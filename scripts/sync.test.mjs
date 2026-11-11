import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { installSkills, listSkills, resolveSource } from "skills";
import { collectNotices, inventory } from "./sync.mjs";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
const projectTerms = "Project license prefix.\n";
const terms = `MIT License\n\nCopyright (c) 2026 Fixture Authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
const skill = (name) =>
  `---\nname: ${name}\ndescription: Integration fixture.\nlicense: MIT\n---\n\nFixture ${name}.\n`;
const publication = ["skills-sources.json", "skills", "skills-lock.json", "LICENSE"];
const hash = (text) => createHash("sha256").update(text).digest("hex");
async function put(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
async function commit(directory) {
  await run("git", ["add", "--all"], { cwd: directory });
  await run(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ],
    { cwd: directory },
  );
}
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "skills-manager-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function invoke(root, args = [], env = {}, options = {}) {
  try {
    const result = await run(
      process.execPath,
      [...(options.import ? ["--import", options.import] : []), cli, ...args],
      {
        cwd: root,
        env: { ...process.env, DO_NOT_TRACK: "1", ...env },
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
      },
    );
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr, signal: error.signal };
  }
}
function success(result) {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}
function failure(result, pattern, code = 1) {
  assert.equal(result.code, code, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, pattern);
}
async function snapshot(root) {
  return Object.fromEntries(
    await Promise.all(publication.map(async (name) => [name, await inventory(join(root, name))])),
  );
}
async function locked(root) {
  return JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
}
async function manifest(root) {
  return JSON.parse(await readFile(join(root, "skills-sources.json"), "utf8"));
}
async function project(t, bootstrap = true) {
  const root = await temporary(t);
  await run("git", ["init", "-q", "-b", "main"], { cwd: root });
  await mkdir(join(root, "skills"));
  await put(join(root, "skills-sources.json"), '{"sources":[]}\n');
  await put(join(root, "skills-lock.json"), '{"version":2,"skills":{}}\n');
  await put(join(root, "LICENSE"), projectTerms);
  await commit(root);
  if (bootstrap) success(await invoke(root));
  return root;
}
async function repository(t, names, extra = {}) {
  const root = await temporary(t);
  await run("git", ["init", "-q", "-b", "main"], { cwd: root });
  await put(join(root, "LICENSE"), terms);
  for (const [folder, name] of Object.entries(names))
    await put(join(root, folder, "SKILL.md"), skill(name));
  for (const [path, content] of Object.entries(extra)) await put(join(root, path), content);
  await commit(root);
  return root;
}
async function legacyProject(t, origin, source = "fixture/legacy") {
  const root = await project(t, false);
  const sandbox = await temporary(t);
  const env = transport({
    [`https://github.com/${source}.git`]: origin,
    [`https://github.com/${source}`]: origin,
  });
  await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import {installSkills, resolveSource} from ${JSON.stringify(import.meta.resolve("skills"))};
const handle = await resolveSource(process.argv[2], {ref: 'main', telemetry: false});
try {
  const result = await installSkills(handle, {cwd: process.argv[1], scope: 'project', agents: ['universal'], mode: 'copy', duplicates: 'error', symlinks: 'reject', telemetry: false});
  if (result.failed.length || result.skipped.length) throw new Error(JSON.stringify(result));
} finally { await handle.dispose(); }`,
      sandbox,
      source,
    ],
    { env: { ...process.env, ...env, DO_NOT_TRACK: "1" } },
  );
  await cp(join(sandbox, ".agents/skills"), join(root, "skills"), { recursive: true });
  await cp(join(sandbox, "skills-lock.json"), join(root, "skills-lock.json"));
  await put(
    join(root, "skills-sources.json"),
    JSON.stringify({ sources: [{ repository: source, ref: "main" }] }),
  );
  await commit(root);
  return { root, env };
}
function transport(repositories) {
  const entries = Object.entries(repositories);
  return {
    GIT_CONFIG_COUNT: String(entries.length),
    GIT_ALLOW_PROTOCOL: "file",
    ...Object.fromEntries(
      entries.flatMap(([url, path], index) => [
        [`GIT_CONFIG_KEY_${index}`, `url.file://${path}.insteadOf`],
        [`GIT_CONFIG_VALUE_${index}`, url],
      ]),
    ),
  };
}
async function unchanged(root, before, result, pattern) {
  failure(result, pattern);
  assert.deepEqual(await snapshot(root), before);
}

function objects(files, options = {}) {
  const blobs = new Map();
  const tree = Object.entries(files).map(([path, text]) => {
    const bytes = Buffer.from(text);
    const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    blobs.set(sha, bytes);
    return { path, sha, type: "blob", mode: options.symlink === path ? "120000" : "100644" };
  });
  return {
    tree: async () => (options.incomplete ? undefined : tree),
    blob: async (sha) => (options.corrupt ? Buffer.from("changed") : blobs.get(sha)),
  };
}
test("notice collector preserves selected ancestry, full texts and Git object integrity", async () => {
  const files = {
    LICENSE: terms,
    NOTICE: "Attribution\r\n",
    "skills/NOTICE": "Shared\n",
    "skills/one/vendor/COPYING": "Vendor terms\n",
    "skills/two/LICENSE": "Unrelated\n",
    "docs/LICENSE": "Docs\n",
  };
  const result = await collectNotices("example", "a".repeat(40), ["skills/one"], objects(files));
  assert.deepEqual(
    result.map((value) => value.path),
    ["LICENSE", "NOTICE", "skills/NOTICE", "skills/one/vendor/COPYING"],
  );
  assert.equal(result.find((value) => value.path === "NOTICE").text, "Attribution\r\n");
  for (const [content, options, pattern] of [
    [{ LICENSE: terms }, { incomplete: true }, /incomplete/],
    [{ NOTICE: terms }, {}, /no license/],
    [{ LICENSE: terms }, { symlink: "LICENSE" }, /symlinked/],
    [{ LICENSE: "" }, {}, /Empty or binary/],
    [{ LICENSE: terms }, { corrupt: true }, /hash mismatch/],
  ])
    await assert.rejects(
      collectNotices("example", "a".repeat(40), ["skills/one"], objects(content, options)),
      pattern,
    );
});

