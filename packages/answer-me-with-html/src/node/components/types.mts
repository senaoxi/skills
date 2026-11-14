import type en from "../languages/en.mjs";

export type DeltaState = "added" | "removed" | "changed";
export type ChangeMark = "+" | "-" | "~";
export interface ComponentWarning {
  line: number;
  message: string;
}
export type ComponentUI = Partial<Omit<typeof en.ui, "delta">> & {
  delta?: Partial<typeof en.ui.delta> & { counts?: Partial<Record<DeltaState, string>> };
  chart?: typeof en.ui.chart;
};
export interface ComponentContext {
  args: string;
  uid: () => string;
  ui?: ComponentUI;
  video?: boolean;
  dir?: string;
  warn?: (warning: ComponentWarning) => void;
}
export interface Component {
  name: string;
  summary: string;
  syntax: string;
  example: string;
  pageOnly?: boolean;
  panelOnly?: boolean;
  lint?: (text: string) => string;
  render: (text: string, context: ComponentContext) => string;
}
export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export type Box = [number, number, number, number];

export interface LayoutNode extends Point, Size {
  label?: string;
  rank?: number;
  order: number;
  dummy?: string;
}
export interface LayoutEdge extends Point, Size {
  points: Point[];
  label?: string;
  labelpos?: "l" | "c" | "r";
}
export interface LayoutGraphData extends Size {
  marginx: number;
  marginy: number;
  rankdir: string;
  nodesep: number;
  ranksep: number;
}

// Dagre's layout fills positions and graph bounds in place. This view describes
// the populated layout and keeps graphlib's untyped labels out of renderer code.
export interface DiagramGraph<N = LayoutNode, E = LayoutEdge> {
  setGraph(value: Partial<LayoutGraphData> & { rankdir: string }): DiagramGraph<N, E>;
  graph(): LayoutGraphData;
  setDefaultEdgeLabel(value: () => object): DiagramGraph<N, E>;
  setNode(name: string, value: Partial<N>): DiagramGraph<N, E>;
  node(name: string): N;
  nodes(): string[];
  hasNode(name: string): boolean;
  setParent(name: string, parent: string): DiagramGraph<N, E>;
  parent(name: string): string | undefined;
  predecessors(name: string): string[] | undefined;
  successors(name: string): string[] | undefined;
  setEdge(from: string, to: string, value: Partial<E>, name?: string): DiagramGraph<N, E>;
  edge(edge: { v: string; w: string; name?: string }): E;
  edge(from: string, to: string, name?: string): E;
  edges(): { v: string; w: string; name?: string }[];
}
