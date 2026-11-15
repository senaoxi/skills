import type { Point, ComponentUI, DiagramGraph } from "../components/types.ts";
// Shared helpers for SVG fragments: number formatting, smooth polylines, arrow markers, multi-line text.
import { esc } from "./text.ts";
import { svgLine } from "../bidi.ts";

export const f = (n: number) => String(Math.round(n * 10) / 10);

const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Quadratic curves through the midpoints of each bend: straight segments at both ends, smooth corners.
export function smoothPath(points: Point[]) {
  const [first, ...rest] = points;
  if (rest.length === 1) return `M${f(first.x)},${f(first.y)} L${f(rest[0].x)},${f(rest[0].y)}`;
  const parts = [`M${f(first.x)},${f(first.y)}`];
  const m0 = mid(points[0], points[1]);
  parts.push(`L${f(m0.x)},${f(m0.y)}`);
  for (let i = 1; i < points.length - 1; i++) {
    const m = mid(points[i], points[i + 1]);
    parts.push(`Q${f(points[i].x)},${f(points[i].y)} ${f(m.x)},${f(m.y)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L${f(last.x)},${f(last.y)}`);
  return parts.join(" ");
}

// variants: extra arrowheads, "added" and "removed" for change markers; each one is a marker named <uid>-arrow-<variant>.
export function arrowDefs(uid: string, variants: string[] = []) {
  const marker = (name: string, cls: string) =>
    `<marker id="${uid}-arrow${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="am-arrow${cls}" d="M0,0 L10,5 L0,10 z"/></marker>`;
  return `<defs>${[marker("", ""), ...variants.map((v) => marker(`-${v}`, ` am-arrow--${v}`))].join("")}</defs>`;
}

// Lay out multi-line text vertically centred on (cx, cy). dir: the page direction; on a right-to-left page a line with no
// right-to-left letter is isolated as left to right (src/bidi.js), so a wrapped `src/` or `lint:` keeps its punctuation in place.
export function textLines(
  lines: string[],
  cx: number,
  cy: number,
  lineHeight: number,
  attrs = "",
  dir = "ltr",
) {
  const top = cy - ((lines.length - 1) * lineHeight) / 2;
  return lines
    .map(
      (line, i) =>
        `<text x="${f(cx)}" y="${f(top + i * lineHeight)}" text-anchor="middle" dominant-baseline="central"${attrs}>${esc(svgLine(line, dir))}</text>`,
    )
    .join("");
}

// "Flowchart: A, B": the page language's name for the diagram, then the node names. Without a context (component unit tests) it falls back to English.
const EN_LABELS = {
  flow: "Flowchart",
  state: "State machine diagram",
  sequence: "Sequence diagram",
  er: "Entity relationship diagram",
  class: "Class diagram",
  colon: ": ",
  sep: ", ",
};

export function diagramLabel(
  ui: (Omit<ComponentUI, "chart"> & { chart?: ComponentUI["chart"] | string }) | undefined,
  kind: keyof typeof EN_LABELS | "chart",
  names: string[],
) {
  const u = {
    ...EN_LABELS,
    ...ui,
    chart: typeof ui?.chart === "string" ? ui.chart : (ui?.chart?.name ?? "Chart"),
  };
  return `${u[kind]}${u.colon}${names.join(u.sep)}`;
}

// dir: the page direction. A right-to-left drawing says so on the root, so its text reads right to left wherever the svg is shown
// (a copy in the diagram viewer, a page embedded in another document); a left-to-right drawing keeps the tag it always had.
export function svgOpen(width: number, height: number, label: string, dir = "ltr") {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  const direction = dir === "rtl" ? ' direction="rtl"' : "";
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}"${direction} xmlns="http://www.w3.org/2000/svg">`;
}

// The page box of each generated diagram / chart svg, scaled by the reader's text size; the viewBox keeps the drawing's own units,
// so Node's measured text layout stays exact. Only the svgOpen shape is rewritten (width and height equal the viewBox), never
// another svg. Raw ```svg / ```html blocks bypass the component step, and a video never scales.
const SVG_OPEN_BOX = /<svg viewBox="0 0 (\d+) (\d+)" width="\1" height="\2"/g;

export function scaleSvgBoxes(html: string, scale = 1) {
  if (scale === 1) return html;
  return String(html).replace(
    SVG_OPEN_BOX,
    (tag: string, w: string, h: string) =>
      `<svg viewBox="0 0 ${w} ${h}" width="${Math.ceil(Number(w) * scale)}" height="${Math.ceil(Number(h) * scale)}"`,
  );
}

// A right-to-left page reads a drawing from the right: mirror(width) maps an x of the left-to-right layout to its mirror image
// (the first node or participant on the right, arrows pointing left). Text is not mirrored, only placed.
export const mirror = (width: number, rtl: boolean) => (x: number) => (rtl ? width - x : x);

// dagre's customOrder for flow and er. dagre sorts each rank by the average position of its neighbours alone, so two edges that
// leave one node tie and keep the order of the draft, wherever they end. After dagre's order, swap neighbours in a rank for as
// long as a swap removes crossings. Only nodes with the same parent swap, and group borders stay, so a group keeps its members.
export function orderRanks(g: DiagramGraph, order: (graph: DiagramGraph) => void) {
  order(g);
  const ranks: Record<number, string[]> = {};
  for (const v of g.nodes()) {
    const { rank, order: at } = g.node(v);
    if (rank !== undefined) (ranks[rank] ??= [])[at] = v;
  }
  const pairs = (as: string[], bs: string[]) =>
    as.reduce((n, a) => n + bs.filter((b) => g.node(b).order < g.node(a).order).length, 0);
  const crossings = (left: string, right: string) =>
    pairs(g.predecessors(left) ?? [], g.predecessors(right) ?? []) +
    pairs(g.successors(left) ?? [], g.successors(right) ?? []);
  const border = (v: string) => g.node(v).dummy === "border";
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (const rank of Object.values(ranks)) {
      for (let i = 1; i < rank.length; i++) {
        const [a, b] = [rank[i - 1], rank[i]];
        if (
          g.parent(a) !== g.parent(b) ||
          border(a) ||
          border(b) ||
          crossings(b, a) >= crossings(a, b)
        )
          continue;
        [rank[i - 1], rank[i]] = [b, a];
        g.node(a).order = i;
        g.node(b).order = i - 1;
        swapped = true;
      }
    }
  }
}

// Mirror a finished dagre layout left to right, in place: node and group centres, edge points and edge label positions.
export function mirrorLayout<N extends Point, E extends { points: Point[]; x?: number }>(
  g: DiagramGraph<N, E>,
) {
  const flip = mirror(g.graph().width, true);
  for (const v of g.nodes()) {
    const node = g.node(v);
    node.x = flip(node.x);
  }
  for (const e of g.edges()) {
    const edge = g.edge(e);
    edge.points = edge.points.map((p) => ({ ...p, x: flip(p.x) }));
    if (edge.x !== undefined) edge.x = flip(edge.x);
  }
}
