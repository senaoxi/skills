import type { Token, Tokens } from "marked";
import type { Attrs, UI } from "./model.ts";
interface HtmlNote {
  at: string;
  message: string;
  math?: boolean;
}
// Markdown → HTML (GFM). Extras: $…$ and $$ math (math.js); tables get a horizontally scrolling wrapper and opt in to sort / filter
// with a following {table ...} line; status words in cells render as badges; an image on its own line becomes a captioned figure;
// raw HTML is filtered (see raw-html.js): a placeholder such as <host> shows as text, tags that break the page are escaped, event handlers and javascript: links are removed.

import { Marked } from "marked";
import { filterBlocks, filterInline, isToken } from "./raw-html.ts";
import { mathExtension } from "./math.ts";
import { parseAttrs } from "./attrs.ts";
import { esc } from "./svg/text.ts";

// What the raw-HTML filter changed while collectHtmlNotes is running. Rendering is synchronous, so nothing leaks between calls.
let sink: HtmlNote[] | null = null;
const note = (at: string, message: string) => sink?.push({ at, message });

// Whether $ starts a formula (src/math.js). A video draft turns it off: scenes have no math styles.
let mathOn = true;

// Runs render() and returns its result with the notes about the raw HTML it changed: [{ at, message }], at being the tag as the draft wrote it.
// A formula that Temml cannot read adds a note too, { at, message, math: true }, at being the formula as the draft wrote it.
export function collectHtmlNotes<T>(render: () => T, { math = true } = {}) {
  const outer = sink;
  const outerMath = mathOn;
  const notes: HtmlNote[] = [];
  sink = notes;
  mathOn = math;
  try {
    return { result: render(), notes };
  } finally {
    sink = outer;
    mathOn = outerMath;
  }
}

const marked = new Marked({ gfm: true });
// parseInline reads one run of inline text and hands the hook inline tokens, so it gets its own parser.
const inline = new Marked({ gfm: true });

const TABLE_ATTR = /^\{table\s+([^{}]*)\}$/;
let tableUi: UI["table"] | undefined;
const tableSettings = new WeakMap<Tokens.Table, Attrs>();
let tableInteractive = true;

// A {table ...} line immediately after a table configures that table. Marked reads an unseparated line as a final row;
// a line after a blank is a paragraph. parseAttrs keeps bare flags and key=value options in one syntax, so later options
// such as widths= do not need a second parser.
function tableOptions(tokens: Token[]): Token[] {
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (isToken(token, "table")) {
      const row = token.rows.at(-1);
      const rowOption = row?.[0]?.text.trim().match(TABLE_ATTR);
      const rowMatch =
        row &&
        rowOption &&
        row.length > 1 &&
        row.slice(1).every((cell) => !cell.text.trim()) &&
        rowOption;
      const nextIndex = tokens.findIndex(
        (candidate, index) => index > k && candidate.type !== "space",
      );
      const next = tokens[nextIndex];
      const paragraphMatch =
        next && isToken(next, "paragraph") && next.text.trim().match(TABLE_ATTR);
      const match = rowMatch || paragraphMatch;
      if (match) {
        const options = parseAttrs(match[1]);
        if (["sort", "filter"].some((flag) => options[flag] === true)) {
          tableSettings.set(token, options);
          if (rowMatch) token.rows.pop();
          else tokens.splice(nextIndex, 1);
        } else {
          note(
            match[0],
            "unrecognized table option; use {table sort}, {table filter}, or {table sort filter}",
          );
        }
      } else if (
        rowOption &&
        !["sort", "filter"].some((flag) => parseAttrs(rowOption[1])[flag] === true)
      ) {
        note(
          rowOption[0],
          "unrecognized table option; use {table sort}, {table filter}, or {table sort filter}",
        );
      }
    } else if (isToken(token, "list")) {
      token.items.forEach((item) => tableOptions(item.tokens));
    } else if (isToken(token, "blockquote")) {
      tableOptions(token.tokens);
    }
  }
  return tokens;
}

