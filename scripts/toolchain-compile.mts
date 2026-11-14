import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import {
  exists,
  filesUnder,
  inside,
  json,
  localPath,
  object,
  physicalPath,
  readJSON,
  slash,
} from "./toolchain-core.mjs";
import { dependencySnapshot, hashFile } from "./toolchain-dependencies.mjs";
import {
  discoverSkills,
  outputManifest,
  requireCompiled,
  sourceSolution,
  validateProjects,
} from "./toolchain-projects.mjs";

export const compileReceiptPath = ".build/toolchain/compile-receipt.json";
export const packageOutputsPath = ".build/source-outputs.json";
const digest = (value: unknown): string => createHash("sha256").update(json(value)).digest("hex");
type CompileState = Awaited<ReturnType<typeof compileState>>;
export type CheckedBuild = CompileState & { receiptPath: string };

async function compileState(root: string) {
  root = await realpath(root);
  const projects = await sourceSolution(root);
  const packages = await discoverSkills(root);
  const inputPaths = new Set(
    projects.flatMap((project) => [...project.sources, ...project.configFiles]),
  );
  for (const path of await filesUnder(root, (path) =>
    path
      .split("/")
      .some(
        (part) =>
          [
            "node_modules",
            ".build",
            ".limina",
            ".git",
            "skills",
            "my-skills",
            "reports",
            ".agents",
            ".codex",
          ].includes(part) || part.startsWith(".skills-sync-"),
      ),
  )) {
    if (path === "skills-lock.json" || path === "skills-sources.json") continue;
    if (
      /\.[cm]?tsx?$/.test(path) ||
      /\.(?:jsonc?|ya?ml|toml)$/.test(path) ||
      /(?:^|\/)(?:\.env(?:\..*)?|\.gitignore|\.gitattributes|\.npmrc)$/.test(path) ||
      /^(?:yarn\.lock|bun\.lockb?)$/.test(path)
    )
      inputPaths.add(resolve(root, path));
  }
  const inputs = [];
  for (const path of [...inputPaths].sort()) {
    await physicalPath(root, path);
    const file = await hashFile(path);
    inputs.push({ ...file, path: slash(relative(root, path)) });
  }
  const dependencies = await dependencySnapshot(
    root,
    packages.map((pkg) => pkg.directory),
  );
  const outputs = [];
  for (const file of outputManifest(projects).sort((a, b) => a.output.localeCompare(b.output))) {
    await physicalPath(root, file.output);
    await requireCompiled(file);
    const hash = await hashFile(file.output);
    outputs.push({
      source: slash(relative(root, file.source)),
      project: slash(relative(root, file.project)),
      output: slash(relative(root, file.output)),
      sha256: hash.sha256,
      executable: hash.executable,
    });
  }
  const compiler = { typescript: ts.version, node: process.versions.node };
  const dependencyInputs = dependencies.files.map((file) => ({
    ...file,
    path: slash(relative(root, file.path)),
  }));
  return {
    version: 1,
    kind: "successful-native-build",
    entry: "tsconfig.json",
    compiler,
    inputs,
    dependencyInputs,
    dependencyLinks: dependencies.links,
    outputs,
    packages: packages.map(({ name, packagePath }) => ({ name, packagePath })),
    dependencyFiles: dependencies.allowed,
    inputHash: digest({ compiler, inputs, dependencyInputs, links: dependencies.links }),
    outputHash: digest(outputs),
  };
}

function packageMetadata(
  root: string,
  packagePath: string,
  state: CompileState,
  receiptPath: string,
) {
  const directory = resolve(root, packagePath);
  return {
    version: 1,
    files: state.outputs
      .filter((file) => inside(directory, resolve(root, file.source)))
      .map((file) => ({
        source: resolve(root, file.source),
        output: resolve(root, file.output),
        project: resolve(root, file.project),
      })),
    compileReceipt: { path: receiptPath, inputHash: state.inputHash, outputHash: state.outputHash },
  };
}

async function atomicMetadata(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, json(value), { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Internal receipt writer. Production callers first validate native compiler evidence. */
export async function recordBuild(
  root: string,
  verifyCompiler: () => Promise<void>,
): Promise<{ inputs: number; outputs: number; inputHash: string; outputHash: string }> {
  root = await realpath(root);
  const path = await physicalPath(root, localPath(root, compileReceiptPath));
  await rm(path, { force: true });
  await verifyCompiler();
  const state = await compileState(root);
  await validateProjects(root);
  const stable = await compileState(root);
  if (state.inputHash !== stable.inputHash || state.outputHash !== stable.outputHash)
    throw new Error("Build inputs or outputs changed while recording successful compilation");
  await verifyCompiler();
  for (const pkg of state.packages) {
    const metadataPath = await physicalPath(
      root,
      resolve(root, pkg.packagePath, packageOutputsPath),
    );
    await atomicMetadata(metadataPath, packageMetadata(root, pkg.packagePath, state, path));
  }
  await atomicMetadata(path, state);
  return {
    inputs: state.inputs.length + state.dependencyInputs.length,
    outputs: state.outputs.length,
    inputHash: state.inputHash,
    outputHash: state.outputHash,
  };
}

export async function assertCurrentBuild(root: string): Promise<CheckedBuild> {
  root = await realpath(root);
  const receiptPath = await physicalPath(root, localPath(root, compileReceiptPath));
  if (!(await exists(receiptPath)))
    throw new Error(
      "Missing successful compile receipt; run pnpm build:ts (native build, then record-build)",
    );
  const receipt = object(await readJSON(receiptPath), "successful compile receipt");
  if (
    receipt.version !== 1 ||
    receipt.kind !== "successful-native-build" ||
    receipt.entry !== "tsconfig.json"
  )
    throw new Error("Invalid successful compile receipt; run pnpm build:ts");
  const current = await compileState(root);
  if (receipt.inputHash !== current.inputHash || receipt.outputHash !== current.outputHash) {
    throw new Error(
      "Successful compile receipt is stale: current inputs or JS outputs changed; run pnpm build:ts",
    );
  }
  for (const pkg of current.packages) {
    const metadataPath = await physicalPath(
      root,
      resolve(root, pkg.packagePath, packageOutputsPath),
    );
    if (
      !(await exists(metadataPath)) ||
      digest(await readJSON(metadataPath)) !==
        digest(packageMetadata(root, pkg.packagePath, current, receiptPath))
    ) {
      throw new Error(
        `Package source outputs metadata is missing or stale: ${pkg.packagePath}; run pnpm build:ts`,
      );
    }
  }
  return { ...current, receiptPath };
}

export async function currentBuildIfCompiled(root: string): Promise<CheckedBuild | null> {
  if (!(await exists(resolve(root, "tsconfig.json")))) return null;
  const projects = await sourceSolution(root);
  return outputManifest(projects).length ? assertCurrentBuild(root) : null;
}
