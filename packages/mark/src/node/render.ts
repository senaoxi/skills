import type {
  AttrValue,
  Block,
  DraftDoc,
  DraftError,
  FenceBlock,
  Language,
  Meta,
  RenderContext,
  RenderStats,
  UI,
  Warning,
} from "./model.ts";
// Draft → single-file HTML. Pipeline: parse → STE lint → render panels (markdown / components / raw) → apply template → inline CSS and runtime.

import { parseDocLoose, ParseError, raiseAll, applyOverrides, CHOICES } from "./parse.ts";
import { md, collectHtmlNotes } from "./markdown.ts";
import { COMPONENTS, RAW_LANGS, ComponentError } from "./components/index.ts";
import { TEMPLATES } from "./templates/index.ts";
import { pageCss } from "./themes/index.ts";
import { BUILTIN, AUTO, pickTheme } from "./themes/registry.ts";
import { lintDoc } from "./lint/ste.ts";
import { esc } from "./svg/text.ts";
import { scaleSvgBoxes } from "./svg/shapes.ts";
import { SCALE } from "./themes/type-scale.ts";
import { RUNTIME_JS, TABLE_JS, DELTA_JS, CLOSE_AFTER_JS } from "./assets.ts";
import { rootTag, rootCarrierAttrs, sourceTag } from "./page.ts";
import { resolveLanguage } from "./language.ts";
import { inlineImages, remoteImages, ImageError, IMAGE_EXAMPLE } from "./images.ts";
import { renderCode, CodeError } from "./code.ts";
import { isolateLtrRuns } from "./bidi.ts";
import { hasMath } from "./math.ts";
import { cspMeta } from "./csp.ts";

export class RenderError extends Error {
  line?: number;
  component?: string;
  example?: string;
  constructor(
    message: string,
    { line, component, example }: { line?: number; component?: string; example?: string } = {},
  ) {
    super(message);
    this.name = "RenderError";
    this.line = line;
    this.component = component;
    this.example = example;
  }
}

