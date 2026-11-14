import type { Token, MarkedToken, Tokens } from "marked";
type Note = (at: string, message: string) => void;
interface ElementTag {
  text: string;
  name: string;
  close: boolean;
  label?: never;
}
interface BogusTag {
  text: string;
  label: string;
  name?: never;
  close?: never;
}
type Tag = ElementTag | BogusTag;
type Reason = keyof typeof REASON;
interface Context {
  lex: (source: string) => Token[];
  note: Note;
}
interface Found {
  token: Tokens.HTML | Tokens.Tag;
  tag: Tag;
}
// Marked owns standard token discriminants; extensions in this renderer use distinct math names.
export function isToken<T extends MarkedToken["type"]>(
  token: Token,
  type: T,
): token is Extract<MarkedToken, { type: T }> {
  return token.type === type;
}
// Raw HTML in a draft. marked passes it through, so a placeholder such as <host> vanishes from the page, a <script> or <style> in prose
// swallows what follows it, and a kept tag may carry an event handler or a javascript: link (a draft can quote untrusted text).
// This module filters the raw HTML tokens of one Markdown parse. Code spans, code blocks, comments and autolinks are not HTML tokens, so they are never touched.
// Every change reports a note (note(at, message)); at is the tag as the draft wrote it, so the caller can find its line.

import { esc } from "./svg/text.mjs";

const words = (list: string) => new Set(list.split(" "));

// Elements that change how the rest of the page is parsed, load something, or belong to the page itself (GFM's tagfilter, then the rest).
const NEVER = words(
  "title textarea style xmp iframe noembed noframes script plaintext link meta base object embed frame frameset template html head body noscript svg math",
);
// Text-level elements: the only ones a sentence, a list item or a table cell may hold.
const PHRASING = words(
  "a abbr b bdi bdo br cite code data del dfn em i img ins kbd mark q rp rt ruby s samp small span strong sub sup time u var wbr",
);
// Every other standard element (a draft may write these on lines of their own).
const BLOCK = words(
  "address area article aside audio blockquote button canvas caption col colgroup datalist dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr input label legend li main map menu meter nav ol optgroup option output p picture pre progress search section select slot source summary table tbody td tfoot th thead tr track ul video acronym big center font strike tt",
);
// Inline elements that need no closing tag.
const VOID = words("br wbr img");

const REASON = {
  never: (t: string) => `${t} is shown as text; raw markup belongs in an html fence`,
  unknown: (t: string) => `${t} is not an HTML element, shown as text; put code in backticks`,
  block: (t: string) =>
    `${t} is a block element and cannot sit inside a sentence, shown as text; put it on its own line`,
  unclosed: (t: string) =>
    `${t} has no closing tag in the same text, shown as text; put code in backticks`,
  stray: (t: string) => `${t} has no opening tag in the same text, shown as text`,
  open: (t: string) => `${t} is never closed with >, shown as text`,
  comment: (t: string) => `${t} is never closed with -->, shown as text`,
  bogus: (t: string) => `${t} is not a tag a page can hold, shown as text; put code in backticks`,
};

// Why a tag cannot stay, or null. Inline text may hold only text-level elements.
function kind(name: string, inline: boolean): "never" | "unknown" | "block" | null {
  if (NEVER.has(name)) return "never";
  if (!PHRASING.has(name) && !BLOCK.has(name)) return "unknown";
  return inline && !PHRASING.has(name) ? "block" : null;
}

const shown = (tag: Pick<ElementTag, "name" | "close"> | BogusTag) =>
  "label" in tag ? tag.label : `<${tag.close ? "/" : ""}${tag.name}>`;

// The tag becomes the text the draft wrote.
function hide(tag: Tag, reason: Reason, note: Note) {
  note(tag.text, REASON[reason](shown(tag)));
  return esc(tag.text);
}

// Tags ------------------------------------------------------------------------------------------------------------------------------

// A comment that closes (kept as it is), the start of a comment that never closes or of a processing instruction, CDATA or declaration (a browser reads those
// as comments, so their words vanish), or the start of a tag. The name ends where a browser ends it: at a space, a slash or >.
const SCAN = /<!--[\s\S]*?-->|<(!--|[?!]\[?\w*)|<(\/?)([A-Za-z][^\s/>]*)/g;
const OPENING = /^ {0,3}<(\/?)([A-Za-z][^\s/>]*)/;
// A quoted value may hold >, so a tag ends at the first > outside quotes. -1: it never ends (no >, or a quote with no partner), and a browser would read on into the page.
const CHUNK = /"[^"]*"|'[^']*'|[^"'>]+/y;

