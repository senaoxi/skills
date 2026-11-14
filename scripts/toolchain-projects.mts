import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import {
  exists,
  filesUnder,
  inside,
  localPath,
  nonempty,
  object,
  physicalPath,
  readJSON,
  slug,
  slash,
} from "./toolchain-core.mjs";
import { workspaceDirectories } from "./toolchain-workspace.mjs";

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
    if (prepare !== undefined && prepare !== "node .build/scripts/assemble.mjs") {
      throw new Error(`${manifestPath}: artifact:prepare must be node .build/scripts/assemble.mjs`);
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

export type OutputFile = { source: string; output: string; project: string };
export type SourceProject = {
  config: string;
  sources: string[];
  references: string[];
  parsed: ts.ParsedCommandLine;
  output: { sourceRoot: string; directory: string } | null;
  configFiles: string[];
};

function diagnostics(errors: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(errors, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
}

function disablesChecking(source: string): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      (token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia) &&
      /@ts-nocheck\b/.test(scanner.getTokenText())
    )
      return true;
  }
  return false;
}

export async function readProject(root: string, config: string): Promise<SourceProject> {
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
      output = { sourceRoot, directory };
    }
  }
  for (const file of configFiles) await physicalPath(root, file);
  return { config, sources, references, parsed, output, configFiles: [...configFiles].sort() };
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

export function outputManifest(projects: readonly SourceProject[]): OutputFile[] {
  const files: OutputFile[] = [];
  const owners = new Map<string, string>();
  for (const project of projects) {
    if (!project.output) {
      if (project.sources.some((file) => !/\.d\.[cm]?ts$/.test(file))) {
        throw new Error(`Missing mandatory liminaOptions.outputs in ${project.config}`);
      }
      continue;
    }
    const commandLine: ts.ParsedCommandLine = {
      ...project.parsed,
      options: {
        ...project.parsed.options,
        configFilePath: project.config,
        rootDir: project.output.sourceRoot,
        outDir: project.output.directory,
        noEmit: false,
        emitDeclarationOnly: false,
        declaration: false,
        declarationMap: false,
        sourceMap: false,
        inlineSourceMap: false,
      },
    };
    for (const source of project.sources) {
      if (/\.d\.[cm]?ts$/.test(source)) continue;
      if (!inside(project.output.sourceRoot, source))
        throw new Error(`Source is outside outputs.rootDir: ${source}`);
      for (const output of ts.getOutputFileNames(
        commandLine,
        source,
        !ts.sys.useCaseSensitiveFileNames,
      )) {
        if (!/\.[cm]?js$/.test(output)) continue;
        const previous = owners.get(output);
        if (previous && previous !== source)
          throw new Error(`Overlapping output owners: ${previous}, ${source}: ${output}`);
        owners.set(output, source);
        files.push({ source, output, project: project.config });
      }
    }
  }
  return files;
}

export async function requireCompiled(file: OutputFile): Promise<void> {
  if (!(await exists(file.output)))
    throw new Error(`Missing compiled output ${file.output}; run the native Limina build first`);
  const info = await lstat(file.output);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Invalid compiled output: ${file.output}`);
}

export async function validateProjects(
  root: string,
): Promise<{ projects: number; sources: number }> {
  const projects = await sourceSolution(root);
  const ownedFiles: string[] = [];
  const ignored = (name: string): boolean =>
    name
      .split("/")
      .some((part) => ["node_modules", ".build", ".git", "fixtures", "reports"].includes(part));
  for (const area of ["scripts", "tests", "packages"]) {
    const directory = resolve(root, area);
    if (await exists(directory)) {
      for (const path of await filesUnder(directory, ignored)) {
        if (/\.[cm]?[jt]sx?$/.test(path)) ownedFiles.push(resolve(directory, path));
      }
    }
  }
  if (await exists(resolve(root, "limina.config.mts")))
    ownedFiles.push(resolve(root, "limina.config.mts"));
  const ownership = new Map<string, string>();
  for (const project of projects) {
    const { options } = project.parsed;
    if (options.allowJs) throw new Error(`allowJs is forbidden: ${project.config}`);
    if (options.noCheck) throw new Error(`noCheck is forbidden: ${project.config}`);
    if (project.sources.length && options.strict !== true)
      throw new Error(`strict must be enabled: ${project.config}`);
    if (project.sources.length && !project.output)
      throw new Error(`Missing mandatory liminaOptions.outputs in ${project.config}`);
    if (
      project.output &&
      !slash(relative(root, project.output.directory)).split("/").includes(".build")
    ) {
      throw new Error(`Output must be inside a declared .build directory: ${project.config}`);
    }
    for (const source of project.sources) {
      await physicalPath(root, source);
      const previous = ownership.get(source);
      if (previous && previous !== project.config)
        throw new Error(`Overlapping project owners: ${source}: ${previous}, ${project.config}`);
      ownership.set(source, project.config);
      if (/\.[cm]?jsx?$/.test(source))
        throw new Error(`Authored JavaScript is forbidden: ${source}`);
      if (!source.endsWith(".mts")) throw new Error(`Owned TypeScript must use .mts: ${source}`);
      if (disablesChecking(await readFile(source, "utf8"))) {
        throw new Error(`@ts-nocheck is forbidden: ${source}`);
      }
    }
  }
  for (const file of ownedFiles) {
    if (/\.[cm]?jsx?$/.test(file)) throw new Error(`Authored JavaScript is forbidden: ${file}`);
    if (!file.endsWith(".mts")) throw new Error(`Owned TypeScript must use .mts: ${file}`);
    if (!ownership.has(file))
      throw new Error(`Owned TypeScript is not reachable from the source Solution: ${file}`);
  }
  const emitted = outputManifest(projects);
  for (const pkg of await discoverSkills(root)) {
    const code = ownedFiles.filter((file) => inside(pkg.directory, file));
    if (code.length === 0 && (await exists(resolve(pkg.directory, "tsconfig.json")))) {
      throw new Error(`Docs-only package must not have an empty tsconfig: ${pkg.packagePath}`);
    }
    if (code.length) {
      const solution = projects.find(
        (project) => project.config === resolve(pkg.directory, "tsconfig.json"),
      );
      if (!solution || solution.sources.length || !solution.references.length)
        throw new Error(
          `Code-bearing package source Solution is not reachable: ${pkg.packagePath}/tsconfig.json`,
        );
    }
    for (const file of emitted.filter((file) => inside(pkg.directory, file.source))) {
      if (!inside(pkg.directory, file.output))
        throw new Error(`Package output escapes package: ${file.output}`);
    }
  }
  return { projects: projects.length, sources: ownership.size };
}