export class LintError extends Error {
  warnings: Warning[];
  constructor(warnings: Warning[]) {
    super(
      `STE check failed (style: strict): ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
    );
    this.name = "LintError";
    this.warnings = warnings;
  }
}

export interface RenderOptions {
  themes?: typeof BUILTIN;
  previousLanguage?: string;
  baseDir?: string;
  codeDir?: string;
  knownImages?: Map<string, string>;
  knownCode?: Map<string, string[]>;
  closeAfter?: boolean;
  scale?: number;
}

export function renderDoc(
  source: string,
  overrides: Partial<Meta> = {},
  defaults: Partial<Meta> = {},
  {
    themes = BUILTIN,
    previousLanguage,
    baseDir,
    codeDir,
    knownImages,
    knownCode,
    closeAfter = false,
    scale = 1,
  }: RenderOptions = {},
) {
  const choices = { theme: themes.choices("page") };
  const { doc: parsed, errors } = parseDocLoose(source, { defaults, choices });
  const meta = applyOverrides(parsed.meta, overrides, { ...CHOICES, ...choices });
  if (meta.template === "video")
    throw new ParseError("template: video is a video draft; render it with am video", 0);
  const problem = themes.problem(meta.theme, "page");
  if (problem) throw new ParseError(problem, 0);
  // theme: auto becomes a real theme here, so the page, the summary and later patches name the theme that was used.
  const doc = {
    ...parsed,
    meta:
      meta.theme === AUTO
        ? {
            ...meta,
            theme: pickTheme({
              scope: "page",
              template: meta.template,
              visuals: hasVisuals(parsed),
            }),
          }
        : meta,
  };

  const language = resolveLanguage({
    declared: doc.meta.lang,
    previous: previousLanguage,
    text: source,
  });
  const warnings = doc.meta.style === "off" ? [] : lintDoc(doc, language);
  if (doc.meta.style === "strict" && warnings.length) {
    raiseAll(errors); // the draft errors come first: they have to be fixed anyway
    throw new LintError(warnings);
  }

  const stats: RenderStats = {
    panels: doc.panels.length,
    components: {},
    code: [],
    codeWarnings: [],
    componentWarnings: [],
    htmlWarnings: [],
    mathWarnings: [],
  };
  const ui = language.ui;
  const ctx: RenderContext = {
    seq: 0,
    stats,
    errors,
    ui,
    dir: language.dir,
    scale,
    images: { baseDir, known: knownImages },
    code: { baseDir: codeDir, known: knownCode },
  };
  // A panel-only component in the intro is an error of its own, and the block renders nothing.
  const loose = doc.intro.filter(
    (b): b is FenceBlock => b.type === "fence" && Boolean(COMPONENTS.get(b.lang)?.panelOnly),
  );
  for (const b of loose) {
    errors.push(
      new RenderError(
        `${b.lang} belongs in a panel: put it under the ## heading of the panel the answer changes`,
        { line: b.line, component: b.lang, example: COMPONENTS.get(b.lang)?.example },
      ),
    );
  }
  const introHtml = renderBlocks(
    doc.intro.filter((b) => !loose.some((item) => item === b)),
    ctx,
  );
  const panels = doc.panels.map((p) => ({ ...p, html: renderBlocks(p.blocks, ctx) }));
  raiseAll(errors);
  const template = Object.entries(TEMPLATES).find(([name]) => name === doc.meta.template)?.[1];
  if (!template) throw new TypeError(`Unknown template: ${doc.meta.template}`);
  const page = template({ meta: doc.meta, introHtml, panels, ui, language });
  // A right-to-left page isolates each run of text with no right-to-left letter as left to right (src/bidi.js).
  const body = language.dir === "rtl" ? isolateLtrRuns(page) : page;
  const html = shell({
    meta: doc.meta,
    language,
    body,
    source,
    embedded: themes.embedFor(doc.meta.theme, "page"),
    closeAfter,
    scale,
  });
  return { html, warnings, stats, meta: doc.meta, language };
}

// A diagram, another component or a raw html / svg block anywhere in the draft.
function hasVisuals({ intro, panels }: DraftDoc) {
  return [...intro, ...panels.flatMap((p) => p.blocks)].some(
    (b) => b.type === "fence" && (COMPONENTS.has(b.lang) || RAW_LANGS.has(b.lang)),
  );
}

// ctx.errors: an array that collects the RenderError of each block, so one run finds every broken block; a failing block renders
// nothing and the next one goes on. Without it the first error throws. The caller throws what was collected (raiseAll in src/parse.js).
export function renderBlocks(blocks: Block[], ctx: RenderContext) {
  return blocks
    .map((b) => {
      if (!ctx.errors) return renderBlock(b, ctx);
      try {
        return renderBlock(b, ctx);
      } catch (err) {
        if (!(err instanceof RenderError)) throw err;
        ctx.errors.push(err);
        return "";
      }
    })
    .join("\n");
}

function renderBlock(b: Block, ctx: RenderContext) {
  const { result, notes } = collectHtmlNotes(
    () =>
      b.type === "md"
        ? `<div class="am-md">${md(b.text, { ui: ctx.ui, interactive: !ctx.video })}</div>`
        : renderFence(b, ctx),
    { math: !ctx.video },
  );
  noteHtml(
    b,
    notes.filter((n) => !n.math),
    ctx,
  );
  noteMath(
    b,
    notes.filter((n) => n.math),
    ctx,
  );
  const out = embedImages(b, result, ctx);
  noteRemoteImages(b, out, ctx);
  return out;
}

