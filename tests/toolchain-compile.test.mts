import { dependencySnapshot } from "../scripts/toolchain-dependencies.mjs";
import { recordFixtureBuild } from "./toolchain-fixtures.mjs";
import assert from "node:assert/strict";
import { lstat, readFile, rm, symlink, utimes } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertCurrentBuild,
  compileReceiptPath,
  recordBuild,
} from "../scripts/toolchain-compile.mjs";
import { exists, object, readJSON, runCommand } from "../scripts/toolchain-core.mjs";
import { project, put, solution, temporary } from "./toolchain-fixtures.mjs";
import type { TestContext } from "node:test";

const compiler = fileURLToPath(import.meta.resolve("typescript/lib/tsc.js"));

async function compile(root: string): Promise<Awaited<ReturnType<typeof runCommand>>> {
  return runCommand({
    command: process.execPath,
    args: [
      compiler,
      "--project",
      "scripts/tsconfig.json",
      "--noEmit",
      "false",
      "--noEmitOnError",
      "true",
      "--rootDir",
      "scripts",
      "--outDir",
      ".build/scripts",
      "--pretty",
      "false",
    ],
    cwd: root,
  });
}

async function baseline(
  t: TestContext,
  source = "export const current: number = 1;\n",
  extra: string[] = [],
): Promise<string> {
  const root = await temporary(t);
  await put(root, "scripts/main.mts", source);
  await project(root, "scripts", ["main.mts", ...extra]);
  await solution(root, ["scripts"]);
  return root;
}

