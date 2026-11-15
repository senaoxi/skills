#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { chatgptStatus } from "./chatgpt-session.ts";
import { amHome } from "./home.ts";
import { conversationPaths, downloadPath, readingPage, readPage } from "./page.ts";
import { readConversationBundle } from "./conversation-bundle.ts";

interface Flags {
  [name: string]: string | boolean | undefined;
  replace?: boolean;
  "clear-context"?: boolean;
  local?: boolean;
  "if-uninitialized"?: boolean;
  json?: boolean;
  "list-domains"?: boolean;
  "check-project"?: boolean;
  slug?: string;
  team?: string;
  project?: string;
  "project-id"?: string;
  "alias-domain"?: string;
  group?: string;
  "published-at"?: string;
  "context-source"?: string;
  "context-title"?: string;
  "context-url"?: string;
  "reviewed-sha256"?: string;
  "conversation-bundle"?: string;
  "article-only"?: boolean;
  deployment?: string;
}
interface DeliveryConfig {
  mode?: string;
  team?: string;
  project?: unknown;
  projectId?: string;
  aliasDomain?: string;
}
interface EnabledConfig extends DeliveryConfig {
  mode: "vercel";
  team: string;
  projectId: string;
}
interface ConversationContext {
  [extra: string]: unknown;
  source: "chatgpt" | "codex";
  title: string;
  url?: string;
}
interface PageMetadata {
  [extra: string]: unknown;
  group: string;
  publishedAt: string;
  context?: ConversationContext;
  downloadDigest?: string;
  conversation?: { jsonDigest: string; htmlDigest: string };
}
interface RawCatalog {
  [extra: string]: unknown;
  schemaVersion: number;
  pages: Record<string, unknown>;
}
interface Catalog extends RawCatalog {
  pages: Record<string, PageMetadata>;
}
interface PublishedRecord extends PageMetadata {
  digest: string;
}
interface PublishedState {
  [extra: string]: unknown;
  schemaVersion: 2;
  projectDigest: string;
  origin: string;
  pages: Record<string, PublishedRecord>;
}
interface Production {
  alias: string;
  baseline: string;
  requested?: boolean;
}
interface Journal {
  [extra: string]: unknown;
  schemaVersion: number;
  phase: string;
  projectDigest: string;
  source: string;
  slug: string;
  digests: Record<string, string>;
  origin?: string;
  production?: Production;
}
interface Snapshot {
  catalog: Catalog;
  files: Map<string, Buffer>;
}
interface RenderedHtml {
  source: string;
  html: Buffer;
}
interface PreparedPage {
  source: string;
  slug: string;
  context?: ConversationContext;
  original: string;
  contents: Buffer;
}
interface ReviewedPage extends PreparedPage {
  metadata: PageMetadata;
  files: Map<string, Buffer>;
}
interface PreferredProbe {
  state: string;
  url?: string;
  status?: number;
  binding?: string;
  authenticated?: boolean;
}
interface PublicationResult {
  remote: { state: string; url?: unknown };
  production: { state: string; current?: string | null; relation?: string; error?: string };
  archive: string;
  delivery: { kind: string; url?: string; access?: string };
  preferred: PreferredProbe;
  conversation:
    | { status: "absent" }
    | { status: "selected" | "published"; json: string; html: string };
  source?: unknown;
  slug?: unknown;
  pages?: number;
  error?: string;
}
interface GalleryEntry extends PageMetadata {
  slug: string;
  title: string;
  description: string;
  editable: boolean;
}
function requireProject(
  config: DeliveryConfig,
): asserts config is DeliveryConfig & { team: string; projectId: string } {
  if (!validProject(config)) fail("Invalid pinned Vercel project in delivery settings.");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function parseJson(contents: string): unknown {
  return JSON.parse(contents);
}
function catalogFromJson(value: unknown, message: string): RawCatalog {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.pages)) fail(message);
  return { ...value, schemaVersion: 1, pages: value.pages };
}

const home = path.resolve(amHome());
const configFile = path.join(home, "delivery.md");
const siteDir = path.join(home, "vercel-shared-site");
const pagesDir = path.join(siteDir, "pages");
const catalogFile = path.join(siteDir, "pages.json");
const publishedFile = path.join(home, "vercel-shared-published.json");
const publishedPagesDir = path.join(home, "vercel-shared-content");
const lockFile = path.join(home, "vercel-shared-publish.lock");
const pendingDir = path.join(home, "vercel-shared-pending");
const journalFile = path.join(pendingDir, "journal.json");
const pendingSite = path.join(pendingDir, "site");
const reviewDir = path.join(home, "review");
const setupUsage =
  "publish.mjs setup (--local | --team SLUG --project-id ID [--check-project | --list-domains | --alias-domain HOST]) [--if-uninitialized]";

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const flag = token.slice(2);
    if (
      [
        "replace",
        "clear-context",
        "local",
        "if-uninitialized",
        "json",
        "list-domains",
        "check-project",
        "article-only",
      ].includes(flag)
    ) {
      flags[flag] = true;
      continue;
    }
    if (
      ![
        "slug",
        "team",
        "project",
        "project-id",
        "alias-domain",
        "group",
        "published-at",
        "context-source",
        "context-title",
        "context-url",
        "reviewed-sha256",
        "conversation-bundle",
        "deployment",
      ].includes(flag)
    )
      fail("Unsupported argument: " + token);
    const next = rest[++i];
    if (next === undefined || next.startsWith("--")) fail("Missing value for: " + token);
    flags[flag] = next;
  }
  return { command, positional, flags };
}

function runVercelText(args: string[], cwd = home) {
  const result = spawnSync("vercel", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) fail("Cannot start Vercel CLI: " + result.error.message);
  if (result.status !== 0)
    fail("Vercel CLI failed: " + (result.stderr + "\n" + result.stdout).trim().slice(-1200));
  return result.stdout;
}

function runVercel(args: string[], cwd = home): unknown {
  const stdout = runVercelText(args, cwd);
  try {
    return parseJson(stdout);
  } catch {
    fail("Unexpected Vercel CLI output for " + args[0] + ".");
  }
}

async function atomicWrite(
  file: string,
  content: string | Uint8Array,
  options: { flag?: string; mode?: number } = {},
) {
  const temp = file + ".next-" + randomUUID();
  try {
    await writeFile(temp, content, { ...options, flag: "wx" });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

const settingsFields: ReadonlyArray<readonly [keyof DeliveryConfig, string]> = [
  ["mode", "Delivery mode"],
  ["team", "Vercel team"],
  ["project", "Vercel project"],
  ["projectId", "Vercel project ID"],
  ["aliasDomain", "Vercel delivery alias"],
];

async function writeConfig(config: DeliveryConfig) {
  const lines = ["# Mark delivery settings", ""];
  for (const [field, label] of settingsFields) {
    if (config[field] !== undefined) lines.push("- " + label + ": " + config[field]);
  }
  await mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 });
  await atomicWrite(configFile, lines.join("\n") + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}

function parseMarkdownSettings(contents: string) {
  const config: DeliveryConfig = {};
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim() || /^#{1,6} /.test(line)) continue;
    const entry = /^- ([^:]+): (.+)$/.exec(line.trimEnd());
    const field = settingsFields.find(([, label]) => label === entry?.[1])?.[0];
    if (!field || !entry || Object.hasOwn(config, field))
      fail("Invalid delivery settings at " + configFile);
    config[field] = entry[2];
  }
  return config;
}

function normalizePublicOrigin(value: unknown) {
  if (typeof value !== "string") fail("Expected an HTTPS origin.");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Invalid HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.port
  )
    fail("Expected a bare HTTPS origin without paths, credentials, query or port.");
  return url.origin;
}

const projectFields: ReadonlyArray<"team" | "projectId"> = ["team", "projectId"];
const teamSlugPattern = /^[a-z0-9][a-z0-9-]*$/;
const projectIdPattern = /^prj_[A-Za-z0-9]+$/;

function validProject<T extends { team?: unknown; projectId?: unknown }>(
  config: T,
): config is T & { team: string; projectId: string } {
  return (
    typeof config.team === "string" &&
    teamSlugPattern.test(config.team) &&
    typeof config.projectId === "string" &&
    projectIdPattern.test(config.projectId)
  );
}

