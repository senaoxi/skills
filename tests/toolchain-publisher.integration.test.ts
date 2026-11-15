import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { buildSkills, prepareSkill } from "../scripts/build-skills.ts";
import { exists, json, object, readJSON, treeDigest } from "../scripts/toolchain-core.ts";
import { discoverSkills } from "../scripts/toolchain-projects.ts";
import { preparedReceipt } from "../scripts/toolchain-provenance.ts";
import { inventory, manageRepository, renderNotices } from "../scripts/skills.ts";
import { bundledNoticesFile } from "../scripts/manager-types.ts";
import type { ExternalReceipt, Manifest, SkillsLock } from "../scripts/manager-types.ts";
import { parseSdkRecord } from "../scripts/manager-schema.ts";
import { docsPackage, put, skillText, temporary } from "./toolchain-fixtures.ts";
import type { TestContext } from "node:test";

const terms = `MIT License

Copyright (c) 2026 Fixture Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

async function publicationRoot(t: TestContext, legacyLocal = false): Promise<string> {
  const root = await temporary(t);
  const sources = legacyLocal
    ? [{ id: "source-2", source: "./my-skills", selection: { mode: "all", exclude: [] } }]
    : [];
  const manifest = { version: 2, sources };
  await put(root, "package.json", {
    name: "@fixture/skills",
    version: "0.0.0",
    private: true,
    type: "module",
    packageManager: "pnpm@12.18.0",
    engines: { node: "^24.15.0 || >=26.0.0" },
    devDependencies: { limina: "0.5.0", typescript: "6.0.3", yaml: "2.9.1" },
  });
  await mkdir(resolve(root, "skills"));
  await put(root, "skills-sources.json", manifest);
  await put(root, "LICENSE", "Project fixture terms.\n");
  await put(root, "skills-lock.json", {
    version: 2,
    skills: {},
    repository: {
      version: 2,
      sdk: "skills@1.8.1",
      installed: {},
      sources: legacyLocal
        ? { "source-2": { input: "./my-skills", binding: { type: "local", url: "./my-skills" } } }
        : {},
      manifestHash: hash(json(manifest)),
      licenseHash: hash("Project fixture terms.\n"),
      controlModes: { "skills-sources.json": 0, "skills-lock.json": 0, LICENSE: 0 },
    },
  });
  return root;
}

async function licensedPackage(root: string, name: string): Promise<string> {
  const directory = await docsPackage(root, name);
  await put(directory, "skills/LICENSE", terms);
  return directory;
}

async function installed(root: string): Promise<Record<string, unknown>> {
  return object(
    object(
      object(await readJSON(resolve(root, "skills-lock.json")), "lock").repository,
      "repository",
    ).installed,
    "installed",
  );
}

test("toolchain adapter publishes real local SDK receipts and check detects drift without writes", async (t) => {
  const root = await publicationRoot(t);
  const pkg = await licensedPackage(root, "example");
  await buildSkills({ root });
  assert.equal(object((await installed(root)).example, "receipt").kind, "workspace-build");
  assert.equal(await readFile(resolve(root, "skills/example/LICENSE"), "utf8"), terms);
  assert.equal(await readFile(resolve(root, "LICENSE"), "utf8"), "Project fixture terms.\n");
  assert.match(await readFile(resolve(root, bundledNoticesFile), "utf8"), /Fixture Authors/);
  const before = await treeDigest(root);
  await buildSkills({ root, check: true });
  assert.equal(await treeDigest(root), before);
  await put(pkg, "skills/SKILL.md", skillText("example", "Changed source.\n"));
  const changed = await treeDigest(root);
  await assert.rejects(buildSkills({ root, check: true }), /differ from the prepared build/);
  assert.equal(await treeDigest(root), changed);
});

test("scoped publishing preserves other local bytes and receipts; full empty set removes stale local owners", async (t) => {
  const root = await publicationRoot(t);
  await licensedPackage(root, "first");
  const second = await licensedPackage(root, "second");
  await buildSkills({ root });
  const firstReceipt = (await installed(root)).first;
  const firstBytes = await treeDigest(resolve(root, "skills/first"));
  await put(second, "skills/SKILL.md", skillText("second", "Only the selected package changes.\n"));
  await buildSkills({ root, skill: "second" });
  assert.deepEqual((await installed(root)).first, firstReceipt);
  assert.equal(await treeDigest(resolve(root, "skills/first")), firstBytes);
  await rm(resolve(root, "packages"), { recursive: true });
  await buildSkills({ root });
  assert.deepEqual(await installed(root), {});
  assert.equal(await exists(resolve(root, "skills/first")), false);
});

test("source-2 adoption into packages requires explicit migration", async (t) => {
  const root = await publicationRoot(t, true);
  await put(root, "my-skills/example/SKILL.md", skillText("example"));
  await put(root, "my-skills/example/LICENSE", terms);
  await manageRepository(root, { type: "sync" });
  await licensedPackage(root, "example");
  const before = await treeDigest(root);
  await assert.rejects(buildSkills({ root }), /collision/);
  assert.equal(await treeDigest(root), before);
  await buildSkills({ root, migrate: true });
  const receipt = object((await installed(root)).example, "receipt");
  assert.equal(receipt.kind, "workspace-build");
  assert.equal(receipt.packageDir, "packages/example");
  const manifest = object(await readJSON(resolve(root, "skills-sources.json")), "sources");
  assert.deepEqual(manifest.sources, []);
  await buildSkills({ root, check: true });
});

test("receipt hashes follow current source inputs and ignore stale .build files", async (t) => {
  const root = await publicationRoot(t);
  const pkg = await licensedPackage(root, "example");
  const manifest = object(await readJSON(resolve(pkg, "package.json")), "package manifest");
  await put(pkg, "package.json", { ...manifest, devDependencies: { rolldown: "1.3.2" } });
  const [skill] = await discoverSkills(root);
  const artifact = await prepareSkill(root, skill, await temporary(t));
  const first = await preparedReceipt(root, artifact);
  await put(pkg, ".build/deleted.js", "stale output\n");
  assert.equal((await preparedReceipt(root, artifact)).inputHash, first.inputHash);
  await put(pkg, "skills/SKILL.md", skillText("example", "New input.\n"));
  await assert.rejects(
    preparedReceipt(root, artifact),
    /Artifact inputs changed before publication/,
  );
  const updated = await prepareSkill(root, skill, await temporary(t));
  assert.notEqual((await preparedReceipt(root, updated)).inputHash, first.inputHash);
  await put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  await assert.rejects(
    preparedReceipt(root, updated),
    /Artifact inputs changed before publication/,
  );
  assert.equal(first.toolchain.recipe, "skills-local-build-v2");
  assert.equal(first.toolchain.rolldown, "1.3.2");
  assert.equal(first.toolchain.node, "^24.15.0 || >=26.0.0");
  assert.equal(first.toolchain.typescript, "6.0.3");
});

test("real local publication preserves 58 independent external receipt and mirror fixtures", async (t) => {
  const root = await publicationRoot(t);
  const manifest: Manifest = {
    version: 2,
    sources: [
      {
        id: "source-1",
        source: "fixture/remote",
        ref: "main",
        selection: { mode: "all", exclude: [] },
      },
    ],
  };
  const receipts: ExternalReceipt[] = [];
  const sdkRecords: SkillsLock["skills"] = {};
  const installedRecords: SkillsLock["repository"]["installed"] = {};
  for (let index = 0; index < 58; index++) {
    const name = `remote-${index}`;
    const path = resolve(root, "skills", name);
    await put(path, "SKILL.md", skillText(name));
    const listing = await inventory(path);
    assert.ok(listing);
    const sdk = parseSdkRecord({
      source: "fixture/remote",
      sourceType: "github",
      ref: "main",
      skillPath: `skills/${name}/SKILL.md`,
      computedHash: hash(`sdk-${index}`),
      installMode: "copy",
    });
    const record = {
      kind: "external",
      sourceId: "source-1",
      origin: { kind: "path", path: `skills/${name}` },
      declaredName: name,
      provenance: {
        kind: "git",
        remote: "https://github.com/fixture/remote.git",
        commit: "a".repeat(40),
        ref: "main",
        path: `skills/${name}`,
      },
      installedDigest: listing.hash,
      treeHash: listing.hash,
      sdkRecordHash: hash(json(sdk)),
      notices: [{ path: "LICENSE", text: terms, sha256: hash(terms) }],
      centralizedNotices: [],
    } satisfies SkillsLock["repository"]["installed"][string];
    sdkRecords[name] = sdk;
    installedRecords[name] = record;
    receipts.push({ ...record, name, path, sdk });
  }
  await put(root, bundledNoticesFile, renderNotices(receipts));
  await put(root, "skills-sources.json", manifest);
  await put(root, "skills-lock.json", {
    version: 2,
    skills: sdkRecords,
    repository: {
      version: 2,
      sdk: "skills@1.8.1",
      sources: {
        "source-1": {
          input: "fixture/remote",
          binding: { type: "github", url: "https://github.com/fixture/remote.git" },
        },
      },
      installed: installedRecords,
      manifestHash: hash(json(manifest)),
      licenseHash: hash("Project fixture terms.\n"),
      controlModes: { "skills-sources.json": 0, "skills-lock.json": 0, LICENSE: 0 },
    },
  } satisfies SkillsLock);
  const pkg = await licensedPackage(root, "example");
  await buildSkills({ root });
  await put(
    pkg,
    "skills/SKILL.md",
    skillText("example", "Scoped update with remote owners present.\n"),
  );
  await buildSkills({ root, skill: "example" });
  const after = object(await readJSON(resolve(root, "skills-lock.json")), "lock");
  const afterSDK = object(after.skills, "SDK records");
  const afterInstalled = await installed(root);
  assert.equal(Object.keys(afterInstalled).length, 59);
  for (const receipt of receipts) {
    assert.deepEqual(afterInstalled[receipt.name], installedRecords[receipt.name]);
    assert.deepEqual(afterSDK[receipt.name], sdkRecords[receipt.name]);
    assert.equal((await inventory(receipt.path))?.hash, receipt.treeHash);
  }
  await buildSkills({ root, check: true });
});