test("CLI grammar returns usage errors and legacy-empty sync migrates without remotes", async (t) => {
  const root = await project(t, false);
  const before = await snapshot(root);
  for (const args of [
    ["add"],
    ["add", "owner/repo"],
    ["add", "owner/repo", "--all", "--skill", "one"],
    ["add", "owner/repo", "--wat"],
    ["remove"],
    ["remove", "one", "--source", "x"],
    ["list", "--all"],
    ["sync"],
  ])
    failure(await invoke(root, args), /usage/, 2);
  assert.deepEqual(await snapshot(root), before);
  success(await invoke(root, ["help"]));
  success(await invoke(root));
  assert.deepEqual((await manifest(root)).sources, []);
  assert.deepEqual((await locked(root)).repository.installed, {});
  const migrated = await snapshot(root);
  success(await invoke(root));
  assert.deepEqual(await snapshot(root), migrated);
  assert.equal(await readFile(join(root, "LICENSE"), "utf8"), projectTerms);
});

test("named batch add, offline selective removal, exclusions and renamed declarations", async (t) => {
  const origin = await repository(
    t,
    { "skills/alpha": "Alpha Skill", "skills/beta": "beta" },
    {
      "skills/alpha/LICENSE": terms,
      "skills/alpha/NOTICE": "Alpha attribution\n",
      "skills/beta/LICENSES/Custom.txt": "Custom beta terms\n",
    },
  );
  const root = await project(t);
  const url = "https://fixture.invalid/skills.git";
  const env = transport({ [url]: origin });
  success(await invoke(root, ["list", "--available", url, "--ref", "main"], env));
  success(await invoke(root, ["add", url, "--all", "--ref", "main"], env));
  assert.deepEqual((await readdir(join(root, "skills"))).sort(), ["alpha-skill", "beta"]);
  const lock = await locked(root);
  assert.equal(lock.version, 2);
  assert.ok(lock.skills["Alpha Skill"]);
  assert.ok(lock.repository.installed["alpha-skill"]);
  assert.equal(lock.repository.installed["alpha-skill"].origin.path, "skills/alpha");
  assert.ok(!(await readdir(join(root, "skills/alpha-skill"))).includes("LICENSE"));
  assert.equal(
    await readFile(join(root, "skills/alpha-skill/NOTICE"), "utf8"),
    "Alpha attribution\n",
  );
  assert.match(await readFile(join(root, "LICENSE"), "utf8"), /Custom beta terms/);
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", url, "--skill", "beta"], env),
    /Duplicate add/,
  );
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", url, "--skill", "beta", "--ref", "release"], env),
    /uses ref main/,
  );
  success(await invoke(root, ["remove", "alpha-skill"]));
  assert.deepEqual((await manifest(root)).sources[0].selection.exclude, [
    { kind: "path", path: "skills/alpha" },
  ]);
  assert.doesNotMatch(await readFile(join(root, "LICENSE"), "utf8"), /Alpha attribution/);
  await put(join(origin, "skills/alpha/SKILL.md"), skill("Renamed Alpha"));
  await commit(origin);
  success(await invoke(root, [], env));
  assert.deepEqual(await readdir(join(root, "skills")), ["beta"]);
  success(await invoke(root, ["add", url, "--skill", "Renamed Alpha"], env));
  assert.deepEqual((await readdir(join(root, "skills"))).sort(), ["beta", "renamed-alpha"]);
  success(await invoke(root, ["remove", "beta", "renamed-alpha"]));
  assert.deepEqual(await readdir(join(root, "skills")), []);
  assert.equal(await readFile(join(root, "LICENSE"), "utf8"), projectTerms);
  success(await invoke(root, [], env));
  assert.deepEqual(await readdir(join(root, "skills")), []);
  success(await invoke(root, ["remove", "--source", "source-1"]));
  assert.deepEqual((await manifest(root)).sources, []);
});

test("same-source and cross-source canonical collisions preserve all four artifacts", async (t) => {
  const root = await project(t);
  const mixed = await repository(t, {
    "skills/fancy": "Fancy Skill",
    "skills/lower": "fancy-skill",
  });
  const unrelated = await repository(t, { "skills/fancy": "Fancy Skill", "skills/other": "other" });
  const url = "https://fixture.invalid/mixed.git";
  const second = "https://fixture.invalid/second.git";
  const env = transport({ [url]: mixed, [second]: unrelated });
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", url, "--all", "--ref", "main"], env),
    /collision.*fancy-skill.*Fancy Skill/s,
  );
  success(await invoke(root, ["add", second, "--skill", "Fancy Skill", "--ref", "main"], env));
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", url, "--skill", "fancy-skill", "--ref", "main"], env),
    /collision.*source-1.*source-2/s,
  );
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", second, "--skill", "other", "--skill", "missing"], env),
    /matching|matching skill|No matching/i,
  );
  assert.deepEqual(await readdir(join(root, "skills")), ["fancy-skill"]);
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["remove", "fancy-skill", "missing"]),
    /Unknown installed skill/,
  );
});

