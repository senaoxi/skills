export interface Decision {
  panel: string;
  question: string;
  picked: string[];
  suggested: string[];
  touched: boolean;
}
export interface PanelComment {
  panel: string;
  title: string;
  text: string;
}
export interface ReplyRemark {
  panel: string;
  quote: string;
  kind: string;
  note: string;
}
export interface ReplyUi {
  decisions: string;
  untouched: string;
  confirmed: string;
  was: string;
  comments: string;
  remarks: string;
  kinds?: Record<string, string>;
  typed: string;
}
export interface ReplyTextInput {
  title: string;
  decisions: Decision[];
  comments: PanelComment[];
  remarks?: ReplyRemark[];
  ui: ReplyUi;
  rtl?: boolean;
}
// The reply a reader copies from the page: one Markdown text with the decisions, the panel comments and the block remarks.
// Shared with the page runtime through explicit ES module imports.
// decisions: [{ panel, question, picked: [label], suggested: [label], touched }]; comments: [{ panel, title, text }];
// remarks: [{ panel, quote, kind, note }], where quote is the start of the marked block and kind is a key of ui.kinds.
// Comment and remark text is quoted line by line, so text the reader typed cannot pass as part of the structure.
// rtl: the page reads right to left, so the arrow before each answer points left, the way the text runs.
export function replyText({
  title,
  decisions,
  comments,
  remarks = [],
  ui,
  rtl = false,
}: ReplyTextInput) {
  const arrow = rtl ? "←" : "→";
  const out = [`# Re: ${title}`];
  if (decisions.length) {
    out.push("", `## ${ui.decisions}`);
    decisions.forEach((d, i) => {
      const answer = d.picked.length ? d.picked.map((l) => `**${l}**`).join(", ") : "**—**";
      // Every option starts unselected, so an ask the reader never clicked has no answer: the reply names the suggestion
      // instead of passing it off as the reader's choice.
      const same =
        d.picked.length === d.suggested.length && d.picked.every((l) => d.suggested.includes(l));
      const suggested = d.suggested.join(", ") || "—";
      const why = !d.touched
        ? `${ui.untouched}: ${suggested}`
        : same
          ? ui.confirmed
          : `${ui.was}: ${suggested}`;
      out.push(`${i + 1}. [${d.panel}] ${d.question}`, `   ${arrow} ${answer} _(${why})_`);
    });
  }
  const written = comments.filter((c) => c.text.trim());
  const quoted = (text: string) =>
    text.trim()
      ? text
          .trim()
          .split("\n")
          .map((l) => `  > ${l}`)
      : [];
  if (written.length) {
    out.push("", `## ${ui.comments}`);
    for (const c of written) out.push(`- **${c.panel} · ${c.title}**`, ...quoted(c.text));
  }
  if (remarks.length) {
    out.push("", `## ${ui.remarks}`);
    for (const r of remarks) {
      const label = [r.panel, ui.kinds?.[r.kind] ?? r.kind].filter(Boolean).join(" · ");
      out.push(`- **${label}** "${r.quote}"`, ...quoted(r.note));
    }
  }
  if (written.length || remarks.some((r) => r.note.trim())) out.push("", `_${ui.typed}_`);
  return `${out.join("\n")}\n`;
}
