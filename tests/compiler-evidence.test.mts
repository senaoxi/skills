import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import ts from "typescript";
import { assertNativeCompilerEvidence } from "../scripts/compiler-evidence.mjs";
import { object, runCommand } from "../scripts/toolchain-core.mjs";

const require = createRequire(import.meta.url);
const compilerPackage = dirname(require.resolve("typescript/package.json"));
const liminaPackage = dirname(require.resolve("limina/package.json"));
const valid =
  "import type { Choice } from 'fixture-dep';\nexport const chosen: Choice = 1;\nexport const value: number = 123;\n";
const invalid = valid.replace("number = 123", "number = 'x'");
const stamp = 1_700_000_000;
const fixtureMarkerPath = ".build/toolchain/compile-receipt.json";
const fixtureMarker = { kind: "fixture-only-native-evidence-success" };
let invocation = 0;

async function put(root: string, path: string, value: string | object): Promise<void> {
  const file = resolve(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}
async function fixture(t: TestContext, content = valid): Promise<string> {
  assert.equal(ts.version, "6.0.3");
  const metadata: unknown = JSON.parse(
    await readFile(resolve(liminaPackage, "package.json"), "utf8"),
  );
  assert.equal(object(metadata, "Limina package").version, "0.5.0");
  const root = await mkdtemp(resolve(tmpdir(), "compiler-evidence-"));
  if (process.env.COMPILER_EVIDENCE_KEEP_FIXTURES !== "1")
    t.after(() => rm(root, { recursive: true, force: true }));
  t.diagnostic(`native fixture: ${root}`);
  await put(root, "package.json", {
    name: "compiler-evidence-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@12.18.0",
    dependencies: { "fixture-dep": "1.0.0" },
  });
  await put(root, "pnpm-workspace.yaml", "packages: []\n");
  await put(root, "tsconfig.base.json", {
    compilerOptions: {
      strict: true,
      allowJs: false,
      noEmit: true,
      noEmitOnError: true,
      skipLibCheck: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
      lib: ["ES2023"],
      types: [],
    },
  });
  await put(root, "tsconfig.json", {
    files: [],
    references: [{ path: "./scripts/tsconfig.json" }, { path: "./config/tsconfig.json" }],
  });
  await put(root, "scripts/tsconfig.json", {
    extends: "../tsconfig.base.json",
    files: ["main.mts"],
    liminaOptions: { outputs: { rootDir: ".", outDir: "../.build/scripts" } },
  });
  await put(root, "config/tsconfig.json", {
    extends: "../tsconfig.base.json",
    files: ["../limina.config.mts"],
    liminaOptions: { outputs: { rootDir: "..", outDir: "../.build/config" } },
  });
  await put(
    root,
    "limina.config.mts",
    "export default {scope:{regions:{extendNestedPackageScopes:false}}};\n",
  );
  await put(root, "scripts/main.mts", content);
  await put(root, "node_modules/fixture-dep/package.json", {
    name: "fixture-dep",
    version: "1.0.0",
    type: "module",
    types: "index.d.mts",
  });
  await put(root, "node_modules/fixture-dep/index.d.mts", "export type Choice = 1;\n");
  for (const [name, target] of [
    ["typescript", compilerPackage],
    ["limina", liminaPackage],
  ]) {
    await symlink(
      target,
      resolve(root, "node_modules", name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  for (const path of ["scripts/main.mts", "node_modules/fixture-dep/index.d.mts"])
    await utimes(resolve(root, path), stamp, stamp);
  return root;
}
async function native(root: string): Promise<Awaited<ReturnType<typeof runCommand>>> {
  const result = await runCommand({
    command: process.execPath,
    args: [resolve(liminaPackage, "bin/limina.js"), "build", "tsconfig.json", "--preset", "tsc"],
    cwd: root,
    timeoutMs: 120_000,
  });
  const directory = process.env.COMPILER_EVIDENCE_REPORT_DIR;
  if (directory) {
    const prefix = resolve(directory, `native-${++invocation}`);
    await mkdir(directory, { recursive: true });
    await writeFile(`${prefix}.stdout.log`, result.stdout);
    await writeFile(`${prefix}.stderr.log`, result.stderr);
    await writeFile(
      `${prefix}.json`,
      JSON.stringify(
        {
          root,
          code: result.code,
          signal: result.signal,
          command: [
            process.execPath,
            resolve(liminaPackage, "bin/limina.js"),
            "build",
            "tsconfig.json",
            "--preset",
            "tsc",
          ],
        },
        null,
        2,
      ),
    );
  }
  return result;
}
async function baseline(root: string): Promise<void> {
  const result = await native(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  await assertNativeCompilerEvidence(root);
}
async function preserveMtime(root: string, path: string, content: string): Promise<void> {
  const file = resolve(root, path);
  const before = await lstat(file, { bigint: true });
  assert.equal(Buffer.byteLength(content), Number(before.size));
  await writeFile(file, content);
  await utimes(
    file,
    Number(before.atimeNs / 1_000_000_000n),
    Number(before.mtimeNs / 1_000_000_000n),
  );
  const after = await lstat(file, { bigint: true });
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal(after.ino, before.ino);
}

async function formalFixture(t: TestContext): Promise<string> {
  const root = await fixture(t);
  const repositoryManifest: unknown = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const buildScript = object(
    object(repositoryManifest, "repository package.json").scripts,
    "repository scripts",
  )["build:ts"];
  assert.equal(typeof buildScript, "string");
  const manifest: unknown = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  await put(root, "package.json", {
    ...object(manifest, "fixture package.json"),
    scripts: { "build:ts": buildScript },
  });
  await mkdir(resolve(root, "node_modules/.bin"));
  await symlink(resolve(liminaPackage, "bin/limina.js"), resolve(root, "node_modules/.bin/limina"));
  // Exercise the real gate without pretending this fixture marker is a production receipt.
  await put(
    root,
    ".build/scripts/record-build.mjs",
    `import { mkdir, writeFile } from 'node:fs/promises';
import { assertNativeCompilerEvidence } from ${JSON.stringify(new URL("../scripts/compiler-evidence.mjs", import.meta.url).href)};
await assertNativeCompilerEvidence(process.cwd());
await mkdir('.build/toolchain', { recursive: true });
await writeFile(${JSON.stringify(fixtureMarkerPath)}, ${JSON.stringify(JSON.stringify(fixtureMarker))});
`,
  );
  return root;
}

async function formal(root: string): Promise<Awaited<ReturnType<typeof runCommand>>> {
  return runCommand({
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "build:ts"],
    cwd: root,
    timeoutMs: 120_000,
  });
}

async function formalSuccess(root: string): Promise<void> {
  const result = await formal(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const marker: unknown = JSON.parse(await readFile(resolve(root, fixtureMarkerPath), "utf8"));
  assert.deepEqual(marker, fixtureMarker);
}

test("repository build:ts re-emits altered valid JavaScript regardless of output mtime", async (t) => {
  for (const mode of ["newer", "preserved", "future"] as const) {
    await t.test(mode, async (t) => {
      const root = await formalFixture(t);
      await formalSuccess(root);
      const output = resolve(root, ".build/scripts/main.mjs");
      const source = await readFile(resolve(root, "scripts/main.mts"));
      const infoPath = resolve(root, ".limina/tsbuildinfo/build/scripts/tsconfig.json.tsbuildinfo");
      const info = await readFile(infoPath);
      const expected = await readFile(output, "utf8");
      const altered = expected.replace("value = 123", "value = 456");
      assert.notEqual(altered, expected);
      if (mode === "preserved") {
        await utimes(output, stamp, stamp);
        await preserveMtime(root, ".build/scripts/main.mjs", altered);
      } else {
        const before = await lstat(output);
        await writeFile(output, altered);
        const time = Math.ceil(before.mtimeMs / 1000) + (mode === "future" ? 31_536_000 : 1);
        await utimes(output, time, time);
        assert.ok((await lstat(output)).mtimeMs > before.mtimeMs);
      }
      assert.deepEqual(await readFile(resolve(root, "scripts/main.mts")), source);
      assert.deepEqual(await readFile(infoPath), info);
      await formalSuccess(root);
      assert.equal(await readFile(output, "utf8"), expected);
    });
  }
});

test("repository build:ts restores a missing emit with retained native build-info", async (t) => {
  const root = await formalFixture(t);
  await formalSuccess(root);
  const output = resolve(root, ".build/scripts/main.mjs");
  const expected = await readFile(output, "utf8");
  const infoPath = resolve(root, ".limina/tsbuildinfo/build/scripts/tsconfig.json.tsbuildinfo");
  const info = await readFile(infoPath);
  await rm(output);
  assert.deepEqual(await readFile(infoPath), info);
  await formalSuccess(root);
  assert.equal(await readFile(output, "utf8"), expected);
});

test("repository build:ts emits a legal source edit with its mtime preserved", async (t) => {
  const root = await formalFixture(t);
  await formalSuccess(root);
  const output = resolve(root, ".build/scripts/main.mjs");
  const emitted = await readFile(output, "utf8");
  const expected = emitted.replace("value = 123", "value = 456");
  assert.notEqual(expected, emitted);
  await preserveMtime(root, "scripts/main.mts", valid.replace("number = 123", "number = 456"));
  await formalSuccess(root);
  assert.equal(await readFile(output, "utf8"), expected);
});

test("repository build:ts rejects a preserved-mtime type error without a success marker", async (t) => {
  const root = await formalFixture(t);
  await formalSuccess(root);
  const output = resolve(root, ".build/scripts/main.mjs");
  const emitted = await readFile(output, "utf8");
  await preserveMtime(root, "scripts/main.mts", invalid);
  const failed = await formal(root);
  assert.notEqual(failed.code, 0, `${failed.stdout}\n${failed.stderr}`);
  assert.match(failed.stdout + failed.stderr, /TS2322/);
  assert.equal(await readFile(output, "utf8"), emitted);
  await assert.rejects(readFile(resolve(root, fixtureMarkerPath)), { code: "ENOENT" });
});

test("real Limina evidence rejects restored-mtime semantic source changes after a native success", async (t) => {
  const root = await fixture(t);
  await baseline(root);
  const emitted = await readFile(resolve(root, ".build/scripts/main.mjs"), "utf8");
  await preserveMtime(root, "scripts/main.mts", invalid);
  const skipped = await native(root);
  assert.equal(skipped.code, 0, `${skipped.stdout}\n${skipped.stderr}`);
  assert.equal(await readFile(resolve(root, ".build/scripts/main.mjs"), "utf8"), emitted);
  await assert.rejects(
    assertNativeCompilerEvidence(root),
    /input version is stale:.*main\.mts.*pnpm clean.*pnpm build:ts/,
  );
  const direct = await runCommand({
    command: process.execPath,
    args: [resolve(compilerPackage, "bin/tsc"), "-p", "scripts/tsconfig.json", "--noEmit"],
    cwd: root,
  });
  assert.notEqual(direct.code, 0);
  assert.match(direct.stdout + direct.stderr, /TS2322/);
});

test("real dependency declaration input versions cannot be blessed by restored mtimes", async (t) => {
  const root = await fixture(t);
  await baseline(root);
  await preserveMtime(root, "node_modules/fixture-dep/index.d.mts", "export type Choice = 2;\n");
  const skipped = await native(root);
  assert.equal(skipped.code, 0, `${skipped.stdout}\n${skipped.stderr}`);
  await assert.rejects(
    assertNativeCompilerEvidence(root),
    /input version is stale:.*fixture-dep.*pnpm clean/,
  );
  const direct = await runCommand({
    command: process.execPath,
    args: [resolve(compilerPackage, "bin/tsc"), "-p", "scripts/tsconfig.json", "--noEmit"],
    cwd: root,
  });
  assert.notEqual(direct.code, 0);
  assert.match(direct.stdout + direct.stderr, /TS2322/);
});

test("a failed real native build retains errors or pending work and cannot establish evidence", async (t) => {
  const root = await fixture(t);
  await baseline(root);
  await writeFile(resolve(root, "scripts/main.mts"), invalid);
  const failed = await native(root);
  assert.notEqual(failed.code, 0);
  assert.match(failed.stdout + failed.stderr, /TS2322/);
  await assert.rejects(assertNativeCompilerEvidence(root), /errors|diagnostics|pending/);
});

test("native text hashing accepts BOM and compiler-normalized trailing source map comments", async (t) => {
  const root = await fixture(t, `\uFEFF${valid}//# sourceMappingURL=main.mjs.map\n`);
  await baseline(root);
  await assertNativeCompilerEvidence(root);
});

test("evidence must belong to current output projects and be complete, checked and emitted", async (t) => {
  const root = await fixture(t);
  await baseline(root);
  const path = resolve(root, ".limina/tsbuildinfo/build/scripts/tsconfig.json.tsbuildinfo");
  const original = await readFile(path, "utf8");
  const cases: [string, (info: Record<string, unknown>) => void][] = [
    [
      "errors",
      (info) => {
        info.errors = true;
      },
    ],
    [
      "check pending",
      (info) => {
        info.checkPending = true;
      },
    ],
    [
      "full pending emit encoded as false",
      (info) => {
        info.pendingEmit = false;
      },
    ],
    [
      "file emit pending",
      (info) => {
        info.affectedFilesPendingEmit = [1];
      },
    ],
    [
      "changed files pending",
      (info) => {
        info.changeFileSet = [1];
      },
    ],
    [
      "saved semantic diagnostic",
      (info) => {
        info.semanticDiagnosticsPerFile = [
          [1, [{ category: 1, code: 2322, messageText: "retained diagnostic" }]],
        ];
      },
    ],
    [
      "saved emit diagnostic",
      (info) => {
        info.emitDiagnosticsPerFile = [
          [1, [{ category: 1, code: 1, messageText: "retained emit diagnostic" }]],
        ];
      },
    ],
    [
      "missing input versions",
      (info) => {
        info.fileInfos = [];
      },
    ],
    [
      "unrelated roots",
      (info) => {
        info.root = [1];
      },
    ],
    [
      "different options",
      (info) => {
        info.options = { ...object(info.options, "options"), outDir: "../unrelated-output" };
      },
    ],
    [
      "unsupported compiler",
      (info) => {
        info.version = "0.0.0";
      },
    ],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const value: unknown = JSON.parse(original);
      const info = object(value, "build-info");
      mutate(info);
      try {
        await writeFile(path, JSON.stringify(info));
        await assert.rejects(assertNativeCompilerEvidence(root), /pnpm clean then pnpm build:ts/);
      } finally {
        await writeFile(path, original);
      }
    });
  }
  await rm(path);
  await assert.rejects(assertNativeCompilerEvidence(root), /pnpm clean then pnpm build:ts/);
  await writeFile(path, original);
  const generated = resolve(
    root,
    ".limina/tsconfig/checkers/tsc/outputs/projects/scripts/tsconfig.output.json",
  );
  const configText = await readFile(generated, "utf8");
  const value: unknown = JSON.parse(configText);
  const config = object(value, "output config");
  config.compilerOptions = {
    ...object(config.compilerOptions, "compiler options"),
    tsBuildInfoFile: relative(
      dirname(generated),
      resolve(root, ".limina/tsbuildinfo/build/config/tsconfig.json.tsbuildinfo"),
    ),
  };
  await writeFile(generated, JSON.stringify(config));
  await assert.rejects(assertNativeCompilerEvidence(root), /unrelated build-info/);
  await writeFile(generated, configText);
  await assertNativeCompilerEvidence(root);
});