// Each remote image of one block, with the draft line that names it. The page blocks remote content (src/csp.js), so the image would be blank.
function noteRemoteImages(block: Block, html: string, ctx: RenderContext) {
  if (!ctx.stats.htmlWarnings) return;
  const lines = block.text.split("\n");
  const first = block.type === "md" ? block.line : block.line + 1;
  const used = new Map<string, number>();
  for (const ref of remoteImages(html)) {
    const places = lines.flatMap((l, i) =>
      l.includes(ref) || l.includes(encodeURI(ref)) ? [i] : [],
    );
    const n = used.get(ref) ?? 0;
    used.set(ref, n + 1);
    const shown = ref.length > 80 ? `${ref.slice(0, 77)}...` : ref;
    ctx.stats.htmlWarnings.push({
      line: first + (places[Math.min(n, places.length - 1)] ?? 0),
      message: `remote image ${shown} does not load in the page; save the image and use its local path`,
    });
  }
}

// The raw-HTML notes of one block, each with the draft line of its tag. The nth note about the same tag points at its nth place in the block.
function noteHtml(block: Block, notes: { at: string; message: string }[], ctx: RenderContext) {
  if (!notes.length || !ctx.stats.htmlWarnings) return;
  const lines = block.text.split("\n");
  const first = block.type === "md" ? block.line : block.line + 1;
  const used = new Map<string, number>();
  for (const { at, message } of notes) {
    const tag = at.split("\n")[0];
    const places = lines.flatMap((l, i) =>
      Array.from({ length: l.split(tag).length - 1 }, () => i),
    );
    const n = used.get(tag) ?? 0;
    used.set(tag, n + 1);
    ctx.stats.htmlWarnings.push({
      line: first + (places[Math.min(n, places.length - 1)] ?? 0),
      message,
    });
  }
}

// The math notes of one block, each with the draft line of its formula. The nth note about the same formula points at its nth place in the block.
function noteMath(block: Block, notes: { at: string; message: string }[], ctx: RenderContext) {
  if (!notes.length || !ctx.stats.mathWarnings) return;
  const first = block.type === "md" ? block.line : block.line + 1;
  const next = new Map<string, number>();
  for (const { at, message } of notes) {
    const index = block.text.indexOf(at, next.get(at) ?? 0);
    next.set(at, index + 1);
    ctx.stats.mathWarnings.push({
      line: first + (index < 0 ? 0 : block.text.slice(0, index).split("\n").length - 1),
      message,
    });
  }
}

// Components that read their text as Markdown. Only there is ![a](b) an image the author meant; in raw html and in diagram text it is literal.
const MARKDOWN_FENCES = new Set(["callout", "kv", "tree", "timeline"]);

// Local images in a block's html become data URIs; a missing or oversize file is reported at the line that names it.
function embedImages(block: Block, html: string, ctx: RenderContext) {
  try {
    return inlineImages(html, {
      ...ctx.images,
      checkText: block.type === "md" || MARKDOWN_FENCES.has(block.lang),
    });
  } catch (err) {
    if (!(err instanceof ImageError)) throw err;
    // The draft may write the path as decoded (a b.png) or percent-encoded (a%20b.png).
    const idx = block.text
      .split("\n")
      .findIndex((l) => l.includes(err.ref) || l.includes(encodeURI(err.ref)));
    const first = block.type === "md" ? block.line : block.line + 1;
    throw new RenderError(err.message, {
      line: first + Math.max(idx, 0),
      component: "image",
      example: IMAGE_EXAMPLE,
    });
  }
}