test("pending manifest edits require explicit sync before add, remove or list", async (t) => {
  const first = await repository(t, { "skills/alpha": "alpha" });
  const second = await repository(t, { "skills/beta": "beta", "skills/gamma": "gamma" });
  await run("git", ["branch", "release"], { cwd: second });
  const url = "https://fixture.invalid/first-policy.git";
  const other = "https://fixture.invalid/second-policy.git";
  const env = transport({ [url]: first, [other]: second });
  for (const change of ["source", "selection", "ref"]) {
    const root = await project(t);
    success(await invoke(root, ["add", url, "--skill", "alpha", "--ref", "main"], env));
    success(await invoke(root, ["add", other, "--skill", "beta", "--ref", "main"], env));
    const edited = await manifest(root);
    if (change === "source") edited.sources.shift();
    if (change === "selection") edited.sources[1].selection.origins = [];
    if (change === "ref") edited.sources[1].ref = "release";
    await put(join(root, "skills-sources.json"), JSON.stringify(edited));
    const before = await snapshot(root);
    for (const args of [
      ["remove", "--source", "source-2"],
      ["add", other, "--skill", "gamma"],
      ["list"],
      ["list", "--available", other],
    ])
      await unchanged(root, before, await invoke(root, args, env), /manifest.*pnpm sync/i);
    success(await invoke(root, [], env));
    assert.deepEqual(
      (await readdir(join(root, "skills"))).sort(),
      change === "source" ? ["beta"] : change === "selection" ? ["alpha"] : ["alpha", "beta"],
    );
    success(await invoke(root, ["list"]));
    success(await invoke(root, ["add", other, "--skill", "gamma"], env));
  }
});

test("manifest digest ignores formatting and source order but damaged digests fail", async (t) => {
  const root = await project(t);
  const origin = await repository(t, { "skills/alpha": "alpha", "skills/beta": "beta" });
  const url = "https://fixture.invalid/normalized-policy.git";
  const other = "https://fixture.invalid/normalized-policy-other.git";
  const env = transport({ [url]: origin, [other]: origin });
  success(await invoke(root, ["add", url, "--skill", "alpha", "--ref", "main"], env));
  success(await invoke(root, ["add", other, "--skill", "beta", "--ref", "main"], env));
  const edited = await manifest(root);
  edited.sources.reverse();
  await put(
    join(root, "skills-sources.json"),
    JSON.stringify({ sources: edited.sources, version: 2 }),
  );
  success(await invoke(root, ["list"]));
  const lock = await locked(root);
  delete lock.repository.manifestHash;
  await put(join(root, "skills-lock.json"), JSON.stringify(lock));
  await unchanged(root, await snapshot(root), await invoke(root, ["list"]), /Damaged ownership/);
});

test("control-file chmod edits fail before publication and preserve all artifacts", async (t) => {
  const root = await project(t);
  for (const name of ["skills-sources.json", "skills-lock.json", "LICENSE"]) {
    await chmod(join(root, name), 0o755);
    await unchanged(
      root,
      await snapshot(root),
      await invoke(root),
      /Control-file executable bits changed/,
    );
    await chmod(join(root, name), 0o644);
  }
  success(await invoke(root, ["list"]));
});

test("local changes, unmanaged paths, executable bits and extension loss are preserving errors", async (t) => {
  const origin = await repository(t, { "skills/alpha": "alpha" });
  const root = await project(t);
  const url = "https://fixture.invalid/owned.git";
  const env = transport({ [url]: origin });
  success(await invoke(root, ["add", url, "--all", "--ref", "main"], env));
  await put(join(root, "skills/manual/SKILL.md"), skill("manual"));
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["remove", "alpha"]),
    /Unmanaged content.*manual/,
  );
  await rm(join(root, "skills/manual"), { recursive: true });
  await put(join(root, "skills/alpha/ignored.txt"), "local bytes");
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, [], env),
    /Managed content changed/,
  );
  await rm(join(root, "skills/alpha/ignored.txt"));
  await chmod(join(root, "skills/alpha/SKILL.md"), 0o755);
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["remove", "alpha"]),
    /Managed content changed/,
  );
  await chmod(join(root, "skills/alpha/SKILL.md"), 0o644);
  const lock = await locked(root);
  delete lock.repository;
  await writeFile(join(root, "skills-lock.json"), JSON.stringify(lock));
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, [], env),
    /Damaged ownership extension/,
  );
});

