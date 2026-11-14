import assert from "node:assert/strict";
import { rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  discoverSkills,
  outputManifest,
  sourceSolution,
  validateProjects,
} from "../scripts/toolchain-projects.mjs";
import { docsPackage, project, put, solution, temporary } from "./toolchain-fixtures.mjs";

test("package discovery validates identity and supports docs-only packages", async (t) => {
  const root = await temporary(t);
  await docsPackage(root);
  await put(root, "scripts/tool.mts", "export {};\n");
  await project(root, "scripts", ["tool.mts"]);
  await solution(root, ["scripts"]);
  assert.deepEqual(
    (await discoverSkills(root)).map((pkg) => pkg.name),
    ["example"],
  );
  assert.deepEqual(await validateProjects(root), { projects: 2, sources: 1 });
});

test("package discovery rejects duplicate names and arbitrary preparer commands", async (t) => {
  const root = await temporary(t);
  await docsPackage(root);
  await put(root, "packages/z-duplicate/package.json", { skillBuild: { name: "example" } });
  await assert.rejects(discoverSkills(root), /Duplicate skillBuild/);
  await rm(resolve(root, "packages/z-duplicate"), { recursive: true });
  await put(root, "packages/example/package.json", {
    name: "@senaoxi/skill-example",
    private: true,
    type: "module",
    skillBuild: { name: "example" },
    scripts: { "artifact:prepare": "tsx src/assemble.mts" },
  });
  await assert.rejects(discoverSkills(root), /artifact:prepare/);
});

test("workspace membership and actual package metadata cannot diverge", async (t) => {
  for (const change of [
    { private: false },
    { type: "commonjs" },
    { name: "@other/example" },
    { skillBuild: { name: "different" } },
  ]) {
    const root = await temporary(t);
    const pkg = await docsPackage(root);
    await put(pkg, "package.json", {
      name: "@senaoxi/skill-example",
      private: true,
      type: "module",
      skillBuild: { name: "example" },
      ...change,
    });
    await assert.rejects(discoverSkills(root), /expected private|slug must match/);
  }
  const root = await temporary(t);
  await docsPackage(root);
  await put(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n  - '!packages/example'\n");
  await assert.rejects(discoverSkills(root), /not a workspace member/);
  await put(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n");
  await put(root, "packages/unmarked/package.json", { name: "unmarked" });
  await assert.rejects(discoverSkills(root), /not discovered by skillBuild/);
});

test("code-bearing package Solution must be reachable even when a leaf covers its sources", async (t) => {
  const root = await temporary(t);
  const pkg = await docsPackage(root);
  await put(pkg, "src/runtime.mts", "export const current = 1;\n");
  await project(pkg, "src", ["runtime.mts"], "../.build/src");
  await solution(root, ["packages/example/src"]);
  await assert.rejects(validateProjects(root), /package source Solution is not reachable/);
  await solution(pkg, ["src"]);
  await solution(root, ["packages/example"]);
  assert.deepEqual(await validateProjects(root), { projects: 3, sources: 1 });
});

test("source Solution membership handles nested references and current output mapping", async (t) => {
  const root = await temporary(t);
  await put(root, "scripts/task.mts", "export const task = 1;\n");
  await put(root, "tests/task.test.mts", "export {};\n");
  await project(root, "scripts", ["task.mts"]);
  await project(root, "tests", ["task.test.mts"]);
  await solution(root, ["scripts", "tests/tsconfig.json"]);
  assert.deepEqual(await validateProjects(root), { projects: 3, sources: 2 });
  const files = outputManifest(await sourceSolution(root));
  assert.deepEqual(
    files.map((file) => file.output),
    [resolve(root, ".build/scripts/task.mjs"), resolve(root, ".build/tests/task.test.mjs")],
  );
});

test("membership does not infer a generated import graph or inspect business types", async (t) => {
  const root = await temporary(t);
  await put(root, "scripts/a.mts", "import './missing.mjs'; export const wrong: string = 3;\n");
  await project(root, "scripts", ["a.mts"]);
  await solution(root, ["scripts"]);
  assert.deepEqual(await validateProjects(root), { projects: 2, sources: 1 });
});

test("project validator rejects uncovered and overlapping owners", async (t) => {
  const root = await temporary(t);
  await put(root, "scripts/a.mts", "export {};\n");
  await put(root, "scripts/b.mts", "export {};\n");
  await project(root, "scripts", ["a.mts"]);
  await solution(root, ["scripts"]);
  await assert.rejects(validateProjects(root), /not reachable/);
  await project(root, "scripts", ["a.mts", "b.mts"]);
  await project(root, "tests", ["../scripts/a.mts"]);
  await solution(root, ["scripts", "tests"]);
  await assert.rejects(validateProjects(root), /Overlapping project owners/);
});

test("project references cannot be missing, outside root, or hidden behind external symlinks", async (t) => {
  const root = await temporary(t);
  const other = await temporary(t);
  await solution(other, []);
  await solution(root, ["missing"]);
  await assert.rejects(validateProjects(root), /ENOENT|read file/);
  await solution(root, [resolve(other, "tsconfig.json")]);
  await assert.rejects(validateProjects(root), /escapes root/);
  await symlink(other, resolve(root, "linked"), "dir");
  await solution(root, ["linked"]);
  await assert.rejects(validateProjects(root), /outside root/);
});

test("strictness, output declaration and authored JS checks apply to every owner", async (t) => {
  for (const change of [
    {
      compilerOptions: { strict: false, noEmit: true },
      files: ["a.mts"],
      liminaOptions: { outputs: { rootDir: ".", outDir: "../.build/scripts" } },
    },
    { compilerOptions: { strict: true, allowJs: true, noEmit: true }, files: ["a.mts"] },
    { compilerOptions: { strict: true, noCheck: true, noEmit: true }, files: ["a.mts"] },
    { compilerOptions: { strict: true, noEmit: true }, files: ["a.mts"] },
  ]) {
    const root = await temporary(t);
    await put(root, "scripts/a.mts", "export {};\n");
    await put(root, "scripts/tsconfig.json", change);
    await solution(root, ["scripts"]);
    await assert.rejects(validateProjects(root), /strict|allowJs|noCheck|mandatory/);
  }
  const root = await temporary(t);
  await put(root, "scripts/a.mts", "export {};\n");
  await put(root, "scripts/legacy.mjs", "export {};\n");
  await project(root, "scripts", ["a.mts"]);
  await solution(root, ["scripts"]);
  await assert.rejects(validateProjects(root), /Authored JavaScript/);
});

test("validator rejects checking suppression but does not mistake quoted examples for comments", async (t) => {
  const root = await temporary(t);
  await put(root, "scripts/a.mts", "export const quoted = '// @ts-nocheck';\n");
  await project(root, "scripts", ["a.mts"]);
  await solution(root, ["scripts"]);
  await validateProjects(root);
  await put(root, "scripts/a.mts", "// @ts-nocheck\nexport const broken: string = 1;\n");
  await assert.rejects(validateProjects(root), /@ts-nocheck/);
});