async function readSettings(): Promise<DeliveryConfig | undefined> {
  let contents;
  try {
    contents = await readFile(configFile, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    fail("Cannot read delivery settings at " + configFile);
  }
  const config = parseMarkdownSettings(contents);
  if (config.mode !== "local" && config.mode !== "vercel")
    fail("Invalid delivery mode in " + configFile);
  if (
    (config.mode !== "local" || projectFields.some((field) => config[field] !== undefined)) &&
    !validProject(config)
  )
    fail("Invalid pinned Vercel project in delivery settings.");
  if (
    config.aliasDomain !== undefined &&
    new URL(aliasOrigin(config.aliasDomain)).hostname !== config.aliasDomain
  )
    fail("Invalid saved Vercel delivery alias.");
  return config as DeliveryConfig;
}

function deliveryMode(config: DeliveryConfig | undefined) {
  return config?.mode ?? "uninitialized";
}

async function readEnabledProject(): Promise<EnabledConfig> {
  const config = await readSettings();
  if (!config || config.mode !== "vercel" || !validProject(config))
    fail("Vercel publishing is disabled. Run publish.mjs setup to enable it.");
  return { ...config, mode: "vercel" };
}

function inspectProject(
  config: DeliveryConfig,
  { expectedName, cwd = home }: { expectedName?: string; cwd?: string } = {},
) {
  requireProject(config);
  const project = runVercel(
    ["project", "inspect", config.projectId, "--scope", config.team, "--non-interactive", "--json"],
    cwd,
  );
  if (
    !isRecord(project) ||
    project.id !== config.projectId ||
    !isRecord(project.owner) ||
    project.owner.slug !== config.team ||
    typeof project.name !== "string" ||
    !/^(?!.*---)[a-z0-9._-]{1,100}$/.test(project.name) ||
    (expectedName !== undefined && project.name !== expectedName)
  )
    fail("Vercel project identity differs from the pinned shared project.");
  return project.name;
}

function currentProductionDeployment(config: DeliveryConfig, cwd = home) {
  requireProject(config);
  const project = runVercel(
    ["api", "/v9/projects/" + config.projectId, "--scope", config.team, "--non-interactive"],
    cwd,
  );
  if (
    !isRecord(project) ||
    project.id !== config.projectId ||
    !project.targets ||
    !isRecord(project.targets)
  )
    fail("Cannot determine current production for the pinned Vercel project.");
  const current = project.targets.production;
  if (current == null) return null;
  if (
    !isRecord(current) ||
    !current.aliasAssigned ||
    current.aliasError ||
    typeof current.url !== "string"
  )
    fail("The current production deployment could not be confirmed as serving.");
  return { id: current.id, origin: normalizePublicOrigin("https://" + current.url) };
}

function currentProduction(config: DeliveryConfig) {
  return currentProductionDeployment(config)?.origin ?? null;
}

function aliasOrigin(host: unknown) {
  if (typeof host !== "string" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host))
    fail("Enter an exact alias hostname.");
  const origin = normalizePublicOrigin("https://" + host);
  if (new URL(origin).hostname !== host.toLowerCase()) fail("Enter an exact alias hostname.");
  return origin;
}

function productionAliases(config: DeliveryConfig) {
  requireProject(config);
  const deployment = currentProductionDeployment(config, process.cwd());
  if (!deployment) return [];
  if (typeof deployment.id !== "string" || !/^dpl_[A-Za-z0-9]+$/.test(deployment.id))
    fail("Cannot read the current production deployment ID.");
  const response = runVercel(
    [
      "api",
      "/v2/deployments/" + deployment.id + "/aliases",
      "--scope",
      config.team,
      "--non-interactive",
    ],
    process.cwd(),
  );
  if (!isRecord(response) || !Array.isArray(response.aliases))
    fail("Cannot read the deployment alias list.");
  return [
    ...new Set(
      response.aliases.flatMap((record: unknown) => {
        if (!isRecord(record) || record.redirect) return [];
        try {
          return [new URL(aliasOrigin(record.alias)).hostname];
        } catch {
          return [];
        }
      }),
    ),
  ].sort(
    (a, b) =>
      Number(a.endsWith(".vercel.app")) - Number(b.endsWith(".vercel.app")) || a.localeCompare(b),
  );
}

async function setup(flags: Flags, positional: string[]) {
  const checkProject = flags["check-project"];
  const listDomains = flags["list-domains"];
  const projectOptions = [
    "team",
    "project",
    "project-id",
    "alias-domain",
    "list-domains",
    "check-project",
  ];
  if (
    positional.length !== 0 ||
    Object.keys(flags).some(
      (flag) => !["local", "if-uninitialized", ...projectOptions].includes(flag),
    ) ||
    (flags.local && projectOptions.some((flag) => flags[flag] !== undefined)) ||
    (checkProject && listDomains) ||
    ((checkProject || listDomains) &&
      (flags["alias-domain"] !== undefined || flags["if-uninitialized"]))
  )
    fail("Usage: " + setupUsage);

  const existing = await readSettings();
  if (flags["if-uninitialized"] && existing) {
    process.stdout.write("Delivery is already set up.\n");
    return;
  }
  if (flags.local) {
    await writeConfig({ ...existing, mode: "local" });
    process.stdout.write("Local delivery saved to " + configFile + "\n");
    return;
  }

  const config: DeliveryConfig = {
    mode: "vercel",
    team: flags.team,
    projectId: flags["project-id"],
  };
  if (!teamSlugPattern.test(config.team ?? "")) fail("Enter the Vercel team slug with --team.");
  if (!projectIdPattern.test(config.projectId ?? ""))
    fail("Enter the Vercel project ID (starting with prj_) with --project-id.");
  if (existing?.projectId && projectFields.some((field) => config[field] !== existing[field]))
    fail(
      "This archive is bound to a different project. Use a separate AM_HOME for another project.",
    );
  if (flags["alias-domain"] !== undefined)
    config.aliasDomain = new URL(aliasOrigin(flags["alias-domain"])).hostname;
  config.project = inspectProject(config, { expectedName: flags.project, cwd: process.cwd() });

  if (checkProject) {
    const { team, projectId, project } = config;
    process.stdout.write(JSON.stringify({ team, projectId, project }) + "\n");
    return;
  }

  if (listDomains || flags["alias-domain"] !== undefined) {
    const domains = productionAliases(config);
    if (listDomains) {
      process.stdout.write(
        JSON.stringify({
          project: config.project,
          domains: domains.slice(0, 5),
          more: domains.length > 5,
        }) + "\n",
      );
      return;
    }
    if (!domains.includes(config.aliasDomain ?? ""))
      fail("The selected domain is not bound to the current production deployment.");
  }
  await mkdir(siteDir, { recursive: true });
  await writeConfig(config);
  process.stdout.write("Vercel delivery saved to " + configFile + "\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function extractTitle(html: string, slug: string) {
  const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html);
  return (match?.[1] || slug).trim();
}

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

function normalizeGroup(value: unknown) {
  if (value === undefined) return "posts";
  if (typeof value !== "string" || !SAFE_SLUG.test(value.toLowerCase()))
    fail("Group must be a lowercase project slug or Posts.");
  return value.toLowerCase();
}

function normalizePublishedAt(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("Publication date must use YYYY-MM-DD.");
  const time = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(time.valueOf()) || time.toISOString().slice(0, 10) !== value)
    fail("Publication date is not a real calendar day: " + value);
  return time.toISOString();
}

function normalizeContext(raw: unknown): ConversationContext | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) fail("Invalid conversation context.");
  const { source, title, url } = raw;
  if (source !== "chatgpt" && source !== "codex")
    fail("Conversation source must be chatgpt or codex.");
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 240 ||
    /[\u0000-\u001f\u007f]/.test(title)
  )
    fail(
      "A conversation title summarized from the current context is required (maximum 240 characters).",
    );
  const context: ConversationContext = { source, title: title.trim() };
  if (source === "chatgpt" && url !== undefined) {
    if (typeof url !== "string") fail("ChatGPT conversation URL must be a string when provided.");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      fail("Invalid ChatGPT conversation URL.");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !["chatgpt.com", "chat.openai.com"].includes(parsed.hostname) ||
      parsed.port ||
      !/^\/(?:c\/[^/]+|g\/[^/]+\/c\/[^/]+|share\/[^/]+)(?:\/)?$/.test(parsed.pathname)
    )
      fail(
        "ChatGPT conversation URL must be a real https://chatgpt.com conversation or share link.",
      );
    context.url = parsed.origin + parsed.pathname;
  } else if (source === "codex" && url !== undefined) {
    fail("Codex provenance accepts a conversation title only, without a URL.");
  }
  return context;
}

function contextFromFlags(flags: Flags, previousContext?: ConversationContext) {
  const args = [flags["context-source"], flags["context-title"], flags["context-url"]];
  if (flags["clear-context"]) {
    if (args.some((value) => value !== undefined))
      fail("--clear-context cannot be combined with source flags.");
    return undefined;
  }
  if (args.every((value) => value === undefined)) return normalizeContext(previousContext);
  if (flags["context-source"] === undefined)
    fail("Specify --context-source when providing conversation title or URL.");
  return normalizeContext({
    source: flags["context-source"],
    title: flags["context-title"],
    ...(flags["context-url"] !== undefined ? { url: flags["context-url"] } : {}),
  });
}

function readSlug(slug: unknown) {
  if (typeof slug !== "string" || !SAFE_SLUG.test(slug))
    fail("Specify a lowercase ASCII --slug (letters, digits, hyphens; max 64 characters).");
  return slug;
}

