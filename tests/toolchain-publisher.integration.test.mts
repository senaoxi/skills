import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { buildSkills } from "../scripts/build-skills.mjs";
import { exists, json, object, readJSON, treeDigest } from "../scripts/toolchain-core.mjs";
import { preparedReceipt } from "../scripts/toolchain-provenance.mjs";
import { inventory, manageRepository, renderLicense } from "../scripts/skills.mjs";
import type { ExternalReceipt, Manifest, SkillsLock } from "../scripts/manager-types.mjs";
import { parseSdkRecord } from "../scripts/manager-schema.mjs";
import { docsPackage, put, skillText, temporary } from "./toolchain-fixtures.mjs";
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
  await put(directory, "skill/LICENSE", terms);
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
  assert.equal(await exists(resolve(root, "skills/example/LICENSE")), false);
  const before = await treeDigest(root);
  await buildSkills({ root, check: true });
  assert.equal(await treeDigest(root), before);
  await put(pkg, "skill/SKILL.md", skillText("example", "Changed source.\n"));
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
  await put(second, "skill/SKILL.md", skillText("second", "Only the selected package changes.\n"));
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
  const staging = await temporary(t);
  await cp(resolve(pkg, "skill"), resolve(staging, "example"), { recursive: true });
  const artifact = {
    name: "example",
    packagePath: "packages/example",
    directory: resolve(staging, "example"),
  };
  const first = await preparedReceipt(root, artifact);
  await put(pkg, ".build/deleted.mjs", "stale output\n");
  assert.equal((await preparedReceipt(root, artifact)).inputHash, first.inputHash);
  await put(pkg, "skill/SKILL.md", skillText("example", "New input.\n"));
  assert.notEqual((await preparedReceipt(root, artifact)).inputHash, first.inputHash);
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
  const license = renderLicense("Project fixture terms.\n", receipts);
  await put(root, "LICENSE", license);
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
      licenseHash: hash(license),
      controlModes: { "skills-sources.json": 0, "skills-lock.json": 0, LICENSE: 0 },
    },
  } satisfies SkillsLock);
  const pkg = await licensedPackage(root, "example");
  await buildSkills({ root });
  await put(
    pkg,
    "skill/SKILL.md",
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
