import type { Component } from "./types.ts";
// Component registry: fenced-block language name → component. Each component exports { name, summary, syntax, example, render(text, ctx) }.
import callout from "./callout.ts";
import kv from "./kv.ts";
import timeline from "./timeline.ts";
import annot from "./annot.ts";
import tree from "./tree.ts";
import limits from "./limits.ts";
import sequence from "./sequence.ts";
import flow from "./flow.ts";
import state from "./state.ts";
import er from "./er.ts";
import classDiagram from "./class.ts";
import api from "./api.ts";
import ask from "./ask.ts";
import chart from "./chart.ts";

export { ComponentError } from "./error.ts";

const ALL = [
  callout,
  kv,
  timeline,
  annot,
  tree,
  limits,
  chart,
  sequence,
  flow,
  state,
  er,
  classDiagram,
  api,
  ask,
];

export const COMPONENTS = new Map<string, Component>(ALL.map((c) => [c.name, c]));
export const RAW_LANGS = new Set(["html", "svg"]);
