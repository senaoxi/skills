import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  argumentsFor,
  entrypoint,
  exists,
  json,
  nonempty,
  numberOption,
  object,
  physicalPath,
  readJSON,
  runCommand,
  slug,
  filesUnder,
} from "./toolchain-core.mjs";
import { prepareSkill } from "./build-skills.mjs";
import { discoverSkills, selectSkills } from "./toolchain-projects.mjs";
import type { SkillPackage } from "./toolchain-projects.mjs";
import { currentBuildIfCompiled } from "./toolchain-compile.mjs";

type EvalCase = { id: string; payload: Record<string, unknown>; pkg: SkillPackage; file: string };
type RunnerResponse = { pass: boolean; cost: number; data: unknown };
export type EvalOptions = {
  root: string;
  skill?: string;
  runner: readonly string[];
  model: string;
  budget: number;
  maxBudget: number;
  repetitions?: number;
  timeoutMs?: number;
  concurrency?: number;
};

export function runnerCommand(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('--runner must be a JSON argv array, e.g. \'["runner","--flag"]\'');
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Error("--runner must be a nonempty JSON argv array");
  return parsed.map((part: unknown) => nonempty(part, "runner argument"));
}

async function casesFor(packages: readonly SkillPackage[]): Promise<EvalCase[]> {
  const cases: EvalCase[] = [];
  for (const pkg of packages) {
    const paths: string[] = [];
    if (await exists(resolve(pkg.directory, "evals/cases.json"))) paths.push("evals/cases.json");
    const directory = resolve(pkg.directory, "evals/cases");
    if (await exists(directory))
      paths.push(
        ...(await filesUnder(directory))
          .filter((file) => file.endsWith(".json"))
          .map((file) => `evals/cases/${file}`),
      );
    const ids = new Set<string>();
    for (const file of paths.sort()) {
      const path = await physicalPath(pkg.directory, resolve(pkg.directory, file));
      const raw = await readJSON(path);
      const data = Array.isArray(raw) ? raw : object(raw, path);
      const items: unknown = Array.isArray(data)
        ? data
        : Object.hasOwn(data, "cases")
          ? data.cases
          : [data];
      if (!Array.isArray(items) || items.length === 0)
        throw new Error(`${path} must contain a nonempty case or cases array`);
      for (const item of items) {
        const payload = object(item, `${path}: case`);
        const id = slug(payload.id, "eval case id");
        if (ids.has(id)) throw new Error(`Duplicate eval case id: ${pkg.name}/${id}`);
        ids.add(id);
        cases.push({ id, payload, pkg, file });
      }
    }
  }
  return cases;
}

function runnerResponse(parsed: unknown): RunnerResponse {
  const response = object(parsed, "runner response");
  if (
    typeof response.pass !== "boolean" ||
    typeof response.cost !== "number" ||
    !Number.isFinite(response.cost) ||
    response.cost < 0
  ) {
    throw new Error("Runner response requires boolean pass and finite nonnegative cost");
  }
  return { pass: response.pass, cost: response.cost, data: parsed };
}

