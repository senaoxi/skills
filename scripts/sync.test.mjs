import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectNotices, publishSnapshot, renderLicense, syncSkills } from "./sync.mjs";

const commit = "a".repeat(40);
const upstream = "MIT License\n\nCopyright (c) Example contributors\n\nFull upstream terms.\n";

function gitFixture(files, options = {}) {
  const blobs = new Map();
  const tree = Object.entries(files).map(([path, text]) => {
    const bytes = Buffer.from(text);
    const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    blobs.set(sha, bytes);
    return { path, sha, type: "blob", mode: options.symlink === path ? "120000" : "100644" };
  });
  const calls = [];
  return {
    calls,
    tree: async (revision) => {
      calls.push(revision);
      return options.incomplete ? undefined : tree;
    },
    blob: async (sha) => (options.corrupt ? Buffer.from("changed") : blobs.get(sha)),
  };
}

test("collects root, ancestor, per-skill and nested notices at the installed revision", async () => {
  const fixture = gitFixture({
    "LICENSE.md": upstream,
    NOTICE: "Root attribution\n",
    "skills/NOTICE.txt": "Shared attribution\n",
    "skills/alpha/LICENSE": "Additional alpha terms\n",
    "skills/alpha/vendor/COPYING": "Vendor terms\n",
    "skills/other/LICENSE": "Unrelated skill\n",
    "docs/LICENSE": "Unrelated documentation\n",
  });
  const notices = await collectNotices("example/skills", commit, ["skills/alpha"], fixture);
  assert.deepEqual(
    notices.map((notice) => notice.path),
    [
      "LICENSE.md",
      "NOTICE",
      "skills/NOTICE.txt",
      "skills/alpha/LICENSE",
      "skills/alpha/vendor/COPYING",
    ],
  );
  assert.equal(notices[0].text, upstream);
  assert.equal(fixture.calls[0], commit);
});

test("supports nonstandard license texts and SPDX license collections without guessing metadata", async () => {
  const files = {
    "LICENSES/Custom.txt": "Custom permission terms.\n",
    AUTHORS: "Several authors\n",
  };
  const notices = await collectNotices(
    "example/skills",
    commit,
    ["skills/alpha"],
    gitFixture(files),
  );
  const output = renderLicense("Project terms\n", [
    { repository: "example/skills", commit, skills: ["alpha"], notices },
  ]);
  for (const text of Object.values(files)) assert.ok(output.includes(`> ${text.trim()}`));
  assert.ok(output.includes(`Revision: ${commit}`));
  assert.ok(!output.includes("License: MIT"));
});

test("rejects incomplete trees, missing licenses, symlinks, empty files and corrupt blobs", async () => {
  for (const [files, options, message] of [
    [{ LICENSE: upstream }, { incomplete: true }, /incomplete Git tree/],
    [{ NOTICE: "Attribution only" }, {}, /no license file applies/],
    [{ "skills/other/LICENSE": upstream }, {}, /no license file applies/],
    [{ LICENSE: upstream }, { symlink: "LICENSE" }, /symlinked notice/],
    [{ LICENSE: "" }, {}, /empty or binary/],
    [{ LICENSE: upstream }, { corrupt: true }, /hash mismatch/],
  ]) {
    await assert.rejects(
      collectNotices("example/skills", commit, ["skills/alpha"], gitFixture(files, options)),
      message,
    );
  }
});

