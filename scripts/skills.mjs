import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import { installSkills, resolveSource } from "skills";

const run = promisify(execFile);
const artifacts = ["skills-sources.json", "skills", "skills-lock.json", "LICENSE"];
const controlFiles = artifacts.filter((name) => name !== "skills");
const heading = "# Licenses of bundled skills";
const gitTypes = new Set(["github", "gitlab", "git"]);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const contains = (parent, child) => !parent || child === parent || child.startsWith(`${parent}/`);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originKey = (origin) => JSON.stringify(origin);
const present = (value) => typeof value === "string" && value.trim().length > 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message) => {
  throw new Error(message);
};

function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    fail(`Invalid ${label}`);
}
function safeRelative(path) {
  return (
    present(path) &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    (path === "." || path.split("/").every((part) => part && part !== "." && part !== ".."))
  );
}
function safeName(name) {
  return safeRelative(name) && name !== "." && !name.includes("/");
}
function sourceInput(value) {
  if (!present(value) || value.includes("\0") || value.startsWith("-"))
    fail("A non-empty source locator is required");
  if (/^[a-z]+:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.password || (url.username && !["ssh:", "git+ssh:"].includes(url.protocol))) {
      fail("Credential-bearing source URLs cannot be persisted; use Git credential helpers");
    }
  }
  return value;
}
function refPolicy(ref) {
  if (ref !== undefined && (!present(ref) || ref === "HEAD" || ref.startsWith("-"))) {
    fail("Use a concrete Git branch, tag, or commit for --ref, not HEAD");
  }
  return ref;
}
function parseOrigin(value) {
  if (value?.kind === "path") {
    keys(value, ["kind", "path"], "path origin");
    if (!safeRelative(value.path)) fail("Invalid source-relative origin path");
    return { kind: "path", path: value.path };
  }
  keys(value, ["kind", "name"], "declared origin");
  if (value.kind !== "declared" || !present(value.name)) fail("Invalid declared origin");
  return { kind: "declared", name: value.name };
}
function parseOrigins(values) {
  if (!Array.isArray(values)) fail("Selection origins must be an array");
  const origins = values.map(parseOrigin);
  if (new Set(origins.map(originKey)).size !== origins.length) fail("Duplicate selection origin");
  return origins.toSorted((a, b) => compare(originKey(a), originKey(b)));
}
function parseManifest(raw) {
  const legacy = raw.version === undefined;
  keys(raw, legacy ? ["sources"] : ["version", "sources"], "manifest");
  if ((!legacy && raw.version !== 2) || !Array.isArray(raw.sources))
    fail("Expected skills-sources.json version 2");
  const sources = raw.sources.map((entry, index) => {
    if (legacy) {
      keys(entry, ["repository", "ref"], "legacy source");
      if (!/^[a-z\d][a-z\d-]*\/[\w.-]+$/i.test(entry.repository ?? "") || !present(entry.ref))
        fail("Invalid legacy source");
      return {
        id: `source-${index + 1}`,
        source: entry.repository,
        ref: refPolicy(entry.ref),
        selection: { mode: "all", exclude: [] },
      };
    }
    keys(entry, ["id", "source", "ref", "selection"], "source policy");
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(entry.id ?? "")) fail("Invalid source ID");
    const selection = entry.selection;
    const all = selection?.mode === "all";
    keys(selection, all ? ["mode", "exclude"] : ["mode", "origins"], "selection");
    if (!all && selection.mode !== "include") fail("Selection mode must be all or include");
    return {
      id: entry.id,
      source: sourceInput(entry.source),
      ...(entry.ref === undefined ? {} : { ref: refPolicy(entry.ref) }),
      selection: all
        ? { mode: "all", exclude: parseOrigins(selection.exclude) }
        : { mode: "include", origins: parseOrigins(selection.origins) },
    };
  });
  if (
    new Set(sources.map((source) => source.id)).size !== sources.length ||
    new Set(sources.map((source) => source.source)).size !== sources.length
  )
    fail("Duplicate source ID or locator");
  return { legacy, manifest: { version: 2, sources } };
}
function manifestHash(manifest) {
  const normalized = parseManifest(manifest).manifest;
  return digest(
    json({ ...normalized, sources: normalized.sources.toSorted((a, b) => compare(a.id, b.id)) }),
  );
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
export async function inventory(path) {
  const records = [];
  async function visit(absolute, name) {
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
async function fingerprint(path) {
  return (await inventory(path))?.hash ?? null;
}
async function fingerprints(root) {
  return Object.fromEntries(
    await Promise.all(artifacts.map(async (name) => [name, await fingerprint(join(root, name))])),
  );
}
async function durableJSON(path, data) {
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

function noticeLocation(path) {
  const parts = path.split("/");
  const collection = parts.slice(0, -1).findIndex((part) => /^licen[cs]es$/i.test(part));
  if (collection !== -1) return { owner: parts.slice(0, collection).join("/"), license: true };
  const name = posix.basename(path);
  if (/^(?:licen[cs]e|copying)(?:[._-].*)?$/i.test(name))
    return { owner: posix.dirname(path) === "." ? "" : posix.dirname(path), license: true };
  if (
    /^(?:notice|copyright|authors|third[-_]party[-_](?:licenses?|notices?))(?:[._-].*)?$/i.test(
      name,
    )
  )
    return { owner: posix.dirname(path) === "." ? "" : posix.dirname(path), license: false };
}
function noticeText(bytes, label) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!text.trim() || text.includes("\0")) fail(`Empty or binary notice: ${label}`);
  const body = text.replace(/^\s*SPDX-[\w-]+:[^\r\n]*(?:\r?\n|$)/gim, "").trim();
  if (
    noticeLocation(label)?.license &&
    (!body ||
      /^[\w.+:-]+(?:\s+(?:AND|OR|WITH)\s+[\w.+:-]+)*$/i.test(body.replace(/[()]/g, " ").trim()) ||
      /^(?:MIT License|Apache License(?:,?\s+Version\s+\d+(?:\.\d+)*)?|https?:\/\/\S+)$/i.test(
        body,
      ))
  )
    fail(`Notice ${label} supplies an identifier, expression or URL; complete terms are required`);
  return text;
}
function noticeRecord(path, bytes) {
  return { path, text: noticeText(bytes, path), sha256: digest(bytes) };
}
export async function collectNotices(repository, commit, skillPaths, objects) {
  const tree = await objects.tree(commit);
  if (!Array.isArray(tree)) fail(`${repository}: incomplete Git tree`);
  const folders = skillPaths.map((path) => (path === "." ? "" : path));
  const files = tree
    .flatMap((entry) => {
      const location = noticeLocation(entry.path);
      if (
        entry.type !== "blob" ||
        !location ||
        !folders.some(
          (folder) => contains(location.owner, folder) || contains(folder, location.owner),
        )
      )
        return [];
      return [{ ...entry, ...location }];
    })
    .sort((a, b) => compare(a.path, b.path));
  for (const folder of folders)
    if (!files.some((file) => file.license && contains(file.owner, folder)))
      fail(
        `${repository}: no license file applies to ${folder || "."}; complete supplied terms are required`,
      );
  const notices = [];
  for (const file of files) {
    if (file.mode === "120000") fail(`${repository}: symlinked notice ${file.path}`);
    const bytes = await objects.blob(file.sha);
    if (!Buffer.isBuffer(bytes)) fail(`${repository}: unreadable notice ${file.path}`);
    const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (hash !== file.sha) fail(`${repository}: notice hash mismatch for ${file.path}`);
    notices.push(noticeRecord(file.path, bytes));
  }
  return notices;
}
async function gitObjects(remote, commit, staging) {
  sourceInput(remote);
  const directory = await mkdtemp(join(staging, "objects-"));
  await run("git", ["init", "--quiet", "--bare", directory]);
  const git = (...args) =>
    run("git", ["--git-dir", directory, ...args], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
  await retryNetwork(() => git("fetch", "--quiet", "--depth=1", remote, commit));
  return {
    tree: async (revision) =>
      (await git("ls-tree", "-r", "-z", "--full-tree", revision)).stdout
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf("\t");
          const [mode, type, sha] = entry.slice(0, separator).split(" ");
          return { mode, type, sha, path: entry.slice(separator + 1) };
        }),
    blob: async (sha) => (await git("cat-file", "blob", sha)).stdout,
  };
}
async function snapshotNotices(path, listing) {
  const files = listing.records.filter(([name, kind]) => kind === "file" && noticeLocation(name));
  if (
    !files.some(([name]) => {
      const location = noticeLocation(name);
      return location.license && location.owner === "";
    })
  )
    fail(
      `${path}: missing complete supplied license terms in installed package; SPDX metadata or unlisted HTTP files are insufficient`,
    );
  return Promise.all(
    files.map(async ([name]) => noticeRecord(name, await readFile(join(path, name)))),
  );
}
function projectLicense(current) {
  const prefix = current.split(new RegExp(`^${heading}$`, "m"))[0].trimEnd();
  if (!prefix) fail("The project license must precede bundled skill notices");
  return `${prefix}\n`;
}
export function renderLicense(current, receipts) {
  const prefix = projectLicense(current);
  if (!receipts.length) return prefix;
  const sections = receipts
    .toSorted((a, b) => compare(a.name, b.name))
    .map((receipt) => {
      const { provenance } = receipt;
      const origin = receipt.origin.kind === "path" ? receipt.origin.path : receipt.origin.name;
      const observed =
        provenance.kind === "git"
          ? `Remote: ${provenance.remote}\nRevision: ${provenance.commit}\nGit path: ${provenance.path}`
          : `Source: ${provenance.source}\nInstalled-content SHA-256: ${provenance.digest}\nTransport: ${provenance.sourceType}`;
      const files = receipt.notices.map(
        ({ path, text }) =>
          `### ${path}\n\n${text
            .replace(/\n$/, "")
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n")}`,
      );
      return `## ${receipt.name}\n\nSource ID: ${receipt.sourceId}\nDeclared name: ${receipt.declaredName}\nOrigin: ${origin}\n${observed}\n\n${files.join("\n\n")}`;
    });
  return `${prefix}\n${heading}\n\nFull supplied license and attribution texts follow. License files inside skill copies are centralized here.\nInstalled-content digests identify observed packages, not authenticated releases.\n\n${sections.join("\n\n")}\n`;
}

function observedOrigin(skill) {
  if (skill.path !== undefined) return parseOrigin({ kind: "path", path: skill.path });
  return parseOrigin({ kind: "declared", name: skill.name });
}
function repositoryPath(root, path) {
  const local = relative(root, path).split(sep).join("/");
  if (local === "") return ".";
  if (!safeRelative(local))
    fail(
      "Local skill sources must stay inside the repository. Use ./my-skills or a remote Git URL.",
    );
  return `./${local}`;
}
async function repositorySource(root, input) {
  sourceInput(input);
  if (/^file:/i.test(input))
    fail("Local Git URLs are unsupported. Use a repository-relative path or a remote Git URL.");
  const local =
    isAbsolute(input) ||
    /^[a-z]:[/\\]/i.test(input) ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    (!input.includes("/") && !input.includes(":") && !input.includes("\\"));
  if (!local) return input;
  const path = resolve(root, input);
  const physicalRoot = await realpath(root);
  const physicalPath = await realpath(path).catch((error) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") repositoryPath(root, path);
    throw error;
  });
  return repositoryPath(physicalRoot, physicalPath);
}
function sourceBinding(source, policy) {
  sourceInput(source.url);
  if (source.subpath !== undefined && !safeRelative(source.subpath))
    fail("Unsafe SDK source subpath");
  if (
    gitTypes.has(source.type) &&
    (/^file:/i.test(source.url) || !/^(?:[a-z][a-z\d+.-]*:\/\/|[^/:\\]+:[^:])/i.test(source.url))
  )
    fail("Local Git sources are unsupported. Use a repository-relative path or a remote Git URL.");
  return {
    type: source.type,
    url: source.type === "local" ? policy.source : source.url,
    ...(source.subpath ? { subpath: source.subpath } : {}),
  };
}
async function matchesLegacyLocalBinding(previous, binding, absoluteSource) {
  if (
    binding.url === absoluteSource ||
    !isAbsolute(previous?.url ?? "") ||
    !equal(previous, { ...binding, url: previous.url })
  )
    return false;
  try {
    return (await realpath(previous.url)) === (await realpath(absoluteSource));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}
async function openSource(root, policy, previous) {
  const handle = await retryNetwork(() =>
    resolveSource(policy.source, {
      cwd: root,
      ...(policy.ref ? { ref: policy.ref } : {}),
      telemetry: false,
      onWarning: (warning) => {
        throw new Error(warning.message);
      },
    }),
  );
  try {
    const source = handle.source;
    if (source.type === "local") {
      const physicalRoot = await realpath(root);
      const local = repositoryPath(physicalRoot, await realpath(source.url));
      if (local !== policy.source)
        fail(`Local skill source changed during discovery: ${policy.source}`);
      for (const skill of handle.skills)
        for (const path of [skill.path, ...(skill.duplicates ?? [])]) {
          if (!safeRelative(path)) fail("Invalid local skill path");
          repositoryPath(physicalRoot, await realpath(resolve(source.url, path, "SKILL.md")));
        }
    }
    const binding = sourceBinding(source, policy);
    // Migrate an older absolute binding only when it identifies this checkout's source.
    if (
      previous &&
      !equal(previous.binding, binding) &&
      !(await matchesLegacyLocalBinding(previous.binding, binding, source.url))
    )
      fail(
        `Source ${policy.id} cannot be retargeted from ${json(previous.binding).trim()} to ${json(binding).trim()}`,
      );
    if (gitTypes.has(source.type)) {
      const ref = refPolicy(policy.ref ?? source.ref);
      if (!ref)
        fail(`${policy.source}: Git sources need --ref with a concrete branch, tag, or commit`);
      if (!/^[a-f0-9]{40,64}$/.test(source.commit ?? ""))
        fail(`${policy.source}: SDK did not provide a checked-out Git commit`);
      policy.ref = ref;
    }
    return { handle, binding };
  } catch (error) {
    await handle.dispose();
    throw error;
  }
}
const installOptions = (cwd, selector) => ({
  cwd,
  skills: [selector],
  scope: "project",
  agents: ["universal"],
  mode: "copy",
  duplicates: "error",
  symlinks: "reject",
  telemetry: false,
});
async function sdkReceipt(handle, selector, staging) {
  const sandbox = await mkdtemp(join(staging, "install-"));
  const result = await installSkills(handle, installOptions(sandbox, selector));
  if (result.failed.length || result.skipped.length || result.installed.length !== 1)
    fail(`Expected one successful skill receipt for ${selector}; ${JSON.stringify(result)}`);
  const target = result.installed[0];
  const path = resolve(target.path);
  const expectedParent = join(sandbox, ".agents", "skills");
  if (
    dirname(path) !== expectedParent ||
    !safeName(basename(path)) ||
    !(await lstat(path)).isDirectory()
  )
    fail(`Unsafe SDK installation target ${path}`);
  if (!(await lstat(join(path, "SKILL.md"))).isFile()) fail(`Missing regular SKILL.md at ${path}`);
  const listing = await inventory(path);
  const lock = JSON.parse(await readFile(join(sandbox, "skills-lock.json"), "utf8"));
  const entries = Object.entries(lock.skills ?? {});
  if (lock.version !== 2 || entries.length !== 1)
    fail(`Expected one SDK v2 lock record for ${selector}`);
  const [declaredName, sdk] = entries[0];
  const matches = handle.skills.filter((skill) => skill.name === target.skill);
  if (matches.length !== 1) fail(`Cannot bind installed declaration ${target.skill} to discovery`);
  if (!/^[a-f0-9]{64}$/.test(sdk.computedHash ?? ""))
    fail(`Missing SDK computedHash for ${selector}`);
  return { name: basename(path), declaredName, path, listing, sdk, skill: matches[0] };
}
async function installReceipt(handle, selector, policy, binding, staging, objects) {
  const receipt = await sdkReceipt(handle, selector, staging);
  const origin = observedOrigin(receipt.skill);
  const source = handle.source;
  let provenance;
  let notices;
  if (gitTypes.has(source.type)) {
    if (origin.kind !== "path")
      fail(`Git source has no discovered path for ${receipt.declaredName}`);
    const path = origin.path;
    if (
      posix.dirname(receipt.sdk.skillPath ?? "") !== path ||
      (source.subpath && !contains(source.subpath, path))
    )
      fail(`SDK Git path does not match the discovered origin for ${receipt.declaredName}`);
    provenance = { kind: "git", remote: source.url, commit: source.commit, ref: policy.ref, path };
    notices = await collectNotices(source.url, source.commit, [path], objects);
  } else {
    provenance = {
      kind: "installed-snapshot",
      source: binding.url,
      sourceType: receipt.sdk.sourceType,
      digest: receipt.listing.hash,
    };
    notices = await snapshotNotices(receipt.path, receipt.listing);
  }
  // The SDK writes local paths relative to its temporary install directory.
  if (binding.url !== source.url) receipt.sdk = { ...receipt.sdk, source: binding.url };
  const centralizedNotices = [];
  for (const [path, kind] of receipt.listing.records) {
    if (kind !== "file" || !noticeLocation(path)?.license) continue;
    const bytes = await readFile(join(receipt.path, path));
    const text = noticeText(bytes, path);
    const originalPath = provenance.kind === "git" ? posix.join(provenance.path, path) : path;
    if (
      !notices.some(
        (notice) =>
          notice.path === originalPath && notice.text === text && notice.sha256 === digest(bytes),
      )
    )
      fail(`Installed notice ${path} does not match the observed source notice`);
    await rm(join(receipt.path, path));
    centralizedNotices.push({ path, noticePath: originalPath, sha256: digest(bytes) });
  }
  for (const [path, kind] of receipt.listing.records.toReversed()) {
    if (kind !== "directory" || !path || (await readdir(join(receipt.path, path))).length) continue;
    if (path.split("/").some((part) => /^licen[cs]es$/i.test(part)))
      await rm(join(receipt.path, path), { recursive: true });
    else
      fail(
        `${policy.source}: Git cannot retain empty directory ${path} in ${receipt.declaredName}; add a tracked file or marker in the source`,
      );
  }
  // The SDK remains the authority for the hash after intentional packaging changes.
  if (centralizedNotices.length) {
    const local = await resolveSource(receipt.path);
    try {
      const published = await sdkReceipt(local, receipt.skill.name, staging);
      receipt.sdk = { ...receipt.sdk, computedHash: published.sdk.computedHash };
      if ((await fingerprint(published.path)) !== (await fingerprint(receipt.path)))
        fail("Local SDK hash receipt changed published bytes");
    } finally {
      await local.dispose();
    }
  }
  return {
    name: receipt.name,
    sourceId: policy.id,
    origin,
    declaredName: receipt.declaredName,
    provenance,
    installedDigest: receipt.listing.hash,
    treeHash: await fingerprint(receipt.path),
    sdkRecordHash: digest(json(receipt.sdk)),
    notices,
    centralizedNotices,
    sdk: receipt.sdk,
    path: receipt.path,
  };
}
function describe(receipt) {
  return `${receipt.sourceId} (${receipt.provenance?.remote ?? receipt.provenance?.source ?? "unknown source"}), declared ${JSON.stringify(receipt.declaredName)}, origin ${originKey(receipt.origin)}`;
}
function admit(receipts) {
  const names = new Map();
  const declarations = new Map();
  const origins = new Set();
  for (const receipt of receipts) {
    if (names.has(receipt.name))
      fail(
        `Skill name collision ${JSON.stringify(receipt.name)} between ${describe(names.get(receipt.name))} and ${describe(receipt)}`,
      );
    if (declarations.has(receipt.declaredName))
      fail(
        `SDK lock declaration collision ${JSON.stringify(receipt.declaredName)} between ${describe(declarations.get(receipt.declaredName))} and ${describe(receipt)}`,
      );
    const identity = `${receipt.sourceId}\0${originKey(receipt.origin)}`;
    if (origins.has(identity)) fail(`Duplicate origin ${describe(receipt)}`);
    names.set(receipt.name, receipt);
    declarations.set(receipt.declaredName, receipt);
    origins.add(identity);
  }
}

async function legacyOwnership(root, lock, manifest) {
  if (
    lock.version !== 2 ||
    !object(lock.skills) ||
    Object.keys(lock).some((key) => !["version", "skills"].includes(key))
  )
    fail("Unrecognized legacy lock; ownership cannot be bootstrapped");
  try {
    const { stdout } = await run(
      "git",
      ["ls-tree", "-r", "-z", "--full-tree", "HEAD", "--", ...artifacts],
      {
        cwd: root,
        encoding: "buffer",
      },
    );
    const tracked = new Map(
      stdout
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf("\t");
          const [mode, type, hash] = entry.slice(0, separator).split(" ");
          return [entry.slice(separator + 1), { mode, type, hash }];
        }),
    );
    const names = (await readdir(join(root, "skills"))).sort(compare);
    if (!equal(names, Object.keys(lock.skills).sort(compare)))
      fail("Legacy skills and lock do not match");
    for (const path of [...controlFiles, ...names.map((name) => `skills/${name}/SKILL.md`)])
      if (!tracked.has(path)) fail(`Legacy ownership is not tracked in Git HEAD at ${path}`);
    const directories = new Set(["skills"]);
    for (const path of tracked.keys()) {
      let parent = posix.dirname(path);
      while (parent !== ".") {
        directories.add(parent);
        parent = posix.dirname(parent);
      }
    }
    const observedFiles = new Set();
    for (const artifact of artifacts) {
      const listing = await inventory(join(root, artifact));
      if (!listing) fail(`Legacy artifact is missing at ${artifact}`);
      for (const [name, type, executable, encoded] of listing.records) {
        const path = name ? `${artifact}/${name}` : artifact;
        if (type === "directory") {
          if (!directories.has(path)) fail(`Untracked legacy directory at ${path}`);
          continue;
        }
        const entry = tracked.get(path);
        if (!entry) fail(`Untracked or ignored legacy content at ${path}`);
        const bytes = Buffer.from(encoded, "base64");
        const observed = createHash(entry.hash.length === 64 ? "sha256" : "sha1")
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest("hex");
        if (
          entry.type !== "blob" ||
          !["100644", "100755"].includes(entry.mode) ||
          executable !== (entry.mode === "100755" ? 0o111 : 0) ||
          observed !== entry.hash
        )
          fail(`Legacy file or executable bit differs from Git HEAD at ${path}`);
        observedFiles.add(path);
      }
    }
    if (observedFiles.size !== tracked.size)
      fail("Legacy tracked files are missing from Git HEAD snapshot");
    await run("git", ["diff", "--cached", "--exit-code", "HEAD", "--", ...artifacts], {
      cwd: root,
    });
    const owners = [];
    for (const [name, entry] of Object.entries(lock.skills)) {
      keys(
        entry,
        ["source", "ref", "sourceType", "skillPath", "computedHash", "installMode"],
        "legacy SDK record",
      );
      const policy = manifest.sources.find(
        (source) => source.source === entry.source && source.ref === entry.ref,
      );
      if (
        !safeName(name) ||
        !policy ||
        !gitTypes.has(entry.sourceType) ||
        !safeRelative(entry.skillPath) ||
        posix.basename(entry.skillPath) !== "SKILL.md" ||
        !/^[a-f0-9]{64}$/.test(entry.computedHash ?? "") ||
        entry.installMode !== "copy"
      )
        fail(`Legacy SDK record does not match configured source/ref/path for ${name}`);
      owners.push({
        name,
        sourceId: policy.id,
        origin: { kind: "path", path: posix.dirname(entry.skillPath) },
        declaredName: name,
        provenance: { remote: entry.source },
      });
    }
    return owners;
  } catch (error) {
    throw new Error(
      `Legacy migration requires a clean Git-tracked manifest, lock, LICENSE and mirror. Preserve or restore local changes first. ${error.message}`,
    );
  }
}
async function readState(root, command) {
  const baseline = await fingerprints(root);
  const controlModes = Object.fromEntries(
    await Promise.all(
      controlFiles.map(async (name) => [name, (await lstat(join(root, name))).mode & 0o111]),
    ),
  );
  const raw = JSON.parse(await readFile(join(root, "skills-sources.json"), "utf8"));
  const { manifest, legacy } = parseManifest(raw);
  const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
  const license = await readFile(join(root, "LICENSE"), "utf8");
  projectLicense(license);
  if (legacy) {
    const legacyOwners = await legacyOwnership(root, lock, manifest);
    if (command.type !== "sync")
      fail(
        "Run pnpm skills sync once to migrate the clean legacy snapshot and establish ownership receipts before add, remove, or list",
      );
    return {
      manifest,
      license,
      baseline,
      controlModes,
      receipts: [],
      bindings: {},
      legacyOwners,
      legacy: true,
    };
  }
  const repository = lock.repository;
  if (
    lock.version !== 2 ||
    repository?.version !== 1 ||
    repository.sdk !== "skills@1.8.1" ||
    !object(repository.installed) ||
    !object(repository.sources) ||
    !/^[a-f0-9]{64}$/.test(repository.manifestHash ?? "") ||
    !object(repository.controlModes) ||
    !equal(Object.keys(repository.controlModes).sort(compare), controlFiles.toSorted(compare)) ||
    Object.values(repository.controlModes).some(
      (mode) => !Number.isSafeInteger(mode) || mode < 0 || mode > 0o111 || (mode & ~0o111) !== 0,
    )
  )
    fail(
      "Damaged ownership extension in skills-lock.json. Restore the manager-generated lock; upstream SDK writers remove this extension",
    );
  for (const name of controlFiles)
    if (repository.controlModes[name] !== controlModes[name])
      fail(
        `Control-file executable bits changed at ${name}; preserve or restore it before managing skills`,
      );
  if (command.type !== "sync" && repository.manifestHash !== manifestHash(manifest))
    fail(
      "Source manifest has pending policy edits; run pnpm skills sync to reconcile them before add, remove or list",
    );
  if (repository.licenseHash !== digest(Buffer.from(license)))
    fail(
      "Root LICENSE changed outside the manager; preserve or restore the generated file before managing skills",
    );
  const entries = await readdir(join(root, "skills"));
  const names = Object.keys(repository.installed);
  const unmanaged = entries.filter((name) => !Object.hasOwn(repository.installed, name));
  if (unmanaged.length && command.type !== "add")
    fail(
      `Unmanaged content at ${join(root, "skills", unmanaged[0])}; move it before managing this repository`,
    );
  const receipts = [];
  for (const name of names) {
    const record = repository.installed[name];
    if (
      !safeName(name) ||
      !object(record) ||
      !present(record.sourceId) ||
      !present(record.declaredName) ||
      !Array.isArray(record.notices) ||
      !Array.isArray(record.centralizedNotices) ||
      !object(record.provenance) ||
      !Object.hasOwn(repository.sources, record.sourceId)
    )
      fail(`Damaged ownership receipt for ${name}`);
    parseOrigin(record.origin);
    if (
      record.notices.some(
        (notice) =>
          !object(notice) ||
          !safeRelative(notice.path) ||
          !present(notice.text) ||
          notice.sha256 !== digest(Buffer.from(notice.text)),
      ) ||
      new Set(record.notices.map((notice) => notice.path)).size !== record.notices.length
    )
      fail(`Damaged notice receipt for ${name}`);
    const path = join(root, "skills", name);
    if ((await fingerprint(path)) !== record.treeHash)
      fail(
        `Managed content changed or missing at ${path}; preserve or restore it before managing skills`,
      );
    const sdk = lock.skills?.[record.declaredName];
    if (!object(sdk) || !/^[a-f0-9]{64}$/.test(sdk.computedHash ?? ""))
      fail(`Missing SDK lock record for ${name}`);
    if (record.sdkRecordHash !== digest(json(sdk))) fail(`SDK lock record changed for ${name}`);
    const binding = repository.sources[record.sourceId]?.binding;
    if (!object(binding) || !present(binding.url)) fail(`Damaged source binding for ${name}`);
    if (record.provenance.kind === "git") {
      if (
        !gitTypes.has(binding.type) ||
        record.provenance.remote !== binding.url ||
        record.origin.kind !== "path" ||
        record.provenance.path !== record.origin.path ||
        !/^[a-f0-9]{40,64}$/.test(record.provenance.commit ?? "")
      )
        fail(`Damaged Git provenance for ${name}`);
    } else if (
      record.provenance.kind !== "installed-snapshot" ||
      record.provenance.source !== binding.url ||
      record.provenance.digest !== record.installedDigest
    )
      fail(`Damaged installed-snapshot provenance for ${name}`);
    if (
      record.centralizedNotices.some(
        (removed) =>
          !object(removed) ||
          !safeRelative(removed.path) ||
          !noticeLocation(removed.path)?.license ||
          removed.noticePath !==
            (record.provenance.kind === "git"
              ? posix.join(record.origin.path, removed.path)
              : removed.path) ||
          !record.notices.some(
            (notice) => notice.path === removed.noticePath && notice.sha256 === removed.sha256,
          ),
      ) ||
      new Set(record.centralizedNotices.map((notice) => notice.path)).size !==
        record.centralizedNotices.length
    )
      fail(`Damaged centralized notice receipt for ${name}`);
    receipts.push({ ...record, name, sdk, path });
  }
  if (
    !equal(
      Object.keys(lock.skills).sort(compare),
      receipts.map((receipt) => receipt.declaredName).sort(compare),
    )
  )
    fail("SDK lock and ownership receipt sets differ");
  if (command.type !== "sync") validateAssociations(manifest, repository.sources, receipts);
  admit(receipts);
  if (renderLicense(license, receipts) !== license)
    fail("Notice ledger and root LICENSE differ; restore the generated lock and license together");
  return {
    manifest,
    license,
    baseline,
    controlModes,
    receipts,
    bindings: repository.sources,
    unmanaged,
    legacy: false,
  };
}

