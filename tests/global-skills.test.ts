import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../scripts/cli.ts", import.meta.url));
const linkType = process.platform === "win32" ? "junction" : "dir";

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "global-skills-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, "checkout with spaces");
  const home = join(root, "test user");
  const source = join(checkout, "skills");
  const destination = join(home, ".agents", "skills");
  const sourceSkill = join(source, "alpha", "SKILL.md");
  await put(
    sourceSkill,
    "---\nname: alpha\ndescription: Global sync fixture.\n---\n\nFrom the checkout.\n",
  );

  const preload = `data:text/javascript,${encodeURIComponent(`
    import os from "node:os";
    import { syncBuiltinESMExports } from "node:module";
    os.homedir = () => ${JSON.stringify(home)};
    syncBuiltinESMExports();
  `)}`;
  function sync(input: string, ...flags: string[]) {
    const result = spawnSync(
      process.execPath,
      ["--import", preload, cli, "sync", "--global", ...flags],
      {
        cwd: checkout,
        encoding: "utf8",
        env: { ...process.env, NODE_USE_ENV_PROXY: "0" },
        input,
        timeout: 10_000,
      },
    );
    assert.ifError(result.error);
    return result;
  }
  return { source, destination, sourceSkill, sync };
}

test("global sync warns about overwrites and accepts only explicit consent", async (t) => {
  const { destination, sync } = await fixture(t);
  const globalSkill = join(destination, "alpha", "SKILL.md");
  await put(globalSkill, "Existing global alpha.\n");

  for (const answer of ["\n", "no\nyes\n", ""]) {
    const result = sync(answer);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /overwrite same-named skills in the global skills directory/);
    assert.match(result.stdout, /cancelled/);
    assert.equal(await readFile(globalSkill, "utf8"), "Existing global alpha.\n");
    assert.deepEqual(await readdir(destination), ["alpha"]);
  }
  const invalidMode = sync("yes\n", "--mode", "auto");
  assert.equal(invalidMode.status, 2, invalidMode.stderr);
  assert.equal(await readFile(globalSkill, "utf8"), "Existing global alpha.\n");
});

test("global copy replaces complete matching entries and preserves unrelated skills", async (t) => {
  const { source, destination, sourceSkill, sync } = await fixture(t);
  await put(join(source, "linked", "SKILL.md"), "Replacement for the old global link.\n");
  await put(join(source, "new", "SKILL.md"), "New from the checkout.\n");
  await put(join(source, "not-a-skill", "README.md"), "Ignored.\n");
  const executable = join(source, "alpha", "scripts", "run.sh");
  await put(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  await put(join(destination, "alpha", "obsolete.md"), "An old resource.\n");
  const globalOnly = join(destination, "global-only");
  await put(join(globalOnly, "SKILL.md"), "Keep this skill.\n");
  await symlink(globalOnly, join(destination, "linked"), linkType);

  const result = sync("yes\n");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Synced 3 skills.*\(copy\)/);
  assert.deepEqual((await readdir(destination)).sort(), ["alpha", "global-only", "linked", "new"]);
  assert.deepEqual(
    await readFile(join(destination, "alpha", "SKILL.md")),
    await readFile(sourceSkill),
  );
  assert.deepEqual((await readdir(join(destination, "alpha"))).sort(), ["SKILL.md", "scripts"]);
  assert.equal((await lstat(join(destination, "linked"))).isDirectory(), true);
  assert.equal(await readFile(join(globalOnly, "SKILL.md"), "utf8"), "Keep this skill.\n");
  if (process.platform !== "win32")
    assert.equal(
      (await lstat(join(destination, "alpha", "scripts", "run.sh"))).mode & 0o111,
      0o111,
    );
});

test("global symlinks read live checkout files and can be replaced by copies", async (t) => {
  const { source, destination, sourceSkill, sync } = await fixture(t);
  const globalDirectory = join(destination, "alpha");
  const globalSkill = join(globalDirectory, "SKILL.md");
  await put(globalSkill, "Existing global alpha.\n");

  for (const answer of ["y\n", "YES\n"]) {
    const linked = sync(answer, "--mode", "symlink");
    assert.equal(linked.status, 0, linked.stderr);
    assert.equal((await lstat(globalDirectory)).isSymbolicLink(), true);
    assert.equal(await realpath(globalDirectory), await realpath(join(source, "alpha")));
  }
  await writeFile(sourceSkill, "A live checkout edit.\n");
  assert.equal(await readFile(globalSkill, "utf8"), "A live checkout edit.\n");

  const copied = sync("yes\n", "--mode", "copy");
  assert.equal(copied.status, 0, copied.stderr);
  assert.equal((await lstat(globalDirectory)).isDirectory(), true);
  await writeFile(sourceSkill, "An edit after copying.\n");
  assert.equal(await readFile(globalSkill, "utf8"), "A live checkout edit.\n");
});

test("a failed copy stage preserves all existing global entries", async (t) => {
  const { source, destination, sync } = await fixture(t);
  const globalSkill = join(destination, "alpha", "SKILL.md");
  await put(globalSkill, "Existing global alpha.\n");
  await put(join(source, "z-invalid", "SKILL.md"), "Another skill.\n");
  await symlink(join(source, "alpha"), join(source, "z-invalid", "linked"), linkType);

  const result = sync("yes\n", "--mode", "copy");
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Cannot copy a skill containing a symbolic link/);
  assert.equal(await readFile(globalSkill, "utf8"), "Existing global alpha.\n");
  assert.deepEqual(await readdir(destination), ["alpha"]);
});