async function successful(root: string): Promise<void> {
  const result = await compile(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  await recordFixtureBuild(root);
}

async function preserveMtime(root: string, path: string, content: string): Promise<void> {
  const absolute = resolve(root, path);
  const stat = await lstat(absolute);
  await put(root, path, content);
  await utimes(absolute, stat.atime, stat.mtime);
}

test("receipt seals current source and JS bytes, independent of mtime", async (t) => {
  const root = await baseline(t);
  await successful(root);
  const first = await assertCurrentBuild(root);
  await utimes(resolve(root, "scripts/main.mts"), new Date(1), new Date(1));
  await utimes(resolve(root, ".build/scripts/main.mjs"), new Date(1), new Date(1));
  assert.equal((await assertCurrentBuild(root)).inputHash, first.inputHash);
  await preserveMtime(root, ".build/scripts/main.mjs", "export const tampered = true;\n");
  await assert.rejects(assertCurrentBuild(root), /compile receipt is stale/);
});

test("a failed compile after a source edit cannot reuse retained JS with restored mtimes", async (t) => {
  const root = await baseline(t);
  await successful(root);
  const output = await readFile(resolve(root, ".build/scripts/main.mjs"), "utf8");
  await preserveMtime(root, "scripts/main.mts", "export const current: number = 'bad';\n");
  assert.notEqual((await compile(root)).code, 0);
  assert.equal(await readFile(resolve(root, ".build/scripts/main.mjs"), "utf8"), output);
  await assert.rejects(assertCurrentBuild(root), /compile receipt is stale/);
});

test("declaration-only failure invalidates receipt even when emitted JS is unchanged", async (t) => {
  const root = await baseline(
    t,
    "import type {Choice} from './api.mjs'; export const current: Choice = 1;\n",
    ["api.d.mts"],
  );
  await put(root, "scripts/api.d.mts", "export type Choice = 1;\n");
  await successful(root);
  const output = await readFile(resolve(root, ".build/scripts/main.mjs"), "utf8");
  await preserveMtime(root, "scripts/api.d.mts", "export type Choice = 2;\n");
  assert.notEqual((await compile(root)).code, 0);
  assert.equal(await readFile(resolve(root, ".build/scripts/main.mjs"), "utf8"), output);
  await assert.rejects(assertCurrentBuild(root), /compile receipt is stale/);
});

test("inherited config-only failed compilation cannot reuse a previous receipt", async (t) => {
  const root = await baseline(t, "const unused = 1; export const current = 2;\n");
  const config = object(await readJSON(resolve(root, "scripts/tsconfig.json")), "fixture config");
  await put(root, "scripts/tsconfig.json", { ...config, extends: "../compiler-settings.json" });
  await put(root, "compiler-settings.json", { compilerOptions: { noUnusedLocals: false } });
  await successful(root);
  const before = await assertCurrentBuild(root);
  assert.ok(before.inputs.some((file) => file.path === "compiler-settings.json"));
  await preserveMtime(
    root,
    "compiler-settings.json",
    '{"compilerOptions":{"noUnusedLocals":true}}\n',
  );
  assert.notEqual((await compile(root)).code, 0);
  await assert.rejects(assertCurrentBuild(root), /compile receipt is stale/);
});

test("dependency declarations and JS resources are tied to lock-backed installed bytes", async (t) => {
  const root = await baseline(
    t,
    "import type {Choice} from 'fixture-dep'; export const current: Choice = 1;\n",
  );
  await put(root, "package.json", { private: true, dependencies: { "fixture-dep": "1.0.0" } });
  await put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages:\n  fixture-dep@1.0.0: {}\n");
  await put(root, "node_modules/fixture-dep/package.json", {
    name: "fixture-dep",
    version: "1.0.0",
    type: "module",
    types: "index.d.mts",
  });
  await put(root, "node_modules/fixture-dep/index.d.mts", "export type Choice = 1;\n");
  await put(root, "node_modules/fixture-dep/runtime.mjs", "export const dependency = true;\n");
  await successful(root);
  const checked = await assertCurrentBuild(root);
  assert.ok(checked.dependencyFiles.some((file) => file.path.endsWith("fixture-dep/runtime.mjs")));
  await preserveMtime(root, "node_modules/fixture-dep/index.d.mts", "export type Choice = 2;\n");
  assert.notEqual((await compile(root)).code, 0);
  await assert.rejects(assertCurrentBuild(root), /compile receipt is stale/);
  await put(root, "node_modules/fixture-dep/package.json", {
    name: "fixture-dep",
    version: "2.0.0",
  });
  await assert.rejects(recordFixtureBuild(root), /absent from pnpm lock/);
  assert.equal(await exists(resolve(root, compileReceiptPath)), false);
});

test("dependency lock-only change invalidates successful compilation with preserved mtime", async (t) => {
  const root = await baseline(t);
  await put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages: {}\n");
  await successful(root);
  await preserveMtime(
    root,
    "pnpm-lock.yaml",
    "lockfileVersion: '9.0'\npackages: {}\n# changed lock inputs\n",
  );
  await assert.rejects(assertCurrentBuild(root), /compile receipt is stale/);
});

test("build-script invalidation prevents retained-output reuse after any failed attempt", async (t) => {
  const root = await baseline(t);
  await successful(root);
  const invalidation = await runCommand({
    command: process.execPath,
    args: [
      "-e",
      "require('node:fs').rmSync('.build/toolchain/compile-receipt.json', {force:true})",
    ],
    cwd: root,
  });
  assert.equal(invalidation.code, 0);
  const failure = await runCommand({
    command: process.execPath,
    args: ["-e", "process.exit(7)"],
    cwd: root,
  });
  assert.equal(failure.code, 7);
  assert.equal(await exists(resolve(root, ".build/scripts/main.mjs")), true);
  await assert.rejects(assertCurrentBuild(root), /Missing successful compile receipt/);
  await successful(root);
  await assertCurrentBuild(root);
});

test("added/deleted source membership and external dependency links cannot be silently sealed", async (t) => {
  const root = await baseline(t);
  await successful(root);
  await put(root, "scripts/new.mts", "export {};\n");
  await assert.rejects(assertCurrentBuild(root), /compile receipt is stale/);
  await assert.rejects(recordFixtureBuild(root), /not reachable/);
  await rm(resolve(root, "scripts/new.mts"));
  const outside = await temporary(t);
  await put(root, "package.json", { private: true, dependencies: { escaped: "1.0.0" } });
  await put(root, "node_modules/.keep", "fixture\n");
  await symlink(outside, resolve(root, "node_modules/escaped"), "dir");
  await assert.rejects(recordFixtureBuild(root), /Dependency link escapes repository/);
});

test("production receipt requires compiler evidence before and after the input snapshot", async (t) => {
  const root = await baseline(t);
  await successful(root);
  let checks = 0;
  await assert.rejects(
    recordBuild(root, async () => {
      checks += 1;
      if (checks === 2) throw new Error("Compiler inputs changed before sealing");
    }),
    /Compiler inputs changed before sealing/,
  );
  assert.equal(checks, 2);
  assert.equal(await exists(resolve(root, compileReceiptPath)), false);
});

test("pnpm 12 multi-document locks accept locked workspace bytes and reject conflicting records", async (t) => {
  const root = await temporary(t);
  await put(root, "package.json", { private: true, dependencies: { "fixture-dep": "1.0.0" } });
  await put(root, "node_modules/fixture-dep/package.json", {
    name: "fixture-dep",
    version: "1.0.0",
  });
  await put(root, "node_modules/fixture-dep/index.mjs", "export const value = 1;\n");
  const manager = "---\nlockfileVersion: '9.0'\npackages:\n  pnpm@12.18.0: {}\n";
  const workspace = "---\nlockfileVersion: '9.0'\npackages:\n  fixture-dep@1.0.0: {}\n";
  await put(root, "pnpm-lock.yaml", manager + workspace);
  assert.equal((await dependencySnapshot(root, [])).allowed.length, 2);
  await put(
    root,
    "pnpm-lock.yaml",
    manager +
      workspace +
      "---\npackages:\n  fixture-dep@1.0.0: {resolution: {integrity: different}}\n",
  );
  await assert.rejects(dependencySnapshot(root, []), /Conflicting pnpm lock package/);
  await put(
    root,
    "pnpm-lock.yaml",
    manager + "---\npackages:\n  fixture-dep@1.0.0: {}\n  fixture-dep@1.0.0: {}\n",
  );
  await assert.rejects(dependencySnapshot(root, []), /Invalid pnpm dependency lock/);
  await put(root, "pnpm-lock.yaml", manager);
  await assert.rejects(dependencySnapshot(root, []), /absent from pnpm lock/);
});