function renderFence(block: FenceBlock, ctx: RenderContext) {
  const { lang, args, text, line } = block;
  if (RAW_LANGS.has(lang)) {
    if (lang === "html" || lang === "svg") {
      // Comments and <textarea> are skipped; so is <style> in html, whose content is raw text (in svg its children are parsed).
      const style = lang === "html" ? "|<style\\b[^>]*>[\\s\\S]*?(?:<\\/style\\s*>|$)" : "";
      for (const match of text.matchAll(
        new RegExp(
          `<!--[\\s\\S]*?(?:-->|$)|<textarea\\b[^>]*>[\\s\\S]*?(?:<\\/textarea\\s*>|$)${style}|<script\\b`,
          "gi",
        ),
      )) {
        if (match[0].toLowerCase() !== "<script") continue;
        ctx.stats.htmlWarnings?.push({
          line: line + 1 + text.slice(0, match.index).split("\n").length - 1,
          message: "this script will not run: the page allows only am's own scripts",
        });
      }
    }
    return text;
  }
  const comp = COMPONENTS.get(lang);
  if (!comp) return codeBlock(block, ctx);
  if (comp.pageOnly && ctx.video)
    throw new RenderError(`${lang} works on a page only; a video cannot take answers`, {
      line,
      component: lang,
      example: comp.example,
    });
  ctx.stats.components[lang] = (ctx.stats.components[lang] ?? 0) + 1;
  try {
    const warn = ({ line: at = 0, message }: { line?: number; message: string }) =>
      ctx.stats.componentWarnings?.push({ line: line + at, component: lang, message });
    const html = comp.render(text, {
      args,
      uid: () => `am${++ctx.seq}`,
      ui: ctx.ui,
      dir: ctx.dir ?? "ltr",
      video: ctx.video,
      warn,
    });
    // A component's own svg is measured in viewBox units at fixed text sizes, so the whole box takes the factor. Raw svg / html blocks
    // bypass this function, and a video never scales.
    return ctx.video ? html : scaleSvgBoxes(html, ctx.scale ?? 1);
  } catch (err) {
    if (!(err instanceof ComponentError)) throw err;
    throw new RenderError(err.message, {
      line: line + (err.line || 0),
      component: lang,
      example: comp.example,
    });
  }
}

// A fence that is not a component is code. In a video the block has no copy button.
function codeBlock(block: FenceBlock, ctx: RenderContext) {
  try {
    const { html, file, warnings } = renderCode(block, {
      ...ctx.code,
      ui: ctx.ui,
      copy: !ctx.video,
    });
    if (file && ctx.stats.code) ctx.stats.code.push(file);
    if (ctx.stats.codeWarnings)
      ctx.stats.codeWarnings.push(...warnings.map((w) => ({ line: block.line, ...w })));
    return html;
  } catch (err) {
    if (!(err instanceof CodeError)) throw err;
    throw new RenderError(err.message, {
      line: block.line + err.line,
      component: "code",
      example: err.example,
    });
  }
}

