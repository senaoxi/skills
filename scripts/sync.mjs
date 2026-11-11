import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import { installSkills, resolveSource } from "skills";

const heading = "# Licenses of bundled skills";
const run = promisify(execFile);
const contains = (parent, child) => !parent || child === parent || child.startsWith(`${parent}/`);

async function retryNetwork(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt === 2 ||
        !/SSL_connect|SSL_ERROR_SYSCALL|TLS|ECONNRESET|connection reset|timed? out|Could not resolve|HTTP (?:429|5\d\d)/i.test(
          error.message,
        )
      )
        throw error;
      await setTimeout(500 * 2 ** attempt);
    }
  }
}

async function fetchNotices(repository, commit, skillPaths, staging) {
  const directory = await mkdtemp(join(staging, "license-source-"));
  await run("git", ["init", "--quiet", "--bare", directory]);
  const git = (...args) =>
    run("git", ["--git-dir", directory, ...args], {
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
    });
  await retryNetwork(() =>
    git("fetch", "--quiet", "--depth=1", `https://github.com/${repository}.git`, commit),
  );
  return collectNotices(repository, commit, skillPaths, {
    tree: async (revision) => {
      const { stdout } = await git("ls-tree", "-r", "-z", "--full-tree", revision);
      return stdout
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf("\t");
          const [mode, type, sha] = entry.slice(0, separator).split(" ");
          return { mode, type, sha, path: entry.slice(separator + 1) };
        });
    },
    blob: async (sha) => (await git("cat-file", "blob", sha)).stdout,
  });
}

function noticeLocation(path) {
  const parts = path.split("/");
  const collection = parts.slice(0, -1).findIndex((part) => /^licen[cs]es$/i.test(part));
  if (collection !== -1) return { owner: parts.slice(0, collection).join("/"), license: true };
  const name = posix.basename(path);
  if (/^(?:licen[cs]e|copying)(?:[._-].*)?$/i.test(name)) {
    return { owner: posix.dirname(path) === "." ? "" : posix.dirname(path), license: true };
  }
  if (
    /^(?:notice|copyright|authors|third[-_]party[-_](?:licenses?|notices?))(?:[._-].*)?$/i.test(
      name,
    )
  ) {
    return { owner: posix.dirname(path) === "." ? "" : posix.dirname(path), license: false };
  }
}

