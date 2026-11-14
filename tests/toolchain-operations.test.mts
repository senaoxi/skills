import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { packFiles } from "../scripts/check-pack.mjs";
import { clean, cleanTargets } from "../scripts/clean.mjs";
import { argumentsFor, exists, treeDigest } from "../scripts/toolchain-core.mjs";
import { skillTask } from "../scripts/skill-task.mjs";
import { docsPackage, project, put, solution, temporary } from "./toolchain-fixtures.mjs";

test("pack allowlist accepts only the declared public package contents", () => {
  const make = (names: string[]): unknown => [{ files: names.map((path) => ({ path })) }];
  const base = ["package.json", "README.md", "LICENSE", "skills/example/SKILL.md"];
  assert.deepEqual(packFiles(make(base)), base);
  for (const path of [
    "scripts/task.mjs",
    ".build/tests/foo.mjs",
    "pnpm-lock.yaml",
    "skills/../secret",
    "skills/example/../../secret",
    "/skills/example/SKILL.md",
    "skills\\example\\SKILL.md",
  ]) {
    assert.throws(() => packFiles(make([...base, path])), /Unexpected packed path/);
  }
  assert.throws(() => packFiles(make(base.slice(1))), /Required packed file/);
  assert.throws(() => packFiles(make(base.slice(0, 3))), /contains no skills/);
});

test("clean deletes only declared builds and Limina caches, preserving distributions and reports", async (t) => {
  const root = await temporary(t);
  const pkg = await docsPackage(root);
  await put(root, "scripts/a.mts", "export {};\n");
  await project(root, "scripts", ["a.mts"]);
  await solution(root, ["scripts"]);
  for (const path of [
    ".build/scripts/a.mjs",
    ".limina/cache",
    ".liminainfo",
    "packages/example/.limina/cache",
    "packages/example/.build/not-declared",
    "skills/example/SKILL.md",
    "reports/evals/report.json",
    "unrelated.build/keep",
  ])
    await put(root, path, "keep unless declared\n");
  const before = await treeDigest(root);
  const preview = await clean(root, true);
  assert.equal(await treeDigest(root), before);
  assert.ok(preview.removed.includes(".build"));
  const result = await clean(root);
  assert.deepEqual(result.removed, preview.removed);
  assert.equal(await exists(resolve(root, ".build")), false);
  assert.equal(await exists(resolve(root, ".limina")), false);
  assert.equal(await exists(resolve(root, ".liminainfo")), false);
  assert.equal(await exists(resolve(pkg, ".limina")), false);
  for (const path of [
    "packages/example/.build/not-declared",
    "skills/example/SKILL.md",
    "reports/evals/report.json",
    "unrelated.build/keep",
  ])
    assert.equal(await exists(resolve(root, path)), true);
  await put(pkg, ".build/source-outputs.json", { version: 1, files: [] });
  await clean(root);
  assert.equal(await exists(resolve(pkg, ".build")), false);
});

test("clean preflights every target and rejects symlink escapes before deletion", async (t) => {
  const root = await temporary(t);
  const outside = await temporary(t);
  await put(root, "scripts/a.mts", "export {};\n");
  await project(root, "scripts", ["a.mts"]);
  await solution(root, ["scripts"]);
  await put(root, ".build/keep", "unchanged\n");
  await symlink(outside, resolve(root, ".limina"), "dir");
  await assert.rejects(clean(root), /outside root|symlink/);
  assert.equal(await exists(resolve(root, ".build/keep")), true);
});

test("clean rejects outputs outside .build and a target under skills", async (t) => {
  const root = await temporary(t);
  await put(root, "scripts/a.mts", "export {};\n");
  await project(root, "scripts", ["a.mts"], "../skills");
  await solution(root, ["scripts"]);
  await assert.rejects(cleanTargets(root), /outside .build/);
  await project(root, "scripts", ["a.mts"], "../skills/.build/output");
  await assert.rejects(cleanTargets(root), /unsafe clean target/);
});

test("a workspace package named skills does not collide with the root mirror cleanup boundary", async (t) => {
  const root = await temporary(t);
  const pkg = await docsPackage(root, "skills");
  await put(root, "scripts/a.mts", "export {};\n");
  await project(root, "scripts", ["a.mts"]);
  await solution(root, ["scripts"]);
  await put(pkg, ".build/source-outputs.json", { version: 1, files: [] });
  await put(root, "skills/retained/SKILL.md", "retained mirror\n");
  await clean(root);
  assert.equal(await exists(resolve(pkg, ".build")), false);
  assert.equal(await exists(resolve(root, "skills/retained/SKILL.md")), true);
});

test("argument parser rejects unknown and duplicate flags; task dispatcher checks skill ownership", async (t) => {
  assert.equal(argumentsFor(["--kind=unit"], ["kind"]).values.get("kind"), "unit");
  for (const args of [["--unknown"], ["--kind"], ["--check", "--check"], ["-x"]]) {
    assert.throws(() => argumentsFor(args, ["kind"], ["check"]));
  }
  const root = await temporary(t);
  await docsPackage(root);
  await assert.rejects(skillTask(root, ["missing", "test"]), /Unknown skill/);
  await assert.rejects(skillTask(root, ["example", "unknown"]), /Unknown skill task/);
  await assert.rejects(
    skillTask(root, ["example", "test", "--unit", "--integration"]),
    /one test kind/,
  );
});
