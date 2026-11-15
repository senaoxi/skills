import assert from "node:assert/strict";
import { rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { discoverSkills, sourceSolution } from "../scripts/toolchain-projects.ts";
import { docsPackage, put, solution, temporary } from "./toolchain-fixtures.ts";

test("package discovery validates identity and supports docs-only packages", async (t) => {
  const root = await temporary(t);
  await docsPackage(root);
  assert.deepEqual(
    (await discoverSkills(root)).map((pkg) => pkg.name),
    ["example"],
  );
});

test("package discovery rejects duplicate names and arbitrary preparer commands", async (t) => {
  const root = await temporary(t);
  await docsPackage(root);
  await put(root, "packages/z-duplicate/package.json", { skillBuild: { name: "example" } });
  await assert.rejects(discoverSkills(root), /Duplicate skillBuild/);
  await rm(resolve(root, "packages/z-duplicate"), { recursive: true });
  for (const prepare of [
    "node .build/scripts/assemble.js",
    "node src/assemble.ts",
    "node scripts/assemble.ts --extra",
  ]) {
    await put(root, "packages/example/package.json", {
      name: "@senaoxi/skill-example",
      private: true,
      type: "module",
      skillBuild: { name: "example" },
      scripts: { "artifact:prepare": prepare },
    });
    await assert.rejects(discoverSkills(root), /artifact:prepare/);
  }
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

test("project references cannot be missing, outside root, or hidden behind external symlinks", async (t) => {
  const root = await temporary(t);
  const other = await temporary(t);
  await solution(other, []);
  await solution(root, ["missing"]);
  await assert.rejects(sourceSolution(root), /ENOENT|read file/);
  await solution(root, [resolve(other, "tsconfig.json")]);
  await assert.rejects(sourceSolution(root), /escapes root/);
  await symlink(other, resolve(root, "linked"), "dir");
  await solution(root, ["linked"]);
  await assert.rejects(sourceSolution(root), /outside root/);
});
