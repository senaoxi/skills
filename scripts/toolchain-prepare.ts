import { chmod, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exists, filesUnder, physicalPath, requireSuccess, runCommand } from "./toolchain-core.ts";
import { artifactPrepareEntry } from "./toolchain-projects.ts";
import type { SkillPackage } from "./toolchain-projects.ts";

async function copyFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, await readFile(from));
  await chmod(to, (await lstat(from)).mode & 0o777);
}

export async function assembleSource(pkg: SkillPackage, staging: string): Promise<string> {
  const assembler = await physicalPath(pkg.directory, resolve(pkg.directory, artifactPrepareEntry));
  if (!(await exists(assembler)) || !(await lstat(assembler)).isFile())
    throw new Error(`Missing artifact:prepare source: ${pkg.packagePath}/${artifactPrepareEntry}`);
  const generated = await mkdtemp(resolve(staging, ".generated-"));
  requireSuccess(
    await runCommand({
      command: process.execPath,
      args: [assembler, "--out", generated],
      cwd: pkg.directory,
    }),
    `artifact:prepare for ${pkg.name}`,
  );
  return generated;
}

export async function mergePrepared(generated: string, destination: string): Promise<void> {
  for (const file of await filesUnder(generated))
    await copyFile(resolve(generated, file), resolve(destination, file));
}