test("legacy bootstrap rejects ignored nested files and untracked empty directories", async (t) => {
  const root = await project(t, false);
  await put(join(root, "skills/old/SKILL.md"), skill("old"));
  await put(
    join(root, "skills-sources.json"),
    '{"sources":[{"repository":"fixture/source","ref":"main"}]}',
  );
  await put(
    join(root, "skills-lock.json"),
    '{"version":2,"skills":{"old":{"source":"fixture/source"}}}',
  );
  await put(join(root, ".gitignore"), "ignored\n");
  await commit(root);
  await put(join(root, "skills/old/ignored"), "extra");
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root),
    /Untracked or ignored legacy content/,
  );
  await rm(join(root, "skills/old/ignored"));
  await mkdir(join(root, "skills/old/empty"));
  await unchanged(root, await snapshot(root), await invoke(root), /Untracked legacy directory/);
});

test("legacy bootstrap proves raw HEAD ownership of every artifact", async (t) => {
  const ignored = await project(t, false);
  await put(join(ignored, ".gitignore"), "LICENSE\n");
  await run("git", ["rm", "--cached", "LICENSE"], { cwd: ignored });
  await commit(ignored);
  await unchanged(
    ignored,
    await snapshot(ignored),
    await invoke(ignored),
    /Legacy.*(?:HEAD|tracked)/s,
  );
  const origin = await repository(
    t,
    { "skills/one": "one" },
    { "skills/one/resources/tab\tname.txt": "Raw tracked bytes\n" },
  );
  const { root, env } = await legacyProject(t, origin);
  await run("git", ["config", "core.fileMode", "false"], { cwd: root });
  await chmod(join(root, "skills/one/SKILL.md"), 0o755);
  await unchanged(root, await snapshot(root), await invoke(root, [], env), /Legacy.*(?:HEAD|bit)/s);
  await chmod(join(root, "skills/one/SKILL.md"), 0o644);
  await put(join(root, "skills/one/staged.txt"), "Only in index\n");
  await run("git", ["add", "skills/one/staged.txt"], { cwd: root });
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, [], env),
    /Legacy.*(?:HEAD|tracked)/s,
  );
  await run("git", ["reset", "--quiet", "HEAD", "--", "skills/one/staged.txt"], { cwd: root });
  await rm(join(root, "skills/one/staged.txt"));
  success(await invoke(root, [], env));
  assert.equal(
    await readFile(join(root, "skills/one/resources/tab\tname.txt"), "utf8"),
    "Raw tracked bytes\n",
  );
});

test("legacy migration retains deleted origins and rejects declaration swaps", async (t) => {
  for (const mutation of ["deleted", "swapped", "invalid-ref", "invalid-path"]) {
    const origin = await repository(t, { "skills/one": "one", "skills/two": "two" });
    const { root, env } = await legacyProject(t, origin);
    if (mutation === "deleted") await rm(join(origin, "skills/one"), { recursive: true });
    if (mutation === "swapped") {
      await put(join(origin, "skills/one/SKILL.md"), skill("two"));
      await put(join(origin, "skills/two/SKILL.md"), skill("one"));
    }
    if (mutation.startsWith("invalid")) {
      const lock = await locked(root);
      if (mutation === "invalid-ref") lock.skills.one.ref = "other";
      else lock.skills.one.skillPath = "../one/SKILL.md";
      await put(join(root, "skills-lock.json"), JSON.stringify(lock));
      await commit(root);
    } else await commit(origin);
    await unchanged(
      root,
      await snapshot(root),
      await invoke(root, [], env),
      mutation === "deleted"
        ? /Legacy origin.*disappeared/
        : mutation === "swapped"
          ? /collision.*current.*candidate/s
          : /Legacy.*(?:record|source|path)/s,
    );
  }
});

test("Git locator refs, source binding, selective add and SDK hash compatibility", async (t) => {
  const root = await project(t);
  const origin = await repository(
    t,
    { "skills/one": "one", "skills/two": "two" },
    { "skills/one/LICENSE": terms, "skills/one/tool.sh": "#!/bin/sh\nprintf fixture\n" },
  );
  await chmod(join(origin, "skills/one/tool.sh"), 0o755);
  await commit(origin);
  const url = "https://fixture.invalid/refs.git";
  const env = transport({ [url]: origin });
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", url, "--skill", "one"], env),
    /need --ref/,
  );
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", url, "--skill", "one", "--ref", "HEAD"], env),
    /concrete/,
  );
  success(await invoke(root, ["add", `${url}#main`, "--skill", "one"], env));
  const first = (await locked(root)).repository.installed.one;
  success(await invoke(root, ["add", `${url}#main`, "--skill", "two"], env));
  assert.deepEqual((await locked(root)).repository.installed.one, first);
  const before = await snapshot(root);
  success(await invoke(root, [], env));
  assert.deepEqual(await snapshot(root), before);
  const local = await resolveSource(join(root, "skills/one"));
  const sandbox = await temporary(t);
  try {
    await installSkills(local, {
      cwd: sandbox,
      skills: ["one"],
      scope: "project",
      agents: ["universal"],
      mode: "copy",
      duplicates: "error",
      symlinks: "reject",
      telemetry: false,
    });
  } finally {
    await local.dispose();
  }
  assert.equal(
    (await locked(root)).skills.one.computedHash,
    (await locked(sandbox)).skills.one.computedHash,
  );
  await cp(join(root, "skills-lock.json"), join(sandbox, "skills-lock.json"));
  const sdkBefore = await readFile(join(sandbox, "skills-lock.json"));
  assert.equal((await listSkills({ cwd: sandbox, scope: "project" })).skills[0].name, "one");
  assert.deepEqual(await readFile(join(sandbox, "skills-lock.json")), sdkBefore);
  const other = await resolveSource(join(root, "skills/two"));
  try {
    await installSkills(other, {
      cwd: sandbox,
      skills: ["two"],
      scope: "project",
      agents: ["universal"],
      mode: "copy",
      duplicates: "error",
      symlinks: "reject",
      telemetry: false,
    });
  } finally {
    await other.dispose();
  }
  assert.ok((await locked(sandbox)).skills.two);
  assert.equal((await locked(sandbox)).repository, undefined);
  const changed = await manifest(root);
  changed.sources[0].source = "https://fixture.invalid/other.git";
  await writeFile(join(root, "skills-sources.json"), JSON.stringify(changed));
  const changedEnv = transport({ [url]: origin, "https://fixture.invalid/other.git": origin });
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, [], changedEnv),
    /cannot be retargeted/,
  );
});