export async function runEvals(options: EvalOptions): Promise<{
  runs: number;
  passed: number;
  failed: number;
  reservedBudget: number;
  actualCost: number;
  calls: number;
  unknownCostRuns: number;
  unknownCostCalls: number;
  report: string;
}> {
  const command = nonempty(options.runner[0], "external runner command");
  const model = nonempty(options.model, "explicit model");
  const budget = numberOption(String(options.budget), 0, "budget");
  const maxBudget = numberOption(String(options.maxBudget), 0, "max budget");
  const repetitions = numberOption(options.repetitions?.toString(), 3, "repetitions", true);
  const timeoutMs = numberOption(options.timeoutMs?.toString(), 60_000, "timeout", true);
  const concurrency = numberOption(options.concurrency?.toString(), 1, "concurrency", true);
  if (repetitions > 100 || concurrency > 32 || timeoutMs > 3_600_000)
    throw new Error("Eval limits: repetitions <= 100, concurrency <= 32, timeout <= 3600000ms");
  for (const part of options.runner) nonempty(part, "runner argument");
  const packages = selectSkills(await discoverSkills(options.root), options.skill);
  await currentBuildIfCompiled(options.root);
  const cases = await casesFor(packages);
  if (!cases.length) throw new Error("No evals/cases/ JSON cases found");
  const reservedBudget = cases.length * repetitions * budget;
  if (!Number.isFinite(reservedBudget) || reservedBudget > maxBudget) {
    throw new Error(
      `Requested eval budget ${reservedBudget} exceeds max budget ${maxBudget}; no calls dispatched`,
    );
  }
  const reports = await physicalPath(options.root, resolve(options.root, "reports/evals"));
  await mkdir(reports, { recursive: true });
  const report = await mkdtemp(
    resolve(reports, `${new Date().toISOString().replace(/[:.]/g, "-")}-`),
  );
  const staging = await mkdtemp(resolve(tmpdir(), "skills-toolchain-evals-"));
  try {
    const artifacts = new Map<string, string>();
    for (const pkg of packages.filter((pkg) => cases.some((item) => item.pkg.name === pkg.name))) {
      artifacts.set(pkg.name, (await prepareSkill(options.root, pkg, staging)).directory);
    }
    const tasks = cases.flatMap((item) =>
      Array.from({ length: repetitions }, (_, repetition) => ({
        item,
        repetition: repetition + 1,
      })),
    );
    const results: {
      skill: string;
      case: string;
      repetition: number;
      pass: boolean;
      cost: number | null;
      error: string | null;
      raw: string;
      dispatched: boolean;
    }[] = [];
    let cursor = 0;
    let stopReason: string | null = null;
    async function worker(): Promise<void> {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        if (!task) return;
        const { item, repetition } = task;
        const raw = `${item.pkg.name}-${item.id}-${repetition}-${randomUUID()}.json`;
        const request = {
          version: 1,
          skill: item.pkg.name,
          skillDirectory: artifacts.get(item.pkg.name),
          case: item.payload,
          caseFile: item.file,
          model,
          repetition,
          budget,
        };
        let response: RunnerResponse | undefined;
        let rawResponse: unknown;
        let reportedCost: number | null = null;
        let error: string | null = null;
        let execution: Awaited<ReturnType<typeof runCommand>> | undefined;
        try {
          if (stopReason !== null)
            throw new Error(`Not dispatched after budget violation: ${stopReason}`);
          execution = await runCommand({
            command,
            args: options.runner.slice(1),
            cwd: options.root,
            input: json(request),
            timeoutMs,
          });
          let invalidJSON = false;
          try {
            const parsed: unknown = JSON.parse(execution.stdout);
            rawResponse = parsed;
          } catch {
            invalidJSON = true;
          }
          if (
            rawResponse !== null &&
            typeof rawResponse === "object" &&
            !Array.isArray(rawResponse)
          ) {
            const data = object(rawResponse, "raw runner response");
            if (typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost >= 0)
              reportedCost = data.cost;
          }
          if (reportedCost !== null && reportedCost > budget)
            stopReason = `Runner exceeded per-call budget: ${reportedCost} > ${budget}`;
          if (execution.timedOut) throw new Error(`Runner timeout after ${timeoutMs}ms`);
          if (execution.overflow) throw new Error("Runner exceeded output limit");
          if (execution.code !== 0)
            throw new Error(`Runner exited ${execution.code ?? execution.signal}`);
          if (invalidJSON) throw new Error("Runner stdout must contain one JSON response");
          response = runnerResponse(rawResponse);
          if (response.cost > budget) {
            stopReason = `Runner exceeded per-call budget: ${response.cost} > ${budget}`;
            throw new Error(stopReason);
          }
        } catch (reason) {
          error = reason instanceof Error ? reason.message : String(reason);
        }
        await writeFile(
          resolve(report, raw),
          json({
            request,
            execution,
            response: rawResponse,
            costEvidence: { source: "runner-response.cost", reported: reportedCost },
            error,
          }),
        );
        results.push({
          skill: item.pkg.name,
          case: item.id,
          repetition,
          pass: error === null && response?.pass === true,
          cost: reportedCost,
          error,
          raw,
          dispatched: execution !== undefined,
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
    results.sort(
      (a, b) =>
        a.skill.localeCompare(b.skill) ||
        a.case.localeCompare(b.case) ||
        a.repetition - b.repetition,
    );
    const passed = results.filter((result) => result.pass).length;
    const summary = {
      runs: results.length,
      passed,
      failed: results.length - passed,
      reservedBudget,
      actualCost: results.reduce((sum, result) => sum + (result.cost ?? 0), 0),
      calls: results.filter((result) => result.dispatched).length,
      unknownCostRuns: results.filter((result) => result.cost === null).length,
      unknownCostCalls: results.filter((result) => result.dispatched && result.cost === null)
        .length,
      report,
    };
    await writeFile(
      resolve(report, "summary.json"),
      json({
        version: 1,
        ...summary,
        model,
        runner: options.runner,
        budget,
        maxBudget,
        repetitions,
        concurrency,
        timeoutMs,
        results,
      }),
    );
    return summary;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function evalCLI(
  root: string,
  argv: readonly string[],
  skill?: string,
): Promise<void> {
  const args = argumentsFor(argv, [
    "skill",
    "runner",
    "model",
    "budget",
    "max-budget",
    "repetitions",
    "timeout",
    "concurrency",
  ]);
  if (args.positional.length) throw new Error("Unexpected eval argument");
  if (skill !== undefined && args.values.has("skill")) throw new Error("Skill is already selected");
  const summary = await runEvals({
    root,
    skill: skill ?? args.values.get("skill"),
    runner: runnerCommand(nonempty(args.values.get("runner"), "--runner")),
    model: nonempty(args.values.get("model"), "--model"),
    budget: numberOption(args.values.get("budget"), 0, "--budget"),
    maxBudget: numberOption(args.values.get("max-budget"), 0, "--max-budget"),
    repetitions: numberOption(args.values.get("repetitions"), 3, "--repetitions", true),
    timeoutMs: numberOption(args.values.get("timeout"), 60_000, "--timeout", true),
    concurrency: numberOption(args.values.get("concurrency"), 1, "--concurrency", true),
  });
  process.stdout.write(json(summary));
  if (summary.failed) process.exitCode = 1;
}

await entrypoint(import.meta.url, async () => evalCLI(process.cwd(), process.argv.slice(2)));
