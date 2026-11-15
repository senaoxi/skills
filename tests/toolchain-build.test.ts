import assert from "node:assert/strict";
import { readFile, readdir, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { buildSkills, prepareSkill } from "../scripts/build-skills.ts";
import { exists, treeDigest } from "../scripts/toolchain-core.ts";
import { discoverSkills } from "../scripts/toolchain-projects.ts";
import { docsPackage, put, skillText, temporary } from "./toolchain-fixtures.ts";

test("docs-only build preserves frontmatter bytes, excludes development files and cleans staging", async (t) => {
  const root = await temporary(t);
  const pkg = await docsPackage(root);
  await put(pkg, "skills/references/guide.md", "A guide.\n");
  await put(pkg, "skills/tests/internal.test.ts", "export {};\n");
  await put(pkg, "skills/tsconfig.json", "{}\n");
  let staged = "";
  const result = await buildSkills({
    root,
    publisher: async (observedRoot, publication) => {
      assert.equal(observedRoot, root);
      assert.equal(publication.artifacts.length, 1);
      const artifact = publication.artifacts[0];
      assert.ok(artifact);
      staged = artifact.directory;
      assert.equal(artifact.packagePath, "packages/example");
      assert.equal(await readFile(resolve(staged, "SKILL.md"), "utf8"), skillText("example"));
      assert.equal(await exists(resolve(staged, "tests")), false);
      assert.equal(await exists(resolve(staged, "tsconfig.json")), false);
      return { skills: 1 };
    },
  });
  assert.deepEqual(result, { skills: 1 });
  assert.equal(await exists(staged), false);
});

test("check and scoped migration reach the publisher without writing repository outputs", async (t) => {
  const root = await temporary(t);
  await docsPackage(root, "first");
  await docsPackage(root, "second");
  await put(root, "skills/remote/SKILL.md", "remote bytes\n");
  await put(root, "skills-lock.json", { existing: "receipt" });
  const before = await treeDigest(root);
  await buildSkills({
    root,
    skill: "second",
    check: true,
    migrate: true,
    publisher: async (_root, publication) => {
      assert.equal(publication.check, true);
      assert.equal(publication.migrate, true);
      assert.equal(publication.skill, "second");
      assert.deepEqual(
        publication.artifacts.map((artifact) => artifact.name),
        ["second"],
      );
    },
  });
  assert.equal(await treeDigest(root), before);
  await assert.rejects(buildSkills({ root, skill: "unknown" }), /Unknown skill/);
});

test("publisher failures remove staging and invalid local references prevent publication", async (t) => {
  const root = await temporary(t);
  const pkg = await docsPackage(root);
  let staged = "";
  await assert.rejects(
    buildSkills({
      root,
      publisher: async (_root, publication) => {
        staged = publication.artifacts[0]?.directory ?? "";
        throw new Error("transaction rejected");
      },
    }),
    /transaction rejected/,
  );
  assert.equal(await exists(staged), false);
  await put(pkg, "skills/SKILL.md", skillText("example", "[Missing](references/missing.md)\n"));
  await assert.rejects(
    buildSkills({ root, publisher: async () => assert.fail("must not publish") }),
    /Missing local reference/,
  );
});

async function preparedFixture(
  t: Parameters<typeof temporary>[0],
  afterWrite = "",
): Promise<{ root: string; pkg: string }> {
  const root = await temporary(t);
  const pkg = await docsPackage(root, "example", true);
  await put(
    pkg,
    "scripts/assemble.ts",
    `import { appendFile, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { current } from "./current.ts";

const [flag, out, ...extra] = process.argv.slice(2);
if (flag !== "--out" || !out || !isAbsolute(out) || extra.length)
  throw new Error("expected one absolute --out path");
if ((await readdir(out)).length) throw new Error("output must start empty");
if ((await realpath(process.cwd())) !== (await realpath(new URL("../", import.meta.url))))
  throw new Error("preparation must run from the source package");
await mkdir(resolve(out, "scripts"));
await writeFile(resolve(out, "scripts/current.mjs"), "export const current = " + current + ";\\n");
${afterWrite}
`,
  );
  await put(pkg, "scripts/current.ts", "export const current: number = 42;\n");
  return { root, pkg };
}

test("source preparation uses empty staging and leaves a clean checkout untouched in check mode", async (t) => {
  const { root, pkg } = await preparedFixture(t);
  const before = await treeDigest(root);
  await buildSkills({
    root,
    check: true,
    publisher: async (_root, publication) => {
      const artifact = publication.artifacts[0];
      assert.ok(artifact);
      assert.deepEqual(await readdir(resolve(artifact.directory, "scripts")), ["current.mjs"]);
      assert.equal(
        await readFile(resolve(artifact.directory, "scripts/current.mjs"), "utf8"),
        "export const current = 42;\n",
      );
    },
  });
  assert.equal(await treeDigest(root), before);
  assert.equal(await exists(resolve(pkg, ".build")), false);
  assert.equal(await exists(resolve(root, ".build")), false);
});

test("source preparation ignores stale JS and fails when the corresponding source is missing", async (t) => {
  const { root, pkg } = await preparedFixture(t);
  const stale = "throw new Error('stale JS executed');\n";
  await put(pkg, ".build/scripts/assemble.js", stale);
  await put(pkg, ".build/scripts/current.js", stale);
  await put(pkg, "scripts/current.js", stale);
  await put(root, ".build/toolchain/compile-receipt.json", {});
  await buildSkills({
    root,
    publisher: async (_root, publication) => {
      const artifact = publication.artifacts[0];
      assert.ok(artifact);
      assert.equal(
        await readFile(resolve(artifact.directory, "scripts/current.mjs"), "utf8"),
        "export const current = 42;\n",
      );
    },
  });
  const publisher = async (): Promise<void> => assert.fail("must not publish");
  await rm(resolve(pkg, "scripts/current.ts"));
  await assert.rejects(buildSkills({ root, publisher }), /Cannot find module.*current\.ts/);
  await rm(resolve(pkg, "scripts/assemble.ts"));
  await assert.rejects(buildSkills({ root, publisher }), /Missing artifact:prepare source/);
});

test("source or lock changes during preparation prevent publication", async (t) => {
  for (const input of ["scripts/current.ts", "../../pnpm-lock.yaml"]) {
    const { root } = await preparedFixture(t, `await appendFile(${JSON.stringify(input)}, "\\n");`);
    await put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    await assert.rejects(
      buildSkills({ root, publisher: async () => assert.fail("must not publish") }),
      /Artifact inputs changed during preparation/,
    );
  }
});

test("a failed source preparer discards its partial output", async (t) => {
  const { root } = await preparedFixture(
    t,
    `await writeFile("../../staging-path.txt", out);
throw new Error("fixture assembly failure");`,
  );
  await put(
    root,
    "skills/example/SKILL.md",
    skillText("example", "Previous published artifact.\n"),
  );
  const previous = await treeDigest(resolve(root, "skills"));
  await assert.rejects(buildSkills({ root }), /fixture assembly failure/);
  assert.equal(await exists(await readFile(resolve(root, "staging-path.txt"), "utf8")), false);
  assert.equal(await treeDigest(resolve(root, "skills")), previous);
});

test("static symbolic links are rejected before calling the publisher", async (t) => {
  const root = await temporary(t);
  const pkg = await docsPackage(root);
  await symlink(resolve(pkg, "skills/SKILL.md"), resolve(pkg, "skills/linked.md"));
  await assert.rejects(
    buildSkills({ root, publisher: async () => assert.fail("must not publish") }),
    /Symbolic link/,
  );
});

test("a full empty build supplies the empty desired local set for stale-owner removal", async (t) => {
  const root = await temporary(t);
  let called = false;
  await buildSkills({
    root,
    publisher: async (_root, publication) => {
      assert.deepEqual(publication.artifacts, []);
      assert.equal(publication.skill, undefined);
      called = true;
    },
  });
  assert.equal(called, true);
});

test("direct preparation rejects authored JS in skills/ even for docs-only packages", async (t) => {
  for (const path of ["scripts/legacy.mjs", "assets/handwritten.js", "tests/hidden.test.cjs"]) {
    const root = await temporary(t);
    const pkg = await docsPackage(root);
    await put(pkg, `skills/${path}`, "export const bypass = true;\n");
    const actual = (await discoverSkills(root))[0];
    assert.ok(actual);
    await assert.rejects(
      prepareSkill(root, actual, await temporary(t)),
      /Authored JavaScript is forbidden in skills/,
    );
  }
});

test("direct prepare rejects a forged package descriptor instead of trusting the caller", async (t) => {
  const root = await temporary(t);
  await docsPackage(root);
  const actual = (await discoverSkills(root))[0];
  assert.ok(actual);
  await assert.rejects(
    prepareSkill(root, { ...actual, prepare: true }, await temporary(t)),
    /identity does not match workspace metadata/,
  );
});
