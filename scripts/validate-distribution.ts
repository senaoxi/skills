import { argumentsFor, entrypoint, json } from "./toolchain-core.ts";
import { validateDistributions } from "./toolchain-distribution.ts";

export {
  validateDistributions,
  validateSkillDirectory,
  skillFrontmatter,
} from "./toolchain-distribution.ts";

await entrypoint(import.meta.url, async () => {
  const args = argumentsFor(process.argv.slice(2), ["skill"]);
  if (args.positional.length) throw new Error("Usage: validate-distribution [--skill NAME]");
  process.stdout.write(json(await validateDistributions(process.cwd(), args.values.get("skill"))));
});
