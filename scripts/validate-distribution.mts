import { argumentsFor, entrypoint, json } from "./toolchain-core.mjs";
import { validateDistributions } from "./toolchain-distribution.mjs";

export {
  validateDistributions,
  validateSkillDirectory,
  skillFrontmatter,
} from "./toolchain-distribution.mjs";

await entrypoint(import.meta.url, async () => {
  const args = argumentsFor(process.argv.slice(2), ["skill"]);
  if (args.positional.length) throw new Error("Usage: validate-distribution [--skill NAME]");
  process.stdout.write(json(await validateDistributions(process.cwd(), args.values.get("skill"))));
});
