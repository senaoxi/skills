export interface RootSettings {
  lang: string;
  dir?: string;
  theme: string;
  mode: string;
  style: string;
  scale?: number;
  voice?: string;
  video?: boolean;
}
// Page envelope: settings on the page's root tag, video voice-over, hidden source draft at the end.
// render / video write the envelope here, patch reads it back with readPage. The format is defined only in this file.
import { esc } from "./svg/text.ts";
import { SCALE } from "./themes/type-scale.ts";

const SOURCE_OPEN = '<textarea id="am-source"';
const SOURCE_RE = new RegExp(`^${SOURCE_OPEN}[^>]*>([\\s\\S]*?)<\\/textarea>`);
const AUDIO_OPEN = '<audio id="amv-audio"';

function draftTag(html: string) {
  const start = html.lastIndexOf(SOURCE_OPEN);
  const match = start < 0 ? null : html.slice(start).match(SOURCE_RE);
  return match ? { start, markup: match[0], text: match[1] } : null;
}

export const downloadPath = (slug: string) => "downloads/" + encodeURIComponent(slug) + ".txt";
export const conversationPaths = (slug: string) => ({
  json: "conversations/" + encodeURIComponent(slug) + ".json",
  html: "conversations/" + encodeURIComponent(slug) + ".html",
});

export function readingPage(html: string, slug?: string, conversationSlug?: string) {
  const draft = draftTag(html);
  if (draft) html = html.slice(0, draft.start) + html.slice(draft.start + draft.markup.length);
  const body = /<body\b(?:"[^"]*"|'[^']*'|[^'">])*>/i;
  const toolbar = new RegExp(
    `(${body.source}\\s*)<div class="am-toolbar"[^>]*>[\\s\\S]*?<\\/div>`,
    "i",
  );
  const chinese = /<html\b[^>]*\slang="zh(?:-|")/i.test(html);
  const links = [
    ...(slug
      ? [
          {
            href: downloadPath(slug),
            label: chinese ? "下载" : "Download",
            download: slug + ".html",
          },
        ]
      : []),
    ...(conversationSlug
      ? [
          {
            href: conversationPaths(conversationSlug).html,
            label: chinese ? "对话" : "Conversation",
            download: undefined,
          },
          {
            href: conversationPaths(conversationSlug).json,
            label: chinese ? "对话 JSON" : "Conversation JSON",
            download: conversationSlug + ".json",
          },
        ]
      : []),
  ];
  const button = links.length
    ? `<div class="am-toolbar" style="position:fixed;top:12px;inset-inline-end:12px;z-index:10;display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100vw - 24px)">${links.map((link) => `<a class="am-btn" style="text-decoration:none;display:inline-block;background:var(--paper,Canvas);color:var(--ink,CanvasText);padding:7px 10px;border:1px solid var(--line-2,GrayText);border-radius:4px" href="../${link.href}"${link.download ? ` download="${esc(link.download)}"` : ""}>${link.label}</a>`).join("")}</div>`
    : "";
  html = html.replace(
    /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>|<fieldset class="am-ask"(?=[\s>])/gi,
    (markup) => (markup.startsWith("<fieldset") ? '<fieldset disabled class="am-ask"' : markup),
  );
  if (toolbar.test(html))
    return html.replace(toolbar, (_match, opening: string) => opening + button);
  return links.length ? html.replace(body, (opening) => opening + "\n" + button) : html;
}

// lang is already an html lang value when passed in (e.g. zh-CN). dir is written only for a right-to-left language (dir="rtl");
// a left-to-right page keeps the root tag it always had.
// voice is written only on voiced video pages (elevenlabs / local / system / audio-map); patch keeps the same voice.
// scale is the reader's text size (src/themes/type-scale.js); 1 is the default, so the tag carries it only when it differs.
export function rootTag({
  lang,
  dir,
  theme,
  mode,
  style,
  scale = 1,
  voice,
  video = false,
}: RootSettings) {
  return `<html lang="${lang}"${dirAttr(dir)} data-theme="${esc(theme)}" data-mode="${esc(mode)}" data-style="${esc(style)}"${scale === 1 ? "" : ` data-scale="${scale}"`}${voice ? ` data-voice="${esc(voice)}"` : ""}${video ? " data-video" : ""}>`;
}

// Copies of the root settings, written on the toolbar. A host that serves the page inside its own document leaves the real <html>
// without them; the page runtime sets back whatever the root lacks from these (see the first statement of src/runtime/page.js).
export function rootCarrierAttrs({ lang, dir, theme, mode, style }: RootSettings) {
  return ` data-am-root-lang="${lang}"${dir === "rtl" ? ' data-am-root-dir="rtl"' : ""} data-am-root-theme="${esc(theme)}" data-am-root-mode="${esc(mode)}" data-am-root-style="${esc(style)}"`;
}

const dirAttr = (dir?: string) => (dir === "rtl" ? ' dir="rtl"' : "");

export function audioTag(wav: Buffer) {
  return `${AUDIO_OPEN} preload="auto" src="data:audio/wav;base64,${wav.toString("base64")}"></audio>`;
}

// Must be the page's last textarea, right after the optional audioTag.
export function sourceTag(source: string) {
  return `${SOURCE_OPEN} hidden readonly aria-hidden="true">${esc(source)}</textarea>`;
}

// Read the envelope back: { source, video, template, theme, mode, style, scale, lang, voice, voiced }. source is null when there is no source draft.
// scale is 1 when the tag has none (an older page) or names a value outside the range.
// The body html / markdown may contain tags with the same names, so: settings come only from the document-root <html>,
// the source only from the final textarea, the voice only from the audio right before the source.
export function readPage(html: string) {
  const s = String(html);
  const root = s.match(/<html\b[^>]*>/)?.[0] ?? "";
  const attr = (name: string) => root.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1];
  const video = /\sdata-video\b/.test(root);
  const draft = draftTag(s);
  const before = draft ? s.slice(0, draft.start).trimEnd() : "";
  return {
    source: draft ? unescapeHtml(draft.text) : null,
    video,
    // A <main class="am-doc"> in the body does not count; the template's <main> always comes before the body.
    template: video ? "video" : s.match(/<main class="am-(doc|sheet)\b/)?.[1],
    theme: attr("data-theme"),
    mode: attr("data-mode"),
    style: attr("data-style"),
    scale: readScale(attr("data-scale")),
    lang: attr("lang"),
    voice: attr("data-voice"),
    voiced:
      video &&
      before.endsWith("</audio>") &&
      before.lastIndexOf(AUDIO_OPEN) > before.lastIndexOf("<textarea"),
  };
}

function readScale(raw: string | undefined) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= SCALE.min && n <= SCALE.max ? n : 1;
}

export function unescapeHtml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