async function serve(t, files) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const body = files.get(request.url);
    response.statusCode = body === undefined ? 404 : 200;
    response.setHeader(
      "content-type",
      request.url.endsWith(".json")
        ? "application/json"
        : request.url.endsWith(".gz")
          ? "application/gzip"
          : "text/plain",
    );
    response.end(body ?? "missing");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}
async function archive(t, contents, directories = []) {
  const root = await temporary(t);
  const source = join(root, "source");
  await mkdir(source);
  for (const [path, bytes] of Object.entries(contents)) await put(join(source, path), bytes);
  for (const path of directories) await mkdir(join(source, path), { recursive: true });
  const path = join(root, "bundle.tar.gz");
  await run("tar", ["-czf", path, "-C", source, ...Object.keys(contents), ...directories], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  return readFile(path);
}

for (const kind of ["Git", "package"])
  test(`${kind} LICENSE files with identifiers, expressions or URLs fail unchanged`, async (t) => {
    const root = await project(t);
    const incomplete = [
      "SPDX-License-Identifier: MIT\n",
      "MIT\n",
      "MIT OR Apache-2.0\n",
      "SPDX-License-Identifier: (MIT OR Apache-2.0) AND BSD-3-Clause\n",
      "GPL-2.0-only WITH Classpath-exception-2.0\n",
      "https://opensource.org/licenses/MIT\n",
      "MIT License\n",
      "Apache License, Version 2.0\n",
    ];
    const files = new Map();
    const server = kind === "package" ? await serve(t, files) : undefined;
    for (let index = 0; index < incomplete.length; index++) {
      let source;
      let env = {};
      if (kind === "Git") {
        const origin = await repository(
          t,
          { "skills/incomplete": "incomplete" },
          { LICENSE: incomplete[index] },
        );
        source = `https://fixture.invalid/incomplete-${index}.git`;
        env = transport({ [source]: origin });
      } else {
        files.set(
          `/incomplete-${index}.tar.gz`,
          await archive(t, { "SKILL.md": skill("incomplete"), LICENSE: incomplete[index] }),
        );
        source = `${server.url}/incomplete-${index}.tar.gz`;
      }
      await unchanged(
        root,
        await snapshot(root),
        await invoke(
          root,
          ["add", source, "--skill", "incomplete", ...(kind === "Git" ? ["--ref", "main"] : [])],
          env,
        ),
        /identifier|complete terms/i,
      );
    }
  });

test("custom BOM and CRLF notice bytes survive Git and installed-package centralization", async (t) => {
  const root = await project(t);
  const custom = Buffer.from(
    "\uFEFFCustom distribution terms\r\n\r\nCopyright 2026 Fixture Authors.\r\nYou may use, copy, modify and distribute this work with this notice.\r\nThis work comes without any warranty.\r\n",
  );
  const attribution = Buffer.from("\uFEFFAttribution to the custom authors.\r\n");
  const origin = await repository(
    t,
    { "skills/custom": "custom-git" },
    {
      LICENSE: custom,
      "skills/custom/LICENSE": custom,
      "skills/custom/NOTICE": attribution,
    },
  );
  const url = "https://fixture.invalid/custom-notices.git";
  success(await invoke(root, ["add", url, "--all", "--ref", "main"], transport({ [url]: origin })));
  const files = new Map([
    [
      "/custom.tar.gz",
      await archive(t, {
        "SKILL.md": skill("custom-package"),
        LICENSE: custom,
        NOTICE: attribution,
      }),
    ],
  ]);
  const server = await serve(t, files);
  success(await invoke(root, ["add", `${server.url}/custom.tar.gz`, "--skill", "custom-package"]));
  const lock = await locked(root);
  for (const name of ["custom-git", "custom-package"]) {
    const receipt = lock.repository.installed[name];
    for (const notice of receipt.notices) {
      const expected = notice.path.endsWith("NOTICE") ? attribution : custom;
      assert.deepEqual(Buffer.from(notice.text, "utf8"), expected);
      assert.equal(notice.sha256, hash(expected));
    }
    assert.equal(receipt.centralizedNotices.length, 1);
    assert.equal(receipt.centralizedNotices[0].path, "LICENSE");
    assert.equal(receipt.centralizedNotices[0].sha256, hash(custom));
    assert.ok(!(await readdir(join(root, "skills", name))).includes("LICENSE"));
    assert.deepEqual(await readFile(join(root, "skills", name, "NOTICE")), attribution);
  }
  const rendered = (await readFile(join(root, "LICENSE"), "utf8")).replace(/^> ?/gm, "");
  assert.ok(rendered.includes(custom.toString("utf8")));
  assert.ok(rendered.includes(attribution.toString("utf8")));
  success(await invoke(root, ["remove", "custom-git", "custom-package"]));
  assert.equal(await readFile(join(root, "LICENSE"), "utf8"), projectTerms);
});

test("an installed package's vendor license alone cannot license the selected package", async (t) => {
  const root = await project(t);
  const files = new Map([
    [
      "/vendor-only.tar.gz",
      await archive(t, { "SKILL.md": skill("vendor-only"), "vendor/LICENSE": terms }),
    ],
  ]);
  const server = await serve(t, files);
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", `${server.url}/vendor-only.tar.gz`, "--skill", "vendor-only"]),
    /missing complete supplied/,
  );
});

