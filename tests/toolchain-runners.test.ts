import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { currentTests, runTests } from "../scripts/run-tests.ts";
import { runEvals, runnerCommand } from "../scripts/run-evals.ts";
import { exists, object, readJSON, runCommand } from "../scripts/toolchain-core.ts";
import { docsPackage, project, put, solution, temporary } from "./toolchain-fixtures.ts";

test("test selection follows current source membership and unit/integration kinds", async (t) => {
  const root = await temporary(t);
  await put(root, "tests/unit.test.ts", "export {};\n");
  await put(root, "tests/integration/flow.test.ts", "export {};\n");
  await put(root, "tests/unconfigured.test.ts", "throw new Error('unconfigured');\n");
  await put(root, ".build/tests/deleted.test.js", "throw new Error('stale');\n");
  await project(root, "tests", ["unit.test.ts", "integration/flow.test.ts"]);
  await solution(root, ["tests"]);
  assert.deepEqual(await currentTests({ root, kind: "unit" }), [
    resolve(root, "tests/unit.test.ts"),
  ]);
  assert.deepEqual(await currentTests({ root, kind: "integration" }), [
    resolve(root, "tests/integration/flow.test.ts"),
  ]);
  assert.equal((await currentTests({ root })).length, 2);
  await rm(resolve(root, "tests/unit.test.ts"));
  await project(root, "tests", ["integration/flow.test.ts"]);
  assert.equal((await currentTests({ root, kind: "unit" })).length, 0);
});

test("test scope selects a skill package, without running root tests", async (t) => {
  const root = await temporary(t);
  await docsPackage(root);
  await put(root, "tests/root.test.ts", "export {};\n");
  await put(root, "packages/example/tests/local.test.ts", "export {};\n");
  await project(root, "tests", ["root.test.ts"]);
  await project(root, "packages/example/tests", ["local.test.ts"], "../.build/tests");
  await solution(root, ["tests", "packages/example/tests"]);
  const tests = await currentTests({ root, skill: "example" });
  assert.deepEqual(tests, [resolve(root, "packages/example/tests/local.test.ts")]);
  await assert.rejects(currentTests({ root, skill: "missing" }), /Unknown skill/);
});

test("single-skill tests run with TypeScript dependencies and no compiled outputs", async (t) => {
  const root = await temporary(t);
  const pkg = await docsPackage(root);
  await put(pkg, "runtime/current.ts", "export const current: number = 42;\n");
  await put(
    pkg,
    "tests/runtime.test.ts",
    "import test from 'node:test'; import assert from 'node:assert/strict'; import {writeFile} from 'node:fs/promises'; import {current} from '../runtime/current.ts'; test('source runtime', async()=>{assert.equal(current,42); await writeFile('runtime-executed',String(current));});\n",
  );
  await project(pkg, "runtime", ["current.ts"], "../.build/runtime");
  await project(pkg, "tests", ["runtime.test.ts"], "../.build/tests");
  await solution(pkg, ["runtime", "tests"]);
  await solution(root, ["packages/example"]);
  const cli = fileURLToPath(new URL("../scripts/skill-task.ts", import.meta.url));
  const result = await runCommand({
    command: process.execPath,
    args: [cli, "example", "test", "--kind", "unit"],
    cwd: root,
  });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(await readFile(resolve(root, "runtime-executed"), "utf8"), "42");
  assert.equal(await exists(resolve(root, ".build")), false);
  assert.equal(await exists(resolve(pkg, ".build")), false);
});

test("test runner uses current sources and reports failing or missing tests", async (t) => {
  const root = await temporary(t);
  await put(root, "package.json", { private: true, type: "module" });
  await put(
    root,
    "tests/work.test.ts",
    "import test from 'node:test'; import {writeFile} from 'node:fs/promises'; const text: string = 'yes'; test('source fixture',async()=>{await writeFile('executed',text);});\n",
  );
  await project(root, "tests", ["work.test.ts"]);
  await solution(root, ["tests"]);
  await put(root, ".build/tests/work.test.js", "throw new Error('stale JS');\n");
  const cli = fileURLToPath(new URL("../scripts/run-tests.ts", import.meta.url));
  const run = () => runCommand({ command: process.execPath, args: [cli], cwd: root });
  const success = await run();
  assert.equal(success.code, 0, `${success.stdout}\n${success.stderr}`);
  assert.match(success.stdout, /"tests": 1/);
  assert.equal(await readFile(resolve(root, "executed"), "utf8"), "yes");
  await put(
    root,
    "tests/work.test.ts",
    "import test from 'node:test'; test('failure',()=>{throw new Error('observable failure')});\n",
  );
  const failure = await run();
  assert.equal(failure.code, 1);
  assert.match(failure.stdout, /observable failure/);
  await assert.rejects(runTests({ root, kind: "integration" }), /No current integration tests/);
});

