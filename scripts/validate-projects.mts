import { argumentsFor, entrypoint, json } from "./toolchain-core.mjs";
import { validateProjects } from "./toolchain-projects.mjs";

export { validateProjects } from "./toolchain-projects.mjs";

await entrypoint(import.meta.url, async () => {
  const args = argumentsFor(process.argv.slice(2), []);
  if (args.positional.length) throw new Error("Usage: validate-projects");
  process.stdout.write(json(await validateProjects(process.cwd())));
});
