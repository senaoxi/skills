import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { exists, filesUnder, json, nonempty, object, readJSON, slash } from "./toolchain-core.ts";
import type { PreparedLocalSkill } from "./manager-types.ts";
import type { LocalSkillArtifact } from "./build-skills.ts";

export async function artifactInputHash(root: string, packagePath: string): Promise<string> {
  const packageDirectory = resolve(root, packagePath);
  const hash = createHash("sha256");
  const inputs = (
    await filesUnder(packageDirectory, (path) =>
      path
        .split("/")
        .some((part) =>
          [".build", "node_modules", ".limina", "tests", "fixtures", "evals", ".git"].includes(
            part,
          ),
        ),
    )
  ).map((path) => resolve(packageDirectory, path));
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "tsconfig.json",
    "limina.config.ts",
    "scripts/tsconfig.json",
    "config/tsconfig.json",
  ]) {
    if (await exists(resolve(root, path))) inputs.push(resolve(root, path));
  }
  const scriptDirectory = resolve(root, "scripts");
  if (await exists(scriptDirectory)) {
    for (const path of await filesUnder(
      scriptDirectory,
      (path, directory) => directory || !/\.ts$/.test(path),
    )) {
      inputs.push(resolve(scriptDirectory, path));
    }
  }
  for (const path of inputs.sort()) {
    hash.update(json([slash(relative(root, path)), (await lstat(path)).mode & 0o111]));
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function preparedReceipt(
  root: string,
  artifact: LocalSkillArtifact,
): Promise<PreparedLocalSkill> {
  const rootManifest = object(await readJSON(resolve(root, "package.json")), "root package.json");
  const dependencies = object(rootManifest.devDependencies, "root devDependencies");
  const packageManifestPath = resolve(root, artifact.packagePath, "package.json");
  const packageManifest = object(await readJSON(packageManifestPath), packageManifestPath);
  const rolldown =
    packageManifest.devDependencies === undefined
      ? undefined
      : object(packageManifest.devDependencies, `${artifact.packagePath} devDependencies`).rolldown;
  const toolchain = {
    recipe: "skills-local-build-v2",
    node: nonempty(object(rootManifest.engines, "root engines").node, "configured Node engines"),
    pnpm: nonempty(rootManifest.packageManager, "root packageManager"),
    limina: nonempty(dependencies.limina, "configured Limina version"),
    typescript: nonempty(dependencies.typescript, "configured TypeScript version"),
    yaml: nonempty(dependencies.yaml, "configured YAML version"),
    ...(rolldown === undefined
      ? {}
      : { rolldown: nonempty(rolldown, "configured Rolldown version") }),
  };
  const files: PreparedLocalSkill["files"][number][] = [];
  for (const path of await filesUnder(artifact.directory)) {
    const absolute = resolve(artifact.directory, path);
    files.push({
      path,
      sha256: createHash("sha256")
        .update(await readFile(absolute))
        .digest("hex"),
      executable: ((await lstat(absolute)).mode & 0o111) !== 0,
    });
  }
  if ((await artifactInputHash(root, artifact.packagePath)) !== artifact.inputHash)
    throw new Error(`Artifact inputs changed before publication: ${artifact.name}`);
  return {
    path: artifact.directory,
    name: artifact.name,
    packageDir: artifact.packagePath,
    inputHash: artifact.inputHash,
    files,
    toolchain,
  };
}