async function evaluation(
  t: Parameters<typeof temporary>[0],
  response = "{pass:true,cost:0.5}",
): Promise<{ root: string; runner: string[] }> {
  const root = await temporary(t);
  const pkg = await docsPackage(root);
  await put(root, "scripts/ordinary.ts", "export const value: number = 1;\n");
  await project(root, "scripts", ["ordinary.ts"]);
  await solution(root, ["scripts"]);
  await put(pkg, "evals/cases/first.json", { id: "first", input: "alpha" });
  await put(pkg, "evals/cases/nested/second.json", {
    cases: [{ id: "second", input: { text: "beta" } }],
  });
  const runner = resolve(root, "fake-runner.mjs");
  await put(
    root,
    "fake-runner.mjs",
    `import {appendFile,readFile} from 'node:fs/promises';
let input=''; for await(const chunk of process.stdin)input+=chunk;
const request=JSON.parse(input);
if(request.model!=='fake-model'||request.budget!==1)throw new Error('request contract');
if(!(await readFile(request.skillDirectory+'/SKILL.md','utf8')).includes('name: example'))throw new Error('missing built skill');
await appendFile('events.log','start\\n');
await new Promise(resolve=>setTimeout(resolve,50));
await appendFile('events.log','end\\n');
process.stdout.write(JSON.stringify(${response}));
`,
  );
  return { root, runner: [process.execPath, runner] };
}

test("eval runner requires explicit argv, and refuses invalid shell-like options", () => {
  assert.deepEqual(runnerCommand('["runner", "--arg", "a b"]'), ["runner", "--arg", "a b"]);
  for (const input of ["runner --model x", "[]", '["runner",2]', '"runner"']) {
    assert.throws(() => runnerCommand(input), /runner|argument/);
  }
});

test("fake eval runner receives built skills, defaults to three repetitions and respects concurrency", async (t) => {
  const { root, runner } = await evaluation(t);
  const result = await runEvals({
    root,
    runner,
    model: "fake-model",
    budget: 1,
    maxBudget: 6,
    concurrency: 2,
  });
  assert.equal(result.runs, 6);
  assert.equal(result.passed, 6);
  assert.equal(result.failed, 0);
  assert.equal(result.reservedBudget, 6);
  assert.equal(result.actualCost, 3);
  assert.equal(result.calls, 6);
  assert.equal(result.unknownCostRuns, 0);
  const events = (await readFile(resolve(root, "events.log"), "utf8")).trim().split("\n");
  let active = 0;
  let maximum = 0;
  for (const event of events) {
    active += event === "start" ? 1 : -1;
    maximum = Math.max(maximum, active);
  }
  assert.equal(active, 0);
  assert.equal(maximum, 2);
  const summary: unknown = JSON.parse(
    await readFile(resolve(result.report, "summary.json"), "utf8"),
  );
  assert.ok(
    summary &&
      typeof summary === "object" &&
      "results" in summary &&
      Array.isArray(summary.results),
  );
  const first: unknown = summary.results[0];
  assert.ok(first && typeof first === "object" && "raw" in first && typeof first.raw === "string");
  const raw: unknown = JSON.parse(await readFile(resolve(result.report, first.raw), "utf8"));
  assert.ok(raw && typeof raw === "object" && "execution" in raw && "request" in raw);
});

test("eval budget and parameter preflight prevent every subprocess call", async (t) => {
  const { root, runner } = await evaluation(t);
  const base = { root, runner, model: "fake-model", budget: 1, maxBudget: 5 };
  await assert.rejects(runEvals(base), /exceeds max budget.*no calls dispatched/);
  for (const update of [
    { budget: 0 },
    { budget: Number.NaN },
    { maxBudget: 0 },
    { repetitions: 0 },
    { concurrency: 33 },
    { timeoutMs: -1 },
    { model: "" },
    { runner: [] },
  ]) {
    await assert.rejects(runEvals({ ...base, maxBudget: 1000, ...update }));
  }
  assert.equal(await exists(resolve(root, "events.log")), false);
  assert.equal(await exists(resolve(root, "reports")), false);
});

