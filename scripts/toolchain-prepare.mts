import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  exists,
  filesUnder,
  inside,
  json,
  physicalPath,
  requireSuccess,
  runCommand,
  slash,
} from "./toolchain-core.mjs";
import { outputManifest, requireCompiled, sourceSolution } from "./toolchain-projects.mjs";
import type { SkillPackage } from "./toolchain-projects.mjs";
import { assertCurrentBuild } from "./toolchain-compile.mjs";
import { hashFile } from "./toolchain-dependencies.mjs";

async function copyFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, await readFile(from));
  await chmod(to, (await lstat(from)).mode & 0o777);
}

/** Give assemblers a disposable package view containing only current JS outputs. */
export async function assembleCurrent(
  root: string,
  pkg: SkillPackage,
  staging: string,
): Promise<string> {
  const compiled = await assertCurrentBuild(root);
  const manifest = outputManifest(await sourceSolution(root)).filter(
    (file) =>
      inside(pkg.directory, file.source) &&
      !relative(pkg.directory, file.source)
        .split(/[\\/]/)
        .some((part) => ["tests", "test", "__tests__", "evals"].includes(part)),
  );
  const assembler = manifest.find(
    (file) => file.output === resolve(pkg.directory, ".build/scripts/assemble.mjs"),
  );
  if (!assembler)
    throw new Error(
      `artifact:prepare is not a current source output: ${pkg.packagePath}/.build/scripts/assemble.mjs`,
    );
  for (const file of manifest) {
    await physicalPath(root, file.output);
    await requireCompiled(file);
    if (!inside(pkg.directory, file.output))
      throw new Error(`Compiled output escapes package: ${file.output}`);
  }
  const view = await realpath(await mkdtemp(resolve(pkg.directory, ".build/.toolchain-prepare-")));
  try {
    for (const file of await filesUnder(pkg.directory, (path) =>
      path
        .split("/")
        .some((part) =>
          [".build", "node_modules", ".limina", "tests", "fixtures", "evals", ".git"].includes(
            part,
          ),
        ),
    )) {
      if (/\.[cm]?[jt]sx?$|\.map$|\.tsbuildinfo$/.test(file)) continue;
      await copyFile(resolve(pkg.directory, file), resolve(view, file));
    }
    const current = [];
    for (const file of manifest) {
      const recorded = compiled.outputs.find(
        (output) => output.output === slash(relative(root, file.output)),
      );
      if (!recorded)
        throw new Error(`Output is absent from successful compile receipt: ${file.output}`);
      const output = resolve(view, relative(pkg.directory, file.output));
      await copyFile(file.output, output);
      if ((await hashFile(output)).sha256 !== recorded.sha256)
        throw new Error(`Compiled output changed while preparing view: ${file.output}`);
      current.push({
        source: await realpath(file.source),
        project: await realpath(file.project),
        output,
        originalOutput: await realpath(file.output),
        sha256: recorded.sha256,
      });
    }
    const dependencies = resolve(pkg.directory, "node_modules");
    const dependencyRoot = (await exists(dependencies))
      ? dependencies
      : resolve(root, "node_modules");
    if (await exists(dependencyRoot))
      await symlink(
        dependencyRoot,
        resolve(view, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
    const manifestPath = resolve(staging, `${pkg.name}-outputs.json`);
    await writeFile(
      manifestPath,
      json({
        version: 2,
        repositoryRoot: await realpath(root),
        packageRoot: await realpath(pkg.directory),
        viewRoot: view,
        compileReceipt: {
          path: compiled.receiptPath,
          inputHash: compiled.inputHash,
          outputHash: compiled.outputHash,
        },
        files: current,
        dependencyFiles: compiled.dependencyFiles,
      }),
    );
    const generated = resolve(staging, `${pkg.name}-generated`);
    await mkdir(generated, { recursive: true });
    requireSuccess(
      await runCommand({
        command: process.execPath,
        args: [resolve(view, ".build/scripts/assemble.mjs"), "--out", generated],
        cwd: view,
        env: { ...process.env, SKILL_BUILD_OUTPUT_MANIFEST: manifestPath },
      }),
      `artifact:prepare for ${pkg.name}`,
    );
    const after = await assertCurrentBuild(root);
    if (after.inputHash !== compiled.inputHash || after.outputHash !== compiled.outputHash)
      throw new Error("Compile inputs or outputs changed during assembly");
    return generated;
  } finally {
    await rm(view, { recursive: true, force: true });
  }
}

export async function mergePrepared(generated: string, destination: string): Promise<void> {
  for (const file of await filesUnder(generated))
    await copyFile(resolve(generated, file), resolve(destination, file));
}
