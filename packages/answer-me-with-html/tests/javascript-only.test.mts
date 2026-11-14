import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
  readFile,
  lstat,
  utimes,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { build, type Metafile } from "esbuild";
import { compiledInputs, type SourceOutput } from "../scripts/input-manifest.mjs";
import {
  javaScriptInputs,
  javascriptOnly,
  assertJavaScriptInputs,
} from "../scripts/javascript-only.mjs";

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "am-native-inputs-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const original = join(workspace, "packages/answer-me-with-html");
  const view = join(original, ".build/.toolchain-prepare-fixture");
  const manifest = join(root, "outputs.json");
  const fallback = join(original, ".build/source-outputs.json");
  const receipt = join(workspace, ".build/toolchain/compile-receipt.json");
  const entry = join(view, ".build/src/node/entry.mjs");
  const put = async (file: string, text: string) => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    return file;
  };
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const digest = (value: unknown) => createHash("sha256").update(json(value)).digest("hex");
  const fileHash = async (path: string) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    executable: ((await lstat(path)).mode & 0o111) !== 0,
  });
  const slash = (path: string) => path.split("\\").join("/");
  const rootPackage = await put(
    join(workspace, "package.json"),
    json({ private: true, devDependencies: { undeclared: "3.0.0" } }),
  );
  const solution = await put(
    join(workspace, "tsconfig.json"),
    json({ files: [], references: [{ path: "packages/answer-me-with-html/tsconfig.json" }] }),
  );
  const aggregate = await put(
    join(original, "tsconfig.json"),
    json({
      files: [],
      references: [{ path: "scripts/tsconfig.json" }, { path: "src/node/tsconfig.json" }],
    }),
  );
  const packageFile = await put(
    join(original, "package.json"),
    json({
      name: "@senaoxi/skill-answer-me-with-html",
      version: "0.0.0",
      private: true,
      type: "module",
      skillBuild: { name: "answer-me-with-html" },
      dependencies: { "locked-dep": "1.0.0" },
    }),
  );
  const lock = await put(
    join(workspace, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      undeclared: {specifier: 3.0.0, version: 3.0.0}
  packages/answer-me-with-html:
    dependencies:
      locked-dep: {specifier: 1.0.0, version: 1.0.0}
packages:
  locked-dep@1.0.0: {resolution: {integrity: sha512-fixture}}
  locked-child@2.0.0: {resolution: {integrity: sha512-fixture}}
  undeclared@3.0.0: {resolution: {integrity: sha512-fixture}}
snapshots:
  locked-dep@1.0.0:
    dependencies: {locked-child: 2.0.0}
  locked-child@2.0.0: {}
  undeclared@3.0.0: {}
`,
  );
  const dependencies: string[] = [];
  for (const [name, version, text] of [
    ["locked-dep", "1.0.0", 'export { value } from "locked-child";'],
    ["locked-child", "2.0.0", 'export const value = "locked";'],
    ["undeclared", "3.0.0", 'export const value = "unapproved";'],
  ]) {
    dependencies.push(
      await put(
        join(workspace, "node_modules", name!, "package.json"),
        json({ name, version, type: "module", main: "index.mjs" }),
      ),
    );
    dependencies.push(await put(join(workspace, "node_modules", name!, "index.mjs"), text!));
  }
  const files: (SourceOutput & { originalOutput: string })[] = [];
  for (const [sourceName, outputName, projectName, code] of [
    ["scripts/assemble.mts", ".build/scripts/assemble.mjs", "scripts/tsconfig.json", "export {};"],
    [
      "src/node/entry.mts",
      ".build/src/node/entry.mjs",
      "src/node/tsconfig.json",
      'import { value } from "locked-dep"; import { helper } from "./helper.mjs"; export const result = value + helper;',
    ],
    [
      "src/node/helper.mts",
      ".build/src/node/helper.mjs",
      "src/node/tsconfig.json",
      'export const helper = "-current";',
    ],
  ]) {
    const source = await put(join(original, sourceName!), `${code}\n`);
    const originalOutput = await put(join(original, outputName!), `${code}\n`);
    const output = await put(join(view, outputName!), `${code}\n`);
    const project = await put(join(original, projectName!), "{}\n");
    files.push({ source, output, originalOutput, project });
  }
  async function seal() {
    const paths = [
      ...new Set([
        rootPackage,
        solution,
        aggregate,
        packageFile,
        lock,
        ...files.flatMap((file) => [file.source, file.project]),
      ]),
    ].sort();
    const inputs = await Promise.all(
      paths.map(async (path) => ({
        ...(await fileHash(path)),
        path: slash(relative(workspace, path)),
      })),
    );
    const dependencyInputs = await Promise.all(
      dependencies.map(async (path) => ({
        ...(await fileHash(path)),
        path: slash(relative(workspace, path)),
      })),
    );
    const outputs = await Promise.all(
      files.map(async (file) => ({
        source: slash(relative(workspace, file.source)),
        project: slash(relative(workspace, file.project)),
        output: slash(relative(workspace, file.originalOutput)),
        sha256: (await fileHash(file.originalOutput)).sha256,
        executable: (await fileHash(file.originalOutput)).executable,
      })),
    );
    const compiler = { typescript: "6.0.3", node: process.versions.node };
    const dependencyLinks: { path: string; target: string }[] = [];
    const dependencyFiles = await Promise.all(
      dependencies.map(async (path) => ({ path, sha256: (await fileHash(path)).sha256 })),
    );
    const inputHash = digest({ compiler, inputs, dependencyInputs, links: dependencyLinks });
    const outputHash = digest(outputs);
    const compileReceipt = { path: receipt, inputHash, outputHash };
    const state = {
      version: 1,
      kind: "successful-native-build",
      entry: "tsconfig.json",
      compiler,
      inputs,
      dependencyInputs,
      dependencyLinks,
      outputs,
      packages: [{ name: "answer-me-with-html", packagePath: "packages/answer-me-with-html" }],
      dependencyFiles,
      inputHash,
      outputHash,
    };
    const current = {
      version: 2,
      repositoryRoot: workspace,
      packageRoot: original,
      viewRoot: view,
      compileReceipt,
      files: await Promise.all(
        files.map(async (file) => ({
          ...file,
          sha256: (await fileHash(file.originalOutput)).sha256,
        })),
      ),
      dependencyFiles,
    };
    await put(manifest, json(current));
    await put(
      fallback,
      json({
        version: 1,
        files: files.map((file) => ({
          source: file.source,
          output: file.originalOutput,
          project: file.project,
        })),
        compileReceipt,
      }),
    );
    // Mirrors the producer's commit order: package metadata first, global receipt last.
    await put(receipt, json(state));
    return current;
  }
  let data = await seal();
  await symlink(
    join(workspace, "node_modules"),
    join(view, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const policy = () => javaScriptInputs(view, manifest);
  const assemble = async () => {
    const inputs = policy();
    const result = await build({
      absWorkingDir: view,
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      platform: "node",
      write: false,
      metafile: true,
      logLevel: "silent",
      plugins: [javascriptOnly(inputs)],
    });
    assertJavaScriptInputs(result.metafile!, inputs, view);
    return result;
  };
  const setEntry = async (code: string) => {
    await put(entry, `${code}\n`);
    await put(files[1]!.originalOutput, `${code}\n`);
    await put(files[1]!.source, `${code}\n`);
    data = await seal();
  };
  const importFile = (file: string) => setEntry(`import ${JSON.stringify(file)}; export {};`);
  return {
    root,
    workspace,
    original,
    view,
    manifest,
    fallback,
    receipt,
    entry,
    files,
    put,
    policy,
    assemble,
    importFile,
    setEntry,
    get data() {
      return data;
    },
    reseal: async () => {
      data = await seal();
    },
  };
}

function observed(path: string): Metafile {
  return { inputs: { [path]: { bytes: 1, imports: [] } }, outputs: {} };
}

test("assembly accepts mapped native JS and the declared locked transitive dependency closure", async (t) => {
  const f = await fixture(t);
  const result = await f.assemble();
  assert.match(result.outputFiles![0]!.text, /locked-current|locked/);
  assert.equal(Object.keys(result.metafile!.inputs).length, 4);
});

test("retained orphan JS is rejected by both real esbuild loading and independent metafile inspection", async (t) => {
  const f = await fixture(t);
  const stale = await f.put(
    join(f.view, ".build/src/node/deleted.mjs"),
    'throw new Error("stale executed");',
  );
  await f.importFile(stale);
  await assert.rejects(f.assemble(), /not in the current compiled output manifest/);
  assert.throws(
    () => assertJavaScriptInputs(observed(stale), f.policy(), f.view),
    /not in the current compiled output manifest/,
  );
});

test("absolute original TS and JS cannot escape a disposable package view", async (t) => {
  const f = await fixture(t);
  const source = await f.put(
    join(f.original, "src/node/unlisted.mts"),
    "export const value: number = 1;",
  );
  await f.importFile(source);
  await assert.rejects(f.assemble(), /Native TypeScript compilation required/);
  assert.throws(
    () => assertJavaScriptInputs(observed(source), f.policy(), f.view),
    /Native TypeScript compilation required/,
  );
  const originalJS = await f.put(
    join(f.original, ".build/src/node/orphan.mjs"),
    "export const value = 1;",
  );
  await f.importFile(originalJS);
  await assert.rejects(f.assemble(), /outside the current package view and locked dependencies/);
  assert.throws(
    () => assertJavaScriptInputs(observed(originalJS), f.policy(), f.view),
    /outside the current package view and locked dependencies/,
  );
});

test("installed but undeclared packages and vendor symlink escapes are rejected", async (t) => {
  const f = await fixture(t);
  await f.setEntry('import "undeclared";');
  await assert.rejects(f.assemble(), /outside the current package view and locked dependencies/);
  await f.setEntry('import "locked-dep";');
  const foreign = await f.put(join(f.workspace, "foreign.mjs"), "export const value = 1;");
  const vendor = join(f.workspace, "node_modules/locked-dep/index.mjs");
  await rm(vendor);
  await symlink(foreign, vendor, process.platform === "win32" ? "file" : undefined);
  await assert.rejects(f.assemble(), /Invalid native build file/);
});

test("missing mappings, deleted sources and installed version drift fail closed", async (t) => {
  const f = await fixture(t);
  assert.throws(
    () => compiledInputs(f.view, join(f.root, "missing.json")),
    /current compiled output manifest/,
  );
  await rm(join(f.original, "src/node/helper.mts"));
  assert.throws(f.policy, /ENOENT/);
  await f.put(join(f.original, "src/node/helper.mts"), 'export const helper = "-current";\n');
  await f.put(
    join(f.workspace, "node_modules/locked-dep/package.json"),
    JSON.stringify({ name: "locked-dep", version: "9.0.0", main: "index.mjs" }),
  );
  assert.throws(f.policy, /hash or mode differs/);
});

test("unknown virtual modules and external runtime imports cannot bypass the manifest", async (t) => {
  const f = await fixture(t);
  const inputs = f.policy();
  assert.throws(
    () => inputs.assertInput("virtual", "unapproved"),
    /Unapproved assembly input namespace/,
  );
  const meta: Metafile = {
    inputs: {},
    outputs: {
      "page.mjs": {
        bytes: 1,
        inputs: {},
        exports: [],
        imports: [
          { path: "https://example.invalid/remote.mjs", kind: "import-statement", external: true },
        ],
      },
    },
  };
  assert.throws(
    () => assertJavaScriptInputs(meta, inputs, f.view, "browser"),
    /Unbundled runtime dependency/,
  );
});

test("version 1 direct fallback requires the matching committed global receipt", async (t) => {
  const f = await fixture(t);
  const direct = javaScriptInputs(f.original, f.fallback);
  direct.assertInput(f.files[1]!.originalOutput);
  assert.match(direct.resolveDependency("locked-child/index.mjs"), /locked-child[\\/]index\.mjs$/);
  await f.put(
    f.fallback,
    JSON.stringify({
      version: 1,
      files: f.files.slice(0, 2).map((file) => ({
        source: file.source,
        project: file.project,
        output: file.originalOutput,
      })),
      compileReceipt: f.data.compileReceipt,
    }),
  );
  assert.throws(
    () => compiledInputs(f.original, f.fallback),
    /all successfully compiled package outputs/,
  );
  await f.put(
    f.fallback,
    JSON.stringify({
      version: 1,
      files: f.files.map((file) => ({
        source: file.source,
        project: file.project,
        output: file.originalOutput,
      })),
    }),
  );
  assert.throws(() => compiledInputs(f.original, f.fallback), /successful compile receipt pointer/);
  await f.reseal();
  await rm(f.receipt);
  assert.throws(() => compiledInputs(f.original, f.fallback), /ENOENT/);
});

test("manifest pointer, roots and own hashes must match the global receipt", async (t) => {
  const f = await fixture(t);
  await f.put(
    f.manifest,
    JSON.stringify({
      ...f.data,
      compileReceipt: { ...f.data.compileReceipt, inputHash: "0".repeat(64) },
    }),
  );
  assert.throws(f.policy, /does not match global successful compile receipt/);
  await f.put(f.manifest, JSON.stringify({ ...f.data, viewRoot: f.original }));
  assert.throws(f.policy, /roots do not match/);
  await f.put(
    f.manifest,
    JSON.stringify({
      ...f.data,
      files: f.data.files.map((file, index) =>
        index === 1 ? { ...file, sha256: "0".repeat(64) } : file,
      ),
    }),
  );
  assert.throws(f.policy, /Output mapping differs/);
  await f.reseal();
  await f.put(f.entry, "export const changed = true;");
  assert.throws(f.policy, /hash or mode differs/);
});

test("originalOutput proves provenance without authorizing original files outside the view", async (t) => {
  const f = await fixture(t);
  const inputs = f.policy();
  assert.throws(
    () => inputs.assertInput(f.files[1]!.originalOutput),
    /outside the current package view/,
  );
  inputs.assertInput(f.entry);
});

test("dependency allowlists cannot be broadened or replaced with package-root trust", async (t) => {
  const f = await fixture(t);
  await f.put(
    f.manifest,
    JSON.stringify({ ...f.data, dependencyFiles: f.data.dependencyFiles.slice(1) }),
  );
  assert.throws(f.policy, /Dependency file allowlist does not match/);
  await f.reseal();
  await f.setEntry('import "locked-dep/not-recorded.mjs";');
  await f.put(
    join(f.workspace, "node_modules/locked-dep/not-recorded.mjs"),
    "export const unrecorded = true;",
  );
  await assert.rejects(f.assemble(), /absent from the exact successful dependency file allowlist/);
});

test("content drift is rejected even with preserved mtimes, including after policy construction", async (t) => {
  const f = await fixture(t);
  const inputs = f.policy();
  const own = await lstat(f.entry);
  await f.put(f.entry, "export const changed = true;");
  await utimes(f.entry, own.atime, own.mtime);
  assert.throws(() => inputs.assertInput(f.entry), /hash or mode differs/);
  const vendor = join(f.workspace, "node_modules/locked-child/index.mjs");
  const before = await lstat(vendor);
  await f.put(vendor, 'export const value = "tampered";');
  await utimes(vendor, before.atime, before.mtime);
  assert.throws(() => inputs.assertInput(vendor), /hash or mode differs/);
  assert.throws(() => inputs.resolveDependency("locked-child/index.mjs"), /hash or mode differs/);
});

test("fallback verifies recorded source/config bytes and global receipt checksums", async (t) => {
  const f = await fixture(t);
  const source = f.files[1]!.project;
  const before = await lstat(source);
  await f.put(source, '{"compilerOptions":{"strict":false}}');
  await utimes(source, before.atime, before.mtime);
  assert.throws(() => compiledInputs(f.original, f.fallback), /hash or mode differs/);
  await f.put(source, "{}\n");
  const raw: unknown = JSON.parse(await readFile(f.receipt, "utf8"));
  assert.ok(raw && typeof raw === "object" && "outputHash" in raw);
  await f.put(
    f.receipt,
    JSON.stringify({ ...raw, compiler: { typescript: "changed", node: process.versions.node } }),
  );
  assert.throws(() => compiledInputs(f.original, f.fallback), /hashes are inconsistent/);
  await f.put(f.receipt, JSON.stringify({ ...raw, outputHash: "0".repeat(64) }));
  assert.throws(
    () => compiledInputs(f.original, f.fallback),
    /does not match global successful compile receipt/,
  );
});

test("an invalidated global receipt cannot be reused by an existing policy", async (t) => {
  const f = await fixture(t);
  const inputs = f.policy();
  await rm(f.receipt);
  assert.throws(() => inputs.assertInput(f.entry), /ENOENT/);
});
