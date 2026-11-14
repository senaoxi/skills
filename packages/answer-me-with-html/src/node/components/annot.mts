interface AnnotGroup {
  title: string;
  meta: string;
  lines: string[];
  captions: string[];
}
import type { Component, ComponentUI, ComponentWarning, DeltaState, ChangeMark } from "./types.mjs";
// Sentence annotation (figure B): monospace sentence, bracket lines under annotated spans, notes wrap onto rows by horizontal position to avoid overlap.
import { esc, measure } from "../svg/text.mjs";
import { ComponentError, contentLines, fields } from "./error.mjs";
import { SIZES } from "../themes/type-scale.mjs";

const SEG = /\[([^\]]+)\]\{(!?)([^}]*)\}/g;
const TEXT_SIZE = SIZES.body;
const NOTE_SIZE = SIZES.label;
const NOTE_GAP = 10;

export default {
  name: "annot",
  summary: "Sentence annotation by segment (underline bracket + note)",
  syntax: `\`\`\`annot
# Heading | right-side note (optional)
Sentence text, [annotated span]{note}, [wrong span]{!red note}.
> Caption below (optional)
\`\`\`
- Each # starts a group; a group can hold several sentences. Overlapping notes move to separate rows automatically.`,
  example:
    '```annot\n# 1 Procedural sentence | 13 words, limit 20\nMake sure that [the hydraulic reservoir]{Technical name} is [full]{!Not "replenished"}.\n> Write one instruction per sentence\n```',
  render(text, { dir = "ltr" }: { dir?: string } = {}) {
    const groups: AnnotGroup[] = [];
    let group: AnnotGroup | null = null;
    const ensure = () => group ?? (group = pushGroup(groups, {}));
    for (const { text: t, line } of contentLines(text)) {
      if (t.startsWith("#")) {
        const [title, meta = ""] = fields(t.replace(/^#+\s*/, ""));
        group = pushGroup(groups, { title, meta });
      } else if (t.startsWith(">")) {
        ensure().captions.push(t.replace(/^>\s*/, ""));
      } else {
        ensure().lines.push(sentenceHtml(t, line, dir === "rtl"));
      }
    }
    if (!groups.length) throw new ComponentError("annot needs at least one sentence", 1);
    return groups.map(groupHtml).join("");
  },
} satisfies Component;

function pushGroup(
  groups: AnnotGroup[],
  { title = "", meta = "" }: { title?: string; meta?: string },
) {
  const g = { title, meta, lines: [], captions: [] };
  groups.push(g);
  return g;
}

function groupHtml(g: AnnotGroup) {
  const head =
    g.title || g.meta
      ? `<div class="am-annot-head"><span>${esc(g.title)}</span>${g.meta ? `<span class="am-annot-meta">${esc(g.meta)}</span>` : ""}</div>`
      : "";
  const lines = g.lines.map((l) => `<div class="am-annot-scroll">${l}</div>`).join("");
  const caps = g.captions.map((c) => `<div class="am-annot-caption">${esc(c)}</div>`).join("");
  return `<div class="am-annot">${head}${lines}${caps}</div>`;
}

// On a right-to-left page the sentence is set in the sans font (src/themes/rtl.css), so its widths are measured as sans text. The notes start
// at the right edge of their span, so a distance from the start of the sentence is the distance from its right edge.
function sentenceHtml(sentence: string, line: number, rtl: boolean) {
  const stripped = sentence.replace(SEG, "");
  if (/\[[^\]]*\]\{|\]\{[^}]*$/.test(stripped)) {
    throw new ComponentError(
      `annot has an unclosed annotation; expected [span]{note}: "${sentence}"`,
      line,
    );
  }
  const rows: [number, number][][] = [];
  let out = "";
  let plain = "";
  let last = 0;
  for (const m of sentence.matchAll(SEG)) {
    const before = sentence.slice(last, m.index);
    out += esc(before);
    plain += before;
    const [, seg, bang, note] = m;
    const x = measure(plain, TEXT_SIZE, { mono: !rtl });
    const noteHtml = note.trim()
      ? `<span class="am-seg-n" style="--row: ${placeNote(rows, x, x + measure(note, NOTE_SIZE) + NOTE_GAP)}">${esc(note.trim())}</span>`
      : "";
    out += `<span class="am-seg${bang ? " am-seg--err" : ""}"><span class="am-seg-t">${esc(seg)}</span>${noteHtml}</span>`;
    plain += seg;
    last = m.index + m[0].length;
  }
  out += esc(sentence.slice(last));
  const wrapCls = rows.length ? "" : " am-annot-line--wrap";
  return `<div class="am-annot-line${wrapCls}" style="--rows: ${rows.length}">${out}</div>`;
}

// Greedy placement: take the first row that does not overlap an existing note.
function placeNote(rows: [number, number][][], start: number, end: number) {
  const idx = rows.findIndex((ranges) => ranges.every(([s, e]) => end <= s || start >= e));
  if (idx !== -1) {
    rows[idx].push([start, end]);
    return idx;
  }
  rows.push([[start, end]]);
  return rows.length - 1;
}
