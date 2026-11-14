import { lstat, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";
import { inside, object, physicalPath } from "./toolchain-core.mjs";
import { outputManifest, sourceSolution } from "./toolchain-projects.mjs";

const recovery = "Run pnpm clean then pnpm build:ts to rebuild native compiler evidence.";
const key = (path: string): string => {
  const absolute = resolve(path);
  return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
};
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${label}`);
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function fileId(value: unknown, count: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > count)
    throw new Error("Invalid compiler input file ID");
  return value;
}
function roots(value: unknown, names: string[]): Set<string> {
  const result = new Set<string>();
  for (const entry of array(value, "build-info roots")) {
    const range = Array.isArray(entry) ? entry : [entry, entry];
    if (range.length !== 2) throw new Error("Invalid compiler root range");
    const first = fileId(range[0], names.length);
    const last = fileId(range[1], names.length);
    if (last < first) throw new Error("Invalid compiler root range");
    for (let id = first; id <= last; id++) {
      const name = names[id - 1];
      if (name === undefined || result.has(name)) throw new Error("Duplicate compiler root");
      result.add(name);
    }
  }
  return result;
}
function noPendingWork(info: Record<string, unknown>, count: number): void {
  for (const flag of ["errors", "checkPending"]) {
    if (info[flag] !== undefined && info[flag] !== false)
      throw new Error(`Compiler ${flag} remains in build-info`);
  }
  // In TS 6, pendingEmit:false encodes a pending full emit, not completion.
  if (info.pendingEmit !== undefined) throw new Error("Compiler pendingEmit remains");
  for (const name of ["changeFileSet", "affectedFilesPendingEmit", "resolvedRoot"]) {
    if (info[name] !== undefined && array(info[name], name).length)
      throw new Error(`Compiler ${name} is pending or unsupported`);
  }
  for (const name of ["semanticDiagnosticsPerFile", "emitDiagnosticsPerFile"]) {
    if (info[name] === undefined) continue;
    for (const entry of array(info[name], name)) {
      // Numeric semantic entries mean an uncached file, not a saved diagnostic.
      if (typeof entry === "number" && name === "semanticDiagnosticsPerFile") {
        fileId(entry, count);
        continue;
      }
      const pair = array(entry, name);
      if (pair.length !== 2) throw new Error(`Invalid ${name}`);
      fileId(pair[0], count);
      if (array(pair[1], name).length)
        throw new Error(`Compiler ${name} still contains diagnostics`);
    }
  }
}
function compilerOptionsMatch(
  current: ts.CompilerOptions,
  recorded: Record<string, unknown>,
  infoDirectory: string,
): void {
  const declarations = array(
    object(ts, "TypeScript runtime").optionDeclarations,
    "TS option declarations",
  );
  const expected: Record<string, unknown> = {};
  const observed: Record<string, unknown> = {};
  const known = new Set<string>();
  for (const entry of declarations) {
    const declaration = object(entry, "TS option declaration");
    if (declaration.affectsBuildInfo !== true) continue;
    const name = text(declaration.name, "TS option name");
    known.add(name);
    const listPaths =
      declaration.type === "list" &&
      object(declaration.element, "TS list option").isFilePath === true;
    const normalize = (value: unknown, base: string): unknown => {
      if (value === undefined) return undefined;
      if (declaration.isFilePath === true) return key(resolve(base, text(value, name)));
      if (listPaths) return array(value, name).map((path) => key(resolve(base, text(path, name))));
      return value;
    };
    if (current[name] !== undefined) expected[name] = normalize(current[name], ".");
    if (recorded[name] !== undefined) observed[name] = normalize(recorded[name], infoDirectory);
  }
  for (const name of Object.keys(recorded)) {
    if (!known.has(name)) throw new Error(`Unsupported recorded compiler option ${name}`);
  }
  if (!isDeepStrictEqual(expected, observed))
    throw new Error("Generated compiler options differ from recorded build-info options");
}

/** Verify the actual TS 6.0.3 output Programs; this does not resolve another import graph. */
export async function assertNativeCompilerEvidence(root: string): Promise<void> {
  try {
    if (ts.version !== "6.0.3" || !ts.sys.createHash)
      throw new Error(`Unsupported compiler evidence format: TypeScript ${ts.version}`);
    const createHash = ts.sys.createHash;
    root = await realpath(root);
    const projects = await sourceSolution(root);
    const expected = new Set(outputManifest(projects).map((file) => key(file.project)));
    if (!expected.size) return;
    const projectByConfig = new Map(projects.map((project) => [key(project.config), project]));
    const reads = new Map<string, { path: string; content: string | undefined }>();
    const observe = (path: string): string | undefined => {
      const content = ts.sys.readFile(path);
      const previous = reads.get(key(path));
      if (previous && previous.content !== content)
        throw new Error(`Compiler input changed during verification: ${path}`);
      reads.set(key(path), { path, content });
      return content;
    };
    const read = (path: string): string => {
      const content = observe(path);
      if (content === undefined) throw new Error(`Missing compiler evidence/input: ${path}`);
      return content;
    };
    const json = (path: string): Record<string, unknown> => {
      const value: unknown = JSON.parse(read(path));
      return object(value, path);
    };
    if (json(resolve(root, "node_modules/limina/package.json")).version !== "0.5.0")
      throw new Error("Native compiler evidence requires installed Limina 0.5.0");
    const generatedRoot = resolve(root, ".limina/tsconfig/checkers/tsc/outputs");
    const evidenceRoot = resolve(root, ".limina/tsbuildinfo/build");
    const regular = async (path: string, boundary: string): Promise<void> => {
      if (!inside(boundary, path))
        throw new Error(`Compiler evidence escapes its output namespace: ${path}`);
      await physicalPath(root, path);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`Invalid compiler evidence file: ${path}`);
    };
    const visited = new Set<string>();
    const found = new Set<string>();
    const versions = new Map<string, string>();
    async function visit(config: string): Promise<void> {
      if (visited.has(key(config))) return;
      visited.add(key(config));
      await regular(config, generatedRoot);
      const loaded = ts.readConfigFile(config, observe);
      if (loaded.error)
        throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
      const raw: unknown = loaded.config;
      const data = object(raw, config);
      const metadata = object(data.liminaOptions, "generated Limina options");
      if (metadata.generated !== true || metadata.checker !== "tsc")
        throw new Error(`Not a generated native tsc output config: ${config}`);
      const owner = key(resolve(dirname(config), text(metadata.sourceConfig, "sourceConfig")));
      const project = projectByConfig.get(owner);
      if (!project) throw new Error(`Unrelated generated sourceConfig: ${config}`);
      const parsed = ts.parseJsonConfigFileContent(
        data,
        { ...ts.sys, readFile: observe },
        dirname(config),
        undefined,
        config,
      );
      if (parsed.errors.length)
        throw new Error(
          parsed.errors
            .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
            .join("\n"),
        );
      if (expected.has(owner)) {
        if (found.has(owner)) throw new Error(`Duplicate compiler evidence for ${project.config}`);
        found.add(owner);
        const options = parsed.options;
        if (
          !project.output ||
          options.composite !== true ||
          options.incremental !== true ||
          options.noEmit !== false ||
          options.noEmitOnError !== true ||
          options.noCheck === true ||
          options.emitDeclarationOnly === true ||
          options.outFile !== undefined ||
          options.strict !== true ||
          key(text(options.rootDir, "rootDir")) !== key(project.output.sourceRoot) ||
          key(text(options.outDir, "outDir")) !== key(project.output.directory)
        )
          throw new Error(`Unsupported or mismatched output compiler config: ${config}`);
        const rootsNow = new Set(parsed.fileNames.map(key));
        if (!isDeepStrictEqual(rootsNow, new Set(project.sources.map(key))))
          throw new Error(
            `Generated compiler roots differ from current source Solution: ${config}`,
          );
        const infoPath = ts.getTsBuildInfoEmitOutputFilePath(options);
        const ownedInfo = resolve(evidenceRoot, `${relative(root, project.config)}.tsbuildinfo`);
        if (!infoPath || key(infoPath) !== key(ownedInfo))
          throw new Error(`Output config points to unrelated build-info: ${config}`);
        await regular(infoPath, evidenceRoot);
        const info = json(infoPath);
        if (info.version !== ts.version) throw new Error(`Compiler version differs in ${infoPath}`);
        const names = array(info.fileNames, "compiler fileNames").map((name) =>
          key(resolve(dirname(infoPath), text(name, "compiler fileName"))),
        );
        const infos = array(info.fileInfos, "compiler fileInfos");
        if (!names.length || names.length !== infos.length || new Set(names).size !== names.length)
          throw new Error(`Missing or inconsistent compiler input versions: ${infoPath}`);
        noPendingWork(info, names.length);
        if (!isDeepStrictEqual(roots(info.root, names), rootsNow))
          throw new Error(`Recorded compiler roots differ from output config: ${infoPath}`);
        compilerOptionsMatch(
          options,
          object(info.options, "recorded compiler options"),
          dirname(infoPath),
        );
        for (let index = 0; index < names.length; index++) {
          const path = names[index];
          if (path === undefined) throw new Error("Missing compiler input name");
          const entry: unknown = infos[index];
          const version = text(
            typeof entry === "string" ? entry : object(entry, "compiler fileInfo").version,
            "compiler input version",
          );
          let current = versions.get(path);
          if (current === undefined) {
            const content = read(path);
            current = createHash(content);
            if (current !== version) {
              // The real incremental host also handles TS's sourceMappingURL normalization.
              // Loading this one SourceFile never constructs or resolves a Program.
              const host = ts.createIncrementalCompilerHost(options, {
                ...ts.sys,
                readFile: observe,
                createHash,
              });
              const file = host.getSourceFile(path, options.target ?? ts.ScriptTarget.Latest);
              if (!file || !("version" in file) || typeof file.version !== "string")
                throw new Error(`Cannot obtain native compiler version for ${path}`);
              current = file.version;
            }
            versions.set(path, current);
          }
          if (current !== version)
            throw new Error(`Native compiler input version is stale: ${path}`);
        }
      }
      for (const reference of parsed.projectReferences ?? []) {
        const path = reference.path.endsWith(".json")
          ? reference.path
          : resolve(reference.path, "tsconfig.json");
        await visit(path);
      }
    }
    await visit(resolve(generatedRoot, "solutions/tsconfig.output.json"));
    for (const config of expected) {
      if (!found.has(config))
        throw new Error(`Missing generated native compiler project: ${config}`);
    }
    for (const { path, content } of reads.values()) {
      if (ts.sys.readFile(path) !== content)
        throw new Error(`Compiler evidence/input changed during verification: ${path}`);
    }
  } catch (error) {
    throw new Error(
      `Native compiler evidence rejected: ${error instanceof Error ? error.message : String(error)}. ${recovery}`,
    );
  }
}
