import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { exists, filesUnder, json, nonempty, object, readJSON, slash } from "./toolchain-core.mjs";
import type { PreparedLocalSkill } from "./manager-types.mjs";
import type { LocalSkillArtifact } from "./build-skills.mjs";

export async function preparedReceipt(
  root: string,
  artifact: LocalSkillArtifact,
): Promise<PreparedLocalSkill> {
  const packageDirectory = resolve(root, artifact.packagePath);
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
    "limina.config.mts",
    "scripts/tsconfig.json",
    "config/tsconfig.json",
  ]) {
    if (await exists(resolve(root, path))) inputs.push(resolve(root, path));
  }
  const scriptDirectory = resolve(root, "scripts");
  if (await exists(scriptDirectory)) {
    for (const path of await filesUnder(
      scriptDirectory,
      (path, directory) => directory || !/\.mts$/.test(path),
    )) {
      inputs.push(resolve(scriptDirectory, path));
    }
  }
  for (const path of inputs.sort()) {
    hash.update(json([slash(relative(root, path)), (await lstat(path)).mode & 0o111]));
    hash.update(await readFile(path));
    hash.update("\0");
  }
  const rootManifest = object(await readJSON(resolve(root, "package.json")), "root package.json");
  const dependencies = object(rootManifest.devDependencies, "root devDependencies");
  const toolchain = {
    recipe: "skills-local-build-v1",
    node: nonempty(object(rootManifest.engines, "root engines").node, "configured Node engines"),
    pnpm: nonempty(rootManifest.packageManager, "root packageManager"),
    limina: nonempty(dependencies.limina, "configured Limina version"),
    typescript: ts.version,
    yaml: nonempty(dependencies.yaml, "configured YAML version"),
  };
  hash.update(json(toolchain));
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
  return {
    path: artifact.directory,
    name: artifact.name,
    packageDir: artifact.packagePath,
    inputHash: hash.digest("hex"),
    files,
    toolchain,
  };
}
