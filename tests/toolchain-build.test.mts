import { recordFixtureBuild } from "./toolchain-fixtures.mjs";
import assert from "node:assert/strict";
import { lstat, readFile, readdir, rm, symlink, utimes } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { buildSkills, prepareSkill } from "../scripts/build-skills.mjs";
import { exists, object, readJSON, treeDigest } from "../scripts/toolchain-core.mjs";
import { assertCurrentBuild } from "../scripts/toolchain-compile.mjs";
import { discoverSkills } from "../scripts/toolchain-projects.mjs";
import {
  docsPackage,
  emitFixture,
  project,
  put,
  skillText,
  solution,
  temporary,
} from "./toolchain-fixtures.mjs";

test("docs-only build preserves frontmatter bytes, excludes development files and cleans staging", async (t) => {
  const root = await temporary(t);
  const pkg = await docsPackage(root);
  await put(pkg, "skill/references/guide.md", "A guide.\n");
  await put(pkg, "skill/tests/internal.test.mts", "export {};\n");
  await put(pkg, "skill/tsconfig.json", "{}\n");
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
  await put(pkg, "skill/SKILL.md", skillText("example", "[Missing](references/missing.md)\n"));
  await assert.rejects(
    buildSkills({ root, publisher: async () => assert.fail("must not publish") }),
    /Missing local reference/,
  );
});

async function preparedFixture(
  t: Parameters<typeof temporary>[0],
): Promise<{ root: string; pkg: string }> {
  const root = await temporary(t);
  const pkg = await docsPackage(root, "example", true);
  await put(
    pkg,
    "scripts/assemble.mts",
    `import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const out=process.argv[3];
if(process.argv[2]!=='--out'||!out||!out.startsWith('/'))throw new Error('absolute --out required');
if((await readdir(out)).length)throw new Error('output must start empty');
await mkdir(resolve(out,'scripts'),{recursive:true});
for(const file of await readdir('.build/runtime'))await cp(resolve('.build/runtime',file),resolve(out,'scripts',file));
const manifest=JSON.parse(await readFile(process.env.SKILL_BUILD_OUTPUT_MANIFEST,'utf8'));
if(manifest.version!==2||!manifest.compileReceipt.inputHash||!Array.isArray(manifest.dependencyFiles))throw new Error('checked output metadata required');
if(manifest.viewRoot!==process.cwd())throw new Error('metadata must identify the actual view');
for(const file of manifest.files){
 if(file.output===file.originalOutput||!file.output.startsWith(manifest.viewRoot+'/'))throw new Error('owned allowlist must contain view paths only');
 if(createHash('sha256').update(await readFile(file.output)).digest('hex')!==file.sha256)throw new Error('view hash mismatch');
}
for(const file of manifest.dependencyFiles)if(createHash('sha256').update(await readFile(file.path)).digest('hex')!==file.sha256)throw new Error('dependency hash mismatch');
await writeFile(resolve(out,'manifest.json'),JSON.stringify({count:manifest.files.length,withinBuild:process.cwd().split('/').at(-2)==='.build'}));
`,
  );
  await put(pkg, "runtime/current.mts", "export const current: number = 42;\n");
  await project(pkg, "scripts", ["assemble.mts"], "../.build/scripts");
  await project(pkg, "runtime", ["current.mts"], "../.build/runtime");
  await solution(pkg, ["scripts", "runtime"]);
  await solution(root, ["packages/example"]);
  await emitFixture(pkg, "scripts/assemble.mts", ".build/scripts/assemble.mjs");
  await emitFixture(pkg, "runtime/current.mts", ".build/runtime/current.mjs");
  await recordFixtureBuild(root);
  return { root, pkg };
}

