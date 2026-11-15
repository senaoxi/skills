import { lstat, readdir, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  argumentsFor,
  entrypoint,
  exists,
  inside,
  json,
  physicalPath,
  slash,
} from "./toolchain-core.ts";
import { discoverSkills, sourceSolution } from "./toolchain-projects.ts";

export async function cleanTargets(root: string): Promise<string[]> {
  const projects = await sourceSolution(root);
  const targets = new Set<string>();
  const packages = await discoverSkills(root);
  const containers = new Set([root, ...packages.map((pkg) => pkg.directory)]);
  for (const pkg of packages) {
    if (await exists(resolve(pkg.directory, ".build/source-outputs.json")))
      targets.add(resolve(pkg.directory, ".build"));
  }
  for (const project of projects) {
    containers.add(dirname(project.config));
    if (!project.output) continue;
    const components = slash(relative(root, project.output.directory)).split("/");
    const boundary = components.indexOf(".build");
    if (boundary < 0)
      throw new Error(
        `Refusing undeclared build output outside .build: ${project.output.directory}`,
      );
    targets.add(resolve(root, ...components.slice(0, boundary + 1)));
  }
  for (const directory of containers) {
    targets.add(resolve(directory, ".limina"));
    if (await exists(directory)) {
      for (const child of await readdir(directory)) {
        if (/^\.liminainfo(?:\..+)?$/.test(child)) targets.add(resolve(directory, child));
      }
    }
  }
  const ordered = [...targets].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const selected: string[] = [];
  for (const target of ordered) {
    await physicalPath(root, target);
    if (
      target === resolve(root) ||
      !inside(root, target) ||
      inside(resolve(root, "skills"), target)
    ) {
      throw new Error(`Refusing unsafe clean target: ${target}`);
    }
    if ((await exists(target)) && (await lstat(target)).isSymbolicLink())
      throw new Error(`Refusing clean symlink: ${target}`);
    if (!selected.some((parent) => inside(parent, target))) selected.push(target);
  }
  return selected;
}

export async function clean(
  root: string,
  dryRun = false,
): Promise<{ removed: string[]; dryRun: boolean }> {
  const targets = await cleanTargets(root);
  const removed: string[] = [];
  for (const target of targets) {
    if (!(await exists(target))) continue;
    if (!dryRun) await rm(target, { recursive: true, force: true });
    removed.push(slash(relative(root, target)));
  }
  return { removed, dryRun };
}

await entrypoint(import.meta.url, async () => {
  const args = argumentsFor(process.argv.slice(2), [], ["dry-run"]);
  if (args.positional.length) throw new Error("Usage: clean [--dry-run]");
  process.stdout.write(json(await clean(process.cwd(), args.flags.has("dry-run"))));
});
