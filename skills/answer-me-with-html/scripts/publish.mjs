#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
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
import { homedir } from "node:os";
import path from "node:path";
import { cleanPublishedHtml } from "./publish-html.mjs";

const userHome = homedir();
const defaultDataDir = path.join(userHome, ".answer-me-with-html");
const home = path.resolve(process.env.AM_HOME || defaultDataDir);
const configDir = home === defaultDataDir ? path.join(userHome, ".agents") : home;
const configFile = path.join(configDir, "answer-me-with-html-vercel.md");
const previousMarkdownFile = path.join(configDir, "answer-me-with-html.md");
const legacyConfigFile = path.join(home, "vercel-shared-project.json");
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
  "publish.mjs setup (--local | --team SLUG --project NAME --project-id ID [--public-origin HTTPS_URL]) [--if-uninitialized]";

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const flag = token.slice(2);
    if (["replace", "clear-context", "local", "if-uninitialized", "json"].includes(flag)) {
      flags[flag] = true;
      continue;
    }
    if (
      ![
        "slug",
        "team",
        "project",
        "project-id",
        "public-origin",
        "group",
        "published-at",
        "context-source",
        "context-title",
        "context-url",
        "reviewed-sha256",
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

function runVercelText(args, cwd = home) {
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

function runVercel(args, cwd = home) {
  const stdout = runVercelText(args, cwd);
  try {
    return JSON.parse(stdout);
  } catch {
    fail("Unexpected Vercel CLI output for " + args[0] + ".");
  }
}

async function atomicWrite(file, content, options) {
  const temp = file + ".next-" + randomUUID();
  try {
    await writeFile(temp, content, { ...options, flag: "wx" });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

const settingsFields = [
  ["mode", "Delivery mode"],
  ["team", "Vercel team"],
  ["project", "Vercel project"],
  ["projectId", "Vercel project ID"],
  ["publicOrigin", "Preferred link origin"],
  ["lastVerifiedDeployment", "Last verified deployment"],
  ["origin", "Legacy verification origin"],
];

async function writeConfig(config) {
  const lines = ["# Answer me with HTML delivery settings", ""];
  for (const [field, label] of settingsFields) {
    if (config[field] !== undefined) lines.push("- " + label + ": " + config[field]);
  }
  await mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 });
  await atomicWrite(configFile, lines.join("\n") + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}

function parseMarkdownSettings(contents, file) {
  const config = {};
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim() || /^#{1,6} /.test(line)) continue;
    const entry = /^- ([^:]+): (.+)$/.exec(line.trimEnd());
    const field = settingsFields.find(([, label]) => label === entry?.[1])?.[0];
    if (!field || Object.hasOwn(config, field)) fail("Invalid delivery settings at " + file);
    config[field] = entry[2];
  }
  return config;
}

function normalizePublicOrigin(value) {
  if (typeof value !== "string") fail("A preferred domain must be an HTTPS origin.");
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
    fail(
      "Preferred public domain must be a bare HTTPS origin without paths, credentials, query or port.",
    );
  return url.origin;
}

const projectFields = ["team", "project", "projectId"];

function validProject(config) {
  return (
    typeof config.team === "string" &&
    /^[a-z0-9][a-z0-9-]*$/.test(config.team) &&
    typeof config.project === "string" &&
    /^(?!.*---)[a-z0-9._-]{1,100}$/.test(config.project) &&
    typeof config.projectId === "string" &&
    /^prj_[A-Za-z0-9]+$/.test(config.projectId)
  );
}

async function readOptionalSettings(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    fail("Cannot read delivery settings at " + file);
  }
}

async function readLegacySettings() {
  const contents = await readOptionalSettings(legacyConfigFile);
  if (contents === undefined) return undefined;
  let config;
  try {
    config = JSON.parse(contents);
  } catch {
    fail("Invalid delivery settings at " + legacyConfigFile);
  }
  if (config?.schemaVersion !== 1) fail("Invalid delivery settings at " + legacyConfigFile);
  if (config.mode === undefined) config.mode = "local";
  return config;
}

async function readSettings() {
  let settingsFile = configFile;
  let markdown = await readOptionalSettings(settingsFile);
  if (markdown === undefined) {
    settingsFile = previousMarkdownFile;
    markdown = await readOptionalSettings(settingsFile);
  }
  const config =
    markdown === undefined
      ? await readLegacySettings()
      : parseMarkdownSettings(markdown, settingsFile);
  if (!config) return undefined;
  if (!["local", "vercel"].includes(config.mode))
    fail("Invalid delivery mode in " + (markdown === undefined ? legacyConfigFile : settingsFile));
  if (
    (config.mode !== "local" || projectFields.some((field) => config[field] !== undefined)) &&
    !validProject(config)
  )
    fail("Invalid pinned Vercel project in delivery settings.");
  for (const field of ["publicOrigin", "origin", "lastVerifiedDeployment"]) {
    if (
      config[field] !== undefined &&
      (!config.projectId || normalizePublicOrigin(config[field]) !== config[field])
    )
      fail("Invalid HTTPS origin in delivery settings.");
  }
  return config;
}

function deliveryMode(config) {
  return config?.mode ?? "uninitialized";
}

async function readEnabledProject() {
  const config = await readSettings();
  if (deliveryMode(config) !== "vercel")
    fail("Vercel publishing is disabled. Run publish.mjs setup to enable it.");
  return config;
}

function inspectProject(config) {
  const project = runVercel([
    "project",
    "inspect",
    config.projectId,
    "--scope",
    config.team,
    "--non-interactive",
    "--json",
  ]);
  if (
    project.id !== config.projectId ||
    project.name !== config.project ||
    project.owner?.slug !== config.team
  )
    fail("Vercel project identity differs from the pinned shared project.");
}

function currentProduction(config) {
  const project = runVercel([
    "api",
    "/v9/projects/" + config.projectId,
    "--scope",
    config.team,
    "--non-interactive",
  ]);
  if (
    project?.id !== config.projectId ||
    !project.targets ||
    typeof project.targets !== "object" ||
    Array.isArray(project.targets)
  )
    fail("Cannot determine current production for the pinned Vercel project.");
  const current = project.targets.production;
  if (current == null) return null;
  if (!current.aliasAssigned || current.aliasError || typeof current.url !== "string")
    fail("The current production deployment could not be confirmed as serving.");
  return normalizePublicOrigin("https://" + current.url);
}

async function setup(flags, positional) {
  const projectOptions = ["team", "project", "project-id", "public-origin"];
  if (
    positional.length !== 0 ||
    Object.keys(flags).some(
      (flag) => !["local", "if-uninitialized", ...projectOptions].includes(flag),
    ) ||
    (flags.local && projectOptions.some((flag) => flags[flag] !== undefined))
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

  const config = {
    mode: "vercel",
    team: flags.team,
    project: flags.project,
    projectId: flags["project-id"],
  };
  if (!validProject(config))
    fail("Expected --team <slug> --project <name> --project-id <prj_...>.");
  if (existing?.projectId && projectFields.some((field) => config[field] !== existing[field]))
    fail(
      "This archive is bound to a different project. Use a separate AM_HOME for another project.",
    );
  if (existing?.origin) config.origin = existing.origin;
  if (existing?.lastVerifiedDeployment)
    config.lastVerifiedDeployment = existing.lastVerifiedDeployment;
  if (flags["public-origin"] !== undefined)
    config.publicOrigin = normalizePublicOrigin(flags["public-origin"]);
  else if (existing?.publicOrigin) config.publicOrigin = existing.publicOrigin;
  await mkdir(siteDir, { recursive: true });
  inspectProject(config);
  await writeConfig(config);
  process.stdout.write("Vercel delivery saved to " + configFile + "\n");
}

async function setPublicOrigin(flags, positional) {
  if (positional.length !== 0 || !flags["public-origin"])
    fail("Usage: publish.mjs set-public-origin --public-origin https://example.com/");
  const config = await readEnabledProject();
  const published = await readPublishedState(config);
  config.publicOrigin = normalizePublicOrigin(flags["public-origin"]);
  await writeConfig(config);
  process.stdout.write("Preferred public origin: " + config.publicOrigin + "\n");
  process.stdout.write(
    "Vercel verification origin: " +
      (published?.origin ||
        config.lastVerifiedDeployment ||
        config.origin ||
        "resolved from deployment") +
      "\n",
  );
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function extractTitle(html, slug) {
  const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html);
  return (match?.[1] || slug).trim();
}

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

function normalizeGroup(value) {
  if (value === undefined) return "posts";
  if (typeof value !== "string" || !SAFE_SLUG.test(value.toLowerCase()))
    fail("Group must be a lowercase project slug or Posts.");
  return value.toLowerCase();
}

function normalizePublishedAt(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("Publication date must use YYYY-MM-DD.");
  const time = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(time.valueOf()) || time.toISOString().slice(0, 10) !== value)
    fail("Publication date is not a real calendar day: " + value);
  return time.toISOString();
}

function normalizeContext(raw) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Invalid conversation context.");
  const { source, title, url } = raw;
  if (!["chatgpt", "codex"].includes(source)) fail("Conversation source must be chatgpt or codex.");
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 240 ||
    /[\u0000-\u001f\u007f]/.test(title)
  )
    fail(
      "A conversation title summarized from the current context is required (maximum 240 characters).",
    );
  const context = { source, title: title.trim() };
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

function contextFromFlags(flags, previousContext) {
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

function readSlug(slug) {
  if (typeof slug !== "string" || !SAFE_SLUG.test(slug))
    fail("Specify a lowercase ASCII --slug (letters, digits, hyphens; max 64 characters).");
  return slug;
}

function pageMetadata(flags, previous, context) {
  return {
    group: flags.group === undefined ? (previous?.group ?? "posts") : normalizeGroup(flags.group),
    publishedAt:
      flags["published-at"] === undefined
        ? (previous?.publishedAt ?? new Date().toISOString())
        : normalizePublishedAt(flags["published-at"]),
    ...(context ? { context } : {}),
  };
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

async function readCatalog() {
  let catalog;
  try {
    catalog = JSON.parse(await readFile(catalogFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
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
      !record ||
      record.group !== normalizeGroup(record.group) ||
      !validTimestamp(record.publishedAt)
    )
      fail("Invalid catalog metadata for " + slug);
    if (record.context !== undefined) normalizeContext(record.context);
  }
  for (const slug of Object.keys(catalog.pages)) {
    if (!SAFE_SLUG.test(slug) || !filenames.includes(slug + ".html"))
      fail("Missing archived HTML for catalog page: " + slug);
  }
  return catalog;
}

function decodeEntities(value) {
  return value.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity],
  );
}

function textOnly(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const PROVENANCE_START = "<!-- am-context-provenance:start -->";
const PROVENANCE_END = "<!-- am-context-provenance:end -->";

function withoutProvenance(html) {
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

function contextMarkup(context, embedded = false) {
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

function withProvenance(html, context) {
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

function extractSummary(html) {
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

async function makeIndex(catalog, directory = siteDir) {
  const groups = new Map();
  for (const [slug, metadata] of Object.entries(catalog.pages)) {
    const original = await readFile(path.join(directory, "pages", slug + ".html"), "utf8");
    const item = {
      slug,
      title: decodeEntities(extractTitle(original, slug)),
      description: extractSummary(original),
      publishedAt: metadata.publishedAt,
      group: metadata.group,
      context: metadata.context,
    };
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  const orderedGroups = [...groups.keys()].sort((a, b) =>
    a === "posts" ? 1 : b === "posts" ? -1 : a.localeCompare(b, "en"),
  );
  const sections = orderedGroups.map((group) => {
    const entries = groups
      .get(group)
      .sort(
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

async function loadRenderedHtml(file) {
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

async function stage(file, flags) {
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
    if (error.code !== "ENOENT") throw error;
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

function fetchWithVercel(origin, pagePath, team, cwd = home) {
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
      { cwd, maxBuffer: 30 * 1024 * 1024 },
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

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function projectDigest(config) {
  return sha256(config.team + "/" + config.projectId);
}

function galleryHasPage(gallery, slug) {
  return gallery.includes(`class="entry-link" href="./pages/${slug}.html"`);
}

function verify(origin, slug, digest, team, cwd) {
  const pagePath = "/pages/" + encodeURIComponent(slug) + ".html";
  const page = origin + pagePath;
  const actual = sha256(fetchWithVercel(origin, pagePath, team, cwd));
  if (actual !== digest) fail("Published page differs from local HTML: " + page);
  const gallery = fetchWithVercel(origin, "/", team, cwd).toString("utf8");
  if (!galleryHasPage(gallery, slug))
    fail("The published gallery is missing the page link at " + origin);
  return page;
}

async function readPublishedState(config) {
  let data;
  try {
    data = JSON.parse(await readFile(publishedFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  if (
    ![1, 2].includes(data?.schemaVersion) ||
    !data.pages ||
    Array.isArray(data.pages) ||
    typeof data.pages !== "object" ||
    normalizePublicOrigin(data.origin) !== data.origin
  )
    fail("Invalid verified publication record.");
  if (data.projectDigest !== projectDigest(config))
    fail("The verified publication archive belongs to a different Vercel project.");
  for (const [slug, record] of Object.entries(data.pages)) {
    approvedMetadata(slug, record);
    if (!validDigest(record.digest)) fail("Invalid saved page digest for " + slug);
  }
  return data;
}

function approvedMetadata(slug, record) {
  readSlug(slug);
  if (
    !record ||
    record.group !== normalizeGroup(record.group) ||
    !validTimestamp(record.publishedAt)
  )
    fail("Invalid published metadata for " + slug);
  const context = normalizeContext(record.context);
  return pageMetadata({}, record, context);
}

function readProductionCatalog(config, origin) {
  const gallery = fetchWithVercel(origin, "/", config.team).toString("utf8");
  const catalog = JSON.parse(fetchWithVercel(origin, "/pages.json", config.team).toString("utf8"));
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

async function copyApprovedPages(config, directory, replacement) {
  const saved = await readPublishedState(config);
  const catalog = { schemaVersion: 1, pages: Object.create(null) };
  let production;
  let livePages;
  if (saved?.schemaVersion !== 2) {
    production = currentProduction(config);
    const archivedOrigin = saved?.origin || config.lastVerifiedDeployment || config.origin || null;
    if (archivedOrigin !== production)
      fail("The current production deployment does not match this publisher's legacy archive.");
    if (production === null) return catalog;
    livePages = readProductionCatalog(config, production);
    if (
      saved &&
      (Object.keys(saved.pages).length !== Object.keys(livePages).length ||
        Object.keys(livePages).some((slug) => !Object.hasOwn(saved.pages, slug)))
    )
      fail(
        "The publisher's archive is missing or has extra pages compared with current production.",
      );
  }
  if (saved) {
    for (const [slug, record] of Object.entries(saved.pages)) {
      catalog.pages[slug] = approvedMetadata(slug, record);
      if (slug === replacement) continue;
      const contents = await readFile(path.join(publishedPagesDir, record.digest + ".html"));
      if (sha256(contents) !== record.digest) fail("Saved published page was modified: " + slug);
      await writeFile(path.join(directory, "pages", slug + ".html"), contents);
    }
  } else {
    for (const [slug, record] of Object.entries(livePages)) {
      const metadata = approvedMetadata(slug, record);
      catalog.pages[slug] = metadata;
      if (slug === replacement) continue;
      const original = fetchWithVercel(
        production,
        "/pages/" + slug + ".html",
        config.team,
      ).toString("utf8");
      const cleaned = cleanPublishedHtml(withoutProvenance(original));
      await writeFile(
        path.join(directory, "pages", slug + ".html"),
        withProvenance(cleaned, metadata.context),
      );
    }
  }
  return catalog;
}

function validDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function preparePage({ source, html }, flags) {
  const slug = readSlug(flags.slug);
  const context = contextFromFlags(flags);
  const cleaned = cleanPublishedHtml(withoutProvenance(html.toString("utf8")));
  const contents = Buffer.from(withProvenance(cleaned, context));
  return { source, slug, context, cleaned, contents, sha256: sha256(contents) };
}

async function review(file, flags) {
  const prepared = preparePage(await loadRenderedHtml(file), flags);
  const reviewedPath = path.join(reviewDir, prepared.sha256 + ".html");
  await mkdir(reviewDir, { recursive: true, mode: 0o700 });
  await atomicWrite(reviewedPath, prepared.contents, { mode: 0o600 });
  const result = {
    source: prepared.source,
    slug: prepared.slug,
    sha256: prepared.sha256,
    path: reviewedPath,
  };
  if (flags.json) process.stdout.write(JSON.stringify(result) + "\n");
  else process.stdout.write("Review HTML: " + result.path + "\nSHA256: " + result.sha256 + "\n");
}

function snapshotPaths(catalog) {
  return [
    "index.html",
    "pages.json",
    ...Object.keys(catalog.pages).map((slug) => "pages/" + slug + ".html"),
  ];
}

function writeJournal(journal, file = journalFile) {
  return atomicWrite(file, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
}

async function readJournal() {
  try {
    const journal = JSON.parse(await readFile(journalFile, "utf8"));
    if (!journal || typeof journal !== "object" || Array.isArray(journal))
      fail("Invalid pending publication journal.");
    return journal;
  } catch (error) {
    if (error.code === "ENOENT") {
      const pending = await stat(pendingDir).catch((cause) => {
        if (cause.code !== "ENOENT") throw cause;
      });
      if (!pending) return undefined;
    }
    throw error;
  }
}

function validateJournal(journal, config) {
  const phases = ["prepared", "uploading", "deployed", "verified"];
  if (
    journal?.schemaVersion !== 1 ||
    !phases.includes(journal.phase) ||
    typeof journal.source !== "string" ||
    !path.isAbsolute(journal.source) ||
    typeof journal.slug !== "string" ||
    !SAFE_SLUG.test(journal.slug) ||
    !journal.digests ||
    typeof journal.digests !== "object" ||
    Array.isArray(journal.digests) ||
    !Object.values(journal.digests).every(validDigest) ||
    !Object.hasOwn(journal.digests, "pages/" + journal.slug + ".html") ||
    (["prepared", "uploading"].includes(journal.phase)
      ? journal.origin !== undefined
      : normalizePublicOrigin(journal.origin) !== journal.origin)
  )
    fail("Invalid pending publication journal.");
  if (journal.projectDigest !== projectDigest(config))
    fail("The pending publication belongs to a different Vercel project.");
}

async function prepareSnapshot(config, prepared, flags) {
  const { source, slug, cleaned, contents, context } = prepared;
  const directory = await mkdtemp(path.join(home, "vercel-upload-"));
  const site = path.join(directory, "site");
  try {
    await mkdir(path.join(site, "pages"), { recursive: true });
    const catalog = await copyApprovedPages(config, site, flags.replace ? slug : undefined);
    const target = path.join(site, "pages", slug + ".html");
    const previous = catalog.pages[slug];
    if (previous && !flags.replace && withoutProvenance(await readFile(target, "utf8")) !== cleaned)
      fail("Slug already exists with different content; pass --replace to update it.");
    await writeFile(target, contents);
    catalog.pages[slug] = pageMetadata(flags, previous, context);
    await makeIndex(catalog, site);
    const digests = Object.create(null);
    for (const file of snapshotPaths(catalog)) {
      digests[file] = sha256(await readFile(path.join(site, file)));
    }
    const journal = {
      schemaVersion: 1,
      phase: "prepared",
      projectDigest: projectDigest(config),
      source,
      slug,
      digests,
    };
    await writeJournal(journal, path.join(directory, "journal.json"));
    await rename(directory, pendingDir);
    return journal;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch((error) => {
      process.stderr.write("Could not remove the temporary directory: " + error.message + "\n");
    });
  }
}

async function clearPending() {
  const complete = pendingDir + ".complete-" + randomUUID();
  await rename(pendingDir, complete);
  await rm(complete, { recursive: true, force: true }).catch((error) => {
    process.stderr.write("Could not remove the completed snapshot: " + error.message + "\n");
  });
}

async function readSnapshot(journal) {
  const entries = await readdir(pendingSite, { withFileTypes: true });
  if (
    entries.length !== 3 ||
    entries.some((entry) =>
      entry.name === "pages"
        ? !entry.isDirectory()
        : !["index.html", "pages.json"].includes(entry.name) || !entry.isFile(),
    )
  )
    fail("Unexpected pending snapshot files.");
  const files = new Map();
  const read = async (file) => {
    const bytes = await readFile(path.join(pendingSite, file));
    if (sha256(bytes) !== journal.digests[file]) fail("Pending snapshot differs at " + file);
    files.set(file, bytes);
    return bytes;
  };
  const catalog = JSON.parse(await read("pages.json"));
  if (
    catalog?.schemaVersion !== 1 ||
    !catalog.pages ||
    Array.isArray(catalog.pages) ||
    typeof catalog.pages !== "object" ||
    !Object.hasOwn(catalog.pages, journal.slug)
  )
    fail("Invalid pending snapshot catalog.");
  for (const [slug, record] of Object.entries(catalog.pages)) approvedMetadata(slug, record);
  const paths = snapshotPaths(catalog);
  if (
    paths.length !== Object.keys(journal.digests).length ||
    paths.some((file) => !Object.hasOwn(journal.digests, file))
  )
    fail("The pending snapshot catalog and digests do not agree.");
  const pages = await readdir(path.join(pendingSite, "pages"), { withFileTypes: true });
  if (
    pages.length !== Object.keys(catalog.pages).length ||
    pages.some((entry) => !entry.isFile() || !Object.hasOwn(journal.digests, "pages/" + entry.name))
  )
    fail("Unexpected pending snapshot pages.");
  for (const file of paths) {
    if (!files.has(file)) await read(file);
  }
  return { catalog, files };
}

async function rememberPublished(config, journal, snapshot) {
  await mkdir(publishedPagesDir, { recursive: true, mode: 0o700 });
  const pages = Object.create(null);
  for (const [slug, metadata] of Object.entries(snapshot.catalog.pages)) {
    const file = "pages/" + slug + ".html";
    const digest = journal.digests[file];
    const contents = snapshot.files.get(file);
    const stored = path.join(publishedPagesDir, digest + ".html");
    const existing = await readFile(stored).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (!existing?.equals(contents)) await atomicWrite(stored, contents, { mode: 0o600 });
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

function recordPending(result, journal) {
  result.source = journal?.source ?? result.source;
  result.slug = journal?.slug ?? result.slug;
  result.archive = "pending";
  result.remote =
    journal?.phase === "prepared"
      ? { state: "not-attempted" }
      : { state: "unknown", ...(journal?.origin ? { url: journal.origin } : {}) };
}

async function probePreferred(config, slug, digest) {
  if (!config.publicOrigin) return { state: "not-configured" };
  const url = config.publicOrigin + "/pages/" + slug + ".html";
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

function observeProduction(config, origin) {
  try {
    const current = currentProduction(config);
    const relation = current === origin ? "matches-record" : current ? "different" : "absent";
    return { state: "not-written", current, relation };
  } catch (error) {
    return { state: "not-written", relation: "unavailable", error: error.message };
  }
}

function recordVerified(result, origin, slug) {
  result.remote = { state: "verified", url: origin };
  result.delivery = {
    kind: "immutable",
    url: origin + "/pages/" + slug + ".html",
    access: "authenticated",
  };
}

async function finishPublication(config, journal, snapshot, result) {
  for (const [file, expected] of snapshot.files) {
    const pathname = file === "index.html" ? "/" : "/" + file;
    if (!fetchWithVercel(journal.origin, pathname, config.team, pendingSite).equals(expected))
      fail("Staged deployment differs from the verified upload at " + pathname);
  }
  recordVerified(result, journal.origin, journal.slug);
  result.pages = Object.keys(snapshot.catalog.pages).length;
  await writeJournal({ ...journal, phase: "verified" });
  await rememberPublished(config, journal, snapshot);
  result.archive = "saved";
  await clearPending();
  result.preferred = await probePreferred(
    config,
    journal.slug,
    journal.digests["pages/" + journal.slug + ".html"],
  );
}

async function publish(config, input, flags, result) {
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
  const prepared = preparePage(input, flags);
  result.slug = prepared.slug;
  if (flags["reviewed-sha256"] !== prepared.sha256)
    fail(
      "Selected HTML differs from --reviewed-sha256 or no digest was provided. Run review again.",
    );
  inspectProject(config);
  const journal = await prepareSnapshot(config, prepared, flags);
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
  const deployed = response?.deployment;
  const origin = normalizePublicOrigin(deployed?.url);
  result.remote.url = origin;
  const receipt = { ...journal, phase: "deployed", origin };
  await writeJournal(receipt);
  if (
    response.status !== "ok" ||
    deployed.readyState !== "READY" ||
    deployed.target !== "production"
  )
    fail("The staged production deployment was not READY.");
  await finishPublication(config, receipt, snapshot, result);
}

function confirmDeployment(config, origin) {
  const host = new URL(origin).hostname;
  const deployed = runVercel([
    "api",
    "/v13/deployments/" + encodeURIComponent(host),
    "--scope",
    config.team,
    "--non-interactive",
  ]);
  if (deployed?.projectId !== config.projectId || deployed.url !== host)
    fail("The supplied URL is not an immutable deployment of the pinned Vercel project.");
  if (deployed.readyState !== "READY") fail("The immutable deployment is not READY.");
}

async function recover(config, journal, flags, result) {
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

async function withPublicationLock(action) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const lock = await open(lockFile, "wx").catch((error) => {
    if (error.code === "EEXIST") fail("Another publication is in progress; check " + lockFile);
    throw error;
  });
  try {
    return await action();
  } finally {
    try {
      await lock.close();
      await unlink(lockFile);
    } catch (error) {
      process.stderr.write("Could not release the local publication lock: " + error.message + "\n");
    }
  }
}

async function verifyExisting(config, flags, result) {
  const slug = readSlug(flags.slug);
  result.slug = slug;
  const published = await readPublishedState(config);
  const origin = published?.origin || config.lastVerifiedDeployment || config.origin;
  result.production = observeProduction(config, origin);
  if (!origin) fail("No verified Vercel deployment is recorded.");
  const record =
    published && Object.hasOwn(published.pages, slug) ? published.pages[slug] : undefined;
  if (published && !record) fail("No verified publication is recorded for " + slug);
  const digest = record?.digest ?? sha256(await readFile(path.join(pagesDir, slug + ".html")));
  result.archive = published ? "saved" : "not-needed";
  result.remote = { state: "unknown", url: origin };
  result.preferred = await probePreferred(config, slug, digest);
  verify(origin, slug, digest, config.team);
  recordVerified(result, origin, slug);
}

function printResult(command, flags, result) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  const lines = [];
  if (result.delivery.kind === "immutable") {
    if (command !== "verify" && result.archive === "saved")
      lines.push("Published: " + result.delivery.url, "Gallery: " + result.remote.url + "/");
    lines.push("Verified Vercel deployment: " + result.delivery.url, "Access: authenticated");
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
  } else if (command === "recover" && !result.error) {
    lines.push("Cleared a prepared publication before upload.");
  }
  if (result.archive === "pending") lines.push("Archive: pending recovery");
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
        ")",
    );
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
  if (result.error) {
    const label =
      result.archive === "pending"
        ? "Publication recovery required: "
        : command === "deliver"
          ? "Online publication unavailable: "
          : "Error: ";
    process.stderr.write(label + result.error + "\n");
  }
}

async function publicationCommand(command, positional, flags) {
  const result = {
    remote: { state: "not-attempted" },
    production: { state: "not-written" },
    archive: "not-needed",
    delivery: { kind: "local" },
    preferred: { state: "not-tested" },
  };
  try {
    if (command === "publish" || command === "deliver") {
      if (positional.length !== 1) fail("Supply exactly one HTML file path.");
      const input = await loadRenderedHtml(positional[0]);
      result.source = input.source;
      if (command === "publish" || deliveryMode(await readSettings()) === "vercel") {
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
    result.error = error.message;
    if (
      command !== "deliver" ||
      !result.source ||
      result.archive === "pending" ||
      result.remote.state !== "not-attempted"
    )
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

function checkOptions(command, flags) {
  const allowed = {
    deliver: [...pageFlags, "reviewed-sha256", "json"],
    publish: [...pageFlags, "reviewed-sha256", "json"],
    recover: ["deployment", "json"],
    verify: ["slug", "json"],
    review: [...pageFlags, "json"],
    stage: pageFlags,
    "set-public-origin": ["public-origin"],
  }[command];
  if (allowed) {
    const invalid = Object.keys(flags).find((flag) => !allowed.includes(flag));
    if (invalid) fail("--" + invalid + " is not an option for " + command + ".");
  }
}

async function main() {
  const { command, positional, flags } = parseArguments(process.argv.slice(2));
  checkOptions(command, flags);
  if (command === "status") {
    if (positional.length || Object.keys(flags).length) fail("status takes no arguments.");
    process.stdout.write(deliveryMode(await readSettings()) + "\n");
    return;
  }
  if (operationalCommands.includes(command)) {
    return publicationCommand(command, positional, flags);
  }
  if (command === "review") {
    if (positional.length !== 1) fail("Supply exactly one HTML file path.");
    return review(positional[0], flags);
  }
  await withPublicationLock(async () => {
    if (command === "setup" || command === "configure") await setup(flags, positional);
    else if (command === "set-public-origin") await setPublicOrigin(flags, positional);
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
          " | publish.mjs status | set-public-origin --public-origin HTTPS_URL | (stage|review|publish|deliver) FILE.html --slug SLUG | verify --slug SLUG | recover [--deployment HTTPS_URL]",
      );
    }
  });
}

main().catch((error) => {
  const [, , command, ...args] = process.argv;
  if (args.includes("--json") && operationalCommands.includes(command)) {
    printResult(
      command,
      { json: true },
      {
        remote: { state: "not-attempted" },
        production: { state: "not-written" },
        archive: "not-needed",
        delivery: { kind: "local" },
        preferred: { state: "not-tested" },
        error: error.message,
      },
    );
  } else {
    process.stderr.write("Error: " + error.message + "\n");
  }
  process.exitCode = 1;
});