async function deadOwner(lockPath) {
  if (!(await lstat(lockPath)).isDirectory()) fail(`Unsafe repository lock at ${lockPath}`);
  let owner;
  try {
    owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"));
  } catch {
    fail(`Cannot establish lock ownership at ${lockPath}; inspect it before retrying`);
  }
  if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    fail(`Lock owner cannot be proven dead at ${lockPath}`);
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return owner;
    throw error;
  }
  fail(`A repository command is running with PID ${owner.pid}`);
}
export async function recoverPublication(root, journalPath, move = rename) {
  if (!(await lstat(journalPath)).isFile()) fail(`Unsafe publication journal ${journalPath}`);
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const stage = resolve(root, journal.stage);
  if (
    journal.version !== 1 ||
    !["prepared", "committed"].includes(journal.state) ||
    dirname(stage) !== root ||
    !basename(stage).startsWith(".skills-sync-stage-") ||
    !equal(Object.keys(journal.old), artifacts) ||
    !equal(Object.keys(journal.next), artifacts)
  )
    fail(`Invalid publication journal ${journalPath}`);
  if (!(await lstat(stage)).isDirectory() || !(await lstat(join(stage, "backup"))).isDirectory())
    fail(`Unsafe recovery directories at ${stage}`);
  for (const value of [...Object.values(journal.old), ...Object.values(journal.next)])
    if (value !== null && !/^[a-f0-9]{64}$/.test(value))
      fail(`Invalid publication fingerprint at ${journalPath}`);
  const current = await fingerprints(root);
  const backups = await fingerprints(join(stage, "backup"));
  for (const name of artifacts) {
    const old = journal.old[name];
    const next = journal.next[name];
    if (journal.state === "committed") {
      if (current[name] !== next)
        fail(`Committed publication changed at ${name}; recovery retained at ${stage}`);
    } else {
      if (current[name] !== null && current[name] !== old && current[name] !== next)
        fail(`Manual edit at ${name}; recovery will not overwrite it. Evidence: ${stage}`);
      if (backups[name] !== null && backups[name] !== old)
        fail(`Backup changed at ${name}; recovery retained at ${stage}`);
      if (old !== null && current[name] !== old && backups[name] !== old)
        fail(`Original ${name} unavailable; recovery retained at ${stage}`);
    }
  }
  if (journal.state !== "committed") {
    const failures = [];
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
async function acquire(root) {
  const path = join(root, ".skills-sync-lock");
  try {
    await mkdir(path);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    await deadOwner(path);
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
export async function publishSnapshot(root, staging, baseline, move = rename) {
  const lockPath = join(root, ".skills-sync-lock");
  const journalPath = join(lockPath, "journal.json");
  const next = await fingerprints(staging);
  if (Object.values(next).some((value) => value === null)) fail("Incomplete staged publication");
  if (!equal(await fingerprints(root), baseline))
    fail("Publication artifacts changed during staging; no files were replaced");
  await mkdir(join(staging, "backup"));
  const journal = {
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
    journal.state = "committed";
    await durableJSON(journalPath, journal);
  } catch (error) {
    try {
      await recoverPublication(root, journalPath, move);
    } catch (failure) {
      throw new AggregateError([error, failure], `${error.message}\n${failure.message}`);
    }
    throw error;
  }
  await rm(journalPath);
}

function nextSourceId(sources) {
  let number = 1;
  while (sources.some((source) => source.id === `source-${number}`)) number++;
  return `source-${number}`;
}
function active(policy, origin) {
  const key = originKey(origin);
  return policy.selection.mode === "all"
    ? !policy.selection.exclude.some((value) => originKey(value) === key)
    : policy.selection.origins.some((value) => originKey(value) === key);
}
function validateAssociations(manifest, bindings, receipts) {
  const policies = new Map(manifest.sources.map((policy) => [policy.id, policy]));
  if (!equal(Object.keys(bindings).sort(compare), [...policies.keys()].sort(compare)))
    fail("Source policy and binding sets differ");
  for (const policy of policies.values()) {
    const source = bindings[policy.id];
    if (
      !object(source) ||
      source.input !== policy.source ||
      !object(source.binding) ||
      !present(source.binding.type) ||
      !present(source.binding.url) ||
      (source.binding.subpath !== undefined && !safeRelative(source.binding.subpath))
    )
      fail(`Damaged source binding for ${policy.id}`);
  }
  for (const receipt of receipts) {
    const policy = policies.get(receipt.sourceId);
    if (!policy || !active(policy, receipt.origin))
      fail(`Receipt has no active selected origin in its source policy: ${describe(receipt)}`);
  }
}
async function resolveSelection(root, policy, prior, command, staging) {
  const { handle, binding } = await openSource(root, policy, prior);
  try {
    const discovered = handle.skills.map((skill) => ({ skill, origin: observedOrigin(skill) }));
    let selectors;
    if (command.type === "add")
      selectors = command.all ? discovered.map(({ skill }) => skill.name) : command.skills;
    else {
      if (policy.selection.mode === "include")
        for (const origin of policy.selection.origins)
          if (!discovered.some((item) => originKey(item.origin) === originKey(origin)))
            fail(`Selected origin disappeared from ${policy.id}: ${originKey(origin)}`);
      selectors = discovered
        .filter(({ origin }) => active(policy, origin))
        .map(({ skill }) => skill.name);
    }
    const objects =
      selectors.length && gitTypes.has(handle.source.type)
        ? await gitObjects(handle.source.url, handle.source.commit, staging)
        : undefined;
    const receipts = [];
    for (const selector of selectors)
      receipts.push(await installReceipt(handle, selector, policy, binding, staging, objects));
    admit(receipts);
    return { receipts, binding: { input: policy.source, binding } };
  } finally {
    await handle.dispose();
  }
}
async function available(root, manifest, command) {
  const source = await repositorySource(root, command.source);
  const known = manifest.sources.find((policy) => policy.source === source);
  if (known && command.ref !== undefined && command.ref !== known.ref)
    fail(`Source ${known.id} uses ref ${known.ref}; change its manifest policy explicitly`);
  const policy = { source, ref: command.ref ?? known?.ref };
  const { handle } = await openSource(root, policy);
  try {
    return {
      available: handle.skills.map((skill) => ({
        name: skill.name,
        origin: observedOrigin(skill),
        ...(skill.duplicates ? { duplicates: skill.duplicates } : {}),
      })),
      source: handle.source,
    };
  } finally {
    await handle.dispose();
  }
}
export async function manageRepository(directory, command = { type: "sync" }) {
  const root = resolve(directory);
  const lockPath = await acquire(root);
  let staging;
  try {
    const state = await readState(root, command);
    if (command.type === "available") return await available(root, state.manifest, command);
    if (command.type === "list")
      return {
        sources: state.manifest.sources,
        installed: state.receipts.map(({ name, sourceId, origin, declaredName, provenance }) => ({
          name,
          sourceId,
          origin,
          declaredName,
          provenance,
        })),
      };
    staging = await mkdtemp(join(root, ".skills-sync-stage-"));
    const manifest = structuredClone(state.manifest);
    let receipts = [...state.receipts];
    const bindings = structuredClone(state.bindings);
    if (command.type === "remove") {
      let removed;
      if (command.sourceId) {
        if (!manifest.sources.some((source) => source.id === command.sourceId))
          fail(`Unknown source ID ${command.sourceId}`);
        removed = receipts.filter((receipt) => receipt.sourceId === command.sourceId);
        manifest.sources = manifest.sources.filter((source) => source.id !== command.sourceId);
        delete bindings[command.sourceId];
      } else {
        for (const name of command.names)
          if (!receipts.some((receipt) => receipt.name === name))
            fail(`Unknown installed skill ${name}`);
        removed = receipts.filter((receipt) => command.names.includes(receipt.name));
        for (const receipt of removed) {
          const policy = manifest.sources.find((source) => source.id === receipt.sourceId);
          if (!policy)
            fail(`Source policy missing for ${receipt.name}; run sync after editing manifest`);
          const key = originKey(receipt.origin);
          if (policy.selection.mode === "all")
            policy.selection.exclude = parseOrigins([
              ...policy.selection.exclude.filter((value) => originKey(value) !== key),
              receipt.origin,
            ]);
          else
            policy.selection.origins = policy.selection.origins.filter(
              (value) => originKey(value) !== key,
            );
        }
      }
      const names = new Set(removed.map((receipt) => receipt.name));
      receipts = receipts.filter((receipt) => !names.has(receipt.name));
    } else if (command.type === "add") {
      const source = await repositorySource(root, command.source);
      refPolicy(command.ref);
      let policy = manifest.sources.find((policy) => policy.source === source);
      const existing = Boolean(policy);
      if (existing && command.ref !== undefined && command.ref !== policy.ref)
        fail(`Source ${policy.id} uses ref ${policy.ref}; change its manifest policy explicitly`);
      if (existing && command.all)
        fail(
          `Source ${policy.id} is already configured; add named unselected skills or remove the source first`,
        );
      if (!policy) {
        policy = {
          id: nextSourceId(manifest.sources),
          source,
          ...(command.ref ? { ref: command.ref } : {}),
          selection: command.all ? { mode: "all", exclude: [] } : { mode: "include", origins: [] },
        };
        manifest.sources.push(policy);
      }
      const result = await resolveSelection(root, policy, bindings[policy.id], command, staging);
      for (const receipt of result.receipts) {
        if (existing && active(policy, receipt.origin))
          fail(
            `Duplicate add of active origin ${describe(receipt)}; use pnpm skills sync to refresh`,
          );
        if (policy.selection.mode === "all")
          policy.selection.exclude = policy.selection.exclude.filter(
            (value) => originKey(value) !== originKey(receipt.origin),
          );
        else policy.selection.origins = parseOrigins([...policy.selection.origins, receipt.origin]);
      }
      receipts.push(...result.receipts);
      bindings[policy.id] = result.binding;
    } else if (command.type === "sync") {
      receipts = [];
      for (const policy of manifest.sources) {
        policy.source = await repositorySource(root, policy.source);
        const result = await resolveSelection(root, policy, bindings[policy.id], command, staging);
        receipts.push(...result.receipts);
        bindings[policy.id] = result.binding;
      }
    } else fail(`Unknown repository command ${command.type}`);
    for (const name of state.unmanaged ?? []) {
      const candidate = receipts.find((receipt) => receipt.name === name);
      if (candidate)
        fail(
          `Skill name collision ${JSON.stringify(name)} between unmanaged ${join(root, "skills", name)} and ${describe(candidate)}`,
        );
    }
    if (state.unmanaged?.length)
      fail(
        `Unmanaged content at ${join(root, "skills", state.unmanaged[0])}; move it before managing this repository`,
      );
    admit(receipts);
    for (const previous of state.legacyOwners ?? [])
      if (
        !receipts.some(
          (receipt) =>
            receipt.sourceId === previous.sourceId &&
            originKey(receipt.origin) === originKey(previous.origin),
        )
      )
        fail(
          `Legacy origin for ${previous.name} disappeared from ${describe(previous)}; preserve the snapshot and resolve migration explicitly`,
        );
    for (const receipt of receipts) {
      const previous = [...state.receipts, ...(state.legacyOwners ?? [])].find(
        (entry) => entry.name === receipt.name,
      );
      if (
        previous &&
        (previous.sourceId !== receipt.sourceId ||
          originKey(previous.origin) !== originKey(receipt.origin))
      )
        fail(
          `Skill name collision ${JSON.stringify(receipt.name)} between current ${describe(previous)} and candidate ${describe(receipt)}`,
        );
    }
    for (const id of Object.keys(bindings))
      if (!manifest.sources.some((source) => source.id === id)) delete bindings[id];
    validateAssociations(manifest, bindings, receipts);
    await mkdir(join(staging, "skills"));
    const installed = Object.create(null);
    const sdkSkills = Object.create(null);
    for (const receipt of receipts.toSorted((a, b) => compare(a.name, b.name))) {
      await cp(receipt.path, join(staging, "skills", receipt.name), {
        recursive: true,
        preserveTimestamps: true,
      });
      if ((await fingerprint(join(staging, "skills", receipt.name))) !== receipt.treeHash)
        fail(`Staged copy changed ${receipt.name}`);
      const { name, path, sdk, ...record } = receipt;
      installed[name] = record;
      sdkSkills[receipt.declaredName] = sdk;
    }
    const license = renderLicense(state.license, receipts);
    const lock = {
      version: 2,
      skills: Object.fromEntries(Object.entries(sdkSkills).sort(([a], [b]) => compare(a, b))),
      repository: {
        version: 1,
        sdk: "skills@1.8.1",
        sources: bindings,
        installed,
        manifestHash: manifestHash(manifest),
        controlModes: state.controlModes,
        licenseHash: digest(Buffer.from(license)),
      },
    };
    await writeFile(join(staging, "skills-sources.json"), json(parseManifest(manifest).manifest));
    await writeFile(join(staging, "skills-lock.json"), json(lock));
    await writeFile(join(staging, "LICENSE"), license);
    for (const name of controlFiles)
      await chmod(join(staging, name), 0o644 | state.controlModes[name]);
    await publishSnapshot(root, staging, state.baseline);
    return { sources: manifest.sources.length, skills: receipts.length };
  } finally {
    const pending = await exists(join(lockPath, "journal.json"));
    if (!pending) {
      if (staging) await rm(staging, { recursive: true, force: true });
      await rm(lockPath, { recursive: true, force: true });
    }
  }
}