test("eval failures retain raw reports for invalid JSON, overspending and nonzero exit", async (t) => {
  for (const body of [
    "process.stdout.write('not-json')",
    "process.stdout.write(JSON.stringify({pass:true,cost:2}))",
    "process.stderr.write('raw diagnostic');process.exitCode=7",
  ]) {
    const { root, runner } = await evaluation(t);
    await put(root, "fake-runner.mjs", body);
    const result = await runEvals({
      root,
      runner,
      model: "fake-model",
      budget: 1,
      maxBudget: 2,
      repetitions: 1,
    });
    assert.equal(result.failed, 2);
    if (body.includes("cost:2")) {
      assert.equal(result.actualCost, 2);
      assert.equal(result.calls, 1);
      assert.equal(result.unknownCostRuns, 1);
    }
    const summary = await readFile(resolve(result.report, "summary.json"), "utf8");
    assert.match(summary, /Runner stdout|exceeded per-call budget|Runner exited 7/);
    assert.equal(await exists(resolve(result.report, "summary.json")), true);
  }
});

test("eval timeout terminates a hanging runner and records the timeout", async (t) => {
  const { root, runner } = await evaluation(t);
  await put(root, "fake-runner.mjs", "process.stdout.write('partial');setInterval(()=>{},1000);\n");
  const started = Date.now();
  const result = await runEvals({
    root,
    runner,
    model: "fake-model",
    budget: 1,
    maxBudget: 2,
    repetitions: 1,
    concurrency: 2,
    timeoutMs: 250,
  });
  assert.equal(result.failed, 2);
  assert.ok(Date.now() - started < 10_000);
  assert.match(
    await readFile(resolve(result.report, "summary.json"), "utf8"),
    /Runner timeout after 250ms/,
  );
});

test("directory cases support collections and legacy input while rejecting duplicate IDs across files", async (t) => {
  const { root, runner } = await evaluation(t);
  await put(root, "packages/example/evals/cases.json", [
    { id: "first", input: "duplicate legacy case" },
  ]);
  await assert.rejects(
    runEvals({ root, runner, model: "fake-model", budget: 1, maxBudget: 20 }),
    /Duplicate eval case id/,
  );
  assert.equal(await exists(resolve(root, "events.log")), false);
  await rm(resolve(root, "packages/example/evals/cases"), { recursive: true });
  await put(root, "packages/example/evals/cases.json", [{ id: "legacy", input: "supported" }]);
  const result = await runEvals({ root, runner, model: "fake-model", budget: 1, maxBudget: 3 });
  assert.equal(result.runs, 3);
  assert.equal(result.passed, 3);
});

test("nonzero runner exit retains parsed response, tool traces, raw streams and reported cost", async (t) => {
  const { root, runner } = await evaluation(t);
  const payload = {
    pass: true,
    cost: 0.25,
    modelOutput: { text: "fake model output" },
    toolTraces: [{ tool: "read", arguments: { path: "fixture.md" }, result: "raw tool result" }],
    usage: { inputTokens: 7, outputTokens: 3 },
  };
  await put(
    root,
    "fake-runner.mjs",
    `process.stdout.write(${JSON.stringify(JSON.stringify(payload))}); process.stderr.write('raw tool stderr'); process.exitCode=7;\n`,
  );
  const result = await runEvals({
    root,
    runner,
    model: "fake-model",
    budget: 1,
    maxBudget: 2,
    repetitions: 1,
  });
  assert.equal(result.failed, 2);
  assert.equal(result.actualCost, 0.5);
  assert.equal(result.unknownCostCalls, 0);
  const summary = object(await readJSON(resolve(result.report, "summary.json")), "summary");
  assert.ok(Array.isArray(summary.results));
  const first = object(summary.results[0], "result");
  if (typeof first.raw !== "string") assert.fail("raw report path required");
  const raw = object(await readJSON(resolve(result.report, first.raw)), "raw");
  assert.deepEqual(raw.response, payload);
  assert.equal(object(raw.execution, "execution").stderr, "raw tool stderr");
  assert.deepEqual(raw.costEvidence, { source: "runner-response.cost", reported: 0.25 });
  assert.match(String(object(raw.request, "request").caseFile), /evals\/cases\/.*\.json/);
});

test("timed-out runner preserves complete response and cost evidence emitted before the hang", async (t) => {
  const { root, runner } = await evaluation(t);
  await put(
    root,
    "fake-runner.mjs",
    "process.stdout.write(JSON.stringify({pass:true,cost:0.25,toolTraces:[{tool:'fake',result:'before timeout'}]}));setInterval(()=>{},1000);\n",
  );
  const result = await runEvals({
    root,
    runner,
    model: "fake-model",
    budget: 1,
    maxBudget: 2,
    repetitions: 1,
    concurrency: 2,
    timeoutMs: 300,
  });
  assert.equal(result.failed, 2);
  assert.equal(result.actualCost, 0.5);
  assert.equal(result.unknownCostCalls, 0);
});