function pageMetadata(
  flags: Flags,
  previous?: PageMetadata,
  context?: ConversationContext,
): PageMetadata {
  return {
    group: flags.group === undefined ? (previous?.group ?? "posts") : normalizeGroup(flags.group),
    publishedAt:
      flags["published-at"] === undefined
        ? (previous?.publishedAt ?? new Date().toISOString())
        : normalizePublishedAt(flags["published-at"]),
    ...(context ? { context } : {}),
  };
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

async function readCatalog(): Promise<Catalog> {
  let catalog: RawCatalog;
  try {
    catalog = catalogFromJson(
      parseJson(await readFile(catalogFile, "utf8")),
      "Invalid shared site pages.json catalog.",
    );
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    catalog = { schemaVersion: 1, pages: {} };
  }
  if (
    catalog.schemaVersion !== 1 ||
    !catalog.pages ||
    Array.isArray(catalog.pages) ||
    typeof catalog.pages !== "object"
  )
    fail("Invalid shared site pages.json catalog.");
  const filenames = (await readdir(pagesDir))
    .filter((name) => SAFE_SLUG.test(name.slice(0, -5)) && name.endsWith(".html"))
    .sort();
  // Migration: old pages have no publication catalog. Retain their original URLs
  // and use their archive modification time as an explicitly documented proxy.
  for (const filename of filenames) {
    const slug = filename.slice(0, -5);
    if (!Object.hasOwn(catalog.pages, slug)) {
      const archiveStat = await stat(path.join(pagesDir, filename));
      catalog.pages[slug] = {
        group: "posts",
        publishedAt: archiveStat.mtime.toISOString(),
      };
    }
    const record = catalog.pages[slug];
    if (
      !isRecord(record) ||
      record.group !== normalizeGroup(record.group) ||
      !validTimestamp(record.publishedAt)
    )
      fail("Invalid catalog metadata for " + slug);
    approvedMetadata(slug, record);
  }
  for (const slug of Object.keys(catalog.pages)) {
    if (!SAFE_SLUG.test(slug) || !filenames.includes(slug + ".html"))
      fail("Missing archived HTML for catalog page: " + slug);
  }
  return catalog as Catalog;
}

function decodeEntities(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity: string) => {
    const entities: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
    };
    return entities[entity] ?? entity;
  });
}

