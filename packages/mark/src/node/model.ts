import type { resolveLanguage } from "./language.ts";
export type AttrValue = string | number | boolean;
export type Attrs = Record<string, AttrValue>;
export interface Meta {
  [key: string]: AttrValue | undefined;
  template: string;
  theme: string;
  style: string;
  mode: string;
  outline: string;
  cols: string | number;
  title: string;
  subtitle?: string;
  lang?: string;
}
export interface MarkdownBlock {
  type: "md";
  text: string;
  line: number;
}
export interface FenceBlock {
  type: "fence";
  lang: string;
  args: string;
  text: string;
  line: number;
}
export type Block = MarkdownBlock | FenceBlock;
export interface Panel {
  id: string;
  title: string;
  attrs: Attrs;
  heading: string;
  line: number;
  blocks: Block[];
}
export interface DraftDoc {
  meta: Meta;
  intro: Block[];
  panels: Panel[];
}
export interface RenderedPanel extends Panel {
  html: string;
}
export interface Warning {
  line: number;
  rule?: string;
  message: string;
  suggestion?: string;
  component?: string;
}
export interface DraftError extends Error {
  line?: number;
  example?: string;
  component?: string;
}
export type Language = ReturnType<typeof resolveLanguage>;
export type UI = Language["ui"];
export interface RenderStats {
  panels: number;
  components: Record<string, number>;
  code: string[];
  codeWarnings: Warning[];
  componentWarnings: Warning[];
  htmlWarnings: Warning[];
  mathWarnings: Warning[];
}
export interface RenderContext {
  seq: number;
  stats: RenderStats;
  errors?: DraftError[];
  ui: UI;
  dir?: "ltr" | "rtl";
  scale?: number;
  video?: boolean;
  images?: { baseDir?: string; known?: Map<string, string> };
  code?: { baseDir?: string; known?: Map<string, string[]> };
}
export interface TemplateInput {
  meta: Meta;
  introHtml: string;
  panels: RenderedPanel[];
  ui?: UI;
  language: Language;
}