for (const kind of ["local", "archive"])
  test(`${kind} empty source directories fail without changing the repository`, async (t) => {
    const root = await project(t);
    const name = `${kind}-empty`;
    const contents = { "SKILL.md": skill(name), LICENSE: terms };
    const local = await temporary(t);
    for (const [path, content] of Object.entries(contents)) await put(join(local, path), content);
    await mkdir(join(local, "resources/empty"), { recursive: true });
    const files = new Map([["/empty.tar.gz", await archive(t, contents, ["resources/empty"])]]);
    const server = kind === "archive" ? await serve(t, files) : undefined;
    const source = server ? `${server.url}/empty.tar.gz` : local;
    await unchanged(
      root,
      await snapshot(root),
      await invoke(root, ["add", source, "--skill", name]),
      /Git cannot retain empty director.*tracked file or marker/s,
    );
    await put(join(local, "resources/empty/keep.txt"), "Retain this directory\n");
    files.set(
      "/empty.tar.gz",
      await archive(t, { ...contents, "resources/empty/keep.txt": "Retain this directory\n" }),
    );
    success(await invoke(root, ["add", source, "--skill", name]));
    assert.equal(
      await readFile(join(root, `skills/${name}/resources/empty/keep.txt`), "utf8"),
      "Retain this directory\n",
    );
  });

test("HTTP archive and well-known bundles centralize notices; missing supplied terms fail", async (t) => {
  const bundle = await archive(t, {
    "SKILL.md": skill("bundle"),
    LICENSE: terms,
    "resources/keep.bin": Buffer.from([0, 1, 2, 255]),
  });
  const nested = await archive(t, { LICENSE: terms, "skills/nested/SKILL.md": skill("nested") });
  const files = new Map([
    ["/bundle.tar.gz", bundle],
    ["/nested.tar.gz", nested],
    ["/only.md", skill("only")],
  ]);
  for (const name of ["complete", "omitted"]) {
    const list = name === "complete" ? ["SKILL.md", "LICENSE"] : ["SKILL.md"];
    files.set(
      `/${name}/.well-known/agent-skills/index.json`,
      JSON.stringify({ skills: [{ name, description: "Fixture", files: list }] }),
    );
    files.set(`/${name}/.well-known/agent-skills/${name}/SKILL.md`, skill(name));
    files.set(`/${name}/.well-known/agent-skills/${name}/LICENSE`, terms);
  }
  const v2 = await archive(t, { "SKILL.md": skill("archive-provider"), LICENSE: terms });
  files.set(
    "/v2/.well-known/agent-skills/index.json",
    JSON.stringify({
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: [
        {
          name: "archive-provider",
          description: "Fixture",
          type: "archive",
          url: "/v2.tar.gz",
          digest: `sha256:${hash(v2)}`,
        },
      ],
    }),
  );
  files.set("/v2.tar.gz", v2);
  const server = await serve(t, files);
  const root = await project(t);
  success(await invoke(root, ["add", `${server.url}/bundle.tar.gz`, "--skill", "bundle"]));
  let lock = await locked(root);
  assert.equal(lock.skills.bundle.sourceType, "download");
  assert.equal(lock.repository.installed.bundle.provenance.kind, "installed-snapshot");
  assert.deepEqual(
    await readFile(join(root, "skills/bundle/resources/keep.bin")),
    Buffer.from([0, 1, 2, 255]),
  );
  assert.deepEqual((await readdir(join(root, "skills/bundle"))).sort(), ["SKILL.md", "resources"]);
  assert.match(await readFile(join(root, "LICENSE"), "utf8"), /Permission is hereby granted/);
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", `${server.url}/nested.tar.gz`, "--skill", "nested"]),
    /missing complete supplied/,
  );
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", `${server.url}/only.md`, "--skill", "only"]),
    /missing complete supplied/,
  );
  success(await invoke(root, ["add", `${server.url}/complete`, "--skill", "complete"]));
  lock = await locked(root);
  assert.deepEqual(lock.repository.installed.complete.origin, {
    kind: "declared",
    name: "complete",
  });
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", `${server.url}/omitted`, "--skill", "omitted"]),
    /missing complete supplied/,
  );
  assert.ok(!server.requests.includes("/omitted/.well-known/agent-skills/omitted/LICENSE"));
  const v2Result = await invoke(root, ["add", `${server.url}/v2`, "--skill", "archive-provider"]);
  assert.equal(v2Result.code, 0, `${v2Result.stderr} requests ${JSON.stringify(server.requests)}`);
  assert.equal((await locked(root)).skills["archive-provider"].sourceType, "well-known");
  success(await invoke(root, ["remove", "bundle", "complete", "archive-provider"]));
  assert.equal(await readFile(join(root, "LICENSE"), "utf8"), projectTerms);
});

