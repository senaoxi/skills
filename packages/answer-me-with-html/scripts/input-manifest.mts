import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface SourceOutput {
  source: string;
  output: string;
  project: string;
}
interface HashedOutput extends SourceOutput {
  sha256: string;
  executable: boolean;
}
interface HashedFile {
  path: string;
  sha256: string;
  executable: boolean;
}
export interface CompiledInputs {
  packageRoot: string;
  originalPackageRoot: string;
  outputs: ReadonlySet<string>;
  assertOutput(path: string): void;
  assertDependency(path: string): void;
}

export const pathKey = (path: string): string =>
  process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
export function within(base: string, file: string): boolean {
  const rel = relative(base, file);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
export function record(value: unknown, description: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${description}: expected an object`);
  return value as Record<string, unknown>;
}
export function readRecord(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  return record(value, file);
}
function absolute(value: unknown, description: string): string {
  if (typeof value !== "string" || !isAbsolute(value))
    throw new Error(`Invalid ${description}: expected an absolute path`);
  return resolve(value);
}
function hash(value: unknown, description: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new Error(`Invalid ${description}: expected a SHA-256 digest`);
  return value;
}
function array(value: unknown, description: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${description}: expected an array`);
  return value;
}
function physicalFile(path: string): string {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Invalid native build file: ${path}`);
  return realpathSync(path);
}
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
const digest = (value: unknown): string =>
  createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest("hex");
function assertHash(path: string, expected: string, executable?: boolean): void {
  physicalFile(path);
  if (
    sha256(path) !== expected ||
    (executable !== undefined && ((lstatSync(path).mode & 0o111) !== 0) !== executable)
  )
    throw new Error(
      `Native build file hash or mode differs from successful compile receipt: ${path}`,
    );
}
function receiptPath(root: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    isAbsolute(value) ||
    value.split(/[\\/]/).some((part) => part === ".." || part === "." || part === "")
  )
    throw new Error("Invalid repository-relative successful compile receipt path");
  const path = physicalFile(resolve(root, value));
  if (!within(root, path))
    throw new Error(`Successful compile receipt path escapes repository: ${path}`);
  return path;
}
function hashedFiles(root: string, value: unknown, description: string): Map<string, HashedFile> {
  const result = new Map<string, HashedFile>();
  for (const item of array(value, description)) {
    const row = record(item, description);
    const path = receiptPath(root, row.path);
    const checksum = hash(row.sha256, description);
    if (typeof row.executable !== "boolean")
      throw new Error(`Invalid executable flag in ${description}`);
    const key = pathKey(path);
    if (result.has(key)) throw new Error(`Duplicate successful compile receipt file: ${path}`);
    assertHash(path, checksum, row.executable);
    result.set(key, { path, sha256: checksum, executable: row.executable });
  }
  return result;
}
function dependencyFiles(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of array(value, "dependency file allowlist")) {
    const row = record(item, "dependency file allowlist row");
    const path = physicalFile(absolute(row.path, "dependency file"));
    const key = pathKey(path);
    if (result.has(key)) throw new Error(`Duplicate dependency file allowlist entry: ${path}`);
    result.set(key, hash(row.sha256, "dependency file hash"));
  }
  return result;
}
function sameMap(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  return (
    left.size === right.size && [...left].every(([path, checksum]) => right.get(path) === checksum)
  );
}

/** Consume the producer's receipt and output map; never reconstruct a TypeScript graph. */
export function compiledInputs(
  packageRoot: string,
  manifestFile = process.env.SKILL_BUILD_OUTPUT_MANIFEST ??
    resolve(packageRoot, ".build/source-outputs.json"),
): CompiledInputs {
  packageRoot = realpathSync(packageRoot);
  if (!isAbsolute(manifestFile)) throw new Error("Compiled output manifest must be absolute");
  let data: Record<string, unknown>;
  try {
    physicalFile(manifestFile);
    data = readRecord(manifestFile);
  } catch (cause) {
    throw new Error(
      `Cannot read current compiled output manifest ${manifestFile}; run the root build:ts receipt command first`,
      { cause },
    );
  }
  if (
    (data.version !== 1 && data.version !== 2) ||
    !Array.isArray(data.files) ||
    data.files.length === 0
  )
    throw new Error("Invalid compiled output manifest: expected version 1 or 2 and nonempty files");
  const pointer = record(data.compileReceipt, "successful compile receipt pointer");
  const globalPath = physicalFile(absolute(pointer.path, "successful compile receipt"));
  const repositoryRoot = realpathSync(dirname(dirname(dirname(globalPath))));
  if (
    pathKey(globalPath) !==
    pathKey(resolve(repositoryRoot, ".build/toolchain/compile-receipt.json"))
  )
    throw new Error("Compile receipt must be the global successful compile receipt");
  const receiptChecksum = sha256(globalPath);
  const receipt = readRecord(globalPath);
  if (
    receipt.version !== 1 ||
    receipt.kind !== "successful-native-build" ||
    receipt.entry !== "tsconfig.json"
  )
    throw new Error("Invalid global successful compile receipt");
  const inputHash = hash(receipt.inputHash, "successful compile input hash");
  const outputHash = hash(receipt.outputHash, "successful compile output hash");
  if (
    hash(pointer.inputHash, "compile receipt pointer input hash") !== inputHash ||
    hash(pointer.outputHash, "compile receipt pointer output hash") !== outputHash
  )
    throw new Error("Compiled output manifest does not match global successful compile receipt");
  const compiler = record(receipt.compiler, "successful compiler identity");
  if (
    typeof compiler.typescript !== "string" ||
    !compiler.typescript ||
    typeof compiler.node !== "string" ||
    !compiler.node
  )
    throw new Error("Invalid successful compiler identity");
  if (
    digest({
      compiler: receipt.compiler,
      inputs: receipt.inputs,
      dependencyInputs: receipt.dependencyInputs,
      links: receipt.dependencyLinks,
    }) !== inputHash ||
    digest(receipt.outputs) !== outputHash
  )
    throw new Error("Global successful compile receipt hashes are inconsistent");
  const inputs = hashedFiles(repositoryRoot, receipt.inputs, "successful compile inputs");
  const dependencyInputs = hashedFiles(
    repositoryRoot,
    receipt.dependencyInputs,
    "successful dependency inputs",
  );
  for (const item of array(receipt.dependencyLinks, "successful dependency links")) {
    const link = record(item, "successful dependency link");
    if (
      typeof link.path !== "string" ||
      typeof link.target !== "string" ||
      isAbsolute(link.path) ||
      isAbsolute(link.target)
    )
      throw new Error("Invalid successful dependency link");
    const path = resolve(repositoryRoot, link.path);
    const target = resolve(repositoryRoot, link.target);
    if (
      !within(repositoryRoot, path) ||
      !within(repositoryRoot, target) ||
      !lstatSync(path).isSymbolicLink() ||
      pathKey(realpathSync(path)) !== pathKey(target)
    )
      throw new Error(`Dependency link differs from successful compile receipt: ${path}`);
  }
  const originals = new Map<string, HashedOutput>();
  for (const item of array(receipt.outputs, "successful compile outputs")) {
    const row = record(item, "successful compile output");
    const source = receiptPath(repositoryRoot, row.source);
    const project = receiptPath(repositoryRoot, row.project);
    const output = receiptPath(repositoryRoot, row.output);
    const checksum = hash(row.sha256, "successful output hash");
    if (
      typeof row.executable !== "boolean" ||
      !inputs.has(pathKey(source)) ||
      !inputs.has(pathKey(project))
    )
      throw new Error(`Output source/project is absent from successful compile inputs: ${output}`);
    if (originals.has(pathKey(output))) throw new Error(`Duplicate successful output: ${output}`);
    assertHash(output, checksum, row.executable);
    originals.set(pathKey(output), {
      source,
      project,
      output,
      sha256: checksum,
      executable: row.executable,
    });
  }
  const globalDependencies = dependencyFiles(receipt.dependencyFiles);
  for (const [path, checksum] of globalDependencies) {
    if (dependencyInputs.get(path)?.sha256 !== checksum || inputs.has(path) || originals.has(path))
      throw new Error(`Dependency allowlist differs from successful compile inputs: ${path}`);
  }
  const allowedDependencies =
    data.dependencyFiles === undefined && data.version === 1
      ? globalDependencies
      : dependencyFiles(data.dependencyFiles);
  if (!sameMap(allowedDependencies, globalDependencies))
    throw new Error("Dependency file allowlist does not match global successful compile receipt");

  const files = data.files.map((value: unknown) => {
    const row = record(value, "compiled output row");
    return {
      source: absolute(row.source, "compiled source"),
      output: absolute(row.output, "compiled output"),
      project: absolute(row.project, "compiled project"),
      originalOutput:
        data.version === 2
          ? absolute(row.originalOutput, "original compiled output")
          : absolute(row.output, "compiled output"),
      sha256: data.version === 2 ? hash(row.sha256, "compiled output hash") : undefined,
    };
  });
  const entry = realpathSync(resolve(packageRoot, ".build/scripts/assemble.mjs"));
  const assembler = files.filter((file) => pathKey(realpathSync(file.output)) === pathKey(entry));
  if (assembler.length !== 1 || !assembler[0]?.source.endsWith(`${sep}scripts${sep}assemble.mts`))
    throw new Error("Compiled output manifest must contain the current assembler mapping");
  const originalPackageRoot = realpathSync(dirname(dirname(assembler[0].source)));
  if (!within(repositoryRoot, originalPackageRoot))
    throw new Error("Original package escapes compile repository");
  const declared = array(receipt.packages, "successfully compiled packages").some((value) => {
    const pkg = record(value, "successfully compiled package");
    return (
      typeof pkg.packagePath === "string" &&
      !isAbsolute(pkg.packagePath) &&
      pathKey(resolve(repositoryRoot, pkg.packagePath)) === pathKey(originalPackageRoot)
    );
  });
  if (!declared) throw new Error("Package is absent from global successful compile receipt");
  if (data.version === 2) {
    if (
      pathKey(realpathSync(absolute(data.repositoryRoot, "manifest repository root"))) !==
        pathKey(repositoryRoot) ||
      pathKey(realpathSync(absolute(data.packageRoot, "manifest original package root"))) !==
        pathKey(originalPackageRoot) ||
      pathKey(realpathSync(absolute(data.viewRoot, "manifest view root"))) !== pathKey(packageRoot)
    )
      throw new Error(
        "Disposable manifest roots do not match the current package view and receipt",
      );
  } else if (
    pathKey(packageRoot) !== pathKey(originalPackageRoot) ||
    pathKey(realpathSync(manifestFile)) !==
      pathKey(resolve(packageRoot, ".build/source-outputs.json"))
  ) {
    throw new Error("Version 1 fallback must describe its original package and fallback path");
  }
  const outputRoot = realpathSync(resolve(packageRoot, ".build"));
  if (!within(packageRoot, outputRoot))
    throw new Error("Compiled output root escapes the current package view");
  const outputs = new Map<string, HashedOutput>();
  const originalKeys = new Set<string>();
  for (const file of files) {
    if (
      !/\.[cm]?tsx?$/.test(file.source) ||
      /\.d\.[cm]?ts$/.test(file.source) ||
      !/\.[cm]?js$/.test(file.output) ||
      !file.project.endsWith(".json")
    )
      throw new Error(`Invalid native source/output mapping: ${file.output}`);
    const source = physicalFile(file.source);
    const project = physicalFile(file.project);
    const output = physicalFile(file.output);
    const original = originals.get(pathKey(physicalFile(file.originalOutput)));
    if (
      !original ||
      pathKey(source) !== pathKey(original.source) ||
      pathKey(project) !== pathKey(original.project) ||
      (file.sha256 !== undefined && file.sha256 !== original.sha256)
    )
      throw new Error(
        `Output mapping differs from global successful compile receipt: ${file.output}`,
      );
    if (
      !within(originalPackageRoot, source) ||
      !within(originalPackageRoot, project) ||
      !within(outputRoot, output) ||
      !within(resolve(originalPackageRoot, ".build"), original.output) ||
      pathKey(resolve(packageRoot, relative(originalPackageRoot, original.output))) !==
        pathKey(output)
    )
      throw new Error(`Compiled output mapping escapes its package: ${file.output}`);
    if (outputs.has(pathKey(output)) || originalKeys.has(pathKey(original.output)))
      throw new Error(`Duplicate compiled output: ${file.output}`);
    assertHash(output, original.sha256, original.executable);
    outputs.set(pathKey(output), { ...original, output });
    originalKeys.add(pathKey(original.output));
  }
  if (data.version === 1) {
    const expected = [...originals.values()].filter((file) =>
      within(originalPackageRoot, file.source),
    );
    if (
      expected.length !== originalKeys.size ||
      expected.some((file) => !originalKeys.has(pathKey(file.output)))
    )
      throw new Error(
        "Fallback output mapping does not match all successfully compiled package outputs",
      );
  }
  const stable = () => {
    assertHash(globalPath, receiptChecksum);
  };
  stable();
  return {
    packageRoot,
    originalPackageRoot,
    outputs: new Set(outputs.keys()),
    assertOutput(path) {
      stable();
      const file = outputs.get(pathKey(physicalFile(path)));
      if (!file) throw new Error(`Input is absent from compiled output manifest: ${path}`);
      assertHash(path, file.sha256, file.executable);
    },
    assertDependency(path) {
      stable();
      const checksum = allowedDependencies.get(pathKey(physicalFile(path)));
      if (!checksum)
        throw new Error(
          `Input is absent from the exact successful dependency file allowlist: ${path}`,
        );
      assertHash(path, checksum);
    },
  };
}
