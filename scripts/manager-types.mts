import type { SourceType } from "skills";

export type Origin = { kind: "path"; path: string } | { kind: "declared"; name: string };
export type Selection = { mode: "all"; exclude: Origin[] } | { mode: "include"; origins: Origin[] };
export interface SourcePolicy {
  id: string;
  source: string;
  ref?: string;
  selection: Selection;
}
export interface Manifest {
  version: 2;
  sources: SourcePolicy[];
}
export interface SourceBinding {
  type: SourceType;
  url: string;
  subpath?: string;
}
export interface BoundSource {
  input: string;
  binding: SourceBinding;
}
export interface SdkRecord {
  source: string;
  sourceType: SourceType;
  sourceUrl?: string;
  ref?: string;
  skillPath?: string;
  wellKnownDigest?: string;
  computedHash: string;
  installMode: "copy";
}
export interface Notice {
  path: string;
  text: string;
  sha256: string;
}
export interface CentralizedNotice {
  path: string;
  noticePath: string;
  sha256: string;
}
export type ExternalProvenance =
  | { kind: "git"; remote: string; commit: string; ref: string; path: string }
  | { kind: "installed-snapshot"; source: string; sourceType: SourceType; digest: string };
interface OwnedRecord {
  declaredName: string;
  treeHash: string;
  sdkRecordHash: string;
  notices: Notice[];
  centralizedNotices: CentralizedNotice[];
}
export interface ExternalRecord extends OwnedRecord {
  kind: "external";
  sourceId: string;
  origin: Origin;
  provenance: ExternalProvenance;
  installedDigest: string;
}
export interface ArtifactFile {
  path: string;
  sha256: string;
  executable: boolean;
}
export interface WorkspaceBuildRecord extends OwnedRecord {
  kind: "workspace-build";
  packageDir: string;
  inputHash: string;
  files: ArtifactFile[];
  toolchain: Record<string, string>;
}
export type InstalledRecord = ExternalRecord | WorkspaceBuildRecord;
export type Receipt = InstalledRecord & { name: string; path: string; sdk: SdkRecord };
export type ExternalReceipt = ExternalRecord & { name: string; path: string; sdk: SdkRecord };
export type WorkspaceBuildReceipt = WorkspaceBuildRecord & {
  name: string;
  path: string;
  sdk: SdkRecord;
};
export interface LegacyOwner {
  kind: "external";
  name: string;
  sourceId: string;
  origin: Origin;
  declaredName: string;
  provenance: { remote: string };
}
export const artifacts = ["skills-sources.json", "skills", "skills-lock.json", "LICENSE"] as const;
export type Artifact = (typeof artifacts)[number];
export type ControlFile = Exclude<Artifact, "skills">;
export type Fingerprints = Record<Artifact, string | null>;
export type ControlModes = Record<ControlFile, number>;
export interface RepositoryLock {
  version: 2;
  sdk: "skills@1.8.1";
  sources: Record<string, BoundSource>;
  installed: Record<string, InstalledRecord>;
  manifestHash: string;
  controlModes: ControlModes;
  licenseHash: string;
}
export interface SkillsLock {
  version: 2;
  skills: Record<string, SdkRecord>;
  repository: RepositoryLock;
}
export type AddCommand = {
  type: "add";
  source: string;
  skills: string[];
  all: boolean;
  ref?: string;
};
export type AvailableCommand = { type: "available"; source: string; ref?: string };
export type RemoveCommand =
  | { type: "remove"; sourceId: string; names?: never }
  | { type: "remove"; names: string[]; sourceId?: never };
export type RepositoryCommand =
  | { type: "sync" }
  | AddCommand
  | RemoveCommand
  | { type: "list" }
  | AvailableCommand;
export type GlobalSyncMode = "copy" | "symlink";
export type Command =
  | RepositoryCommand
  | { type: "sync-global"; mode: GlobalSyncMode }
  | { type: "help" };

/** The complete prepared tree, including notices, before license centralization. */
export interface PreparedLocalSkill {
  path: string;
  name: string;
  /** Repository-relative package directory, for example my-skills/example. */
  packageDir: string;
  inputHash: string;
  files: readonly ArtifactFile[];
  toolchain: Readonly<Record<string, string>>;
  /** Full source notices when they are not included in the prepared tree. */
  notices?: readonly Notice[];
}
export interface PublishLocalArtifactsOptions {
  root: string;
  /** Complete desired workspace-owned set; omitted previous packages are stale. */
  skills: readonly PreparedLocalSkill[];
  /** Replace only this name, preserving all other workspace build receipts. */
  skill?: string;
  check?: boolean;
  /** Explicitly transfer source-2 ./my-skills ownership to workspace packages. */
  migration?: boolean;
}
export interface PublicationResult {
  sources: number;
  skills: number;
  changed: boolean;
}
export type InventoryRecord = [
  path: string,
  kind: "directory" | "file",
  executable: number,
  base64: string,
];
export interface Inventory {
  hash: string;
  records: InventoryRecord[];
}
export interface GitTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}
export interface GitObjects {
  tree(commit: string): Promise<readonly GitTreeEntry[] | undefined>;
  blob(sha: string): Promise<Buffer | undefined>;
}
export type PublishRules = (path: string, kind?: "file" | "directory") => boolean;
export interface RepositoryState {
  manifest: Manifest;
  license: string;
  baseline: Fingerprints;
  controlModes: ControlModes;
  receipts: Receipt[];
  bindings: Record<string, BoundSource>;
  unmanaged: string[];
  legacyOwners: LegacyOwner[];
  legacy: boolean;
}
