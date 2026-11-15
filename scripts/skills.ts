import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import ignore from "ignore";
import { installSkills, resolveSource } from "skills";
import type { InstallOptions, SkillInfo, SkillSource, SourceInfo } from "skills";
import { artifacts, bundledNoticesFile } from "./manager-types.ts";
import type {
  AddCommand,
  ArtifactFile,
  AvailableCommand,
  BoundSource,
  ExternalProvenance,
  ExternalReceipt,
  GitObjects,
  Inventory,
  InventoryRecord,
  LegacyOwner,
  Manifest,
  Notice,
  Origin,
  PreparedLocalSkill,
  PublicationResult,
  PublishLocalArtifactsOptions,
  PublishRules,
  Receipt,
  RepositoryCommand,
  RepositoryState,
  SkillsLock,
  SourceBinding,
  SourcePolicy,
  WorkspaceBuildReceipt,
} from "./manager-types.ts";
import {
  acquire,
  controlFiles,
  exists,
  fingerprint,
  fingerprints,
  inventory,
  preserveControlModes,
  publishSnapshot,
  readControlModes,
} from "./manager-transaction.ts";
import {
  compare,
  digest,
  equal,
  errorMessage,
  fail,
  hasCode,
  isHash,
  json,
  keys,
  object,
  parseJSON,
  present,
  record,
  safeName,
  safeRelative,
} from "./manager-shared.ts";
import {
  gitTypes,
  originKey,
  parseFiles,
  parseManifest,
  parseNotices,
  parseOrigin,
  parseOrigins,
  parseRepositoryLock,
  parseSdkSkills,
  parseToolchain,
  refPolicy,
  sourceInput,
} from "./manager-schema.ts";
export { inventory, publishSnapshot, recoverPublication } from "./manager-transaction.ts";
export type {
  ArtifactFile,
  PreparedLocalSkill,
  PublishLocalArtifactsOptions,
  PublicationResult,
} from "./manager-types.ts";

const run = promisify(execFile);
const contains = (parent: string, child: string): boolean =>
  !parent || child === parent || child.startsWith(`${parent}/`);
function manifestHash(manifest: Manifest): string {
  const normalized = parseManifest(manifest).manifest;
  return digest(
    json({ ...normalized, sources: normalized.sources.toSorted((a, b) => compare(a.id, b.id)) }),
  );
}
async function retryNetwork<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt === 2 ||
        !/SSL_connect|SSL_ERROR_SYSCALL|TLS|ECONNRESET|connection reset|timed? out|Could not resolve|HTTP (?:429|5\d\d)/i.test(
          errorMessage(error),
        )
      )
        throw error;
      await setTimeout(500 * 2 ** attempt);
    }
  }
}