async function project(t, sources = [{ repository: "example/skills", ref: "main" }]) {
  const root = await mkdtemp(join(tmpdir(), "skills-license-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "skills/old"), { recursive: true });
  await writeFile(join(root, "skills/old/SKILL.md"), "old skill\n");
  await writeFile(
    join(root, "skills-lock.json"),
    JSON.stringify({ version: 2, skills: { old: { source: "old/source" } } }),
  );
  await writeFile(
    join(root, "LICENSE"),
    "Project terms\n\n# Licenses of bundled skills\n\nObsolete notice\n",
  );
  await writeFile(join(root, "skills-sources.json"), JSON.stringify({ sources }));
  return root;
}

function installer(options = {}) {
  const disposed = [];
  let resolveAttempts = 0;
  return {
    disposed,
    get resolveAttempts() {
      return resolveAttempts;
    },
    resolveSource: async (repository, { ref }) => {
      resolveAttempts++;
      if (resolveAttempts <= (options.resolveFailures ?? 0))
        throw new Error(options.resolveError ?? "SSL_connect: connection reset");
      assert.equal(ref, "main");
      return {
        source: { commit },
        skills: [{ name: options.name ?? repository.split("/")[0], path: "skills/alpha" }],
        dispose: async () => disposed.push(repository),
      };
    },
    collectNotices: async (repository, revision) => {
      assert.equal(revision, commit);
      if (options.missing) throw new Error("No license files found");
      return [{ path: "LICENSE", text: upstream }];
    },
    installSkills: async (source, settings) => {
      assert.deepEqual(settings.agents, ["universal"]);
      assert.equal(settings.duplicates, "error");
      assert.equal(settings.symlinks, "reject");
      const name = source.skills[0].name;
      const path = join(settings.cwd, ".agents/skills", name);
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "SKILL.md"), `skill ${name}\n`);
      let lock = { version: 2, skills: {} };
      try {
        lock = JSON.parse(await readFile(join(settings.cwd, "skills-lock.json"), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      lock.skills[name] = { source: name };
      await writeFile(join(settings.cwd, "skills-lock.json"), JSON.stringify(lock));
      return {
        installed: [{ path }],
        failed: options.fail ? [{ message: "Install failed" }] : [],
        skipped: [],
      };
    },
  };
}

test("multiple sources update one LICENSE deterministically, remove stale notices and preserve project terms", async (t) => {
  const root = await project(t, [
    { repository: "second/skills", ref: "main" },
    { repository: "first/skills", ref: "main" },
  ]);
  const adapters = installer();
  assert.deepEqual(await syncSkills(root, adapters), { sources: 2, skills: 2 });
  const generated = await readFile(join(root, "LICENSE"), "utf8");
  assert.ok(generated.startsWith("Project terms\n\n# Licenses"));
  assert.ok(!generated.includes("Obsolete notice"));
  assert.ok(generated.indexOf("## first/skills") < generated.indexOf("## second/skills"));
  assert.equal(generated.match(/^# Licenses of bundled skills$/gm).length, 1);
  assert.deepEqual((await readdir(join(root, "skills"))).sort(), ["first", "second"]);
  await syncSkills(root, installer());
  assert.equal(await readFile(join(root, "LICENSE"), "utf8"), generated);
  assert.deepEqual(adapters.disposed, ["first/skills", "second/skills"]);
  assert.ok(!(await readdir(root)).some((name) => name.startsWith(".skills-sync-")));
  await writeFile(
    join(root, "skills-sources.json"),
    JSON.stringify({ sources: [{ repository: "first/skills", ref: "main" }] }),
  );
  await syncSkills(root, installer());
  assert.ok(!(await readFile(join(root, "LICENSE"), "utf8")).includes("## second/skills"));
  assert.deepEqual(await readdir(join(root, "skills")), ["first"]);
});

test("license failures, partial installs and cross-source collisions leave the original snapshot intact", async (t) => {
  for (const options of [{ missing: true }, { fail: true }, { name: "collision" }]) {
    const root = await project(t, [
      { repository: "first/skills", ref: "main" },
      { repository: "second/skills", ref: "main" },
    ]);
    const original = await readFile(join(root, "LICENSE"), "utf8");
    const originalLock = await readFile(join(root, "skills-lock.json"), "utf8");
    const adapters = installer(options);
    await assert.rejects(syncSkills(root, adapters), /license|incomplete installation|collision/);
    assert.equal(await readFile(join(root, "LICENSE"), "utf8"), original);
    assert.equal(await readFile(join(root, "skills-lock.json"), "utf8"), originalLock);
    assert.equal(await readFile(join(root, "skills/old/SKILL.md"), "utf8"), "old skill\n");
    assert.ok(adapters.disposed.length > 0);
    assert.ok(!(await readdir(root)).some((name) => name.startsWith(".skills-sync-")));
  }
});

test("concurrent sync attempts cannot publish over each other", async (t) => {
  const root = await project(t);
  await mkdir(join(root, ".skills-sync-lock"));
  await assert.rejects(syncSkills(root, installer()), /A sync is running/);
  assert.equal(await readFile(join(root, "skills/old/SKILL.md"), "utf8"), "old skill\n");
});

test("transient source failures retry at most three times; permanent failures stop immediately", async (t) => {
  for (const [options, expectedAttempts, succeeds] of [
    [{ resolveFailures: 1 }, 2, true],
    [{ resolveFailures: 4 }, 3, false],
    [{ resolveFailures: 4, resolveError: "Repository not found" }, 1, false],
  ]) {
    const root = await project(t);
    const adapters = installer(options);
    const original = await readFile(join(root, "LICENSE"), "utf8");
    if (succeeds) await syncSkills(root, adapters);
    else {
      await assert.rejects(syncSkills(root, adapters));
      assert.equal(await readFile(join(root, "LICENSE"), "utf8"), original);
      assert.equal(await readFile(join(root, "skills/old/SKILL.md"), "utf8"), "old skill\n");
    }
    assert.equal(adapters.resolveAttempts, expectedAttempts);
    assert.ok(!(await readdir(root)).some((name) => name.startsWith(".skills-sync-")));
  }
});

test("publication errors roll back files already replaced", async (t) => {
  const root = await project(t);
  const staging = await mkdtemp(join(root, ".skills-sync-"));
  await mkdir(join(staging, "skills"));
  await writeFile(join(staging, "skills-lock.json"), "new lock");
  await writeFile(join(staging, "LICENSE"), "new license");
  const original = await readFile(join(root, "LICENSE"), "utf8");
  await assert.rejects(
    publishSnapshot(root, staging, async (from, to) => {
      if (from === join(staging, "LICENSE")) throw new Error("Disk write failed");
      return rename(from, to);
    }),
    /Disk write failed/,
  );
  assert.equal(await readFile(join(root, "LICENSE"), "utf8"), original);
  assert.equal(await readFile(join(root, "skills/old/SKILL.md"), "utf8"), "old skill\n");
  assert.ok(JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8")).skills.old);
});

test("failed rollback retains original files for recovery and restores the other files", async (t) => {
  const root = await project(t);
  const staging = await mkdtemp(join(root, ".skills-sync-"));
  await mkdir(join(staging, "skills"));
  await writeFile(join(staging, "skills-lock.json"), "new lock");
  await writeFile(join(staging, "LICENSE"), "new license");
  const original = await readFile(join(root, "LICENSE"), "utf8");
  await assert.rejects(
    publishSnapshot(root, staging, async (from, to) => {
      if (from === join(staging, "LICENSE") || from === join(staging, "backup/skills"))
        throw new Error("Disk write failed");
      return rename(from, to);
    }),
    /Could not restore original files; backups:/,
  );
  assert.equal(await readFile(join(staging, "backup/skills/old/SKILL.md"), "utf8"), "old skill\n");
  assert.equal(await readFile(join(root, "LICENSE"), "utf8"), original);
  assert.ok(JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8")).skills.old);
});
