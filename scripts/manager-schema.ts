import type { SourceType } from "skills";
import type {
  ArtifactFile,
  BoundSource,
  CentralizedNotice,
  ControlModes,
  ExternalProvenance,
  ExternalRecord,
  InstalledRecord,
  Manifest,
  Notice,
  Origin,
  RepositoryLock,
  SdkRecord,
  SourceBinding,
  SourcePolicy,
  WorkspaceBuildRecord,
} from "./manager-types.ts";
import {
  compare,
  digest,
  fail,
  isHash,
  keys,
  object,
  present,
  record,
  safeRelative,
} from "./manager-shared.ts";

export const gitTypes: ReadonlySet<SourceType> = new Set(["github", "gitlab", "git"]);
export const originKey = (origin: Origin): string => JSON.stringify(origin);
export function sourceInput(value: unknown): string {
  if (!present(value) || value.includes("\0") || value.startsWith("-"))
    fail("A non-empty source locator is required");
  if (/^[a-z]+:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.password || (url.username && !["ssh:", "git+ssh:"].includes(url.protocol)))
      fail("Credential-bearing source URLs cannot be persisted; use Git credential helpers");
  }
  return value;
}
export function refPolicy(ref: unknown): string | undefined {
  if (ref !== undefined && (!present(ref) || ref === "HEAD" || ref.startsWith("-")))
    fail("Use a concrete Git branch, tag, or commit for --ref, not HEAD");
  return ref;
}
export function parseOrigin(value: unknown): Origin {
  const input = record(value, "origin");
  if (input.kind === "path") {
    keys(input, ["kind", "path"], "path origin");
    if (!safeRelative(input.path)) fail("Invalid source-relative origin path");
    return { kind: "path", path: input.path };
  }
  keys(input, ["kind", "name"], "declared origin");
  if (input.kind !== "declared" || !present(input.name)) fail("Invalid declared origin");
  return { kind: "declared", name: input.name };
}
export function parseOrigins(values: unknown): Origin[] {
  if (!Array.isArray(values)) fail("Selection origins must be an array");
  const origins = values.map((value: unknown) => parseOrigin(value));
  if (new Set(origins.map(originKey)).size !== origins.length) fail("Duplicate selection origin");
  return origins.toSorted((a, b) => compare(originKey(a), originKey(b)));
}
export function parseManifest(raw: unknown): { legacy: boolean; manifest: Manifest } {
  const input = record(raw, "manifest");
  const legacy = input.version === undefined;
  keys(input, legacy ? ["sources"] : ["version", "sources"], "manifest");
  if ((!legacy && input.version !== 2) || !Array.isArray(input.sources))
    fail("Expected skills-sources.json version 2");
  const sources = input.sources.map((value: unknown, index: number): SourcePolicy => {
    if (legacy) {
      keys(value, ["repository", "ref"], "legacy source");
      if (
        !present(value.repository) ||
        !/^[a-z\d][a-z\d-]*\/[\w.-]+$/i.test(value.repository) ||
        !present(value.ref)
      )
        fail("Invalid legacy source");
      return {
        id: `source-${index + 1}`,
        source: value.repository,
        ref: refPolicy(value.ref),
        selection: { mode: "all", exclude: [] },
      };
    }
    keys(value, ["id", "source", "ref", "selection"], "source policy");
    if (!present(value.id) || !/^[a-z0-9][a-z0-9_-]*$/i.test(value.id)) fail("Invalid source ID");
    const selection = record(value.selection, "selection");
    const all = selection.mode === "all";
    keys(selection, all ? ["mode", "exclude"] : ["mode", "origins"], "selection");
    if (!all && selection.mode !== "include") fail("Selection mode must be all or include");
    const ref = refPolicy(value.ref);
    return {
      id: value.id,
      source: sourceInput(value.source),
      ...(ref === undefined ? {} : { ref }),
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
function text(value: unknown, label: string): string {
  if (!present(value)) fail(`Invalid ${label}`);
  return value;
}
function path(value: unknown, label: string): string {
  if (!safeRelative(value)) fail(`Invalid ${label}`);
  return value;
}
function hash(value: unknown, label: string): string {
  if (!isHash(value)) fail(`Damaged ownership ${label}`);
  return value;
}
function sourceType(value: unknown): SourceType {
  switch (value) {
    case "github":
    case "gitlab":
    case "git":
    case "local":
    case "well-known":
    case "download":
      return value;
    default:
      return fail("Invalid SDK source type");
  }
}
export function parseSdkRecord(value: unknown): SdkRecord {
  keys(
    value,
    [
      "source",
      "sourceUrl",
      "ref",
      "sourceType",
      "skillPath",
      "computedHash",
      "wellKnownDigest",
      "installMode",
    ],
    "SDK record",
  );
  if (value.installMode !== "copy") fail("Invalid SDK installation mode");
  const ref = refPolicy(value.ref);
  return {
    source: sourceInput(value.source),
    ...(value.sourceUrl === undefined ? {} : { sourceUrl: sourceInput(value.sourceUrl) }),
    ...(ref === undefined ? {} : { ref }),
    sourceType: sourceType(value.sourceType),
    ...(value.skillPath === undefined
      ? {}
      : { skillPath: path(value.skillPath, "SDK skill path") }),
    computedHash: hash(value.computedHash, "SDK computed hash"),
    ...(value.wellKnownDigest === undefined
      ? {}
      : { wellKnownDigest: text(value.wellKnownDigest, "well-known digest") }),
    installMode: "copy",
  };
}
export function parseSdkSkills(value: unknown): Record<string, SdkRecord> {
  return Object.fromEntries(
    Object.entries(record(value, "SDK skills")).map(([name, entry]) => [
      name,
      parseSdkRecord(entry),
    ]),
  );
}
function parseBinding(value: unknown): SourceBinding {
  keys(value, ["type", "url", "subpath"], "source binding");
  return {
    type: sourceType(value.type),
    url: sourceInput(value.url),
    ...(value.subpath === undefined ? {} : { subpath: path(value.subpath, "source subpath") }),
  };
}
function parseBoundSource(value: unknown): BoundSource {
  keys(value, ["input", "binding"], "bound source");
  return { input: sourceInput(value.input), binding: parseBinding(value.binding) };
}
export function parseNotices(values: unknown): Notice[] {
  if (!Array.isArray(values)) fail("Damaged notice receipt");
  const notices = values.map((value: unknown): Notice => {
    keys(value, ["path", "text", "sha256"], "notice receipt");
    const body = text(value.text, "notice text");
    if (value.sha256 !== digest(Buffer.from(body))) fail("Damaged notice receipt hash");
    return { path: path(value.path, "notice path"), text: body, sha256: value.sha256 };
  });
  if (new Set(notices.map((notice) => notice.path)).size !== notices.length)
    fail("Damaged duplicate notice receipt");
  return notices;
}
function parseCentralizedNotices(values: unknown): CentralizedNotice[] {
  if (!Array.isArray(values)) fail("Damaged centralized notice receipt");
  const notices = values.map((value: unknown): CentralizedNotice => {
    keys(value, ["path", "noticePath", "sha256"], "centralized notice");
    return {
      path: path(value.path, "centralized notice path"),
      noticePath: path(value.noticePath, "notice origin path"),
      sha256: hash(value.sha256, "centralized notice hash"),
    };
  });
  if (new Set(notices.map((notice) => notice.path)).size !== notices.length)
    fail("Damaged duplicate centralized notice receipt");
  return notices;
}
function parseProvenance(value: unknown): ExternalProvenance {
  const input = record(value, "provenance");
  if (input.kind === "git") {
    keys(input, ["kind", "remote", "commit", "ref", "path"], "Git provenance");
    const commit = text(input.commit, "Git commit");
    const ref = refPolicy(input.ref);
    if (!/^[a-f0-9]{40,64}$/.test(commit) || ref === undefined) fail("Damaged Git provenance");
    return {
      kind: "git",
      remote: sourceInput(input.remote),
      commit,
      ref,
      path: path(input.path, "Git path"),
    };
  }
  keys(input, ["kind", "source", "sourceType", "digest"], "snapshot provenance");
  if (input.kind !== "installed-snapshot") fail("Damaged installed-snapshot provenance");
  return {
    kind: "installed-snapshot",
    source: sourceInput(input.source),
    sourceType: sourceType(input.sourceType),
    digest: hash(input.digest, "snapshot hash"),
  };
}
export function parseFiles(values: unknown): ArtifactFile[] {
  if (!Array.isArray(values)) fail("Invalid artifact file manifest");
  const files = values
    .map((value: unknown): ArtifactFile => {
      keys(value, ["path", "sha256", "executable"], "artifact file");
      if (typeof value.executable !== "boolean" || value.path === ".")
        fail("Invalid artifact file");
      return {
        path: path(value.path, "artifact file path"),
        sha256: hash(value.sha256, "artifact file hash"),
        executable: value.executable,
      };
    })
    .toSorted((a, b) => compare(a.path, b.path));
  if (new Set(files.map((file) => file.path)).size !== files.length)
    fail("Duplicate artifact file path");
  return files;
}
export function parseToolchain(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value, "toolchain"))
      .sort(([a], [b]) => compare(a, b))
      .map(([name, version]) => [text(name, "tool name"), text(version, "tool version")]),
  );
}
function parseInstalledRecord(value: unknown, legacy: boolean): InstalledRecord {
  const input = record(value, "ownership receipt");
  const common = {
    declaredName: text(input.declaredName, "declared name"),
    treeHash: hash(input.treeHash, "tree hash"),
    sdkRecordHash: hash(input.sdkRecordHash, "SDK record hash"),
    notices: parseNotices(input.notices),
    centralizedNotices: parseCentralizedNotices(input.centralizedNotices),
  };
  if (input.kind === "workspace-build" && !legacy) {
    keys(
      input,
      [
        "kind",
        "packageDir",
        "inputHash",
        "files",
        "toolchain",
        "declaredName",
        "treeHash",
        "sdkRecordHash",
        "notices",
        "centralizedNotices",
      ],
      "workspace ownership receipt",
    );
    return {
      ...common,
      kind: "workspace-build",
      packageDir: path(input.packageDir, "workspace package directory"),
      inputHash: hash(input.inputHash, "workspace input hash"),
      files: parseFiles(input.files),
      toolchain: parseToolchain(input.toolchain),
    } satisfies WorkspaceBuildRecord;
  }
  if ((!legacy || input.kind !== undefined) && input.kind !== "external")
    fail("Damaged ownership receipt kind");
  keys(
    input,
    [
      "kind",
      "sourceId",
      "origin",
      "declaredName",
      "provenance",
      "installedDigest",
      "treeHash",
      "sdkRecordHash",
      "notices",
      "centralizedNotices",
    ],
    "external ownership receipt",
  );
  return {
    ...common,
    kind: "external",
    sourceId: text(input.sourceId, "source ID"),
    origin: parseOrigin(input.origin),
    provenance: parseProvenance(input.provenance),
    installedDigest: hash(input.installedDigest, "installed digest"),
  } satisfies ExternalRecord;
}
export function parseControlModes(value: unknown): ControlModes {
  keys(value, ["skills-sources.json", "skills-lock.json", "LICENSE"], "control modes");
  const mode = (name: keyof ControlModes): number => {
    const result = value[name];
    if (
      typeof result !== "number" ||
      !Number.isSafeInteger(result) ||
      result < 0 ||
      result > 0o111 ||
      (result & ~0o111) !== 0
    )
      fail("Damaged control-file executable bits");
    return result;
  };
  return {
    "skills-sources.json": mode("skills-sources.json"),
    "skills-lock.json": mode("skills-lock.json"),
    LICENSE: mode("LICENSE"),
  };
}
export function parseRepositoryLock(value: unknown): RepositoryLock {
  if (
    !object(value) ||
    (value.version !== 1 && value.version !== 2) ||
    value.sdk !== "skills@1.8.1"
  )
    fail(
      "Damaged ownership extension in skills-lock.json. Restore the manager-generated lock; upstream SDK writers remove this extension",
    );
  const legacy = value.version === 1;
  const sources = Object.fromEntries(
    Object.entries(record(value.sources, "source bindings")).map(([id, source]) => [
      id,
      parseBoundSource(source),
    ]),
  );
  const installed = Object.fromEntries(
    Object.entries(record(value.installed, "installed receipts")).map(([name, entry]) => [
      name,
      parseInstalledRecord(entry, legacy),
    ]),
  );
  return {
    version: 2,
    sdk: "skills@1.8.1",
    sources,
    installed,
    manifestHash: hash(value.manifestHash, "manifest hash"),
    licenseHash: hash(value.licenseHash, "license hash"),
    controlModes: parseControlModes(value.controlModes),
  };
}
