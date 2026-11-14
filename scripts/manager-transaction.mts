import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { artifacts } from "./manager-types.mjs";
import type {
  ControlFile,
  ControlModes,
  Fingerprints,
  Inventory,
  InventoryRecord,
} from "./manager-types.mjs";
import {
  compare,
  digest,
  equal,
  errorMessage,
  fail,
  hasCode,
  isHash,
  json,
  object,
  parseJSON,
} from "./manager-shared.mjs";

export const controlFiles = artifacts.filter((name): name is ControlFile => name !== "skills");
export type Move = (from: string, to: string) => Promise<void>;
interface Journal {
  version: 1;
  stage: string;
  state: "prepared" | "committed";
  old: Fingerprints;
  next: Fingerprints;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}
export async function inventory(path: string): Promise<Inventory | null> {
  const records: InventoryRecord[] = [];
  async function visit(absolute: string, name: string): Promise<void> {
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
      fail(`Symlink or special file is not managed: ${absolute}`);
    records.push([
      name,
      info.isDirectory() ? "directory" : "file",
      info.mode & 0o111,
      info.isFile() ? (await readFile(absolute)).toString("base64") : "",
    ]);
    if (info.isDirectory())
      for (const child of (await readdir(absolute)).sort(compare))
        await visit(join(absolute, child), name ? `${name}/${child}` : child);
  }
  if (!(await exists(path))) return null;
  await visit(path, "");
  return { hash: digest(json(records)), records };
}
export async function fingerprint(path: string): Promise<string | null> {
  return (await inventory(path))?.hash ?? null;
}
export async function fingerprints(root: string): Promise<Fingerprints> {
  const values = await Promise.all(artifacts.map((name) => fingerprint(join(root, name))));
  const [sources, skills, lock, license] = values;
  if (sources === undefined || skills === undefined || lock === undefined || license === undefined)
    fail("Incomplete artifact fingerprint set");
  return { "skills-sources.json": sources, skills, "skills-lock.json": lock, LICENSE: license };
}
export async function readControlModes(root: string): Promise<ControlModes> {
  const mode = async (name: ControlFile): Promise<number> =>
    (await lstat(join(root, name))).mode & 0o111;
  const [sources, lock, license] = await Promise.all([
    mode("skills-sources.json"),
    mode("skills-lock.json"),
    mode("LICENSE"),
  ]);
  return { "skills-sources.json": sources, "skills-lock.json": lock, LICENSE: license };
}
export async function preserveControlModes(root: string, modes: ControlModes): Promise<void> {
  for (const name of controlFiles) await chmod(join(root, name), 0o644 | modes[name]);
}
export async function durableJSON(path: string, data: unknown): Promise<void> {
  const temporary = `${path}.new`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(json(data));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function deadOwner(lockPath: string): Promise<void> {
  if (!(await lstat(lockPath)).isDirectory()) fail(`Unsafe repository lock at ${lockPath}`);
  let owner: unknown;
  try {
    owner = parseJSON(await readFile(join(lockPath, "owner.json"), "utf8"));
  } catch {
    fail(`Cannot establish lock ownership at ${lockPath}; inspect it before retrying`);
  }
  if (
    !object(owner) ||
    owner.host !== hostname() ||
    typeof owner.pid !== "number" ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0
  )
    fail(`Lock owner cannot be proven dead at ${lockPath}`);
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (hasCode(error, "ESRCH")) return;
    throw error;
  }
  fail(`A repository command is running with PID ${owner.pid}`);
}
function parseFingerprints(value: unknown, label: string): Fingerprints {
  if (!object(value) || !equal(Object.keys(value), artifacts)) fail(`Invalid publication ${label}`);
  const field = (name: (typeof artifacts)[number]): string | null => {
    const hash = value[name];
    if (hash !== null && !isHash(hash)) fail(`Invalid publication fingerprint at ${label}`);
    return hash;
  };
  return {
    "skills-sources.json": field("skills-sources.json"),
    skills: field("skills"),
    "skills-lock.json": field("skills-lock.json"),
    LICENSE: field("LICENSE"),
  };
}
function parseJournal(value: unknown, root: string, journalPath: string): Journal {
  if (
    !object(value) ||
    value.version !== 1 ||
    (value.state !== "prepared" && value.state !== "committed") ||
    typeof value.stage !== "string"
  )
    fail(`Invalid publication journal ${journalPath}`);
  const stage = resolve(root, value.stage);
  if (dirname(stage) !== root || !basename(stage).startsWith(".skills-sync-stage-"))
    fail(`Invalid publication journal ${journalPath}`);
  return {
    version: 1,
    stage: value.stage,
    state: value.state,
    old: parseFingerprints(value.old, journalPath),
    next: parseFingerprints(value.next, journalPath),
  };
}
export async function recoverPublication(
  root: string,
  journalPath: string,
  move: Move = rename,
): Promise<void> {
  if (!(await lstat(journalPath)).isFile()) fail(`Unsafe publication journal ${journalPath}`);
  const journal = parseJournal(parseJSON(await readFile(journalPath, "utf8")), root, journalPath);
  const stage = resolve(root, journal.stage);
  const directories = [await lstat(stage), await lstat(join(stage, "backup"))];
  if (directories.some((info) => info.isSymbolicLink() || !info.isDirectory()))
    fail(`Unsafe recovery directories at ${stage}`);
  const current = await fingerprints(root);
  const backups = await fingerprints(join(stage, "backup"));
  for (const name of artifacts) {
    const old = journal.old[name];
    const next = journal.next[name];
    if (backups[name] !== null && backups[name] !== old)
      fail(`Backup changed at ${name}; recovery retained at ${stage}`);
    if (journal.state === "committed") {
      if (current[name] !== next)
        fail(`Committed publication changed at ${name}; recovery retained at ${stage}`);
    } else {
      if (current[name] !== null && current[name] !== old && current[name] !== next)
        fail(`Manual edit at ${name}; recovery will not overwrite it. Evidence: ${stage}`);
      if (old !== null && current[name] !== old && backups[name] !== old)
        fail(`Original ${name} unavailable; recovery retained at ${stage}`);
    }
  }
  if (journal.state !== "committed") {
    const failures: unknown[] = [];
    for (const name of artifacts.toReversed()) {
      try {
        if (current[name] === journal.old[name]) continue;
        if (current[name] !== null) await rm(join(root, name), { recursive: true, force: true });
        if (journal.old[name] !== null) await move(join(stage, "backup", name), join(root, name));
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        `Could not restore original files; recovery evidence: ${stage}`,
      );
  }
  await rm(journalPath);
  await rm(stage, { recursive: true, force: true });
}
export async function acquire(root: string, options: { recover?: boolean } = {}): Promise<string> {
  const path = join(root, ".skills-sync-lock");
  try {
    await mkdir(path);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    await deadOwner(path);
    if (options.recover === false && (await exists(join(path, "journal.json"))))
      fail(
        "Pending publication recovery requires a writing command; check will not change publication artifacts",
      );
    const recovery = join(root, ".skills-sync-recovery");
    try {
      await mkdir(recovery);
    } catch {
      fail(`Recovery already claimed at ${recovery}; inspect its owner before retrying`);
    }
    try {
      await durableJSON(join(recovery, "owner.json"), { host: hostname(), pid: process.pid });
      await deadOwner(path);
      if (await exists(join(path, "journal.json")))
        await recoverPublication(root, join(path, "journal.json"));
      await rm(path, { recursive: true });
      await mkdir(path);
    } finally {
      await rm(recovery, { recursive: true, force: true });
    }
  }
  await durableJSON(join(path, "owner.json"), { host: hostname(), pid: process.pid });
  return path;
}
export async function publishSnapshot(
  root: string,
  staging: string,
  baseline: Fingerprints,
  move: Move = rename,
): Promise<void> {
  const journalPath = join(root, ".skills-sync-lock", "journal.json");
  const next = await fingerprints(staging);
  if (Object.values(next).some((value) => value === null)) fail("Incomplete staged publication");
  if (!equal(await fingerprints(root), baseline))
    fail("Publication artifacts changed during staging; no files were replaced");
  await mkdir(join(staging, "backup"));
  const journal: Journal = {
    version: 1,
    stage: relative(root, staging),
    state: "prepared",
    old: baseline,
    next,
  };
  await durableJSON(journalPath, journal);
  try {
    for (const name of artifacts) {
      if (baseline[name] !== null) await move(join(root, name), join(staging, "backup", name));
      await move(join(staging, name), join(root, name));
    }
    // An original may change after the initial check but before its backup rename.
    const [originals, installed] = await Promise.all([
      fingerprints(join(staging, "backup")),
      fingerprints(root),
    ]);
    for (const name of artifacts) {
      if (originals[name] !== baseline[name])
        fail(`Backed-up original changed at ${name}; recovery evidence retained at ${staging}`);
      if (installed[name] !== next[name])
        fail(
          `Installed publication candidate changed at ${name}; recovery evidence retained at ${staging}`,
        );
    }
  } catch (error) {
    try {
      await recoverPublication(root, journalPath, move);
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        `${errorMessage(error)}\n${errorMessage(failure)}`,
      );
    }
    throw error;
  }
  journal.state = "committed";
  // Persistence may fail after the committed marker becomes visible on disk.
  try {
    await durableJSON(journalPath, journal);
  } catch (error) {
    throw new Error(
      `Publication artifacts are installed; commit durability is uncertain and the journal may already be committed. Recovery evidence retained at ${staging}. ${errorMessage(error)}`,
      { cause: error },
    );
  }
  await rm(journalPath);
}
