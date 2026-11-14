// JSON timings are kept raw until an arithmetic operation consumes them, matching
// existing saved player pages that carry numeric strings or null/falsy values.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type TimingValue = JsonValue | undefined;
export interface Beat {
  start: TimingValue;
  end: TimingValue;
  html?: unknown;
  focus?: unknown;
}
export interface Segment {
  start: TimingValue;
  end: TimingValue;
  id?: unknown;
  title?: unknown;
  beats: Beat[];
}
export interface Timeline {
  duration: TimingValue;
  fps: TimingValue;
  segments: Segment[];
}
function record(value: JsonValue | undefined): { [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid video timeline");
  return value;
}
export function parseTimeline(text: string): Timeline {
  // JSON.parse itself guarantees the recursive JSON value domain; the renderer's
  // object/array structure is checked without imposing a new numeric schema.
  const value: JsonValue = JSON.parse(text);
  const data = record(value);
  if (!Array.isArray(data.segments)) throw new Error("Invalid video segments");
  const segments = data.segments.map((value): Segment => {
    const s = record(value);
    if (!Array.isArray(s.beats)) throw new Error("Invalid video beats");
    const beats = s.beats.map((value): Beat => {
      const b = record(value);
      return { ...b, start: b.start, end: b.end, html: b.html, focus: b.focus };
    });
    return { ...s, start: s.start, end: s.end, id: s.id, title: s.title, beats };
  });
  return { ...data, duration: data.duration, fps: data.fps, segments };
}

// For JSON objects and arrays, ordinary default-hint primitive conversion falls
// through valueOf to toString. Primitives retain their original kind: addition
// concatenates strings, and two string operands compare lexically.
function primitive(value: TimingValue): string | number | boolean | null | undefined {
  return value !== null && typeof value === "object" ? String(value) : value;
}
export function addTime(value: TimingValue, delta: number): string | number {
  const raw = primitive(value);
  return typeof raw === "string" ? raw + delta : Number(raw) + delta;
}
export function timeBefore(left: TimingValue, right: TimingValue): boolean {
  const a = primitive(left);
  const b = primitive(right);
  return typeof a === "string" && typeof b === "string" ? a < b : Number(a) < Number(b);
}
export function timeAtLeast(left: TimingValue, right: TimingValue): boolean {
  const a = primitive(left);
  const b = primitive(right);
  return typeof a === "string" && typeof b === "string" ? a >= b : Number(a) >= Number(b);
}
