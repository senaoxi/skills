import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  argumentsFor,
  copyStatic,
  entrypoint,
  exists,
  json,
  physicalPath,
  filesUnder,
} from "./toolchain-core.mjs";
import { skillFrontmatter, validateSkillDirectory } from "./toolchain-distribution.mjs";
import { readFile } from "node:fs/promises";
import { actualSkill, discoverSkills, selectSkills } from "./toolchain-projects.mjs";
import type { SkillPackage } from "./toolchain-projects.mjs";
import { assembleCurrent, mergePrepared } from "./toolchain-prepare.mjs";
import { preparedReceipt } from "./toolchain-provenance.mjs";
import { publishLocalArtifacts as publishSkills } from "./skills.mjs";
import type { PublishLocalArtifactsOptions } from "./manager-types.mjs";
import { currentBuildIfCompiled } from "./toolchain-compile.mjs";

export type LocalSkillArtifact = { name: string; directory: string; packagePath: string };
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
  await currentBuildIfCompiled(root);
  const directory = resolve(staging, pkg.name);
  await mkdir(directory, { recursive: true });
  const staticDirectory = resolve(pkg.directory, "skill");
  await physicalPath(root, staticDirectory);
  if (!(await exists(staticDirectory)))
    throw new Error(`Missing static skill/ folder: ${pkg.packagePath}`);
  for (const file of await filesUnder(staticDirectory)) {
    if (/\.[cm]?jsx?$/i.test(file))
      throw new Error(
        `Authored JavaScript is forbidden in skill/: ${pkg.packagePath}/skill/${file}`,
      );
  }
  skillFrontmatter(await readFile(resolve(staticDirectory, "SKILL.md"), "utf8"), pkg.name);
  await copyStatic(staticDirectory, directory);
  if (pkg.prepare) {
    await mergePrepared(await assembleCurrent(root, pkg, staging), directory);
  }
  await validateSkillDirectory(directory, pkg.name, pkg.resources);
  return { name: pkg.name, directory, packagePath: pkg.packagePath };
}

export async function buildSkills(options: {
  root: string;
  skill?: string;
  check?: boolean;
  migrate?: boolean;
  publisher?: LocalPublisher;
}): Promise<unknown> {
  const packages = selectSkills(await discoverSkills(options.root), options.skill);
  await currentBuildIfCompiled(options.root);
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