export async function collectNotices(repository, commit, skillPaths, objects) {
  const tree = await objects.tree(commit);
  if (!Array.isArray(tree)) throw new Error(`${repository}: incomplete Git tree`);
  const folders = skillPaths.map((path) => (path === "." ? "" : path));
  const files = tree
    .flatMap((entry) => {
      const location = noticeLocation(entry.path);
      if (entry.type !== "blob" || !location) return [];
      if (
        !folders.some(
          (folder) => contains(location.owner, folder) || contains(folder, location.owner),
        )
      )
        return [];
      return [{ ...entry, ...location }];
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const folder of folders) {
    if (!files.some((file) => file.license && contains(file.owner, folder))) {
      throw new Error(`${repository}: no license file applies to ${folder || "."}`);
    }
  }
  const notices = [];
  for (const file of files) {
    if (file.mode === "120000") throw new Error(`${repository}: symlinked notice ${file.path}`);
    const bytes = await objects.blob(file.sha);
    if (!Buffer.isBuffer(bytes)) {
      throw new Error(`${repository}: unreadable notice ${file.path}`);
    }
    const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (hash !== file.sha) throw new Error(`${repository}: notice hash mismatch for ${file.path}`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n");
    if (!text.trim() || text.includes("\0"))
      throw new Error(`${repository}: empty or binary notice ${file.path}`);
    notices.push({ path: file.path, text });
  }
  return notices;
}

export function renderLicense(current, sources) {
  const project = current
    .replaceAll("\r\n", "\n")
    .split(new RegExp(`^${heading}$`, "m"))[0]
    .trimEnd();
  if (!project) throw new Error("The project license must precede the bundled skill notices");
  const sections = sources.map(({ repository, commit, skills, notices }) => {
    const url = `https://github.com/${repository}`;
    const files = notices.map(({ path, text }) => {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const quoted = text
        .replace(/\n$/, "")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
      return `### ${path}\n\nSource: ${url}/blob/${commit}/${encodedPath}\n\n${quoted}`;
    });
    return `## ${repository}\n\nRepository: ${url}\nRevision: ${commit}\nSkills: ${skills.length} (see skills-lock.json)\n\n${files.join("\n\n")}`;
  });
  return `${project}\n\n${heading}\n\nGenerated from the same source revisions as the bundled skills.\nCopyright and license terms are reproduced below from the upstream files.\n\n# Bundled skills\n\n${sections.join("\n\n")}\n`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function publishSnapshot(root, staging, move = rename) {
  const backup = join(staging, "backup");
  await mkdir(backup);
  const changes = [];
  try {
    for (const name of ["skills", "skills-lock.json", "LICENSE"]) {
      const previous = await exists(join(root, name));
      if (previous) await move(join(root, name), join(backup, name));
      const change = { name, previous, installed: false };
      changes.push(change);
      await move(join(staging, name), join(root, name));
      change.installed = true;
    }
  } catch (error) {
    const failures = [error];
    for (const { name, previous, installed } of changes.reverse()) {
      try {
        if (installed) await rm(join(root, name), { recursive: true, force: true });
        if (previous) await move(join(backup, name), join(root, name));
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(failures, `Could not restore original files; backups: ${backup}`);
    throw error;
  }
}

export async function syncSkills(root, adapters = {}) {
  const openSource = adapters.resolveSource ?? resolveSource;
  const install = adapters.installSkills ?? installSkills;
  const readNotices = adapters.collectNotices ?? fetchNotices;
  const { sources } = JSON.parse(await readFile(join(root, "skills-sources.json"), "utf8"));
  if (!Array.isArray(sources) || !sources.length)
    throw new Error("Configure at least one skill source");
  const repositories = new Set();
  for (const entry of sources) {
    if (
      !entry ||
      typeof entry.repository !== "string" ||
      !/^[a-z\d][a-z\d-]*\/[\w.-]+$/i.test(entry.repository) ||
      [".", ".."].includes(entry.repository.split("/")[1]) ||
      typeof entry.ref !== "string" ||
      !entry.ref.trim()
    ) {
      throw new Error("Each source needs a GitHub owner/repository and a non-empty ref");
    }
    if (repositories.has(entry.repository.toLowerCase()))
      throw new Error(`Duplicate source: ${entry.repository}`);
    repositories.add(entry.repository.toLowerCase());
  }

  const lockPath = join(root, ".skills-sync-lock");
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `A sync is running or left a lock at ${lockPath}; inspect it before retrying`,
      );
    throw error;
  }
  let staging;
  let preserveStaging = false;
  const names = new Set();
  const groups = [];
  try {
    staging = await mkdtemp(join(root, ".skills-sync-"));
    for (const { repository, ref } of sources.toSorted((a, b) =>
      a.repository < b.repository ? -1 : a.repository > b.repository ? 1 : 0,
    )) {
      const source = await retryNetwork(() =>
        openSource(repository, {
          ref,
          onWarning: (warning) => {
            throw new Error(warning.message);
          },
        }),
      );
      try {
        const commit = source.source.commit;
        if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
          throw new Error(`${repository}: no source commit was resolved`);
        if (
          !source.skills.length ||
          source.skills.some((skill) => typeof skill.path !== "string")
        ) {
          throw new Error(`${repository}: incomplete skill paths`);
        }
        const notices = await readNotices(
          repository,
          commit,
          source.skills.map((skill) => skill.path),
          staging,
        );
        const result = await install(source, {
          cwd: staging,
          agents: ["universal"],
          mode: "copy",
          duplicates: "error",
          symlinks: "reject",
        });
        if (
          result.failed.length ||
          result.skipped.length ||
          result.installed.length !== source.skills.length
        ) {
          throw new Error(
            `${repository}: incomplete installation: ${JSON.stringify(result.failed)}`,
          );
        }
        const skills = result.installed.map((target) => basename(target.path)).sort();
        for (const name of skills) {
          if (names.has(name)) throw new Error(`Skill name collision: ${name}`);
          names.add(name);
        }
        groups.push({ repository, commit, skills, notices });
      } finally {
        await source.dispose();
      }
    }
    const lock = JSON.parse(await readFile(join(staging, "skills-lock.json"), "utf8"));
    const installed = await readdir(join(staging, ".agents/skills"));
    const expected = [...names].sort().join("\n");
    if (
      Object.keys(lock.skills).sort().join("\n") !== expected ||
      installed.sort().join("\n") !== expected
    ) {
      throw new Error("Installed skills and lock file do not match");
    }
    for (const name of names) {
      if (!(await stat(join(staging, ".agents/skills", name, "SKILL.md"))).isFile())
        throw new Error(`Missing skill entry: ${name}`);
    }
    await rename(join(staging, ".agents/skills"), join(staging, "skills"));
    const currentLicense = await readFile(join(root, "LICENSE"), "utf8");
    await writeFile(join(staging, "LICENSE"), renderLicense(currentLicense, groups));
    await publishSnapshot(root, staging);
    return { sources: groups.length, skills: names.size };
  } catch (error) {
    if (
      staging &&
      (await exists(join(staging, "backup"))) &&
      (await readdir(join(staging, "backup"))).length
    ) {
      preserveStaging = true;
      throw new Error(`${error.message}\nOriginal files retained at ${join(staging, "backup")}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (staging && !preserveStaging) await rm(staging, { recursive: true, force: true });
    await rm(lockPath, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncSkills(fileURLToPath(new URL("../", import.meta.url)))
    .then(({ sources, skills }) =>
      console.log(`Synced ${skills} skills and their license notices from ${sources} sources.`),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
