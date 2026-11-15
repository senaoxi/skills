import type { ReplyRemark, ReplyUi } from "../shared/runtime/reply-text.ts";
export interface ReplyLabels extends ReplyUi {
  comment: string;
  commentHint: string;
  title: string;
  hint: string;
  raw: string;
  copy: string;
  close: string;
  empty: string;
  copyFailed: string;
  done: string;
  preview: string;
  count: Record<string, string>;
  closeAfter?: { seconds: number; keep: string; closing: string; closeFailed: string };
}
export interface RemarkLabels {
  button: string;
  clear: string;
  clearConfirm: string;
  hint: string;
  save: string;
  need: string;
  remove: string;
  kinds: Record<string, string>;
}
export interface Mark {
  key: string;
  kind: string;
  note: string;
}
export interface SavedMark {
  key: string;
  kind: string;
  note: unknown;
}
export interface ReplyState {
  asks?: unknown;
  comments?: unknown;
}
export interface PageState {
  reply?: ReplyState;
  remark?: SavedMark[];
}
export type StatePatch = Pick<PageState, "reply"> | Pick<PageState, "remark">;
declare global {
  interface Window {
    __amRemarkData?: () => ReplyRemark[];
  }
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function parseJson(text: string | null | undefined): unknown {
  return JSON.parse(text ?? "null");
}
export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function strings(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object(value)).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string",
    ),
  );
}
export function replyLabels(value: unknown): ReplyLabels {
  const v = object(value);
  const after = object(v.closeAfter);
  return {
    decisions: string(v.decisions),
    untouched: string(v.untouched),
    confirmed: string(v.confirmed),
    was: string(v.was),
    comments: string(v.comments),
    remarks: string(v.remarks),
    typed: string(v.typed),
    kinds: strings(v.kinds),
    comment: string(v.comment),
    commentHint: string(v.commentHint),
    title: string(v.title),
    hint: string(v.hint),
    raw: string(v.raw),
    copy: string(v.copy),
    close: string(v.close),
    empty: string(v.empty),
    copyFailed: string(v.copyFailed),
    done: string(v.done),
    preview: string(v.preview),
    count: strings(v.count),
    ...(typeof after.seconds === "number"
      ? {
          closeAfter: {
            seconds: after.seconds,
            keep: string(after.keep),
            closing: string(after.closing),
            closeFailed: string(after.closeFailed),
          },
        }
      : {}),
  };
}
export function remarkLabels(value: unknown): RemarkLabels {
  const v = object(value);
  return {
    button: string(v.button),
    clear: string(v.clear),
    clearConfirm: string(v.clearConfirm),
    hint: string(v.hint),
    save: string(v.save),
    need: string(v.need),
    remove: string(v.remove),
    kinds: strings(v.kinds),
  };
}
// Saved state is read field by field, as in the original runtime. In particular, an
// unrelated malformed entry must not discard a reader's valid answers or comments.
export function readProperty(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return undefined;
  const boxed: object = Object(value);
  return Reflect.get(boxed, key);
}
export function replyState(value: unknown): ReplyState {
  return { ...object(value) };
}
export function markState(value: unknown): SavedMark[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const m = object(entry);
    return typeof m.key === "string" &&
      typeof m.kind === "string" &&
      ["suggestion", "keep", "question", "concern"].includes(m.kind)
      ? [{ key: m.key, kind: m.kind, note: m.note }]
      : [];
  });
}
export function pageState(value: unknown): PageState {
  const { reply, remark, ...extensions } = object(value);
  return {
    ...extensions,
    ...(reply ? { reply: replyState(reply) } : {}),
    ...(Array.isArray(remark) ? { remark: markState(remark) } : {}),
  };
}
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required page element is missing");
  return value;
}