function textOnly(value: string) {
  return decodeEntities(value.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const PROVENANCE_START = "<!-- am-context-provenance:start -->";
const PROVENANCE_END = "<!-- am-context-provenance:end -->";

function withoutProvenance(html: string) {
  const start = html.indexOf(PROVENANCE_START);
  const end = html.indexOf(PROVENANCE_END);
  if (start === -1 && end === -1) return html;
  if (
    start < 0 ||
    end < start ||
    html.indexOf(PROVENANCE_START, start + 1) !== -1 ||
    html.indexOf(PROVENANCE_END, end + 1) !== -1
  )
    fail("Invalid or duplicate generated conversation provenance markup.");
  return html.slice(0, start) + html.slice(end + PROVENANCE_END.length);
}

function contextMarkup(context: ConversationContext, embedded = false) {
  const label = context.source === "chatgpt" ? "ChatGPT" : "Codex";
  const title = escapeHtml(context.title);
  const contextText =
    context.source === "chatgpt" && context.url
      ? '<a href="' +
        escapeHtml(context.url) +
        '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;text-underline-offset:3px">' +
        title +
        " ↗</a>"
      : "<span>" + title + "</span>";
  if (!embedded) {
    return (
      '<span class="entry-origin"><span class="entry-origin-platform">' +
      label +
      '</span><span class="entry-origin-title">' +
      contextText +
      "</span></span>"
    );
  }
  return (
    PROVENANCE_START +
    '<div class="am-head-meta am-conversation-provenance" data-am-conversation-provenance="true" aria-label="Source conversation">' +
    "<span><b>" +
    label +
    "</b>" +
    contextText +
    "</span></div>" +
    PROVENANCE_END
  );
}

function withProvenance(html: string, context?: ConversationContext) {
  const base = withoutProvenance(html);
  if (!context) return base;
  const markup = contextMarkup(context, true);
  const header = base.indexOf('<header class="am-head">');
  if (header !== -1) {
    const end = base.indexOf("</header>", header);
    if (end < 0) fail("Generated HTML header was not closed.");
    return base.slice(0, end) + markup + base.slice(end);
  }
  const body = /<body(?:\s[^>]*)?>/i.exec(base);
  if (!body) fail("Cannot attach context metadata: HTML document has no body.");
  const end = body.index + body[0].length;
  // Plain HTML fallback for smaller render templates.
  const fallback = markup.replace(
    '<div class="am-head-meta am-conversation-provenance"',
    '<div style="padding:12px 24px;font:14px/1.6 system-ui,sans-serif" class="am-head-meta am-conversation-provenance"',
  );
  return base.slice(0, end) + fallback + base.slice(end);
}

function extractSummary(html: string) {
  const subtitle = /<p class="am-sub">([\s\S]*?)<\/p>/i.exec(html);
  const intro = /<div class="am-intro[^"]*"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i.exec(html);
  const summary = textOnly((subtitle || intro)?.[1] || "");
  return summary.length > 180 ? summary.slice(0, 179).trimEnd() + "…" : summary;
}

function indexStyles() {
  return [
    '@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,600;6..72,700&display=swap");',
    ':root{color-scheme:light;--bg:#f6f3ee;--text:#221d17;--muted:#675c50;--faint:#85796d;--accent:#95603d;--line:rgba(74,59,43,.16);--serif:"Newsreader","Songti SC","Noto Serif CJK SC",Georgia,serif;--sans:"IBM Plex Sans","PingFang SC","Microsoft Yahei",system-ui,sans-serif}',
    "@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#12100d;--text:#f0e8de;--muted:#b2a596;--faint:#897d70;--accent:#ddb38e;--line:rgba(217,190,157,.19)}}",
    "*,*::before,*::after{box-sizing:border-box}",
    "html{scroll-behavior:smooth}",
    "body{background:var(--bg);color:var(--text);font-family:var(--sans);margin:0;min-height:100vh;-webkit-font-smoothing:antialiased}",
    "a{color:inherit;text-decoration:none}",
    "a:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:2px}",
    ".site-main{max-width:624px;padding:56px 24px 80px;margin:0 auto}",
    ".intro{margin-bottom:28px}",
    ".intro h1{font:700 36px/1.12 var(--serif);letter-spacing:-.03em;margin:0 0 10px}",
    ".intro p{font-size:15px;line-height:1.65;color:var(--muted);margin:0}",
    ".group+.group{margin-top:32px}",
    ".group-header{position:relative;isolation:isolate;display:flex;align-items:flex-end;justify-content:space-between;min-height:56px;padding:20px 0 8px}",
    ".group-watermark{position:absolute;inset:0;overflow:hidden;z-index:-1;pointer-events:none;user-select:none}",
    ".group-watermark span{font:600 clamp(48px,8vw,80px)/1.1 var(--serif);color:transparent;white-space:nowrap;letter-spacing:-.025em;opacity:.10;-webkit-text-stroke:1px var(--muted)}",
    ".group-header h2,.group-count{font:400 12px/1.5 var(--sans);letter-spacing:.04em;color:var(--muted);margin:0}",
    ".entries{list-style:none;margin:0;padding:0}",
    ".entry-link{display:block;min-height:44px;min-width:0;padding:12px 0}",
    ".entry-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px}",
    ".entry-title{font:400 18px/1.375 var(--serif);flex:1;min-width:0;overflow-wrap:anywhere;transition:color .2s}",
    ".entry-date{font:400 12px/1.5 var(--sans);font-variant-numeric:tabular-nums;color:var(--muted);flex-shrink:0;white-space:nowrap}",
    ".entry-description{display:block;font:400 14px/1.625 var(--sans);color:var(--muted);margin-top:4px;overflow-wrap:anywhere}",
    ".entry-link:hover .entry-title{color:var(--accent);text-decoration:underline;text-underline-offset:.2em}",
    ".entry-download{display:inline-block;margin-bottom:12px;font-size:13px;color:var(--accent);text-decoration:underline;text-underline-offset:.2em}",
    ".entry-origin{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;color:var(--faint);font:400 12px/1.5 var(--sans);padding:0 0 12px}",
    ".entry-origin-platform{font-weight:600;color:var(--muted)}",
    ".entry-origin-title{min-width:0;overflow-wrap:anywhere}",
    ".entry-origin a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:2px}",
    ".empty{padding:35px 0;color:var(--muted)}",
    "@media(max-width:767px){.site-main{padding-top:36px}.intro h1{font-size:32px}}",
    "@media(max-width:479px){.entry-head{flex-wrap:wrap;gap:4px 16px}.entry-title{flex-basis:100%}}",
    "@media(max-width:360px){.site-main{padding-left:20px;padding-right:20px}}",
  ].join("\n");
}

async function makeIndex(catalog: Catalog, directory = siteDir) {
  const groups = new Map<string, GalleryEntry[]>();
  for (const [slug, metadata] of Object.entries(catalog.pages)) {
    const original = await readFile(path.join(directory, "pages", slug + ".html"), "utf8");
    const item = {
      slug,
      title: decodeEntities(extractTitle(original, slug)),
      description: extractSummary(original),
      publishedAt: metadata.publishedAt,
      group: metadata.group,
      context: metadata.context,
      conversation: metadata.conversation,
      editable: metadata.downloadDigest !== undefined,
    };
    const entries = groups.get(item.group) ?? [];
    entries.push(item);
    groups.set(item.group, entries);
  }
  const orderedGroups = [...groups.keys()].sort((a, b) =>
    a === "posts" ? 1 : b === "posts" ? -1 : a.localeCompare(b, "en"),
  );
  const sections = orderedGroups.map((group) => {
    const entries = (groups.get(group) ?? []).sort(
      (a, b) =>
        b.publishedAt.localeCompare(a.publishedAt) ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
    const label = group === "posts" ? "Posts" : group;
    const rows = entries.map((entry) => {
      const url = "./pages/" + encodeURIComponent(entry.slug) + ".html";
      const date = entry.publishedAt.slice(0, 10);
      return [
        '      <li><a class="entry-link" href="' + url + '">',
        '        <span class="entry-head"><span class="entry-title">' +
          escapeHtml(entry.title) +
          '</span><time class="entry-date" datetime="' +
          escapeHtml(entry.publishedAt) +
          '">' +
          date +
          "</time></span>",
        entry.description
          ? '        <span class="entry-description">' + escapeHtml(entry.description) + "</span>"
          : "",
        "      </a>",
        entry.editable
          ? `      <a class="entry-download" href="./${downloadPath(entry.slug)}" download="${entry.slug}.html">Download editable HTML</a>`
          : "",
        entry.conversation
          ? `      <a class="entry-download" href="./${conversationPaths(entry.slug).html}">Read conversation</a> · <a class="entry-download" href="./${conversationPaths(entry.slug).json}" download="${entry.slug}.json">Download conversation JSON</a>`
          : "",
        entry.context ? "      " + contextMarkup(entry.context) : "",
        "      </li>",
      ]
        .filter(Boolean)
        .join("\n");
    });
    return [
      '    <section class="group" aria-labelledby="group-' + escapeHtml(group) + '">',
      '      <header class="group-header">',
      '        <div class="group-watermark" aria-hidden="true"><span>' +
        escapeHtml(label) +
        "</span></div>",
      '        <h2 id="group-' + escapeHtml(group) + '">' + escapeHtml(label) + "</h2>",
      '        <span class="group-count">' + String(entries.length).padStart(2, "0") + "</span>",
      "      </header>",
      '      <ul class="entries">',
      ...rows,
      "      </ul>",
      "    </section>",
    ].join("\n");
  });
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <meta name="robots" content="noindex, nofollow">',
    '  <meta name="description" content="Technical notes, architecture and project explanations.">',
    "  <title>Explainers</title>",
    "  <style>" + indexStyles() + "</style>",
    "</head>",
    "<body>",
    '  <main class="site-main">',
    '    <header class="intro"><h1>Explainers</h1><p>Visual notes on code, architecture, and ideas worth keeping.</p></header>',
    ...sections,
    ...(!sections.length ? ['    <p class="empty">No explanations published yet.</p>'] : []),
    "  </main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
  await atomicWrite(path.join(directory, "index.html"), html);
  await atomicWrite(path.join(directory, "pages.json"), JSON.stringify(catalog, null, 2) + "\n");
  return Object.keys(catalog.pages).length;
}

async function loadRenderedHtml(file: string | undefined): Promise<RenderedHtml> {
  if (!file || path.extname(file).toLowerCase() !== ".html")
    fail("Supply an existing generated .html file.");
  const source = path.resolve(file);
  const information = await stat(source);
  if (!information.isFile()) fail("Source is not a regular file.");
  const html = await readFile(source);
  if (!html.toString("utf8", 0, 40).toLowerCase().includes("<!doctype html"))
    fail("Source does not look like a standalone generated HTML page.");
  return { source, html };
}

async function stage(file: string, flags: Flags) {
  const slug = readSlug(flags.slug);
  const { source, html } = await loadRenderedHtml(file);
  await mkdir(pagesDir, { recursive: true });
  const catalog = await readCatalog();
  const oldMetadata = catalog.pages[slug];
  const context = contextFromFlags(flags, oldMetadata?.context);
  const metadata = pageMetadata(flags, oldMetadata, context);
  const original = html.toString("utf8");
  const decorated = Buffer.from(withProvenance(original, context), "utf8");
  const target = path.join(pagesDir, slug + ".html");
  let existing;
  try {
    existing = await readFile(target);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (
    existing !== undefined &&
    withoutProvenance(existing.toString("utf8")) !== withoutProvenance(original) &&
    !flags.replace
  )
    fail("Slug already exists with different content; pass --replace to update it.");
  if (existing === undefined || !existing.equals(decorated)) {
    const temp = target + ".next-" + process.pid;
    await writeFile(temp, decorated);
    await rename(temp, target);
  }
  catalog.pages[slug] = metadata;
  const total = await makeIndex(catalog);
  return { slug, total };
}

function fetchWithVercel(origin: string, pagePath: string, team: string, cwd = home): Buffer {
  // Vercel CLI authenticates requests without exposing long-lived bypass secrets
  // to this script. Raw curl cannot verify pages behind Deployment Protection.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(
      "vercel",
      [
        "curl",
        origin + pagePath,
        "--scope",
        team,
        "--",
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "30",
      ],
      { cwd, maxBuffer: 100 * 1024 * 1024 },
    );
    if (result.error) fail("Cannot start authenticated Vercel request: " + result.error.message);
    if (result.status === 0) return result.stdout;
    const cause = result.stderr.toString("utf8").trim();
    if (attempt > 0 || !/curl: \((?:28|35)\)/.test(cause))
      fail(
        "Authenticated Vercel request failed for " + origin + pagePath + ": " + cause.slice(-800),
      );
  }
  fail("Authenticated Vercel request could not finish.");
}

function sha256(contents: string | Uint8Array) {
  return createHash("sha256").update(contents).digest("hex");
}

function projectDigest(config: DeliveryConfig) {
  return sha256(config.team + "/" + config.projectId);
}

function galleryHasPage(gallery: string, slug: string) {
  return gallery.includes(`class="entry-link" href="./pages/${slug}.html"`);
}

function verify(origin: string, slug: string, digest: string, team: string, cwd?: string) {
  const pagePath = "/pages/" + encodeURIComponent(slug) + ".html";
  const page = origin + pagePath;
  const actual = sha256(fetchWithVercel(origin, pagePath, team, cwd));
  if (actual !== digest) fail("Published page differs from local HTML: " + page);
  const gallery = fetchWithVercel(origin, "/", team, cwd).toString("utf8");
  if (!galleryHasPage(gallery, slug))
    fail("The published gallery is missing the page link at " + origin);
  return page;
}

async function writeDownload(directory: string, slug: string, bytes: Buffer, digest: string) {
  if (sha256(bytes) !== digest) fail("Editable download differs from the catalog: " + slug);
  await mkdir(path.join(directory, "downloads"), { recursive: true });
  await writeFile(path.join(directory, downloadPath(slug)), bytes);
}

async function copyPage(
  directory: string,
  slug: string,
  metadata: PageMetadata,
  load: (file: string) => Promise<Buffer>,
) {
  const file = "pages/" + slug + ".html";
  const bytes = await load(file);
  for (const [resource, digest] of Object.entries(sidecarDigests(slug, metadata))) {
    const contents = await load(resource);
    if (sha256(contents) !== digest)
      fail("Published resource differs from the catalog: " + resource);
    await mkdir(path.dirname(path.join(directory, resource)), { recursive: true });
    await writeFile(path.join(directory, resource), contents);
  }
  if (metadata.downloadDigest || metadata.conversation) {
    await writeFile(path.join(directory, file), bytes);
    return;
  }
  const html = bytes.toString("utf8");
  const editable = readPage(html).source !== null;
  if (editable) {
    metadata.downloadDigest = sha256(bytes);
    await writeDownload(directory, slug, bytes, metadata.downloadDigest);
  }
  await writeFile(path.join(directory, file), readingPage(html, editable ? slug : undefined));
}

async function readPublishedState(config: DeliveryConfig): Promise<PublishedState | undefined> {
  let data: unknown;
  try {
    data = parseJson(await readFile(publishedFile, "utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  if (
    !isRecord(data) ||
    data.schemaVersion !== 2 ||
    !isRecord(data.pages) ||
    normalizePublicOrigin(data.origin) !== data.origin
  )
    fail("Invalid verified publication record.");
  if (data.projectDigest !== projectDigest(config))
    fail("The verified publication archive belongs to a different Vercel project.");
  for (const [slug, record] of Object.entries(data.pages)) {
    approvedMetadata(slug, record);
    if (!isRecord(record) || !validDigest(record.digest))
      fail("Invalid saved page digest for " + slug);
  }
  return data as PublishedState;
}

function approvedMetadata(slug: string, record: unknown): PageMetadata {
  readSlug(slug);
  if (
    !isRecord(record) ||
    record.group !== normalizeGroup(record.group) ||
    !validTimestamp(record.publishedAt)
  )
    fail("Invalid published metadata for " + slug);
  const context = normalizeContext(record.context);
  const metadata = pageMetadata(
    {},
    { group: record.group, publishedAt: record.publishedAt },
    context,
  );
  if (record.downloadDigest !== undefined) {
    if (!validDigest(record.downloadDigest)) fail("Invalid editable download digest for " + slug);
    metadata.downloadDigest = record.downloadDigest;
  }
  if (record.conversation !== undefined) {
    const archive = record.conversation;
    if (
      !isRecord(archive) ||
      Object.keys(archive).length !== 2 ||
      !validDigest(archive.jsonDigest) ||
      !validDigest(archive.htmlDigest)
    )
      fail("Invalid conversation archive digests for " + slug);
    metadata.conversation = { jsonDigest: archive.jsonDigest, htmlDigest: archive.htmlDigest };
  }
  return metadata;
}

function readProductionCatalog(config: EnabledConfig, origin: string) {
  const gallery = fetchWithVercel(origin, "/", config.team).toString("utf8");
  const catalog = catalogFromJson(
    parseJson(fetchWithVercel(origin, "/pages.json", config.team).toString("utf8")),
    "Cannot recover the current production catalog.",
  );
  if (
    catalog?.schemaVersion !== 1 ||
    !catalog.pages ||
    Array.isArray(catalog.pages) ||
    typeof catalog.pages !== "object"
  )
    fail("Cannot recover the current production catalog.");
  const listed = new Set(
    [...gallery.matchAll(/class="entry-link" href="\.\/pages\/([a-z0-9-]+)\.html"/g)].map(
      (match) => match[1],
    ),
  );
  const slugs = Object.keys(catalog.pages);
  if (listed.size !== slugs.length || slugs.some((slug) => !listed.has(slug)))
    fail("The current production gallery and catalog do not agree.");
  return catalog.pages;
}

async function copyProductionPages(config: EnabledConfig, directory: string, production: string) {
  const pages = readProductionCatalog(config, production);
  const catalog: Catalog = { schemaVersion: 1, pages: Object.create(null) };
  for (const [slug, record] of Object.entries(pages)) {
    const metadata = approvedMetadata(slug, record);
    catalog.pages[slug] = metadata;
    await copyPage(directory, slug, metadata, async (file) =>
      fetchWithVercel(production, "/" + file, config.team),
    );
  }
  return catalog;
}

async function copyApprovedPages(config: EnabledConfig, directory: string, replacement?: string) {
  const saved = await readPublishedState(config);
  const catalog: Catalog = { schemaVersion: 1, pages: Object.create(null) };
  if (!saved) {
    if (currentProduction(config))
      fail(
        "An existing production deployment requires a publication archive for immutable snapshots.",
      );
    return catalog;
  }
  for (const [slug, record] of Object.entries(saved.pages)) {
    const metadata = approvedMetadata(slug, record);
    catalog.pages[slug] = metadata;
    if (slug === replacement) continue;
    await copyPage(directory, slug, metadata, async (file) => {
      const digest = sidecarDigests(slug, metadata)[file] ?? record.digest;
      const contents = await readFile(path.join(publishedPagesDir, digest + ".html"));
      if (sha256(contents) !== digest) fail("Saved published page was modified: " + slug);
      return contents;
    });
  }
  return catalog;
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function preparePage(
  { source, html }: RenderedHtml,
  flags: Flags,
  previousContext?: ConversationContext,
): PreparedPage {
  const slug = readSlug(flags.slug);
  const context = contextFromFlags(flags, previousContext);
  const original = withoutProvenance(html.toString("utf8"));
  const contents = Buffer.from(withProvenance(original, context));
  return { source, slug, context, original, contents };
}

function sidecarDigests(slug: string, metadata: PageMetadata): Record<string, string> {
  return {
    ...(metadata.downloadDigest ? { [downloadPath(slug)]: metadata.downloadDigest } : {}),
    ...(metadata.conversation
      ? {
          [conversationPaths(slug).json]: metadata.conversation.jsonDigest,
          [conversationPaths(slug).html]: metadata.conversation.htmlDigest,
        }
      : {}),
  };
}

function pagePaths(slug: string, metadata: PageMetadata) {
  return ["pages/" + slug + ".html", ...Object.keys(sidecarDigests(slug, metadata))];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (isRecord(value))
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]))
        .join(",") +
      "}"
    );
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return JSON.stringify(value);
  fail("Invalid review manifest value.");
}