function tagEnd(text: string, from: number) {
  let i = from;
  while (i < text.length && text[i] !== ">") {
    CHUNK.lastIndex = i;
    if (!CHUNK.exec(text)) return -1;
    i = CHUNK.lastIndex;
  }
  return i < text.length ? i + 1 : -1;
}

// What a match of SCAN is, with the text it covers: a tag that never ends is cut at its name, and so is a comment that never closes.
function readMatch(
  text: string,
  m: RegExpMatchArray & { index: number },
): { reason: Reason; tag: Tag } | { reason: null; tag: ElementTag } {
  if (m[1]) {
    const end = m[1] === "!--" ? -1 : text.indexOf(">", m.index);
    return {
      reason: m[1] === "!--" ? "comment" : "bogus",
      tag: { text: end === -1 ? m[0] : text.slice(m.index, end + 1), label: m[0] },
    };
  }
  const end = tagEnd(text, m.index + m[0].length);
  return {
    reason: end === -1 ? "open" : null,
    tag: {
      text: end === -1 ? m[0] : text.slice(m.index, end),
      close: m[2] === "/",
      name: m[3].toLowerCase(),
    },
  };
}

// Replaces each tag in a block of raw HTML with whatever decide(tag) returns. What a browser would not read as the draft means is shown as text.
function mapTags(text: string, decide: (tag: ElementTag) => string, note: Note) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(SCAN)) {
    if (m.index < last || (!m[1] && !m[3])) continue; // inside the tag before, or a comment that closes
    const { reason, tag } = readMatch(text, m);
    out += text.slice(last, m.index) + (reason ? hide(tag, reason, note) : decide(tag));
    last = m.index + tag.text.length;
  }
  return out + text.slice(last);
}