async function fault(t, source) {
  const directory = await temporary(t);
  const path = join(directory, "fault.mjs");
  await put(
    path,
    `import fs from 'node:fs/promises';\nimport {syncBuiltinESMExports} from 'node:module';\n${source}\nsyncBuiltinESMExports();\n`,
  );
  return path;
}
test("four-artifact publication rolls back move failures and recovers death between move and journal", async (t) => {
  const origin = await repository(t, { "skills/one": "one" });
  const url = "https://fixture.invalid/publication.git";
  const env = transport({ [url]: origin });
  for (const target of publication) {
    const root = await project(t);
    const before = await snapshot(root);
    const injection = await fault(
      t,
      `const original = fs.rename; let fired = false; fs.rename = async (from,to) => { if (!fired && String(from).includes('.skills-sync-stage-') && String(from).endsWith('/${target}') && !String(from).includes('/backup/')) { fired = true; throw new Error('Injected publication failure'); } return original(from,to); };`,
    );
    await unchanged(
      root,
      before,
      await invoke(root, ["add", url, "--all", "--ref", "main"], env, { import: injection }),
      /Injected publication failure/,
    );
  }
  for (const afterBackup of [true, false]) {
    const root = await project(t);
    const before = await snapshot(root);
    const injection = await fault(
      t,
      `const original = fs.rename; fs.rename = async (from,to) => { const result = await original(from,to); if (String(${afterBackup ? "to" : "from"}).includes('.skills-sync-stage-') && String(${afterBackup ? "to" : "from"}).endsWith('${afterBackup ? "/backup/skills-sources.json" : "/skills-sources.json"}')) process.kill(process.pid,'SIGKILL'); return result; };`,
    );
    const crashed = await invoke(root, ["add", url, "--all", "--ref", "main"], env, {
      import: injection,
    });
    assert.equal(crashed.signal, "SIGKILL");
    success(await invoke(root, ["list"]));
    assert.deepEqual(await snapshot(root), before);
  }
});

test("recovery refuses manual edits and pre-publication rechecks every artifact", async (t) => {
  const origin = await repository(t, { "skills/one": "one" });
  const url = "https://fixture.invalid/guard.git";
  const env = transport({ [url]: origin });
  const root = await project(t);
  const crash = await fault(
    t,
    "const original = fs.rename; fs.rename = async (from,to) => { const result = await original(from,to); if (String(to).includes('/backup/skills-sources.json')) process.kill(process.pid,'SIGKILL'); return result; };",
  );
  assert.equal(
    (await invoke(root, ["add", url, "--all", "--ref", "main"], env, { import: crash })).signal,
    "SIGKILL",
  );
  await put(join(root, "skills-sources.json"), "Manual recovery edit\n");
  failure(await invoke(root, ["list"]), /Manual edit/);
  assert.equal(await readFile(join(root, "skills-sources.json"), "utf8"), "Manual recovery edit\n");
  for (const artifact of publication) {
    const projectRoot = await project(t);
    const path = artifact === "skills" ? "skills/manual.txt" : artifact;
    const mutation = await fault(
      t,
      `const original = fs.writeFile; let fired = false; fs.writeFile = async (path,...args) => { const result = await original(path,...args); if (!fired && String(path).includes('.skills-sync-stage-') && String(path).endsWith('/LICENSE')) { fired = true; await original(${JSON.stringify(join(projectRoot, path))}, 'Concurrent manual edit\\n'); } return result; };`,
    );
    failure(
      await invoke(projectRoot, ["add", url, "--all", "--ref", "main"], env, { import: mutation }),
      /changed during staging/,
    );
    assert.equal(await readFile(join(projectRoot, path), "utf8"), "Concurrent manual edit\n");
  }
});

test("subpath locator refs survive list and later add while notices bind to repository paths", async (t) => {
  const root = await project(t);
  const origin = await repository(
    t,
    {
      "nested/skills/one": "nested-one",
      "nested/skills/two": "nested-two",
      "outside/other": "outside",
    },
    {
      "nested/NOTICE": "Selected ancestor attribution\n",
      "nested/skills/one/LICENSE": terms,
      "outside/NOTICE": "Unrelated attribution\n",
    },
  );
  const remote = "https://fixture.invalid/team/subpath.git";
  const locator = "https://fixture.invalid/team/subpath/-/tree/main/nested";
  const env = transport({ [remote]: origin });
  const found = JSON.parse(
    success(await invoke(root, ["list", "--available", locator], env)).stdout,
  );
  assert.deepEqual(found.available.map((entry) => entry.origin.path).sort(), [
    "nested/skills/one",
    "nested/skills/two",
  ]);
  success(
    await invoke(root, ["add", locator, "--skill", "nested-one", "--skill", "nested-two"], env),
  );
  assert.deepEqual((await readdir(join(root, "skills"))).sort(), ["nested-one", "nested-two"]);
  assert.match(await readFile(join(root, "LICENSE"), "utf8"), /Selected ancestor attribution/);
  assert.doesNotMatch(await readFile(join(root, "LICENSE"), "utf8"), /Unrelated attribution/);
  assert.equal(
    (await locked(root)).repository.installed["nested-one"].provenance.path,
    "nested/skills/one",
  );
  const generated = await snapshot(root);
  success(await invoke(root, [], env));
  assert.deepEqual(await snapshot(root), generated);
  const previous = (await locked(root)).repository.installed["nested-one"];
  success(await invoke(root, ["list"]));
  success(await invoke(root, ["add", remote, "--skill", "outside", "--ref", "main"], env));
  assert.deepEqual((await locked(root)).repository.installed["nested-one"], previous);
  assert.deepEqual((await readdir(join(root, "skills"))).sort(), [
    "nested-one",
    "nested-two",
    "outside",
  ]);
});