function reviewSelection(flags: Flags, context?: ConversationContext) {
  return {
    replace: flags.replace === true,
    clearContext: flags["clear-context"] === true,
    group: flags.group === undefined ? null : normalizeGroup(flags.group),
    publishedAt:
      flags["published-at"] === undefined ? null : normalizePublishedAt(flags["published-at"]),
    context: context ?? null,
    ...(flags["article-only"] ? { articleOnly: true } : {}),
  };
}

async function requireArchiveSelection(includesConversation: boolean, flags: Flags) {
  if (flags["article-only"]) {
    if (includesConversation) fail("--article-only cannot be used with a conversation archive.");
    return;
  }
  if (includesConversation) return;
  const status = await chatgptStatus(home);
  if (status.status === "configured") {
    if (!status.archivePublicationOptIn) return;
    fail(
      "ChatGPT archive is enabled. Supply a private ChatGPT conversation URL to capture an archive, or explicitly choose --article-only for this publication.",
    );
  }
  if (status.reason !== "credentials_missing")
    fail(
      "Cannot determine ChatGPT archive authorization (" +
        status.reason +
        "). Resolve the credential issue or explicitly choose --article-only for this publication.",
    );
}

async function readRegular(file: string, limit = 100 * 1024 * 1024) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const information = await handle.stat();
    if (!information.isFile() || information.size > limit)
      fail("Invalid or oversized reviewed file.");
    const bytes = await handle.readFile();
    if (bytes.length > limit) fail("Invalid or oversized reviewed file.");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function assertResourceFiles(directory: string, paths: string[]) {
  if (!(await lstat(directory)).isDirectory()) fail("Invalid snapshot directory.");
  const folders = new Set(
    paths.filter((file) => file.includes("/")).map((file) => file.split("/")[0]),
  );
  const roots = paths.filter((file) => !file.includes("/"));
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.length !== folders.size + roots.length ||
    entries.some((entry) =>
      folders.has(entry.name)
        ? !entry.isDirectory()
        : !roots.includes(entry.name) || !entry.isFile(),
    )
  )
    fail("Unexpected snapshot files.");
  for (const folder of folders) {
    const contents = await readdir(path.join(directory, folder), { withFileTypes: true });
    if (
      contents.length !== paths.filter((file) => file.startsWith(folder + "/")).length ||
      contents.some((entry) => !entry.isFile() || !paths.includes(folder + "/" + entry.name))
    )
      fail("Unexpected snapshot files under " + folder + ".");
  }
}

async function readReview(input: RenderedHtml, flags: Flags): Promise<ReviewedPage> {
  const slug = readSlug(flags.slug);
  const digest = flags["reviewed-sha256"];
  const mismatch =
    "Selected HTML, metadata or resources differ from --reviewed-sha256. Run review again.";
  if (!validDigest(digest)) fail(mismatch);
  const directory = path.join(reviewDir, digest);
  let manifest: unknown;
  try {
    manifest = parseJson(
      (await readRegular(path.join(directory, "manifest.json"), 1024 * 1024)).toString("utf8"),
    );
  } catch {
    fail("Cannot read the --reviewed-sha256 selection. Run review again.");
  }
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    sha256(canonicalJson(manifest)) !== digest ||
    manifest.source !== input.source ||
    manifest.sourceDigest !== sha256(input.html) ||
    manifest.slug !== slug ||
    !isRecord(manifest.files) ||
    !Object.values(manifest.files).every(validDigest)
  )
    fail(mismatch);
  const metadata = approvedMetadata(slug, manifest.metadata);
  const prepared = preparePage(input, flags, metadata.context);
  if (canonicalJson(manifest.selection) !== canonicalJson(reviewSelection(flags, prepared.context)))
    fail(mismatch);
  const digests = manifest.files;
  const paths = pagePaths(prepared.slug, metadata);
  if (
    paths.length !== Object.keys(digests).length ||
    paths.some((file) => !Object.hasOwn(digests, file))
  )
    fail(mismatch);
  await assertResourceFiles(directory, ["manifest.json", ...paths]);
  const files = new Map<string, Buffer>();
  for (const file of paths) {
    const bytes = await readRegular(path.join(directory, file));
    if (sha256(bytes) !== manifest.files[file]) fail(mismatch);
    files.set(file, bytes);
  }
  for (const [file, expected] of Object.entries(sidecarDigests(prepared.slug, metadata))) {
    if (manifest.files[file] !== expected) fail(mismatch);
  }
  if (flags["conversation-bundle"]) {
    const bytes = await readConversationBundle(flags["conversation-bundle"]);
    if (
      !metadata.conversation ||
      sha256(bytes.json) !== metadata.conversation.jsonDigest ||
      sha256(bytes.html) !== metadata.conversation.htmlDigest
    )
      fail(mismatch);
  }
  return { ...prepared, metadata, files };
}

