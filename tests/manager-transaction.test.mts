import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { digest, hasCode, json, parseJSON, record } from "../scripts/manager-shared.mjs";
import { exists, fingerprints, inventory } from "../scripts/manager-transaction.mjs";
import type {
  PreparedLocalSkill,
  PublishLocalArtifactsOptions,
  SkillsLock,
} from "../scripts/manager-types.mjs";
import { manageRepository, publishLocalArtifacts } from "../scripts/skills.mjs";

const run = promisify(execFile);
const manager = new URL("../scripts/skills.mjs", import.meta.url).href;
const projectLicense = "Fixture project license.\n";
const terms =
  "Fixture license\n\nPermission to use, copy, modify and distribute this fixture is granted with this notice.\nNo warranty is provided.\n";
interface Invocation {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function temporary(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "skills-transaction-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
async function emptyProject(t: TestContext, mirrorMode = 0o755): Promise<string> {
  const root = await temporary(t);
  await mkdir(join(root, "skills"));
  await chmod(join(root, "skills"), mirrorMode);
  const manifest = { version: 2, sources: [] };
  const lock: SkillsLock = {
    version: 2,
    skills: {},
    repository: {
      version: 2,
      sdk: "skills@1.8.1",
      sources: {},
      installed: {},
      manifestHash: digest(json(manifest)),
      controlModes: { "skills-sources.json": 0, "skills-lock.json": 0, LICENSE: 0 },
      licenseHash: digest(projectLicense),
    },
  };
  await put(join(root, "skills-sources.json"), json(manifest));
  await put(join(root, "skills-lock.json"), json(lock));
  await put(join(root, "LICENSE"), projectLicense);
  return root;
}
async function prepared(t: TestContext, root: string): Promise<PreparedLocalSkill> {
  const path = await temporary(t);
  await chmod(path, 0o755);
  await mkdir(join(root, "packages/local"), { recursive: true });
  await put(
    join(path, "SKILL.md"),
    "---\nname: local\ndescription: Transaction fixture.\n---\n\nFixture.\n",
  );
  await put(join(path, "LICENSE"), terms);
  await put(join(path, "scripts/run.mjs"), "export const value = 42;\n");
  const listing = await inventory(path);
  assert.ok(listing);
  return {
    path,
    name: "local",
    packageDir: "packages/local",
    inputHash: listing.hash,
    files: listing.records
      .filter(([, kind]) => kind === "file")
      .map(([path, , executable, base64]) => ({
        path,
        executable: executable !== 0,
        sha256: digest(Buffer.from(base64, "base64")),
      })),
    toolchain: { builder: "transaction-fixture-v1" },
  };
}
async function fault(t: TestContext, source: string): Promise<string> {
  const path = join(await temporary(t), "fault.mjs");
  await put(
    path,
    `import fs from "node:fs/promises";\nimport { syncBuiltinESMExports } from "node:module";\n${source}\nsyncBuiltinESMExports();\n`,
  );
  return path;
}
async function invoke(
  options: PublishLocalArtifactsOptions,
  setup: { preload?: string; umask?: number } = {},
): Promise<Invocation> {
  try {
    const result = await run(
      process.execPath,
      [
        ...(setup.preload ? ["--import", pathToFileURL(setup.preload).href] : []),
        "--input-type=module",
        "--eval",
        `import { publishLocalArtifacts } from ${JSON.stringify(manager)};
${setup.umask === undefined ? "" : `process.umask(${setup.umask});`}
process.stdout.write(JSON.stringify(await publishLocalArtifacts(JSON.parse(process.argv[1]))));`,
        JSON.stringify(options),
      ],
      { cwd: options.root, env: { ...process.env, DO_NOT_TRACK: "1" }, timeout: 30_000 },
    );
    return { code: 0, ...result };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("stdout" in error) ||
      typeof error.stdout !== "string" ||
      !("stderr" in error) ||
      typeof error.stderr !== "string"
    )
      throw error;
    return {
      code: "code" in error && typeof error.code === "number" ? error.code : null,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
}
async function textOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}
async function journal(root: string) {
  const path = join(root, ".skills-sync-lock/journal.json");
  const text = await textOrNull(path);
  if (text === null) return null;
  const value = record(parseJSON(text), "transaction test journal");
  assert.ok(
    typeof value.stage === "string" && (value.state === "prepared" || value.state === "committed"),
  );
  return { path, text, stage: join(root, value.stage), state: value.state };
}

test("publication retains an original edited after the first published artifact and before its backup", async (t) => {
  const root = await emptyProject(t);
  const local = await prepared(t, root);
  const manual = "Manual bytes written during publication.\n";
  const preload = await fault(
    t,
    `const original = fs.rename; let fired = false;
fs.rename = async (from, to) => {
  const result = await original(from, to);
  if (!fired && String(to) === ${JSON.stringify(join(root, "skills-sources.json"))}) {
    fired = true;
    await fs.writeFile(${JSON.stringify(join(root, "skills/manual.txt"))}, ${JSON.stringify(manual)});
  }
  return result;
};`,
  );
  const result = await invoke({ root, skills: [local] }, { preload });
  const evidence = await journal(root);
  const saved = evidence
    ? await textOrNull(join(evidence.stage, "backup/skills/manual.txt"))
    : null;
  t.diagnostic(json({ code: result.code, journal: evidence?.state ?? null, saved }));
  assert.notEqual(result.code, 0, "A late edit to the original must prevent a successful commit");
  assert.ok(evidence);
  assert.equal(evidence.state, "prepared");
  assert.equal(saved, manual);
  assert.match(result.stderr, /backup.*skills|original.*skills/is);
  const current = await fingerprints(root);
  await assert.rejects(manageRepository(root, { type: "list" }), /Backup changed.*skills/);
  assert.deepEqual(await fingerprints(root), current);
  assert.equal(await readFile(join(evidence.stage, "backup/skills/manual.txt"), "utf8"), manual);
  assert.equal(await readFile(evidence.path, "utf8"), evidence.text);
});

test("publication retains a candidate edited after installation instead of committing a stale receipt", async (t) => {
  const root = await emptyProject(t);
  const local = await prepared(t, root);
  const manual = "export const value = 'manual';\n";
  const preload = await fault(
    t,
    `const original = fs.rename; let fired = false;
fs.rename = async (from, to) => {
  const result = await original(from, to);
  if (!fired && String(to) === ${JSON.stringify(join(root, "skills"))}) {
    fired = true;
    await fs.writeFile(${JSON.stringify(join(root, "skills/local/scripts/run.mjs"))}, ${JSON.stringify(manual)});
  }
  return result;
};`,
  );
  const result = await invoke({ root, skills: [local] }, { preload });
  const evidence = await journal(root);
  t.diagnostic(json({ code: result.code, journal: evidence?.state ?? null }));
  assert.notEqual(result.code, 0, "A late candidate edit must prevent a successful commit");
  assert.ok(evidence);
  assert.equal(evidence.state, "prepared");
  assert.equal(await readFile(join(root, "skills/local/scripts/run.mjs"), "utf8"), manual);
  assert.match(result.stderr, /installed.*skills|candidate.*skills/is);
  await assert.rejects(manageRepository(root, { type: "list" }), /Manual edit.*skills/);
  assert.equal(await readFile(join(root, "skills/local/scripts/run.mjs"), "utf8"), manual);
  assert.equal(await readFile(evidence.path, "utf8"), evidence.text);
});

test("identical empty publication checks preserve mirror mode independently of process umask", async (t) => {
  for (const mirrorMode of [0o755, 0o700])
    for (const umask of [0o022, 0o077])
      await t.test(`mirror ${mirrorMode.toString(8)}, umask ${umask.toString(8)}`, async (t) => {
        const root = await emptyProject(t, mirrorMode);
        const before = await fingerprints(root);
        const result = await invoke({ root, skills: [], check: true }, { umask });
        t.diagnostic(json({ code: result.code, stderr: result.stderr }));
        assert.equal(result.code, 0, result.stderr);
        assert.deepEqual(parseJSON(result.stdout), { sources: 0, skills: 0, changed: false });
        assert.deepEqual(await fingerprints(root), before);
        assert.ok(!(await readdir(root)).some((name) => name.startsWith(".skills-sync-")));
      });
});

test("commit journal directory-sync failure preserves the committed marker, originals and lock", async (t) => {
  const root = await emptyProject(t);
  const local = await prepared(t, root);
  const before = await fingerprints(root);
  const preload = await fault(
    t,
    `const originalRename = fs.rename; const originalOpen = fs.open;
let committed = false; let fired = false;
fs.rename = async (from, to) => {
  const result = await originalRename(from, to);
  if (String(to) === ${JSON.stringify(join(root, ".skills-sync-lock/journal.json"))})
    committed = JSON.parse(await fs.readFile(to, "utf8")).state === "committed";
  return result;
};
fs.open = async (path, ...args) => {
  const handle = await originalOpen(path, ...args);
  if (String(path) === ${JSON.stringify(join(root, ".skills-sync-lock"))}) {
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      if (committed && !fired) {
        fired = true;
        const error = new Error("Injected directory-sync EIO after committed journal rename");
        error.code = "EIO";
        throw error;
      }
      return sync();
    };
  }
  return handle;
};`,
  );
  const result = await invoke({ root, skills: [local] }, { preload });
  const evidence = await journal(root);
  t.diagnostic(json({ code: result.code, journal: evidence?.state ?? null }));
  assert.notEqual(result.code, 0);
  assert.ok(evidence, "A failed commit-directory sync must retain its journal and backups");
  assert.equal(evidence.state, "committed");
  assert.deepEqual(await fingerprints(join(evidence.stage, "backup")), before);
  assert.match(result.stderr, /commit.*uncertain.*committed.*recovery evidence/is);
  assert.match(result.stderr, /EIO/);
  assert.ok(await exists(join(root, ".skills-sync-lock/owner.json")));
  const installed = await fingerprints(root);
  assert.notDeepEqual(installed, before);
  await assert.rejects(
    publishLocalArtifacts({ root, skills: [local], check: true }),
    /check will not change/,
  );
  assert.deepEqual(await fingerprints(root), installed);
  assert.equal(await readFile(evidence.path, "utf8"), evidence.text);
  const manualPath = join(evidence.stage, "backup/skills/manual.txt");
  await put(manualPath, "Manual edit to retained committed recovery evidence.\n");
  await assert.rejects(manageRepository(root, { type: "list" }), /Backup changed.*skills/);
  assert.equal(
    await readFile(manualPath, "utf8"),
    "Manual edit to retained committed recovery evidence.\n",
  );
  assert.deepEqual(await fingerprints(root), installed);
  assert.equal(await readFile(evidence.path, "utf8"), evidence.text);
  await rm(manualPath);
  assert.deepEqual(
    (await manageRepository(root, { type: "list" })).installed.map((receipt) => receipt.name),
    ["local"],
  );
  assert.deepEqual(await fingerprints(root), installed);
  assert.ok(!(await exists(evidence.path)));
  assert.ok(!(await exists(evidence.stage)));
});

test("commit marker rename failure preserves a prepared journal for later explicit rollback", async (t) => {
  const root = await emptyProject(t);
  const local = await prepared(t, root);
  const before = await fingerprints(root);
  const preload = await fault(
    t,
    `const original = fs.rename;
fs.rename = async (from, to) => {
  if (String(to) === ${JSON.stringify(join(root, ".skills-sync-lock/journal.json"))} &&
    JSON.parse(await fs.readFile(from, "utf8")).state === "committed") {
    const error = new Error("Injected commit-marker rename EIO");
    error.code = "EIO";
    throw error;
  }
  return original(from, to);
};`,
  );
  const result = await invoke({ root, skills: [local] }, { preload });
  const evidence = await journal(root);
  t.diagnostic(json({ code: result.code, journal: evidence?.state ?? null }));
  assert.notEqual(result.code, 0);
  assert.ok(evidence, "Commit persistence failure must not run rollback or remove its evidence");
  assert.equal(evidence.state, "prepared");
  assert.deepEqual(await fingerprints(join(evidence.stage, "backup")), before);
  assert.notDeepEqual(await fingerprints(root), before);
  assert.match(result.stderr, /commit.*uncertain.*committed.*recovery evidence/is);
  assert.deepEqual((await manageRepository(root, { type: "list" })).installed, []);
  assert.deepEqual(await fingerprints(root), before);
  assert.ok(!(await exists(evidence.stage)));
});