function noticeLocation(path: string): { owner: string; license: boolean } | undefined {
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
async function readPublishRules(root: string): Promise<PublishRules> {
  const patterns = await readFile(join(root, ".skillsignore"), "utf8").catch((error) => {
    if (hasCode(error, "ENOENT")) return "";
    throw error;
  });
  const rules = ignore({ ignorecase: true }).add(patterns);
  return (path, kind = "file") => rules.ignores(kind === "directory" ? `${path}/` : path);
}
function noticeText(bytes: Uint8Array, label: string): string {
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
function noticeRecord(path: string, bytes: Uint8Array): Notice {
  return { path, text: noticeText(bytes, path), sha256: digest(bytes) };
}
export async function collectNotices(
  repository: string,
  commit: string,
  skillPaths: readonly string[],
  objects: GitObjects,
  isIgnored: PublishRules = () => false,
) {
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
          (folder) =>
            (contains(location.owner, folder) || contains(folder, location.owner)) &&
            (!contains(folder, entry.path) || !isIgnored(posix.relative(folder, entry.path))),
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
async function gitObjects(remote: string, commit: string, staging: string): Promise<GitObjects> {
  sourceInput(remote);
  const directory = await mkdtemp(join(staging, "objects-"));
  await run("git", ["init", "--quiet", "--bare", directory]);
  const git = (...args: string[]) =>
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
async function snapshotNotices(
  path: string,
  records: readonly InventoryRecord[],
): Promise<Notice[]> {
  const files = records.filter(([name, kind]) => kind === "file" && noticeLocation(name));
  if (
    !files.some(([name]) => {
      const location = noticeLocation(name);
      return location?.license === true && location.owner === "";
    })
  )
    fail(
      `${path}: missing complete supplied license terms in installed package; SPDX metadata or unlisted HTTP files are insufficient`,
    );
  return Promise.all(
    files.map(async ([name]) => noticeRecord(name, await readFile(join(path, name)))),
  );
}
export function renderNotices(receipts: readonly Receipt[]): string {
  const sections = receipts
    .toSorted((a, b) => compare(a.name, b.name))
    .map((receipt) => {
      let observed: string;
      if (receipt.kind === "external") {
        const { provenance } = receipt;
        const origin = receipt.origin.kind === "path" ? receipt.origin.path : receipt.origin.name;
        const source =
          provenance.kind === "git"
            ? `Remote: ${provenance.remote}\nRevision: ${provenance.commit}\nGit path: ${provenance.path}`
            : `Source: ${provenance.source}\nInstalled-content SHA-256: ${provenance.digest}\nTransport: ${provenance.sourceType}`;
        observed = `Source ID: ${receipt.sourceId}\nDeclared name: ${receipt.declaredName}\nOrigin: ${origin}\n${source}`;
      } else {
        observed = `Workspace package: ./${receipt.packageDir}\nDeclared name: ${receipt.declaredName}\nInput SHA-256: ${receipt.inputHash}\nToolchain: ${JSON.stringify(receipt.toolchain)}`;
      }
      const files = receipt.notices.map(
        ({ path, text }) =>
          `### ${path}\n\n${text
            .replace(/\n$/, "")
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n")}`,
      );
      return `## ${receipt.name}\n\n${observed}\n\n${files.join("\n\n")}`;
    });
  return `# Licenses of bundled skills\n\nFull supplied license and attribution texts for the bundled skills follow.\nInstalled-content digests identify observed packages, not authenticated releases.\n\n${sections.join("\n\n")}\n`;
}

function observedOrigin(skill: SkillInfo): Origin {
  if (skill.path !== undefined) return parseOrigin({ kind: "path", path: skill.path });
  return parseOrigin({ kind: "declared", name: skill.name });
}
function repositoryPath(root: string, path: string): string {
  const local = relative(root, path).split(sep).join("/");
  if (local === "") return ".";
  if (!safeRelative(local))
    fail(
      "Local skill sources must stay inside the repository. Use ./my-skills or a remote Git URL.",
    );
  return `./${local}`;
}
async function repositorySource(root: string, input: string): Promise<string> {
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
    if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) repositoryPath(root, path);
    throw error;
  });
  return repositoryPath(physicalRoot, physicalPath);
}
function sourceBinding(source: SourceInfo, policy: Pick<SourcePolicy, "source">): SourceBinding {
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
async function matchesLegacyLocalBinding(
  previous: SourceBinding | undefined,
  binding: SourceBinding,
  absoluteSource: string,
): Promise<boolean> {
  if (
    binding.url === absoluteSource ||
    previous === undefined ||
    !isAbsolute(previous.url) ||
    !equal(previous, { ...binding, url: previous.url })
  )
    return false;
  try {
    return (await realpath(previous.url)) === (await realpath(absoluteSource));
  } catch (error) {
    if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) return false;
    throw error;
  }
}
async function openSource(
  root: string,
  policy: Pick<SourcePolicy, "source" | "ref"> & { id?: string },
  previous?: BoundSource,
) {
  const handle = await retryNetwork(() =>
    resolveSource(policy.source, {
      cwd: root,
      ...(policy.ref ? { ref: policy.ref } : {}),
      config: { telemetry: false },
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
const installOptions = (cwd: string, selector: string): InstallOptions => ({
  cwd,
  skills: [selector],
  scope: "project",
  agents: ["universal"],
  mode: "copy",
  duplicates: "error",
  symlinks: "reject",
  config: { telemetry: false },
});
async function sdkReceipt(handle: SkillSource, selector: string, staging: string) {
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
  if (!listing) fail(`Missing installed tree at ${path}`);
  const lock = record(
    parseJSON(await readFile(join(sandbox, "skills-lock.json"), "utf8")),
    "SDK lock",
  );
  const entries = Object.entries(parseSdkSkills(lock.skills));
  if (lock.version !== 2 || entries.length !== 1)
    fail(`Expected one SDK v2 lock record for ${selector}`);
  const [declaredName, sdk] = entries[0];
  const matches = handle.skills.filter((skill) => skill.name === target.skill);
  if (matches.length !== 1) fail(`Cannot bind installed declaration ${target.skill} to discovery`);
  if (!/^[a-f0-9]{64}$/.test(sdk.computedHash ?? ""))
    fail(`Missing SDK computedHash for ${selector}`);
  return { name: basename(path), declaredName, path, listing, sdk, skill: matches[0] };
}
async function installReceipt(
  handle: SkillSource,
  selector: string,
  policy: SourcePolicy,
  binding: SourceBinding,
  staging: string,
  objects: GitObjects | undefined,
  isIgnored: PublishRules,
): Promise<ExternalReceipt> {
  const receipt = await sdkReceipt(handle, selector, staging);
  if (isIgnored("SKILL.md")) fail(`.skillsignore excludes required SKILL.md for ${selector}`);
  const ignored = new Set(
    receipt.listing.records
      .filter(([path, kind]) => path && isIgnored(path, kind))
      .map(([path]) => path),
  );
  const retained = receipt.listing.records.filter(([path]) => !ignored.has(path));
  const origin = observedOrigin(receipt.skill);
  const source = handle.source;
  let provenance: ExternalProvenance;
  let notices: Notice[];
  if (gitTypes.has(source.type)) {
    if (origin.kind !== "path")
      fail(`Git source has no discovered path for ${receipt.declaredName}`);
    const path = origin.path;
    if (!source.commit || !policy.ref || !objects) fail("Missing checked-out Git evidence");
    if (
      posix.dirname(receipt.sdk.skillPath ?? "") !== path ||
      (source.subpath && !contains(source.subpath, path))
    )
      fail(`SDK Git path does not match the discovered origin for ${receipt.declaredName}`);
    provenance = { kind: "git", remote: source.url, commit: source.commit, ref: policy.ref, path };
    notices = await collectNotices(source.url, source.commit, [path], objects, isIgnored);
  } else {
    provenance = {
      kind: "installed-snapshot",
      source: binding.url,
      sourceType: receipt.sdk.sourceType,
      digest: receipt.listing.hash,
    };
    notices = await snapshotNotices(receipt.path, retained);
  }
  // The SDK writes local paths relative to its temporary install directory.
  if (binding.url !== source.url) receipt.sdk = { ...receipt.sdk, source: binding.url };
  const centralizedNotices = [];
  for (const [path, kind] of retained) {
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
  const prunedParents = new Set<string>();
  for (const [path, kind] of receipt.listing.records.toReversed()) {
    if (!path) continue;
    const parent = posix.dirname(path);
    if (ignored.has(parent)) continue;
    const absolute = join(receipt.path, path);
    if (ignored.has(path)) {
      await rm(absolute, { recursive: kind === "directory" });
      prunedParents.add(parent);
      continue;
    }
    if (kind !== "directory" || (await readdir(absolute)).length) continue;
    if (prunedParents.has(path)) {
      await rm(absolute, { recursive: true });
      prunedParents.add(parent);
    } else if (path.split("/").some((part) => /^licen[cs]es$/i.test(part))) {
      await rm(absolute, { recursive: true });
    } else {
      fail(
        `${policy.source}: Git cannot retain empty directory ${path} in ${receipt.declaredName}; add a tracked file or marker in the source`,
      );
    }
  }
  // The SDK remains the authority for the hash after intentional packaging changes.
  if (centralizedNotices.length || ignored.size) {
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
  const treeHash = await fingerprint(receipt.path);
  if (treeHash === null) fail("Installed skill disappeared during staging");
  return {
    kind: "external",
    name: receipt.name,
    sourceId: policy.id,
    origin,
    declaredName: receipt.declaredName,
    provenance,
    installedDigest: receipt.listing.hash,
    treeHash,
    sdkRecordHash: digest(json(receipt.sdk)),
    notices,
    centralizedNotices,
    sdk: receipt.sdk,
    path: receipt.path,
  };
}
function describe(receipt: Receipt | LegacyOwner): string {
  if (receipt.kind === "workspace-build")
    return `workspace package ./${receipt.packageDir}, declared ${JSON.stringify(receipt.declaredName)}`;
  const source =
    "remote" in receipt.provenance ? receipt.provenance.remote : receipt.provenance.source;
  return `${receipt.sourceId} (${source}), declared ${JSON.stringify(receipt.declaredName)}, origin ${originKey(receipt.origin)}`;
}
function sameOwner(a: Receipt | LegacyOwner, b: Receipt | LegacyOwner): boolean {
  if (a.kind === "external" && b.kind === "external")
    return a.sourceId === b.sourceId && originKey(a.origin) === originKey(b.origin);
  return (
    a.kind === "workspace-build" && b.kind === "workspace-build" && a.packageDir === b.packageDir
  );
}
function admit(receipts: readonly Receipt[]): void {
  const names = new Map<string, Receipt>();
  const declarations = new Map<string, Receipt>();
  const origins = new Set<string>();
  for (const receipt of receipts) {
    const nameOwner = names.get(receipt.name);
    if (nameOwner)
      fail(
        `Skill name collision ${JSON.stringify(receipt.name)} between ${describe(nameOwner)} and ${describe(receipt)}`,
      );
    const declaredOwner = declarations.get(receipt.declaredName);
    if (declaredOwner)
      fail(
        `SDK lock declaration collision ${JSON.stringify(receipt.declaredName)} between ${describe(declaredOwner)} and ${describe(receipt)}`,
      );
    const identity =
      receipt.kind === "external"
        ? `${receipt.sourceId}\0${originKey(receipt.origin)}`
        : `workspace\0${receipt.packageDir}`;
    if (origins.has(identity)) fail(`Duplicate origin ${describe(receipt)}`);
    names.set(receipt.name, receipt);
    declarations.set(receipt.declaredName, receipt);
    origins.add(identity);
  }
}

async function legacyOwnership(
  root: string,
  lock: unknown,
  manifest: Manifest,
): Promise<LegacyOwner[]> {
  if (
    !object(lock) ||
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
    const observedFiles = new Set<string>();
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
    const owners: LegacyOwner[] = [];
    for (const [name, entry] of Object.entries(parseSdkSkills(lock.skills))) {
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
        kind: "external",
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
      `Legacy migration requires a clean Git-tracked manifest, lock, LICENSE and mirror. Preserve or restore local changes first. ${errorMessage(error)}`,
    );
  }
}
function fileManifest(listing: Inventory): ArtifactFile[] {
  return listing.records
    .filter(([, kind]) => kind === "file")
    .map(([path, , executable, encoded]) => ({
      path,
      sha256: digest(Buffer.from(encoded, "base64")),
      executable: executable !== 0,
    }))
    .toSorted((a, b) => compare(a.path, b.path));
}
async function readState(
  root: string,
  command: RepositoryCommand | { type: "local-build" },
): Promise<RepositoryState> {
  const baseline = await fingerprints(root);
  const controlModes = await readControlModes(root);
  const { manifest, legacy } = parseManifest(
    parseJSON(await readFile(join(root, "skills-sources.json"), "utf8")),
  );
  const lock = record(
    parseJSON(await readFile(join(root, "skills-lock.json"), "utf8")),
    "skills lock",
  );
  const license = await readFile(join(root, "LICENSE"));
  if (!license.toString("utf8").trim()) fail("Root LICENSE is empty");
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
      unmanaged: [],
      legacy: true,
    };
  }
  if (lock.version !== 2) fail("Expected SDK v2 outer lock schema");
  const repository = parseRepositoryLock(lock.repository);
  const sdkSkills = parseSdkSkills(lock.skills);
  for (const name of controlFiles)
    if (repository.controlModes[name] !== controlModes[name])
      fail(
        `Control-file executable bits changed at ${name}; preserve or restore it before managing skills`,
      );
  if (command.type !== "sync" && repository.manifestHash !== manifestHash(manifest))
    fail(
      "Source manifest has pending policy edits; run pnpm skills sync to reconcile them before add, remove or list",
    );
  if (repository.licenseHash !== digest(license))
    fail("Root LICENSE changed since its hash was recorded in skills-lock.json");
  const entries = await readdir(join(root, "skills"));
  const unmanaged = entries.filter(
    (name) => name !== basename(bundledNoticesFile) && !Object.hasOwn(repository.installed, name),
  );
  if (unmanaged.length && command.type !== "add")
    fail(
      `Unmanaged content at ${join(root, "skills", unmanaged[0])}; move it before managing this repository`,
    );
  const receipts: Receipt[] = [];
  for (const [name, owned] of Object.entries(repository.installed)) {
    if (!safeName(name)) fail(`Damaged ownership receipt for ${name}`);
    const path = join(root, "skills", name);
    const listing = await inventory(path);
    if (!listing || listing.hash !== owned.treeHash)
      fail(
        `Managed content changed or missing at ${path}; preserve or restore it before managing skills`,
      );
    const sdk = sdkSkills[owned.declaredName];
    if (!sdk) fail(`Missing SDK lock record for ${name}`);
    if (owned.sdkRecordHash !== digest(json(sdk))) fail(`SDK lock record changed for ${name}`);
    if (owned.kind === "external") {
      const binding = repository.sources[owned.sourceId]?.binding;
      if (!binding) fail(`Damaged source binding for ${name}`);
      if (owned.provenance.kind === "git") {
        if (
          !gitTypes.has(binding.type) ||
          owned.provenance.remote !== binding.url ||
          owned.origin.kind !== "path" ||
          owned.provenance.path !== owned.origin.path
        )
          fail(`Damaged Git provenance for ${name}`);
      } else if (
        owned.provenance.source !== binding.url ||
        owned.provenance.digest !== owned.installedDigest
      )
        fail(`Damaged installed-snapshot provenance for ${name}`);
    } else if (
      owned.packageDir === "." ||
      sdk.sourceType !== "local" ||
      sdk.source !== `./skills/${name}` ||
      !equal(fileManifest(listing), owned.files)
    )
      fail(`Damaged workspace build receipt for ${name}`);
    for (const removed of owned.centralizedNotices) {
      const noticePath =
        owned.kind === "external" && owned.provenance.kind === "git"
          ? posix.join(owned.provenance.path, removed.path)
          : removed.path;
      if (
        !noticeLocation(removed.path)?.license ||
        removed.noticePath !== noticePath ||
        !owned.notices.some(
          (notice) => notice.path === removed.noticePath && notice.sha256 === removed.sha256,
        )
      )
        fail(`Damaged centralized notice receipt for ${name}`);
    }
    receipts.push({ ...owned, name, sdk, path });
  }
  if (
    !equal(
      Object.keys(sdkSkills).sort(compare),
      receipts.map((receipt) => receipt.declaredName).sort(compare),
    )
  )
    fail("SDK lock and ownership receipt sets differ");
  if (command.type !== "sync") validateAssociations(manifest, repository.sources, receipts);
  admit(receipts);
  const noticesPath = join(root, bundledNoticesFile);
  if (
    (await exists(noticesPath)) &&
    !(await readFile(noticesPath)).equals(Buffer.from(renderNotices(receipts)))
  )
    fail(`${bundledNoticesFile} differs from the license notices in skills-lock.json`);
  return {
    manifest,
    license,
    baseline,
    controlModes,
    receipts,
    bindings: repository.sources,
    unmanaged,
    legacyOwners: [],
    legacy: false,
  };
}

function nextSourceId(sources: readonly SourcePolicy[]): string {
  let number = 1;
  while (sources.some((source) => source.id === `source-${number}`)) number++;
  return `source-${number}`;
}
function active(policy: SourcePolicy, origin: Origin): boolean {
  const key = originKey(origin);
  return policy.selection.mode === "all"
    ? !policy.selection.exclude.some((value) => originKey(value) === key)
    : policy.selection.origins.some((value) => originKey(value) === key);
}
function validateAssociations(
  manifest: Manifest,
  bindings: Record<string, BoundSource>,
  receipts: readonly Receipt[],
): void {
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
    if (receipt.kind !== "external") continue;
    const policy = policies.get(receipt.sourceId);
    if (!policy || !active(policy, receipt.origin))
      fail(`Receipt has no active selected origin in its source policy: ${describe(receipt)}`);
  }
}
async function resolveSelection(
  root: string,
  policy: SourcePolicy,
  prior: BoundSource | undefined,
  command: AddCommand | { type: "sync" },
  staging: string,
  isIgnored: PublishRules,
) {
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
        ? await gitObjects(
            handle.source.url,
            handle.source.commit ?? fail("Missing Git commit"),
            staging,
          )
        : undefined;
    const receipts = [];
    for (const selector of selectors)
      receipts.push(
        await installReceipt(handle, selector, policy, binding, staging, objects, isIgnored),
      );
    admit(receipts);
    return { receipts, binding: { input: policy.source, binding } };
  } finally {
    await handle.dispose();
  }
}
async function available(root: string, manifest: Manifest, command: AvailableCommand) {
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
async function stagePublication(
  root: string,
  staging: string,
  state: RepositoryState,
  manifest: Manifest,
  bindings: Record<string, BoundSource>,
  receipts: readonly Receipt[],
): Promise<void> {
  admit(receipts);
  validateAssociations(manifest, bindings, receipts);
  await mkdir(join(staging, "skills"));
  await chmod(join(staging, "skills"), (await lstat(join(root, "skills"))).mode & 0o777);
  const installed: SkillsLock["repository"]["installed"] = {};
  const sdkSkills: SkillsLock["skills"] = {};
  for (const receipt of receipts.toSorted((a, b) => compare(a.name, b.name))) {
    const target = join(staging, "skills", receipt.name);
    await cp(receipt.path, target, { recursive: true, preserveTimestamps: true });
    if ((await fingerprint(target)) !== receipt.treeHash)
      fail(`Staged copy changed ${receipt.name}`);
    const record =
      receipt.kind === "external"
        ? {
            kind: receipt.kind,
            sourceId: receipt.sourceId,
            origin: receipt.origin,
            declaredName: receipt.declaredName,
            provenance: receipt.provenance,
            installedDigest: receipt.installedDigest,
            treeHash: receipt.treeHash,
            sdkRecordHash: receipt.sdkRecordHash,
            notices: receipt.notices,
            centralizedNotices: receipt.centralizedNotices,
          }
        : {
            kind: receipt.kind,
            packageDir: receipt.packageDir,
            inputHash: receipt.inputHash,
            files: receipt.files,
            toolchain: receipt.toolchain,
            declaredName: receipt.declaredName,
            treeHash: receipt.treeHash,
            sdkRecordHash: receipt.sdkRecordHash,
            notices: receipt.notices,
            centralizedNotices: receipt.centralizedNotices,
          };
    Object.defineProperty(installed, receipt.name, { value: record, enumerable: true });
    Object.defineProperty(sdkSkills, receipt.declaredName, {
      value: receipt.sdk,
      enumerable: true,
    });
  }
  const lock: SkillsLock = {
    version: 2,
    skills: Object.fromEntries(Object.entries(sdkSkills).sort(([a], [b]) => compare(a, b))),
    repository: {
      version: 2,
      sdk: "skills@1.8.1",
      sources: bindings,
      installed,
      manifestHash: manifestHash(manifest),
      controlModes: state.controlModes,
      licenseHash: digest(state.license),
    },
  };
  await writeFile(join(staging, "skills-sources.json"), json(parseManifest(manifest).manifest));
  await writeFile(join(staging, "skills-lock.json"), json(lock));
  await writeFile(join(staging, "LICENSE"), state.license);
  if (receipts.length)
    await writeFile(join(staging, bundledNoticesFile), renderNotices(receipts), { flag: "wx" });
  await preserveControlModes(staging, state.controlModes);
}
async function release(lockPath: string, staging: string | undefined): Promise<void> {
  if (!(await exists(join(lockPath, "journal.json")))) {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lockPath, { recursive: true, force: true });
  }
}
type MutationCommand = Exclude<RepositoryCommand, { type: "list" | "available" }>;
interface ManagerSummary {
  sources: number;
  skills: number;
}
function listed(receipts: readonly Receipt[]) {
  return receipts.map((receipt) =>
    receipt.kind === "external"
      ? {
          kind: receipt.kind,
          name: receipt.name,
          sourceId: receipt.sourceId,
          origin: receipt.origin,
          declaredName: receipt.declaredName,
          provenance: receipt.provenance,
        }
      : {
          kind: receipt.kind,
          name: receipt.name,
          packageDir: receipt.packageDir,
          declaredName: receipt.declaredName,
          inputHash: receipt.inputHash,
          toolchain: receipt.toolchain,
        },
  );
}
export function manageRepository(
  directory: string,
  command?: MutationCommand,
): Promise<ManagerSummary>;
export function manageRepository(
  directory: string,
  command: { type: "list" },
): Promise<{ sources: SourcePolicy[]; installed: ReturnType<typeof listed> }>;
export function manageRepository(
  directory: string,
  command: AvailableCommand,
): ReturnType<typeof available>;
export async function manageRepository(
  directory: string,
  command: RepositoryCommand = { type: "sync" },
) {
  const root = resolve(directory);
  const lockPath = await acquire(root);
  let staging: string | undefined;
  try {
    const state = await readState(root, command);
    if (command.type === "available") return await available(root, state.manifest, command);
    if (command.type === "list")
      return { sources: state.manifest.sources, installed: listed(state.receipts) };
    staging = await mkdtemp(join(root, ".skills-sync-stage-"));
    const manifest = structuredClone(state.manifest);
    let receipts = [...state.receipts];
    const bindings = structuredClone(state.bindings);
    if (command.type === "remove") {
      let removed: Receipt[];
      if (command.sourceId !== undefined) {
        if (!manifest.sources.some((source) => source.id === command.sourceId))
          fail(`Unknown source ID ${command.sourceId}`);
        removed = receipts.filter(
          (receipt) => receipt.kind === "external" && receipt.sourceId === command.sourceId,
        );
        manifest.sources = manifest.sources.filter((source) => source.id !== command.sourceId);
        delete bindings[command.sourceId];
      } else {
        for (const name of command.names) {
          const receipt = receipts.find((receipt) => receipt.name === name);
          if (!receipt) fail(`Unknown installed skill ${name}`);
          if (receipt.kind === "workspace-build")
            fail(
              `Workspace skill ${name} is owned by ./${receipt.packageDir}; remove its package and rebuild local artifacts`,
            );
        }
        removed = receipts.filter((receipt) => command.names.includes(receipt.name));
        for (const receipt of removed) {
          if (receipt.kind !== "external")
            fail("Workspace skills are removed by local artifact builds");
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
      const existing = policy !== undefined;
      if (policy && command.ref !== undefined && command.ref !== policy.ref)
        fail(`Source ${policy.id} uses ref ${policy.ref}; change its manifest policy explicitly`);
      if (policy && command.all)
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
      const result = await resolveSelection(
        root,
        policy,
        bindings[policy.id],
        command,
        staging,
        await readPublishRules(root),
      );
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
    } else {
      receipts = state.receipts.filter((receipt) => receipt.kind === "workspace-build");
      const isIgnored = await readPublishRules(root);
      for (const policy of manifest.sources) {
        policy.source = await repositorySource(root, policy.source);
        const result = await resolveSelection(
          root,
          policy,
          bindings[policy.id],
          command,
          staging,
          isIgnored,
        );
        receipts.push(...result.receipts);
        bindings[policy.id] = result.binding;
      }
    }
    for (const name of state.unmanaged) {
      const candidate = receipts.find((receipt) => receipt.name === name);
      if (candidate)
        fail(
          `Skill name collision ${JSON.stringify(name)} between unmanaged ${join(root, "skills", name)} and ${describe(candidate)}`,
        );
    }
    if (state.unmanaged.length)
      fail(
        `Unmanaged content at ${join(root, "skills", state.unmanaged[0])}; move it before managing this repository`,
      );
    admit(receipts);
    for (const previous of state.legacyOwners)
      if (!receipts.some((receipt) => sameOwner(receipt, previous)))
        fail(
          `Legacy origin for ${previous.name} disappeared from ${describe(previous)}; preserve the snapshot and resolve migration explicitly`,
        );
    for (const receipt of receipts) {
      const previous = [...state.receipts, ...state.legacyOwners].find(
        (entry) => entry.name === receipt.name,
      );
      if (previous && !sameOwner(previous, receipt))
        fail(
          `Skill name collision ${JSON.stringify(receipt.name)} between current ${describe(previous)} and candidate ${describe(receipt)}`,
        );
    }
    for (const id of Object.keys(bindings))
      if (!manifest.sources.some((source) => source.id === id)) delete bindings[id];
    await stagePublication(root, staging, state, manifest, bindings, receipts);
    await publishSnapshot(root, staging, state.baseline);
    return { sources: manifest.sources.length, skills: receipts.length };
  } finally {
    await release(lockPath, staging);
  }
}

async function localReceipt(
  root: string,
  prepared: PreparedLocalSkill,
  staging: string,
): Promise<WorkspaceBuildReceipt> {
  if (
    !safeName(prepared.name) ||
    !safeRelative(prepared.packageDir) ||
    prepared.packageDir === "." ||
    !isHash(prepared.inputHash)
  )
    fail("Invalid prepared local skill identity");
  const packagePath = resolve(root, prepared.packageDir);
  const physicalRoot = await realpath(root);
  if (repositoryPath(physicalRoot, await realpath(packagePath)) !== `./${prepared.packageDir}`)
    fail(`Workspace package must remain inside the repository at ./${prepared.packageDir}`);
  const expectedFiles = parseFiles(prepared.files);
  const toolchain = parseToolchain(prepared.toolchain);
  const initial = await inventory(prepared.path);
  if (!initial || !equal(fileManifest(initial), expectedFiles))
    fail(`Prepared file manifest differs for ${prepared.name}`);
  const path = await mkdtemp(join(staging, "local-"));
  await cp(prepared.path, path, { recursive: true, preserveTimestamps: true });
  await chmod(path, (await lstat(prepared.path)).mode & 0o777);
  const copied = await inventory(path);
  if (!copied || copied.hash !== initial.hash)
    fail(`Prepared local artifact changed during staging: ${prepared.name}`);
  for (const [name, kind] of copied.records)
    if (kind === "directory") await chmod(join(path, name), 0o755);
  const declaration = await lstat(join(path, "SKILL.md"));
  if (!declaration.isFile()) fail(`Missing regular SKILL.md for ${prepared.name}`);
  const notices =
    prepared.notices === undefined
      ? await snapshotNotices(path, copied.records)
      : parseNotices(prepared.notices);
  if (
    !notices.some((notice) => {
      const location = noticeLocation(notice.path);
      return location?.license === true && location.owner === "";
    })
  )
    fail(`Missing complete supplied license terms for ${prepared.name}`);
  for (const notice of notices) noticeText(Buffer.from(notice.text), notice.path);
  for (const [name, kind, , encoded] of copied.records) {
    if (kind !== "file" || !noticeLocation(name)?.license) continue;
    const sha256 = digest(Buffer.from(encoded, "base64"));
    if (!notices.some((notice) => notice.path === name && notice.sha256 === sha256))
      fail(`Prepared notice differs from source notice for ${prepared.name}: ${name}`);
  }
  const handle = await resolveSource(path, { config: { telemetry: false } });
  try {
    if (handle.skills.length !== 1) fail(`Expected one local declaration for ${prepared.name}`);
    const discovered = handle.skills[0];
    const installed = await sdkReceipt(handle, discovered.name, staging);
    if (installed.name !== prepared.name)
      fail(`Prepared name ${prepared.name} differs from SDK canonical name ${installed.name}`);
    const listing = await inventory(path);
    if (!listing || installed.listing.hash !== listing.hash)
      fail(`Local SDK receipt changed bytes for ${prepared.name}`);
    const sdk = { ...installed.sdk, source: `./skills/${prepared.name}` };
    return {
      kind: "workspace-build",
      name: prepared.name,
      path,
      sdk,
      declaredName: installed.declaredName,
      packageDir: prepared.packageDir,
      inputHash: prepared.inputHash,
      files: fileManifest(listing),
      toolchain,
      treeHash: listing.hash,
      sdkRecordHash: digest(json(sdk)),
      notices,
      centralizedNotices: [],
    };
  } finally {
    await handle.dispose();
  }
}

/** Publish a complete local build set through the same lock and journal as external sync.
 * Check mode reports drift without replacing files.
 */
export async function publishLocalArtifacts(
  options: PublishLocalArtifactsOptions,
): Promise<PublicationResult> {
  if (
    options.skill !== undefined &&
    (!safeName(options.skill) ||
      options.skills.length !== 1 ||
      options.skills[0]?.name !== options.skill)
  )
    fail("A scoped local build requires exactly its named prepared artifact");
  const root = resolve(options.root);
  const lockPath = await acquire(root, { recover: !options.check });
  let staging: string | undefined;
  try {
    const state = await readState(root, { type: "local-build" });
    const manifest = structuredClone(state.manifest);
    const bindings = structuredClone(state.bindings);
    const previousLocalSource = manifest.sources.find(
      (source) => source.id === "source-2" && source.source === "./my-skills",
    );
    const migrating = options.migration === true && previousLocalSource !== undefined;
    if (migrating) {
      if (
        bindings["source-2"]?.binding.type !== "local" ||
        bindings["source-2"].binding.url !== "./my-skills"
      )
        fail("Explicit source-2 migration requires the existing ./my-skills local binding");
      manifest.sources = manifest.sources.filter((source) => source.id !== "source-2");
      delete bindings["source-2"];
    }
    staging = await mkdtemp(join(root, ".skills-sync-stage-"));
    const receipts: Receipt[] = state.receipts.filter((receipt) =>
      receipt.kind === "external"
        ? !(migrating && receipt.sourceId === "source-2")
        : options.skill !== undefined && receipt.name !== options.skill,
    );
    for (const prepared of options.skills)
      receipts.push(await localReceipt(root, prepared, staging));
    admit(receipts);
    for (const receipt of receipts) {
      const previous = state.receipts.find((entry) => entry.name === receipt.name);
      if (!previous || sameOwner(previous, receipt)) continue;
      if (migrating && canMigrateLocalOwner(previous, receipt)) continue;
      fail(
        `Skill name collision ${JSON.stringify(receipt.name)} between current ${describe(previous)} and candidate ${describe(receipt)}`,
      );
    }
    if (migrating) {
      for (const previous of state.receipts.filter(
        (receipt) => receipt.kind === "external" && receipt.sourceId === "source-2",
      ))
        if (!receipts.some((receipt) => canMigrateLocalOwner(previous, receipt)))
          fail(`Explicit migration has no prepared workspace artifact for ${previous.name}`);
    }
    await stagePublication(root, staging, state, manifest, bindings, receipts);
    const changed = !equal(await fingerprints(staging), state.baseline);
    if (options.check) {
      if (!equal(await fingerprints(root), state.baseline))
        fail("Publication artifacts changed during check; no files were replaced");
      if (changed)
        fail(
          "Local skill artifacts differ from the prepared build; rebuild and publish local artifacts",
        );
    } else if (changed) await publishSnapshot(root, staging, state.baseline);
    return { sources: manifest.sources.length, skills: receipts.length, changed };
  } finally {
    await release(lockPath, staging);
  }
}

function canMigrateLocalOwner(previous: Receipt, receipt: Receipt): boolean {
  return (
    previous.kind === "external" &&
    previous.sourceId === "source-2" &&
    previous.origin.kind === "path" &&
    receipt.kind === "workspace-build" &&
    receipt.name === previous.name &&
    receipt.declaredName === previous.declaredName &&
    (receipt.packageDir === posix.join("my-skills", previous.origin.path) ||
      (previous.origin.path === previous.name && receipt.packageDir === `packages/${receipt.name}`))
  );
}
