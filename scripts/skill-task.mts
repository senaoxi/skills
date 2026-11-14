import { argumentsFor, entrypoint, json } from "./toolchain-core.mjs";
import { buildSkills } from "./build-skills.mjs";
import { discoverSkills, selectSkills } from "./toolchain-projects.mjs";
import { validateDistributions } from "./toolchain-distribution.mjs";
import { runTests, testKind } from "./run-tests.mjs";
import { evalCLI } from "./run-evals.mjs";

export async function skillTask(root: string, argv: readonly string[]): Promise<unknown> {
  const [name, task, ...rest] = argv;
  if (!name || !task) throw new Error("Usage: skill NAME build|check|test|eval|validate [options]");
  selectSkills(await discoverSkills(root), name);
  if (task === "eval") return evalCLI(root, rest, name);
  if (task === "build" || task === "check") {
    const args = argumentsFor(rest, [], ["check", "migrate"]);
    if (args.positional.length) throw new Error("Unexpected build argument");
    return buildSkills({
      root,
      skill: name,
      check: task === "check" || args.flags.has("check"),
      migrate: args.flags.has("migrate"),
    });
  }
  if (task === "test") {
    const args = argumentsFor(rest, ["kind"], ["unit", "integration"]);
    if (
      args.positional.length ||
      (args.flags.size && (args.values.has("kind") || args.flags.size > 1))
    )
      throw new Error("Choose one test kind");
    return runTests({
      root,
      skill: name,
      kind: testKind(
        args.values.get("kind") ??
          (args.flags.has("unit") ? "unit" : args.flags.has("integration") ? "integration" : "all"),
      ),
    });
  }
  if (task === "validate") {
    if (rest.length) throw new Error("Unexpected validate argument");
    return validateDistributions(root, name);
  }
  throw new Error(`Unknown skill task: ${task}`);
}

await entrypoint(import.meta.url, async () => {
  const result = await skillTask(process.cwd(), process.argv.slice(2));
  if (result !== undefined) process.stdout.write(json(result));
});