test("local complete packages and unmanaged canonical collision diagnostics", async (t) => {
  const root = await project(t);
  const local = await temporary(t);
  await put(join(local, "SKILL.md"), skill("Local Skill"));
  await put(join(local, "LICENSE"), terms);
  await put(join(root, "skills/local-skill/SKILL.md"), "Unmanaged original\n");
  await unchanged(
    root,
    await snapshot(root),
    await invoke(root, ["add", local, "--skill", "Local Skill"]),
    /collision.*local-skill.*unmanaged.*Local Skill/s,
  );
  await rm(join(root, "skills/local-skill"), { recursive: true });
  success(await invoke(root, ["add", local, "--skill", "Local Skill"]));
  assert.equal(
    (await locked(root)).repository.installed["local-skill"].provenance.kind,
    "installed-snapshot",
  );
  assert.equal((await locked(root)).skills["Local Skill"].sourceType, "local");
});

test("nested centralized license collections remain owned after commit and fresh checkout", async (t) => {
  const root = await project(t);
  const origin = await repository(
    t,
    { "skills/one": "one" },
    {
      "skills/one/LICENSES/nested/Custom.txt":
        "Custom terms allow copying and distribution with this notice.\n",
      "skills/one/resources/keep.txt": "Keep resource bytes\n",
    },
  );
  const url = "https://fixture.invalid/nested-licenses.git";
  success(await invoke(root, ["add", url, "--all", "--ref", "main"], transport({ [url]: origin })));
  await commit(root);
  const checkout = await temporary(t);
  await run("git", ["clone", "--quiet", root, checkout]);
  success(await invoke(checkout, ["list"]));
  assert.deepEqual((await readdir(join(checkout, "skills/one"))).sort(), ["SKILL.md", "resources"]);
  assert.equal(
    await readFile(join(checkout, "skills/one/resources/keep.txt"), "utf8"),
    "Keep resource bytes\n",
  );
  assert.match(await readFile(join(checkout, "LICENSE"), "utf8"), /Custom terms allow copying/);
});

test("damaged SDK records and notice ledgers are preserving errors", async (t) => {
  const origin = await repository(t, { "skills/one": "one" });
  const url = "https://fixture.invalid/damaged.git";
  const env = transport({ [url]: origin });
  for (const damage of ["sdk", "notices", "binding"]) {
    const root = await project(t);
    success(await invoke(root, ["add", url, "--all", "--ref", "main"], env));
    const lock = await locked(root);
    if (damage === "sdk") lock.skills.one.computedHash = "0".repeat(64);
    if (damage === "notices") lock.repository.installed.one.notices[0].text = "Changed terms\n";
    if (damage === "binding")
      lock.repository.sources["source-1"].binding.url = "https://fixture.invalid/changed.git";
    await writeFile(join(root, "skills-lock.json"), JSON.stringify(lock));
    await unchanged(
      root,
      await snapshot(root),
      await invoke(root, ["remove", "one"]),
      /changed|differ|Damaged/,
    );
  }
});

test("failed restoration retains evidence and a later command recovers it", async (t) => {
  const root = await project(t);
  const origin = await repository(t, { "skills/one": "one" });
  const url = "https://fixture.invalid/rollback.git";
  const before = await snapshot(root);
  const injection = await fault(
    t,
    "const original = fs.rename; fs.rename = async (from,to) => { if (String(from).includes('.skills-sync-stage-') && (String(from).endsWith('/LICENSE') || String(from).endsWith('/backup/skills'))) throw new Error('Persistent fixture write failure'); return original(from,to); };",
  );
  failure(
    await invoke(root, ["add", url, "--all", "--ref", "main"], transport({ [url]: origin }), {
      import: injection,
    }),
    /recovery evidence/,
  );
  const journal = JSON.parse(await readFile(join(root, ".skills-sync-lock/journal.json"), "utf8"));
  assert.ok(
    (await readFile(join(root, journal.stage, "backup/skills-lock.json")).catch(() => null)) ||
      (await readdir(join(root, journal.stage, "backup/skills"))),
  );
  success(await invoke(root, ["list"]));
  assert.deepEqual(await snapshot(root), before);
});

test("a live repository owner blocks list, add and sync", async (t) => {
  const root = await project(t);
  const { hostname } = await import("node:os");
  await put(
    join(root, ".skills-sync-lock/owner.json"),
    JSON.stringify({ host: hostname(), pid: process.pid }),
  );
  const before = await snapshot(root);
  for (const args of [
    ["list"],
    ["add", "https://fixture.invalid/unused.git", "--all", "--ref", "main"],
    [],
  ])
    await unchanged(root, before, await invoke(root, args), /command is running/);
});
