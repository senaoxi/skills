import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  argumentsFor,
  copyStatic,
  entrypoint,
  exists,
  filesUnder,
  json,
  physicalPath,
} from "./toolchain-core.ts";
import { skillFrontmatter, validateSkillDirectory } from "./toolchain-distribution.ts";
import { actualSkill, discoverSkills, selectSkills } from "./toolchain-projects.ts";
import type { SkillPackage } from "./toolchain-projects.ts";
import { assembleSource, mergePrepared } from "./toolchain-prepare.ts";
import { artifactInputHash, preparedReceipt } from "./toolchain-provenance.ts";
import { publishLocalArtifacts as publishSkills } from "./skills.ts";
import type { PublishLocalArtifactsOptions } from "./manager-types.ts";

export type LocalSkillArtifact = {
  name: string;
  directory: string;
  packagePath: string;
  inputHash: string;
};
export type LocalPublication = {
  artifacts: LocalSkillArtifact[];
  check: boolean;
  migrate: boolean;
  skill?: string;
};
export type LocalPublisher = (root: string, publication: LocalPublication) => Promise<unknown>;

export const publishLocalArtifacts: LocalPublisher = async (root, publication) => {
  const skills = [];
  for (const artifact of publication.artifacts) skills.push(await preparedReceipt(root, artifact));
  const options = {
    root,
    skills,
    check: publication.check,
    migration: publication.migrate,
    skill: publication.skill,
  } satisfies PublishLocalArtifactsOptions;
  return publishSkills(options);
};

export async function prepareSkill(
  root: string,
  pkg: SkillPackage,
  staging: string,
): Promise<LocalSkillArtifact> {
  pkg = await actualSkill(root, pkg);
  const inputHash = await artifactInputHash(root, pkg.packagePath);
  const directory = resolve(staging, pkg.name);
  await mkdir(directory, { recursive: true });
  const staticDirectory = resolve(pkg.directory, "skills");
  await physicalPath(root, staticDirectory);
  if (!(await exists(staticDirectory)))
    throw new Error(`Missing static skills/ folder: ${pkg.packagePath}`);
  for (const file of await filesUnder(staticDirectory)) {
    if (/\.[cm]?jsx?$/i.test(file))
      throw new Error(
        `Authored JavaScript is forbidden in skills/: ${pkg.packagePath}/skills/${file}`,
      );
  }
  skillFrontmatter(await readFile(resolve(staticDirectory, "SKILL.md"), "utf8"), pkg.name);
  await copyStatic(staticDirectory, directory);
  if (pkg.prepare) await mergePrepared(await assembleSource(pkg, staging), directory);
  await validateSkillDirectory(directory, pkg.name, pkg.resources);
  if ((await artifactInputHash(root, pkg.packagePath)) !== inputHash)
    throw new Error(`Artifact inputs changed during preparation: ${pkg.name}`);
  return { name: pkg.name, directory, packagePath: pkg.packagePath, inputHash };
}

export async function buildSkills(options: {
  root: string;
  skill?: string;
  check?: boolean;
  migrate?: boolean;
  publisher?: LocalPublisher;
}): Promise<unknown> {
  const packages = selectSkills(await discoverSkills(options.root), options.skill);
  const staging = await mkdtemp(resolve(tmpdir(), "skills-toolchain-build-"));
  try {
    const artifacts: LocalSkillArtifact[] = [];
    for (const pkg of packages) artifacts.push(await prepareSkill(options.root, pkg, staging));
    return await (options.publisher ?? publishLocalArtifacts)(options.root, {
      artifacts,
      check: options.check ?? false,
      migrate: options.migrate ?? false,
      ...(options.skill === undefined ? {} : { skill: options.skill }),
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

await entrypoint(import.meta.url, async () => {
  const args = argumentsFor(process.argv.slice(2), ["skill"], ["check", "migrate"]);
  if (args.positional.length)
    throw new Error("Usage: build-skills [--skill NAME] [--check] [--migrate]");
  const result = await buildSkills({
    root: process.cwd(),
    skill: args.values.get("skill"),
    check: args.flags.has("check"),
    migrate: args.flags.has("migrate"),
  });
  process.stdout.write(json(result ?? { ok: true }));
});
