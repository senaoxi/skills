import { lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import {
  exists,
  localPath,
  nonempty,
  object,
  physicalPath,
  readJSON,
  slug,
  slash,
} from "./toolchain-core.ts";
import { workspaceDirectories } from "./toolchain-workspace.ts";

export const artifactPrepareEntry = "scripts/assemble.ts";
const artifactPrepareCommand = `node ${artifactPrepareEntry}`;

export type SkillPackage = {
  name: string;
  directory: string;
  packagePath: string;
  prepare: boolean;
  resources?: string[];
};

/** Literal paths within a built skill; computed runtime access still needs consumer tests. */
export function skillResources(value: unknown, label = "skillBuild.resources"): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of skill-relative paths`);
  const paths = value.map((entry: unknown) => {
    const path = nonempty(entry, label);
    if (
      isAbsolute(path) ||
      /[\\:#?]/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error(`${label} must contain skill-relative paths without traversal: ${path}`);
    return path;
  });
  if (new Set(paths).size !== paths.length) throw new Error(`${label} contains duplicate paths`);
  return paths;
}

export async function discoverSkills(root: string): Promise<SkillPackage[]> {
  const directory = resolve(root, "packages");
  if (!(await exists(directory))) return [];
  await physicalPath(root, directory);
  const packages: SkillPackage[] = [];
  const workspace = new Set(await workspaceDirectories(root));
  const names = new Set<string>();
  for (const child of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    if (child.isSymbolicLink()) throw new Error(`Package symlink is not allowed: ${child.name}`);
    if (!child.isDirectory()) continue;
    const path = resolve(directory, child.name);
    const manifestPath = resolve(path, "package.json");
    if (!(await exists(manifestPath))) continue;
    const manifest = object(await readJSON(manifestPath), manifestPath);
    if (manifest.skillBuild === undefined) {
      if (workspace.has(path))
        throw new Error(`Workspace package is not discovered by skillBuild: ${path}`);
      continue;
    }
    const build = object(manifest.skillBuild, `${manifestPath}: skillBuild`);
    const name = slug(build.name);
    if (names.has(name)) throw new Error(`Duplicate skillBuild.name: ${name}`);
    names.add(name);
    if (name !== child.name)
      throw new Error(`Package slug must match its directory: ${name} != ${child.name}`);
    if (
      manifest.private !== true ||
      manifest.type !== "module" ||
      manifest.name !== `@senaoxi/skill-${name}`
    ) {
      throw new Error(
        `${manifestPath}: expected private:true, type:module, name:@senaoxi/skill-${name}`,
      );
    }
    if (!workspace.delete(path))
      throw new Error(`Discovered skill is not a workspace member: ${path}`);
    const scripts =
      manifest.scripts === undefined ? {} : object(manifest.scripts, `${manifestPath}: scripts`);
    const prepare = scripts["artifact:prepare"];
    if (prepare !== undefined && prepare !== artifactPrepareCommand) {
      throw new Error(`${manifestPath}: artifact:prepare must be ${artifactPrepareCommand}`);
    }
    packages.push({
      name,
      directory: path,
      packagePath: slash(relative(root, path)),
      prepare: prepare !== undefined,
      ...(build.resources === undefined
        ? {}
        : { resources: skillResources(build.resources, `${manifestPath}: skillBuild.resources`) }),
    });
  }
  if (workspace.size) throw new Error(`Workspace package is not discovered: ${[...workspace][0]}`);
  return packages;
}

export async function actualSkill(root: string, supplied: SkillPackage): Promise<SkillPackage> {
  const actual = (await discoverSkills(root)).find((pkg) => pkg.name === supplied.name);
  if (
    !actual ||
    actual.directory !== supplied.directory ||
    actual.packagePath !== supplied.packagePath ||
    actual.prepare !== supplied.prepare
  ) {
    throw new Error(
      `Prepared package identity does not match workspace metadata: ${supplied.name}`,
    );
  }
  return actual;
}

export function selectSkills(packages: readonly SkillPackage[], name?: string): SkillPackage[] {
  if (name === undefined) return [...packages];
  slug(name);
  const selected = packages.filter((pkg) => pkg.name === name);
  if (selected.length === 0) throw new Error(`Unknown skill: ${name}`);
  return selected;
}

type SourceProject = {
  config: string;
  sources: string[];
  references: string[];
  output: { directory: string } | null;
};

function diagnostics(errors: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(errors, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
}

async function readProject(root: string, config: string): Promise<SourceProject> {
  config = await physicalPath(root, localPath(root, config, "project reference"));
  if ((await lstat(config)).isSymbolicLink())
    throw new Error(`Config symlink is not allowed: ${config}`);
  const loaded = ts.readConfigFile(config, ts.sys.readFile);
  if (loaded.error) throw new Error(diagnostics([loaded.error]));
  const raw: unknown = loaded.config;
  const data = object(raw, config);
  const configFiles = new Set([config]);
  const host: ts.ParseConfigHost = {
    ...ts.sys,
    readFile: (file) => {
      const text = ts.sys.readFile(file);
      if (text !== undefined) configFiles.add(localPath(root, file, "config input"));
      return text;
    },
  };
  const parsed = ts.parseJsonConfigFileContent(data, host, dirname(config), undefined, config);
  if (parsed.errors.length) throw new Error(diagnostics(parsed.errors));
  const sources = parsed.fileNames.map((file) => localPath(root, file, "project source"));
  const references: string[] = [];
  for (const reference of parsed.projectReferences ?? []) {
    let path = localPath(root, reference.path, "project reference");
    if ((await lstat(path)).isDirectory()) path = resolve(path, "tsconfig.json");
    await physicalPath(root, path);
    references.push(path);
  }
  let output: SourceProject["output"] = null;
  if (data.liminaOptions !== undefined) {
    const options = object(data.liminaOptions, `${config}: liminaOptions`);
    if (options.outputs !== undefined) {
      const outputs = object(options.outputs, `${config}: outputs`);
      const sourceRoot = resolve(
        dirname(config),
        nonempty(outputs.rootDir, `${config}: outputs.rootDir`),
      );
      const directory = resolve(
        dirname(config),
        nonempty(outputs.outDir, `${config}: outputs.outDir`),
      );
      await physicalPath(root, sourceRoot);
      await physicalPath(root, directory);
      output = { directory };
    }
  }
  for (const file of configFiles) await physicalPath(root, file);
  return { config, sources, references, output };
}

export async function sourceSolution(
  root: string,
  entry = "tsconfig.json",
): Promise<SourceProject[]> {
  const projects = new Map<string, SourceProject>();
  async function visit(config: string): Promise<void> {
    config = localPath(root, config, "project reference");
    if (projects.has(config)) return;
    const project = await readProject(root, config);
    projects.set(config, project);
    for (const reference of project.references) await visit(reference);
  }
  await visit(localPath(root, entry));
  return [...projects.values()];
}
