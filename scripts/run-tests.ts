import { relative } from "node:path";
import {
  argumentsFor,
  entrypoint,
  inside,
  json,
  physicalPath,
  requireSuccess,
  runCommand,
  slash,
} from "./toolchain-core.ts";
import { discoverSkills, selectSkills, sourceSolution } from "./toolchain-projects.ts";

export type TestKind = "all" | "unit" | "integration";

export function testKind(value: string): TestKind {
  if (value !== "all" && value !== "unit" && value !== "integration")
    throw new Error("Test kind must be all, unit or integration");
  return value;
}

export async function currentTests(options: {
  root: string;
  skill?: string;
  kind?: TestKind;
}): Promise<string[]> {
  const packages = await discoverSkills(options.root);
  const selected =
    options.skill === undefined ? undefined : selectSkills(packages, options.skill)[0];
  const projects = await sourceSolution(options.root);
  const files = [...new Set(projects.flatMap((project) => project.sources))];
  return files.filter((file) => {
    const path = slash(relative(options.root, file));
    if (!/(?:^|\/)(?:tests?|__tests__)\//.test(path) || !/\.(?:test|spec)\.ts$/.test(path))
      return false;
    if (selected && !inside(selected.directory, file)) return false;
    const integration = /(?:^|\/)integration(?:\/|\.)|\.integration\./.test(path);
    return (
      options.kind === undefined ||
      options.kind === "all" ||
      integration === (options.kind === "integration")
    );
  });
}

export async function runTests(options: {
  root: string;
  skill?: string;
  kind?: TestKind;
}): Promise<{ tests: number }> {
  const tests = await currentTests(options);
  if (!tests.length)
    throw new Error(
      `No current ${options.kind ?? "all"} tests found${options.skill ? ` for ${options.skill}` : ""}`,
    );
  for (const test of tests) await physicalPath(options.root, test);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = await runCommand({
    command: process.execPath,
    args: ["--test", ...tests],
    cwd: options.root,
    env,
    timeoutMs: 300_000,
    maxOutputBytes: 32 * 1024 * 1024,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  requireSuccess(result, "Tests");
  return { tests: tests.length };
}

await entrypoint(import.meta.url, async () => {
  const args = argumentsFor(process.argv.slice(2), ["skill", "kind"], ["unit", "integration"]);
  if (
    args.positional.length ||
    (args.flags.size && (args.values.has("kind") || args.flags.size > 1))
  ) {
    throw new Error("Usage: run-tests [--skill NAME] [--kind all|unit|integration]");
  }
  const kind = testKind(
    args.values.get("kind") ??
      (args.flags.has("unit") ? "unit" : args.flags.has("integration") ? "integration" : "all"),
  );
  process.stdout.write(
    json(await runTests({ root: process.cwd(), skill: args.values.get("skill"), kind })),
  );
});
