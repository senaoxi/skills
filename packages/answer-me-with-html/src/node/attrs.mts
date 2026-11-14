import type { Attrs } from "./model.mjs";
// Heading and fence-line attributes (key=value pairs and bare flags). Kept apart from parse.js so the components can use it
// without a cycle: parse.js reads the component registry.

const NUMERIC_KEYS = new Set(["cols", "span"]);
const ATTR_TOKEN = /([\w-]+)(?:=("[^"]*"|'[^']*'|\S+))?/g;

export function parseAttrs(text: string): Attrs {
  const attrs: Attrs = {};
  for (const m of text.matchAll(ATTR_TOKEN)) {
    attrs[m[1]] = m[2] === undefined ? true : coerce(m[1], unquote(m[2]));
  }
  return attrs;
}

export function unquote(v: string) {
  const s = v.trim();
  return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : s;
}

export function coerce(key: string, value: string): string | number {
  if (NUMERIC_KEYS.has(key) && /^\d+$/.test(value)) return Number(value);
  return value;
}