marked.use({
  hooks: {
    processAllTokens: (tokens) =>
      filterBlocks(tableOptions(tokens), {
        lex: (source) => tableOptions(marked.lexer(source)),
        note,
      }),
  },
});
inline.use({ hooks: { processAllTokens: (tokens) => filterInline(tokens, note) } });
marked.use({
  extensions: [
    {
      name: "table",
      renderer(token) {
        if (!tableInteractive || !isToken(token, "table")) return false;
        const options = tableSettings.get(token);
        if (!options) return false;
        const flags = ["sort", "filter"].filter((flag) => options[flag] === true);
        if (!flags.length) return false;
        const table = this.parser.renderer
          .table(token)
          .replace("<table>", `<table data-am-table="${flags.join(" ")}">`);
        if (!options.filter) return table;
        const label = esc(tableUi?.filter ?? "Filter table");
        return `<div class="am-table-controls" hidden><label class="am-table-filter"><span>${label}</span><input type="search" data-am-table-filter aria-label="${label}"></label></div>${table}`;
      },
    },
  ],
});
const math = mathExtension({
  enabled: () => mathOn,
  note: (at, message) => sink?.push({ at, message, math: true }),
});
marked.use(math);
inline.use(math);

const STATUS: Record<string, { cls: string; icon: string }> = {
  ok: { cls: "ok", icon: "✓" },
  no: { cls: "no", icon: "✗" },
  warn: { cls: "warn", icon: "!" },
};
const STATUS_ALIAS: Record<string, string> = {
  "✓": "ok",
  "✔": "ok",
  "✗": "no",
  "✘": "no",
  "⚠": "warn",
};

export function statusHtml(word: string, label = "") {
  const kind = STATUS[STATUS_ALIAS[word] ?? word];
  if (!kind) return null;
  const text = label.trim();
  return `<span class="am-status am-status--${kind.cls}"><span class="am-status-icon" aria-hidden="true">${kind.icon}</span>${text ? `<span class="am-status-text">${text}</span>` : ""}</span>`;
}

// A paragraph that holds only an image becomes a figure; the alt text is its caption.
const IMAGE_ONLY = /<p>\s*(<img\b[^>]*>)\s*<\/p>/g;

// The status word must open the cell; the label after it may hold inline HTML (code, em, strong, a) but never crosses a cell boundary.
const CELL_STATUS =
  /<td([^>]*)>\s*(ok|no|warn|✓|✔|✗|✘|⚠)(?:\s+((?:(?!<\/?td\b)[\s\S])*?))?\s*<\/td>/g;

function figure(img: string) {
  const alt = img.match(/\salt="([^"]*)"/)?.[1];
  return `<figure class="am-figure">${img}${alt ? `<figcaption>${alt}</figcaption>` : ""}</figure>`;
}

function decorate(html: string) {
  return html
    .replace(/<table data-am-table=/g, '<div class="am-table-wrap"><table data-am-table=')
    .replace(/<table>/g, '<div class="am-table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>")
    .replace(IMAGE_ONLY, (_, img) => figure(img))
    .replace(
      CELL_STATUS,
      (_, attrs, word, label = "") => `<td${attrs}>${statusHtml(word, label)}</td>`,
    );
}

// CommonMark takes a space in a link destination only inside <…>, so marked would leave ![alt](a b.png) as text. Wrap such a destination; code spans are skipped.
// A destination may hold balanced (…) such as "Screenshot (1).png".
const SPACED_IMAGE =
  /(`[^`\n]*`)|(!\[[^\]\n]*\]\()\s*((?:[^()<>"\n]|\([^()<>"\n]*\))*?)(\s+"[^"\n]*")?\s*\)/g;

function wrapSpacedImages(text: string) {
  return text.replace(SPACED_IMAGE, (whole, code, head, dest, title = "") =>
    code || !/\s/.test(dest) ? whole : `${head}<${dest}>${title})`,
  );
}

export function md(
  text: unknown,
  { ui, interactive = true }: { ui?: Pick<UI, "table">; interactive?: boolean } = {},
): string {
  const outerUi = tableUi;
  const outerInteractive = tableInteractive;
  tableUi = ui?.table;
  tableInteractive = interactive;
  try {
    return decorate(marked.parse(wrapSpacedImages(String(text ?? "")), { async: false }));
  } finally {
    tableUi = outerUi;
    tableInteractive = outerInteractive;
  }
}

export function mdInline(text: unknown): string {
  return inline.parseInline(wrapSpacedImages(String(text ?? "")), { async: false });
}