// The title scene uses the local render date, matching the customized renderer.
export function renderDate(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The page without its new-version button and popover, for a reader on another device (src/serve.js): the notice is for the person
// who made the page. Both come before the body, so the first match is the one updateNotice wrote.
export function withoutUpdateNotice(html: string) {
  return html
    .replace(/<button class="am-btn am-btn--update"[^]*?<\/button>\n/, "")
    .replace(/<div class="am-update" id="am-update" popover>[^]*?\n<\/div>\n/, "");
}

// A diagram with change markers carries a count row; only then the page needs the delta styles and script.
export const hasDelta = (html: string) => html.includes('class="am-delta-bar"');

// A chart (src/components/chart.js) needs its own styles, as a formula needs the math ones.
export const hasChart = (html: string) => html.includes('class="am-diagram am-chart"');

function lightboxShell(ui: UI, hasDiagrams: boolean) {
  if (!hasDiagrams) return "";
  return `<div class="am-lightbox" hidden aria-modal="true" role="dialog" aria-label="${esc(ui.diagram)}" data-expand="${esc(ui.expand)}">
<div class="am-lightbox-backdrop"></div>
<div class="am-lightbox-header">
<div class="am-lightbox-title">
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
<span class="am-lightbox-title-text"></span>
</div>
<div class="am-lightbox-actions">
<button class="am-lightbox-close" data-action="close" title="${esc(ui.close)}" aria-label="${esc(ui.close)}">✕</button>
</div>
</div>
<div class="am-lightbox-stage">
<div class="am-lightbox-canvas am-diagram"></div>
</div>
</div>
`;
}

// Seconds the page waits before it closes its tab; the page shows the countdown (src/runtime/close-after-reply.js).
const CLOSE_AFTER_SECONDS = 3;

// The toolbar's text-size buttons. They carry the range from SCALE and start hidden: the runtime reads the numbers off them and
// reveals them, so a reader without JavaScript gets no button that cannot do anything.
function scaleButtons(ui: UI) {
  const range = `data-min="${SCALE.min}" data-max="${SCALE.max}" data-step="${SCALE.step}"`;
  const button = (action: string, label: string, text: string) =>
    `<button class="am-btn" type="button" data-am="${action}" ${range} aria-label="${esc(label)}" title="${esc(label)}" hidden>${text}</button>`;
  return `${button("scale-down", ui.scale.down, "A−")}${button("scale-up", ui.scale.up, "A+")}`;
}

function shell({
  meta,
  language,
  body,
  source,
  embedded,
  closeAfter,
  scale,
}: {
  meta: Meta;
  language: Language;
  body: string;
  source: string;
  embedded: ReturnType<typeof BUILTIN.embedFor>;
  closeAfter: boolean;
  scale: number;
}) {
  const { ui, labelKey } = language;
  const pick = (name: string, label: string, values: [string, string][], current: string) =>
    `<label class="am-pick">${esc(label)}<select data-am="${name}">${values
      .map(
        ([value, text]) =>
          `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(text)}</option>`,
      )
      .join("")}</select></label>`;
  const root = {
    lang: language.htmlLang,
    dir: language.dir,
    theme: meta.theme,
    mode: meta.mode,
    style: meta.style,
    scale,
  };
  // The one inline script, as the browser reads it: the policy pins a hash of exactly this text.
  const interactiveTable = body.includes("<table data-am-table=");
  const script = `\n${RUNTIME_JS}${interactiveTable ? TABLE_JS : ""}${hasDelta(body) ? DELTA_JS : ""}${closeAfter ? CLOSE_AFTER_JS : ""}`;
  return `<!doctype html>
${rootTag(root)}
<head>
<meta charset="utf-8">
${cspMeta([script], { live: true })}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title || "Untitled")}</title>
<style>
${pageCss(embedded, { diff: body.includes('class="am-codeblock am-codeblock--diff"'), delta: hasDelta(body), rtl: language.dir === "rtl", math: hasMath(body), chart: hasChart(body), table: interactiveTable, closeAfter, scale })}
</style>
</head>
<body>
<div class="am-toolbar"${rootCarrierAttrs(root)}>
${pick(
  "theme",
  ui.theme,
  embedded.map((t) => [t.name, t.label[labelKey]]),
  meta.theme,
)}
${pick("mode", ui.modeLabel, Object.entries(ui.mode), meta.mode)}
${scaleButtons(ui)}
<button class="am-btn am-btn--reply" type="button" data-am="reply" data-ui="${esc(JSON.stringify({ ...ui.reply, done: ui.done, remarks: ui.remark.section, kinds: ui.remark.kinds, ...(closeAfter ? { closeAfter: { seconds: CLOSE_AFTER_SECONDS, ...ui.closeAfter } } : {}) }))}">${esc(ui.reply.button)}</button>
<button class="am-btn am-btn--remark" type="button" data-am="remark" data-ui="${esc(JSON.stringify(ui.remark))}">${esc(ui.remark.button)}</button>
<button class="am-btn" type="button" data-am="copy" data-done="${esc(ui.done)}">${esc(ui.copy)}</button>
</div>
${body}
${lightboxShell(ui, body.includes('class="am-diagram'))}${sourceTag(source)}
<script>${script}</script>
</body>
</html>
`;
}