test("compiled preparer gets empty output and a current manifest; stale output globs cannot leak", async (t) => {
  const { root, pkg } = await preparedFixture(t);
  await put(pkg, ".build/runtime/deleted.mjs", "throw new Error('stale must not ship');\n");
  const before = await treeDigest(root);
  await buildSkills({
    root,
    check: true,
    publisher: async (_root, publication) => {
      const artifact = publication.artifacts[0];
      assert.ok(artifact);
      assert.deepEqual(await readdir(resolve(artifact.directory, "scripts")), ["current.mjs"]);
      assert.deepEqual(
        JSON.parse(await readFile(resolve(artifact.directory, "manifest.json"), "utf8")),
        { count: 2, withinBuild: true },
      );
      assert.match(
        await readFile(resolve(artifact.directory, "scripts/current.mjs"), "utf8"),
        /current = 42/,
      );
    },
  });
  assert.equal(await treeDigest(root), before);
});

test("preparer cannot silently run missing, stale or unmapped compiled source", async (t) => {
  const { root, pkg } = await preparedFixture(t);
  const publisher = async (): Promise<void> => assert.fail("must not publish");
  const runtime = resolve(pkg, ".build/runtime/current.mjs");
  const saved = await readFile(runtime, "utf8");
  await rm(runtime);
  await assert.rejects(buildSkills({ root, publisher }), /Missing compiled output/);
  await put(pkg, ".build/runtime/current.mjs", `${saved}\n// changed after compile\n`);
  const old = new Date((await lstat(resolve(pkg, "runtime/current.mts"))).mtimeMs - 10_000);
  await utimes(runtime, old, old);
  await assert.rejects(buildSkills({ root, publisher }), /compile receipt is stale/);
  await put(pkg, "scripts/other.mts", "export {};\n");
  await project(pkg, "scripts", ["other.mts"]);
  await assert.rejects(
    buildSkills({ root, publisher }),
    /Missing compiled output|compile receipt is stale/,
  );
});

test("static symbolic links are rejected before calling the publisher", async (t) => {
  const root = await temporary(t);
  const pkg = await docsPackage(root);
  await symlink(resolve(pkg, "skill/SKILL.md"), resolve(pkg, "skill/linked.md"));
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

test("direct preparation rejects authored JS in skill/ even for docs-only packages", async (t) => {
  for (const path of ["scripts/legacy.mjs", "assets/handwritten.js", "tests/hidden.test.cjs"]) {
    const root = await temporary(t);
    const pkg = await docsPackage(root);
    await put(pkg, `skill/${path}`, "export const bypass = true;\n");
    const actual = (await discoverSkills(root))[0];
    assert.ok(actual);
    await assert.rejects(
      prepareSkill(root, actual, await temporary(t)),
      /Authored JavaScript is forbidden in skill/,
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

test("view metadata carries exact lock-backed dependency files without adding owned escape paths", async (t) => {
  const { root } = await preparedFixture(t);
  await put(root, "package.json", { private: true, dependencies: { "fixture-dep": "1.0.0" } });
  await put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages:\n  fixture-dep@1.0.0: {}\n");
  await put(root, "node_modules/fixture-dep/package.json", {
    name: "fixture-dep",
    version: "1.0.0",
    type: "module",
  });
  await put(root, "node_modules/fixture-dep/runtime.mjs", "export const locked = true;\n");
  await recordFixtureBuild(root);
  const before = await treeDigest(root);
  await buildSkills({
    root,
    check: true,
    publisher: async (_root, publication) => {
      assert.equal(publication.artifacts.length, 1);
    },
  });
  assert.equal(await treeDigest(root), before);
});

test("successful record writes package source-output metadata and guards missing or modified tables", async (t) => {
  const { root, pkg } = await preparedFixture(t);
  const path = resolve(pkg, ".build/source-outputs.json");
  const metadata = object(await readJSON(path), "package source outputs");
  assert.equal(metadata.version, 1);
  assert.ok(Array.isArray(metadata.files));
  assert.equal(metadata.files.length, 2);
  assert.equal(typeof object(metadata.compileReceipt, "compile receipt").inputHash, "string");
  await put(pkg, ".build/source-outputs.json", { ...metadata, files: [] });
  await assert.rejects(assertCurrentBuild(root), /source outputs metadata is missing or stale/);
  await recordFixtureBuild(root);
  await rm(path);
  await assert.rejects(assertCurrentBuild(root), /source outputs metadata is missing or stale/);
});
