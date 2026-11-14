import type { Component } from "./types.mjs";
// Component registry: fenced-block language name → component. Each component exports { name, summary, syntax, example, render(text, ctx) }.
import callout from "./callout.mjs";
import kv from "./kv.mjs";
import timeline from "./timeline.mjs";
import annot from "./annot.mjs";
import tree from "./tree.mjs";
import limits from "./limits.mjs";
import sequence from "./sequence.mjs";
import flow from "./flow.mjs";
import state from "./state.mjs";
import er from "./er.mjs";
import classDiagram from "./class.mjs";
import api from "./api.mjs";
import ask from "./ask.mjs";
import chart from "./chart.mjs";

export { ComponentError } from "./error.mjs";

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
