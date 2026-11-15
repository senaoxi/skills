import { cp, lstat, mkdir, readdir, realpath, rename, rm, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { compare, errorMessage, fail, hasCode } from "./manager-shared.ts";
import { exists } from "./manager-transaction.ts";
import type { GlobalSyncMode } from "./manager-types.ts";
import { inside } from "./toolchain-core.ts";

async function resolveDestination(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    const parent = dirname(path);
    if (!hasCode(error, "ENOENT") || parent === path || (await exists(path))) throw error;
    return join(await resolveDestination(parent), basename(path));
  }
}

async function skillNames(source: string): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const marker = join(source, entry.name, "SKILL.md");
    try {
      if ((await lstat(marker)).isFile()) names.push(entry.name);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  return names.sort(compare);
}

async function renameToVacantPath(from: string, to: string): Promise<void> {
  if (await exists(to)) fail(`Cannot move ${from}; destination already exists at ${to}`);
  await rename(from, to);
}

export async function syncGlobalSkills(options: {
  source: string;
  destination: string;
  mode: GlobalSyncMode;
  confirm: (destination: string) => Promise<boolean>;
}): Promise<number | null> {
  const source = await realpath(options.source);
  const names = await skillNames(source);
  if (!names.length) return 0;

  const destination = await resolveDestination(options.destination);
  if (inside(source, destination) || inside(destination, source))
    fail(`Source and global skills directories overlap: ${source} and ${destination}`);
  if (!(await options.confirm(destination))) return null;
  if ((await resolveDestination(options.destination)) !== destination)
    fail("Global skills directory changed while waiting for confirmation");

  await mkdir(destination, { recursive: true });
  const stage = join(destination, ".skills-global-sync.lock");
  try {
    await mkdir(stage, { mode: 0o700 });
  } catch (error) {
    if (hasCode(error, "EEXIST"))
      fail(
        `A global skill sync is in progress or was interrupted. Inspect ${stage} before retrying.`,
      );
    throw error;
  }

  const incoming = join(stage, "incoming");
  const backup = join(stage, "backup");
  const moves: { from: string; to: string }[] = [];
  let retainStage = false;
  async function move(from: string, to: string): Promise<void> {
    await renameToVacantPath(from, to);
    moves.push({ from, to });
  }
  try {
    await mkdir(incoming);
    await mkdir(backup);
    for (const name of names) {
      const from = join(source, name);
      const to = join(incoming, name);
      if (await exists(to)) fail(`Skill names collide on the global filesystem at ${name}`);
      if (options.mode === "symlink") {
        await symlink(from, to, process.platform === "win32" ? "junction" : "dir");
      } else {
        await cp(from, to, {
          recursive: true,
          filter: async (path) => {
            if ((await lstat(path)).isSymbolicLink())
              fail(`Cannot copy a skill containing a symbolic link: ${path}`);
            return true;
          },
        });
      }
    }

    // Exact directory entries distinguish names on case-insensitive filesystems.
    const existing = new Set(await readdir(destination));
    existing.delete(basename(stage));
    for (const name of names) {
      const target = join(destination, name);
      if (existing.has(name)) await move(target, join(backup, name));
      await move(join(incoming, name), target);
    }
  } catch (error) {
    const failures: string[] = [];
    for (const { from, to } of moves.reverse()) {
      try {
        await renameToVacantPath(to, from);
      } catch (failure) {
        failures.push(errorMessage(failure));
      }
    }
    if (failures.length) {
      retainStage = true;
      throw new Error(
        `${errorMessage(error)}\nCould not restore global skills. Backups retained at ${backup}.\n${failures.join("\n")}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (!retainStage) await rm(stage, { recursive: true, force: true });
  }
  return names.length;
}