// The tag an inline html token holds, or null for a comment. A processing instruction, CDATA or declaration has a label and no name.
const readTag = (text: string): Tag | null => {
  const m = /^<(\/?)([A-Za-z][^\s/>]*)/.exec(text);
  if (m) return { text, close: m[1] === "/", name: m[2].toLowerCase() };
  const bogus = /^<[?!](?!--)\[?\w*/.exec(text);
  return bogus && { text, label: bogus[0] };
};

// Attributes ------------------------------------------------------------------------------------------------------------------------

const ATTR = /\s*([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
const URL_ATTRS = words("href src action xlink:href poster cite background");
const ENTITY = /&#x([0-9a-f]+);?|&#(\d+);?|&(tab|newline|colon);?/gi;
const NAMED: Record<string, string> = { tab: "\t", newline: "\n", colon: ":" };

function decode(text: string) {
  return text.replace(ENTITY, (_, hex, dec, name) => {
    if (name) return NAMED[name.toLowerCase()];
    const code = hex ? parseInt(hex, 16) : Number(dec);
    return code > 0x10ffff ? "" : String.fromCodePoint(code);
  });
}

// A link a browser would run or open as a document. An image may carry data:image/ in src.
function unsafeUrl(element: string, attr: string, value: string) {
  const url = decode(value.replace(/^["']|["']$/g, ""))
    .replace(/[\x00-\x20\x7f]/g, "")
    .toLowerCase();
  if (/^(javascript|vbscript):/.test(url)) return true;
  return (
    url.startsWith("data:") &&
    !(element === "img" && attr === "src" && url.startsWith("data:image/"))
  );
}

function unsafe(element: string, attr: string, value: string) {
  if (/^on|^(srcdoc|formaction)$/.test(attr)) return true;
  return URL_ATTRS.has(attr) && unsafeUrl(element, attr, value);
}

// A tag that stays loses its event handlers and unsafe links. A clean tag comes back byte for byte.
function cleanTag(tag: ElementTag, note: Note) {
  if (tag.close) return tag.text;
  const head = 1 + tag.name.length;
  const removed: string[] = [];
  const attrs = tag.text.slice(head).replace(ATTR, (attr, name, value = "") => {
    if (!unsafe(tag.name, name.toLowerCase(), value)) return attr;
    removed.push(name);
    return "";
  });
  if (removed.length)
    note(
      tag.text,
      `removed ${removed.join(", ")} from <${tag.name}>${removed.some((n) => URL_ATTRS.has(n.toLowerCase())) ? " (unsafe URL)" : ""}`,
    );
  return tag.text.slice(0, head) + attrs;
}

// Inline HTML -----------------------------------------------------------------------------------------------------------------------

// The html tokens of one run of inline text, nested ones included, in reading order.
function htmlTokens(
  tokens: Token[] | undefined,
  out: (Tokens.HTML | Tokens.Tag)[] = [],
): (Tokens.HTML | Tokens.Tag)[] {
  for (const t of tokens ?? []) {
    if (isToken(t, "html")) out.push(t);
    else if ("tokens" in t && Array.isArray(t.tokens)) htmlTokens(t.tokens, out);
  }
  return out;
}

// Which tags of one run have no partner. A close tag pairs with the nearest open tag of its name; an open tag between them that never closed has no partner either.
function unpaired(found: Found[]) {
  const hidden = new Map<Found, Reason>();
  const open: Found[] = [];
  for (const item of found) {
    const { tag } = item;
    const reason = tag.label !== undefined ? "bogus" : kind(tag.name, true);
    if (reason) hidden.set(item, reason);
    else if (tag.name !== undefined && VOID.has(tag.name)) continue;
    else if (!tag.close) open.push(item);
    else {
      const i = open.findLastIndex((o) => o.tag.name === tag.name);
      if (i === -1) hidden.set(item, "stray");
      else
        open
          .splice(i)
          .slice(1)
          .forEach((o) => hidden.set(o, "unclosed"));
    }
  }
  open.forEach((o) => hidden.set(o, "unclosed"));
  return hidden;
}

// One run of inline text: a paragraph, a heading, the text of a list item, a table cell, or a whole mdInline call.
function filterRun(tokens: Token[] | undefined, note: Note) {
  const found = htmlTokens(tokens)
    .map((token) => ({ token, tag: readTag(token.text) }))
    .filter((item): item is Found => item.tag !== null);
  const hidden = unpaired(found);
  for (const item of found) {
    const reason = hidden.get(item);
    item.token.text = reason
      ? hide(item.tag, reason, note)
      : item.tag.name !== undefined
        ? cleanTag(item.tag, note)
        : item.token.text;
  }
}

export function filterInline(tokens: Token[], note: Note) {
  filterRun(tokens, note);
  return tokens;
}

// Block HTML ------------------------------------------------------------------------------------------------------------------------

// A block HTML token that starts with a tag we hide, a processing instruction or declaration, a comment that never closes or an unclosed <pre> runs to its end marker
// or a blank line and keeps the Markdown after it from being read. Returns what to say about it ({ reason, at, label }), or null. A <pre> block or comment that closes stays raw.
function relexReason(raw: string): { reason: Reason; at: string; label: string } | null {
  const special = /^ {0,3}(<[?!](?!--)\[?\w*|<!--)/.exec(raw);
  if (special) {
    const comment = special[1] === "<!--";
    return comment && raw.includes("-->")
      ? null
      : { reason: comment ? "comment" : "bogus", at: special[1], label: special[1] };
  }
  const m = OPENING.exec(raw);
  if (!m) return null;
  const tag = { close: m[1] === "/", name: m[2].toLowerCase() };
  const reason =
    kind(tag.name, false) ??
    (tag.name === "pre" && !tag.close && !/<\/pre>/i.test(raw) ? "unclosed" : null);
  return reason ? { reason, at: m[0].trim(), label: shown(tag) } : null;
}

// Reads the block again with its first < escaped, so what follows is Markdown again.
function relex(
  token: Token,
  { reason, at, label }: { reason: Reason; at: string; label: string },
  { lex, note }: Context,
): Token[] {
  note(at, REASON[reason](label));
  return filterBlocks(lex(token.raw.replace("<", "&lt;")), { lex, note });
}

const filterHtmlBlock = (text: string, note: Note) =>
  mapTags(
    text,
    (tag) => {
      const reason = kind(tag.name, false);
      return reason ? hide(tag, reason, note) : cleanTag(tag, note);
    },
    note,
  );

// A block read again at the top level comes back as a paragraph; in a tight list its text must stay a bare text, as the list's own items are.
const tight = (block: Token): Token =>
  block.type === "paragraph" ? { ...block, type: "text" } : block;

// ctx: { lex(source) → block tokens, note }. Changes the tokens in place and returns them.
export function filterBlocks(tokens: Token[], ctx: Context): Token[] {
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const plan = isToken(t, "html") ? relexReason(t.raw) : null;
    if (plan) {
      const again = relex(t, plan, ctx);
      tokens.splice(k, 1, ...again);
      k += again.length - 1;
    } else if (isToken(t, "html")) {
      t.text = filterHtmlBlock(t.text, ctx.note);
    } else if (isToken(t, "table")) {
      [...t.header, ...t.rows.flat()].forEach((cell) => filterRun(cell.tokens, ctx.note));
    } else if (isToken(t, "list")) {
      t.items.forEach((item) => {
        filterBlocks(item.tokens, ctx);
        if (!t.loose) item.tokens = item.tokens.map(tight);
      });
    } else if (isToken(t, "blockquote")) {
      filterBlocks(t.tokens, ctx);
    } else if (isToken(t, "paragraph") || isToken(t, "heading") || isToken(t, "text")) {
      filterRun(t.tokens, ctx.note);
    }
  }
  return tokens;
}