async function review(file: string, flags: Flags) {
  const input = await loadRenderedHtml(file);
  const slug = readSlug(flags.slug);
  await requireArchiveSelection(Boolean(flags["conversation-bundle"]), flags);
  const config = await readSettings();
  let previous: PageMetadata | undefined;
  if (config && validProject(config)) {
    const saved = await readPublishedState(config);
    previous = saved?.pages[slug];
    if (config.mode === "vercel" && config.aliasDomain && flags.replace && !previous) {
      const origin = currentProduction(config);
      if (origin) {
        const record = readProductionCatalog({ ...config, mode: "vercel" }, origin)[slug];
        previous = record === undefined ? undefined : approvedMetadata(slug, record);
      }
    }
  }
  const prepared = preparePage(input, flags, previous?.context);
  const metadata = pageMetadata(flags, previous, prepared.context);
  const files = new Map<string, Buffer>();
  const editable = readPage(prepared.original).source !== null;
  if (editable) {
    metadata.downloadDigest = sha256(prepared.contents);
    files.set(downloadPath(prepared.slug), prepared.contents);
  }
  if (flags["conversation-bundle"]) {
    const bytes = await readConversationBundle(flags["conversation-bundle"]);
    metadata.conversation = { jsonDigest: sha256(bytes.json), htmlDigest: sha256(bytes.html) };
    files.set(conversationPaths(prepared.slug).json, bytes.json);
    files.set(conversationPaths(prepared.slug).html, bytes.html);
  }
  const page = "pages/" + prepared.slug + ".html";
  files.set(
    page,
    Buffer.from(
      readingPage(
        prepared.contents.toString("utf8"),
        editable ? prepared.slug : undefined,
        metadata.conversation ? prepared.slug : undefined,
      ),
    ),
  );
  const manifest = {
    schemaVersion: 1,
    source: input.source,
    sourceDigest: sha256(input.html),
    slug: prepared.slug,
    selection: reviewSelection(flags, prepared.context),
    metadata,
    files: Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)])),
  };
  const manifestBytes = canonicalJson(manifest);
  const digest = sha256(manifestBytes);
  await mkdir(reviewDir, { recursive: true, mode: 0o700 });
  const directory = path.join(reviewDir, digest);
  const temporary = await mkdtemp(path.join(reviewDir, "selection-"));
  try {
    for (const [name, bytes] of files) {
      await mkdir(path.dirname(path.join(temporary, name)), { recursive: true, mode: 0o700 });
      await writeFile(path.join(temporary, name), bytes, { mode: 0o400, flag: "wx" });
    }
    await writeFile(path.join(temporary, "manifest.json"), manifestBytes + "\n", {
      mode: 0o400,
      flag: "wx",
    });
    await rename(temporary, directory).catch((error) => {
      if (!["EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? "")) throw error;
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  await readReview(input, { ...flags, "reviewed-sha256": digest });
  const paths = {
    page: path.join(directory, page),
    manifest: path.join(directory, "manifest.json"),
    ...(editable ? { download: path.join(directory, downloadPath(prepared.slug)) } : {}),
    ...(metadata.conversation
      ? {
          conversation: {
            json: path.join(directory, conversationPaths(prepared.slug).json),
            html: path.join(directory, conversationPaths(prepared.slug).html),
          },
        }
      : {}),
  };
  const result = {
    source: prepared.source,
    slug: prepared.slug,
    sha256: digest,
    path: paths.page,
    paths,
    conversation: metadata.conversation
      ? { status: "selected", ...paths.conversation }
      : { status: "absent" },
  };
  if (flags.json) process.stdout.write(JSON.stringify(result) + "\n");
  else {
    const resources = [...files.keys()].map((name) => path.join(directory, name));
    process.stdout.write(
      "Review HTML: " +
        result.path +
        "\nReview resources:\n" +
        resources.join("\n") +
        "\nSHA256: " +
        result.sha256 +
        "\n",
    );
  }
}

function snapshotPaths(catalog: Catalog) {
  return [
    "index.html",
    "pages.json",
    ...Object.entries(catalog.pages).flatMap(([slug, metadata]) => pagePaths(slug, metadata)),
  ];
}

function writeJournal(journal: Journal, file = journalFile) {
  return atomicWrite(file, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
}

async function readJournal() {
  try {
    const journal = parseJson(await readFile(journalFile, "utf8"));
    if (!isRecord(journal)) fail("Invalid pending publication journal.");
    return journal;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      const pending = await stat(pendingDir).catch((cause) => {
        if (errorCode(cause) !== "ENOENT") throw cause;
      });
      if (!pending) return undefined;
    }
    throw error;
  }
}

function validateJournal(
  journal: Record<string, unknown>,
  config: DeliveryConfig,
): asserts journal is Journal {
  const phases = ["prepared", "uploading", "deployed", "verified"];
  if (
    journal?.schemaVersion !== 1 ||
    !phases.some((phase) => phase === journal.phase) ||
    typeof journal.source !== "string" ||
    !path.isAbsolute(journal.source) ||
    typeof journal.slug !== "string" ||
    !SAFE_SLUG.test(journal.slug) ||
    !journal.digests ||
    typeof journal.digests !== "object" ||
    Array.isArray(journal.digests) ||
    !Object.values(journal.digests).every(validDigest) ||
    !Object.hasOwn(journal.digests, "pages/" + journal.slug + ".html") ||
    (["prepared", "uploading"].some((phase) => phase === journal.phase)
      ? journal.origin !== undefined
      : normalizePublicOrigin(journal.origin) !== journal.origin)
  )
    fail("Invalid pending publication journal.");
  if (journal.production !== undefined) {
    const { alias, baseline, requested } = isRecord(journal.production) ? journal.production : {};
    if (
      new URL(aliasOrigin(alias)).hostname !== alias ||
      normalizePublicOrigin(baseline) !== baseline ||
      (requested !== undefined && (requested !== true || journal.phase !== "verified"))
    )
      fail("Invalid production promotion in pending publication.");
  }
  if (journal.projectDigest !== projectDigest(config))
    fail("The pending publication belongs to a different Vercel project.");
}

async function prepareSnapshot(
  config: EnabledConfig,
  prepared: ReviewedPage,
  flags: Flags,
  production?: Production,
) {
  const { source, slug, original, metadata, files } = prepared;
  const directory = await mkdtemp(path.join(home, "vercel-upload-"));
  const site = path.join(directory, "site");
  try {
    await mkdir(path.join(site, "pages"), { recursive: true });
    const catalog = production
      ? await copyProductionPages(config, site, production.baseline)
      : await copyApprovedPages(config, site, flags.replace ? slug : undefined);
    const target = path.join(site, "pages", slug + ".html");
    const previous = catalog.pages[slug];
    if (previous && !flags.replace) {
      const existing = await readFile(
        previous.downloadDigest ? path.join(site, downloadPath(slug)) : target,
        "utf8",
      );
      const expected = previous.downloadDigest
        ? original
        : readingPage(original, undefined, previous.conversation ? slug : undefined);
      if (
        withoutProvenance(existing) !== expected ||
        canonicalJson(previous.conversation ?? null) !==
          canonicalJson(metadata.conversation ?? null)
      )
        fail("Slug already exists with different content; pass --replace to update it.");
    }
    if (previous?.downloadDigest && !metadata.downloadDigest)
      fail("Use an editable HTML file to replace a page with an editable download.");
    if (previous) {
      for (const resource of Object.keys(sidecarDigests(slug, previous))) {
        if (!files.has(resource)) await rm(path.join(site, resource), { force: true });
      }
    }
    for (const [resource, bytes] of files) {
      await mkdir(path.dirname(path.join(site, resource)), { recursive: true });
      await writeFile(path.join(site, resource), bytes);
    }
    for (const folder of ["downloads", "conversations"]) {
      const location = path.join(site, folder);
      const entries = await readdir(location).catch((error) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
      if (entries?.length === 0) await rm(location, { recursive: true });
    }
    catalog.pages[slug] = metadata;
    await makeIndex(catalog, site);
    const digests: Record<string, string> = Object.create(null);
    for (const file of snapshotPaths(catalog)) {
      digests[file] = sha256(await readFile(path.join(site, file)));
    }
    const journal: Journal = {
      schemaVersion: 1,
      phase: "prepared",
      projectDigest: projectDigest(config),
      source,
      slug,
      digests,
      ...(production && { production }),
    };
    await writeJournal(journal, path.join(directory, "journal.json"));
    await rename(directory, pendingDir);
    return journal;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch((error) => {
      process.stderr.write(
        "Could not remove the temporary directory: " + errorMessage(error) + "\n",
      );
    });
  }
}

async function clearPending() {
  const complete = pendingDir + ".complete-" + randomUUID();
  await rename(pendingDir, complete);
  await rm(complete, { recursive: true, force: true }).catch((error) => {
    process.stderr.write("Could not remove the completed snapshot: " + errorMessage(error) + "\n");
  });
}

async function readSnapshot(journal: Journal): Promise<Snapshot> {
  const files = new Map<string, Buffer>();
  const read = async (file: string) => {
    const bytes = await readRegular(path.join(pendingSite, file));
    if (sha256(bytes) !== journal.digests[file]) fail("Pending snapshot differs at " + file);
    files.set(file, bytes);
    return bytes;
  };
  const catalog = catalogFromJson(
    parseJson((await read("pages.json")).toString("utf8")),
    "Invalid pending snapshot catalog.",
  );
  if (
    catalog?.schemaVersion !== 1 ||
    !catalog.pages ||
    Array.isArray(catalog.pages) ||
    typeof catalog.pages !== "object" ||
    !Object.hasOwn(catalog.pages, journal.slug)
  )
    fail("Invalid pending snapshot catalog.");
  const pages: Record<string, PageMetadata> = Object.create(null);
  for (const [slug, record] of Object.entries(catalog.pages)) {
    const metadata = approvedMetadata(slug, record);
    for (const [resource, digest] of Object.entries(sidecarDigests(slug, metadata))) {
      if (journal.digests[resource] !== digest)
        fail("The pending resource digest differs from the catalog: " + resource);
    }
    pages[slug] = metadata;
  }
  const checkedCatalog = { ...catalog, pages };
  const paths = snapshotPaths(checkedCatalog);
  if (
    paths.length !== Object.keys(journal.digests).length ||
    paths.some((file) => !Object.hasOwn(journal.digests, file))
  )
    fail("The pending snapshot catalog and digests do not agree.");
  await assertResourceFiles(pendingSite, paths);
  for (const file of paths) {
    if (!files.has(file)) await read(file);
  }
  return { catalog: checkedCatalog, files };
}

async function rememberPublished(config: EnabledConfig, journal: Journal, snapshot: Snapshot) {
  await mkdir(publishedPagesDir, { recursive: true, mode: 0o700 });
  const store = async (file: string) => {
    const digest = journal.digests[file];
    const contents = snapshot.files.get(file) ?? fail("Pending snapshot differs at " + file);
    const stored = path.join(publishedPagesDir, digest + ".html");
    const existing = await readFile(stored).catch((error) => {
      if (errorCode(error) !== "ENOENT") throw error;
    });
    if (!existing?.equals(contents)) await atomicWrite(stored, contents, { mode: 0o600 });
    return digest;
  };
  const pages: Record<string, PublishedRecord> = Object.create(null);
  for (const [slug, metadata] of Object.entries(snapshot.catalog.pages)) {
    const digest = await store("pages/" + slug + ".html");
    for (const resource of Object.keys(sidecarDigests(slug, metadata))) await store(resource);
    pages[slug] = { ...metadata, digest };
  }
  await atomicWrite(
    publishedFile,
    JSON.stringify(
      {
        schemaVersion: 2,
        projectDigest: projectDigest(config),
        origin: journal.origin,
        pages,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}

function recordPending(result: PublicationResult, journal?: Record<string, unknown>) {
  result.source = journal?.source ?? result.source;
  result.slug = journal?.slug ?? result.slug;
  result.archive = "pending";
  result.remote =
    journal?.phase === "prepared"
      ? { state: "not-attempted" }
      : { state: "unknown", ...(journal?.origin ? { url: journal.origin } : {}) };
}

async function probePreferred(
  origin: string,
  slug: string,
  digest: string,
): Promise<PreferredProbe> {
  const url = origin + "/pages/" + slug + ".html";
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const status = response.status;
    if (status !== 200) {
      await response.body?.cancel();
      return {
        state: [401, 403].includes(status) ? "protected" : "unverified",
        url,
        status,
      };
    }
    const hash = createHash("sha256");
    let bytes = 0;
    if (!response.body) return { state: "unavailable", url };
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 30 * 1024 * 1024) return { state: "unverified", url, status };
      hash.update(chunk);
    }
    const state = hash.digest("hex") === digest ? "verified" : "mismatch";
    return { state, url, status };
  } catch {
    return { state: "unavailable", url };
  }
}

function observeProduction(config: DeliveryConfig, origin?: string) {
  try {
    const current = currentProduction(config);
    const relation = current === origin ? "matches-record" : current ? "different" : "absent";
    return { state: "not-written", current, relation };
  } catch (error) {
    return { state: "not-written", relation: "unavailable", error: errorMessage(error) };
  }
}

function recordVerified(result: PublicationResult, origin: string, slug: string) {
  result.remote = { state: "verified", url: origin };
  result.delivery = {
    kind: "immutable",
    url: origin + "/pages/" + slug + ".html",
    access: "authenticated",
  };
}

function boundDeployment(config: EnabledConfig, hostname: string) {
  const alias = runVercel([
    "api",
    "/v4/aliases/" + encodeURIComponent(hostname),
    "--scope",
    config.team,
    "--non-interactive",
  ]);
  if (
    !isRecord(alias) ||
    alias.alias !== hostname ||
    alias.projectId !== config.projectId ||
    alias.redirect
  )
    return null;
  return isRecord(alias.deployment) && alias.deployment.url
    ? aliasOrigin(alias.deployment.url)
    : null;
}

function productionBaseline(config: EnabledConfig) {
  if (!config.aliasDomain) return undefined;
  const baseline = currentProduction(config);
  if (!baseline || boundDeployment(config, config.aliasDomain) !== baseline)
    fail("The selected alias does not point to this project's current production deployment.");
  return { alias: config.aliasDomain, baseline };
}

async function promotePublication(
  config: EnabledConfig,
  journal: Journal & { origin: string; production: Production },
  result: PublicationResult,
) {
  const { alias, baseline } = journal.production;
  if (config.aliasDomain !== alias)
    fail("The saved delivery alias changed while publication was pending.");
  const current = currentProduction(config);
  if (current !== journal.origin) {
    const bound = boundDeployment(config, alias);
    if (journal.production.requested) {
      result.production = { state: "unknown", current };
      fail(
        "The prior promotion request is unresolved. Check its Vercel status before retrying recovery.",
      );
    }
    if (current !== baseline || bound !== baseline) {
      result.production = { state: "conflict", current };
      return;
    }
    result.production = { state: "unknown", current };
    await writeJournal({ ...journal, production: { ...journal.production, requested: true } });
    runVercelText(
      ["promote", journal.origin, "--scope", config.team, "--yes", "--non-interactive"],
      pendingDir,
    );
  }
  if (
    currentProduction(config) !== journal.origin ||
    boundDeployment(config, alias) !== journal.origin
  )
    fail("The production domain has not been confirmed on the new deployment. Run recover.");
  result.production = { state: "promoted", current: journal.origin };
}

async function selectDeliveryLink(
  config: EnabledConfig,
  slug: string,
  digest: string,
  result: PublicationResult,
) {
  if (!config.aliasDomain) {
    result.preferred = { state: "not-configured" };
    return;
  }
  const origin = aliasOrigin(config.aliasDomain);
  const preferred = await probePreferred(origin, slug, digest);
  result.preferred = preferred;
  if (result.production.state === "conflict") return;

  try {
    preferred.binding =
      boundDeployment(config, config.aliasDomain) === result.remote.url
        ? "matches-deployment"
        : "different";
  } catch {
    preferred.binding = "unavailable";
  }
  if (preferred.binding !== "matches-deployment") return;

  const delivery: PublicationResult["delivery"] = {
    kind: "alias",
    url: preferred.url,
    access: preferred.state === "verified" ? "anonymous" : "unverified",
  };
  result.delivery = delivery;
  if (delivery.access === "anonymous") return;

  try {
    const pathname = "/pages/" + slug + ".html";
    const bytes = fetchWithVercel(origin, pathname, config.team);
    if (sha256(bytes) !== digest) {
      preferred.state = "mismatch";
      return;
    }
    preferred.authenticated = true;
    delivery.access = "authenticated";
  } catch {
    // The binding still identifies the published deployment when the page probe is blocked.
  }
}

async function finishPublication(
  config: EnabledConfig,
  journal: Journal & { origin: string },
  snapshot: Snapshot,
  result: PublicationResult,
) {
  for (const [file, expected] of snapshot.files) {
    const pathname = file === "index.html" ? "/" : "/" + file;
    if (!fetchWithVercel(journal.origin, pathname, config.team, pendingSite).equals(expected))
      fail("Staged deployment differs from the verified upload at " + pathname);
  }
  recordVerified(result, journal.origin, journal.slug);
  if (snapshot.catalog.pages[journal.slug].conversation) {
    const resources = conversationPaths(journal.slug);
    result.conversation = {
      status: "published",
      json: journal.origin + "/" + resources.json,
      html: journal.origin + "/" + resources.html,
    };
  }
  result.pages = Object.keys(snapshot.catalog.pages).length;
  const verified = { ...journal, phase: "verified" };
  await writeJournal(verified);
  if (journal.production)
    await promotePublication(config, { ...verified, production: journal.production }, result);
  await rememberPublished(config, journal, snapshot);
  result.archive = "saved";
  await clearPending();
  await selectDeliveryLink(
    config,
    journal.slug,
    journal.digests["pages/" + journal.slug + ".html"],
    result,
  );
}

async function publish(
  config: EnabledConfig,
  input: RenderedHtml,
  flags: Flags,
  result: PublicationResult,
) {
  let pending;
  try {
    pending = await readJournal();
  } catch (error) {
    recordPending(result);
    throw error;
  }
  if (pending !== undefined) {
    recordPending(result, pending);
    fail("A pending publication must be resolved with recover before another upload.");
  }
  const prepared = await readReview(input, flags);
  await requireArchiveSelection(Boolean(prepared.metadata.conversation), flags);
  result.slug = prepared.slug;
  if (prepared.metadata.conversation)
    result.conversation = { status: "selected", ...conversationPaths(prepared.slug) };
  inspectProject(config);
  const journal = await prepareSnapshot(config, prepared, flags, productionBaseline(config));
  recordPending(result, journal);
  const snapshot = await readSnapshot(journal);
  await writeJournal({ ...journal, phase: "uploading" });
  result.remote = { state: "unknown" };
  const response = runVercel(
    [
      "deploy",
      pendingSite,
      "--scope",
      config.team,
      "--project",
      config.projectId,
      "--prod",
      "--skip-domain",
      "--yes",
      "--non-interactive",
      "--json",
    ],
    pendingSite,
  );
  if (!isRecord(response)) fail("The staged production deployment was not READY.");
  const deployed = isRecord(response.deployment) ? response.deployment : undefined;
  const origin = normalizePublicOrigin(deployed?.url);
  result.remote.url = origin;
  const receipt = { ...journal, phase: "deployed", origin };
  await writeJournal(receipt);
  if (
    response.status !== "ok" ||
    deployed?.readyState !== "READY" ||
    deployed?.target !== "production"
  )
    fail("The staged production deployment was not READY.");
  await finishPublication(config, receipt, snapshot, result);
}

function confirmDeployment(config: EnabledConfig, origin: string) {
  const host = new URL(origin).hostname;
  const deployed = runVercel([
    "api",
    "/v13/deployments/" + encodeURIComponent(host),
    "--scope",
    config.team,
    "--non-interactive",
  ]);
  if (!isRecord(deployed) || deployed.projectId !== config.projectId || deployed.url !== host)
    fail("The supplied URL is not an immutable deployment of the pinned Vercel project.");
  if (deployed?.readyState !== "READY") fail("The immutable deployment is not READY.");
}

async function recover(
  config: EnabledConfig,
  journal: Record<string, unknown>,
  flags: Flags,
  result: PublicationResult,
) {
  validateJournal(journal, config);
  if (journal.phase === "prepared") {
    if (flags.deployment) fail("The pending publication never reached upload.");
    await clearPending();
    result.archive = "not-needed";
    return;
  }
  const origin = flags.deployment ? normalizePublicOrigin(flags.deployment) : journal.origin;
  if (!origin)
    fail(
      "The upload result is unknown. Supply the immutable HTTPS origin with recover --deployment.",
    );
  if (journal.origin && journal.origin !== origin)
    fail("The supplied deployment differs from the pending publication's recorded URL.");
  const snapshot = await readSnapshot(journal);
  confirmDeployment(config, origin);
  await finishPublication(config, { ...journal, origin }, snapshot, result);
}

async function withPublicationLock<T>(action: () => Promise<T>): Promise<T> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const lock = await open(lockFile, "wx").catch((error) => {
    if (errorCode(error) === "EEXIST")
      fail("Another publication is in progress; check " + lockFile);
    throw error;
  });
  try {
    return await action();
  } finally {
    try {
      await lock.close();
      await unlink(lockFile);
    } catch (error) {
      process.stderr.write(
        "Could not release the local publication lock: " + errorMessage(error) + "\n",
      );
    }
  }
}

async function verifyExisting(config: EnabledConfig, flags: Flags, result: PublicationResult) {
  const slug = readSlug(flags.slug);
  result.slug = slug;
  const published = await readPublishedState(config);
  result.production = observeProduction(config, published?.origin);
  if (!published) fail("No verified Vercel deployment is recorded.");
  const { origin } = published;
  if (!Object.hasOwn(published.pages, slug))
    fail("No verified publication is recorded for " + slug);
  const record = published.pages[slug];
  result.archive = "saved";
  result.remote = { state: "unknown", url: origin };
  verify(origin, slug, record.digest, config.team);
  for (const [resource, expected] of Object.entries(sidecarDigests(slug, record))) {
    const bytes = fetchWithVercel(origin, "/" + resource, config.team);
    if (sha256(bytes) !== expected)
      fail("Published resource differs from the archive: " + resource);
  }
  if (record.conversation) {
    const resources = conversationPaths(slug);
    result.conversation = {
      status: "published",
      json: origin + "/" + resources.json,
      html: origin + "/" + resources.html,
    };
  }
  recordVerified(result, origin, slug);
  await selectDeliveryLink(config, slug, record.digest, result);
}

function printResult(command: string | undefined, flags: Flags, result: PublicationResult) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  const lines = [];
  if (result.delivery.kind === "immutable" || result.delivery.kind === "alias") {
    if (command !== "verify" && result.archive === "saved")
      lines.push(
        "Published: " + result.delivery.url,
        "Gallery: " + new URL(result.delivery.url ?? fail("Missing delivery URL.")).origin + "/",
      );
    lines.push(
      "Verified Vercel deployment: " + result.remote.url + "/pages/" + result.slug + ".html",
      "Access: " + result.delivery.access,
    );
    if (result.pages) lines.push("Pages: " + result.pages);
    if (result.source) lines.push("Editable source: " + result.source);
  } else if (result.remote.state === "unknown" || result.archive === "pending") {
    lines.push(
      "Remote publication: " +
        result.remote.state +
        (result.remote.url ? " " + result.remote.url : ""),
    );
    if (result.source) lines.push("Editable source: " + result.source);
  } else if (command === "deliver" && result.source) {
    lines.push("Local: " + result.source);
  } else if (command === "publish" && result.source) {
    lines.push("Editable source: " + result.source);
  } else if (command === "recover" && !result.error) {
    lines.push("Cleared a prepared publication before upload.");
  }
  if (result.archive === "pending") lines.push("Archive: pending recovery");
  if (result.conversation.status === "published")
    lines.push(
      "Conversation HTML: " + result.conversation.html,
      "Conversation JSON: " + result.conversation.json,
    );
  if (result.production.state !== "not-written")
    lines.push("Production: " + result.production.state);
  if (result.production.relation)
    lines.push(
      "Current production: " +
        result.production.relation +
        (result.production.current ? " " + result.production.current : ""),
    );
  if (result.preferred.url)
    lines.push(
      "Preferred: " +
        result.preferred.url +
        " (" +
        result.preferred.state +
        (result.preferred.status ? ", HTTP " + result.preferred.status : "") +
        (result.preferred.binding ? ", binding " + result.preferred.binding : "") +
        (result.preferred.authenticated ? ", authenticated page verified" : "") +
        ")",
    );
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
  if (result.error) {
    const label = result.archive === "pending" ? "Publication recovery required: " : "Error: ";
    process.stderr.write(label + result.error + "\n");
  }
}

async function publicationCommand(command: string, positional: string[], flags: Flags) {
  const result: PublicationResult = {
    remote: { state: "not-attempted" },
    production: { state: "not-written" },
    archive: "not-needed",
    delivery: { kind: "local" },
    preferred: { state: "not-tested" },
    conversation: { status: "absent" },
  };
  try {
    if (command === "publish" || command === "deliver") {
      if (positional.length !== 1) fail("Supply exactly one HTML file path.");
      const input = await loadRenderedHtml(positional[0]);
      result.source = input.source;
      if (command === "publish") {
        await withPublicationLock(async () => {
          const config = await readEnabledProject();
          await publish(config, input, flags, result);
        });
      }
    } else {
      if (positional.length) fail(command + " does not take a file path.");
      await withPublicationLock(async () => {
        if (command === "recover") {
          let journal;
          try {
            journal = await readJournal();
          } catch (error) {
            recordPending(result);
            throw error;
          }
          if (journal === undefined) fail("There is no pending publication to recover.");
          recordPending(result, journal);
          await recover(await readEnabledProject(), journal, flags, result);
        } else {
          await verifyExisting(await readEnabledProject(), flags, result);
        }
      });
    }
  } catch (error) {
    result.error = errorMessage(error);
    process.exitCode = 1;
  }
  printResult(command, flags, result);
}

const operationalCommands = ["publish", "deliver", "verify", "recover"];
const pageFlags = [
  "slug",
  "replace",
  "clear-context",
  "group",
  "published-at",
  "context-source",
  "context-title",
  "context-url",
];

function checkOptions(command: string | undefined, flags: Flags) {
  const options: Record<string, string[]> = {
    deliver: [...pageFlags, "reviewed-sha256", "conversation-bundle", "json"],
    publish: [...pageFlags, "reviewed-sha256", "conversation-bundle", "article-only", "json"],
    recover: ["deployment", "json"],
    verify: ["slug", "json"],
    review: [...pageFlags, "conversation-bundle", "article-only", "json"],
    stage: pageFlags,
  };
  const allowed = command === undefined ? undefined : options[command];
  if (allowed) {
    const invalid = Object.keys(flags).find((flag) => !allowed.includes(flag));
    if (invalid) fail("--" + invalid + " is not an option for " + command + ".");
  }
}

async function main() {
  const { command, positional, flags } = parseArguments(process.argv.slice(2));
  checkOptions(command, flags);
  if (command === "status") {
    if (positional.length || Object.keys(flags).some((flag) => flag !== "check-project"))
      fail("Usage: publish.mjs status [--check-project]");
    const config = await readSettings();
    if (flags["check-project"] && config?.mode === "vercel") inspectProject(config);
    process.stdout.write(deliveryMode(config) + "\n");
    return;
  }
  if (command !== undefined && operationalCommands.includes(command ?? "")) {
    return publicationCommand(command, positional, flags);
  }
  if (command === "review") {
    if (positional.length !== 1) fail("Supply exactly one HTML file path.");
    return review(positional[0], flags);
  }
  if (command === "setup" && (flags["check-project"] || flags["list-domains"]))
    return setup(flags, positional);

  await withPublicationLock(async () => {
    if (command === "setup") await setup(flags, positional);
    else if (command === "stage") {
      if (positional.length !== 1) fail("Supply exactly one HTML file path.");
      const result = await stage(positional[0], flags);
      process.stdout.write(
        "Staged: /pages/" + result.slug + ".html (" + result.total + " total)\n",
      );
    } else {
      fail(
        "Usage: " +
          setupUsage +
          " | publish.mjs status [--check-project] | (stage|review|publish|deliver) FILE.html --slug SLUG | verify --slug SLUG | recover [--deployment HTTPS_URL]",
      );
    }
  });
}

main().catch((error) => {
  const [, , command, ...args] = process.argv;
  if (args.includes("--json") && operationalCommands.includes(command ?? "")) {
    printResult(
      command,
      { json: true },
      {
        remote: { state: "not-attempted" },
        production: { state: "not-written" },
        archive: "not-needed",
        delivery: { kind: "local" },
        preferred: { state: "not-tested" },
        conversation: { status: "absent" },
        error: errorMessage(error),
      },
    );
  } else {
    process.stderr.write("Error: " + errorMessage(error) + "\n");
  }
  process.exitCode = 1;
});
