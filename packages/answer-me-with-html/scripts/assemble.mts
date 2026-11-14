import { build } from "esbuild";
import type { Plugin } from "esbuild";
import { cp, lstat, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeFontCss, FONT_NAMES } from "../src/node/themes/font-css.mjs";
import { composeMathCss } from "../src/node/themes/math-css.mjs";
import type { RendererAssets } from "../src/node/assets.mjs";
import { assertJavaScriptInputs, javascriptOnly, javaScriptInputs } from "./javascript-only.mjs";
import type { JavaScriptInputs } from "./javascript-only.mjs";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) =>
  readFileSync(join(packageRoot, file), "utf8").replace(/\r\n?/g, "\n");
const compiled = (file: string) => join(packageRoot, ".build", file);
const within = (base: string, file: string) => {
  const rel = relative(base, file);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

async function outputDirectory(out: string): Promise<string> {
  if (!isAbsolute(out)) throw new Error("--out must be an absolute staging directory.");
  const normalized = resolve(out);
  let existing = normalized;
  for (;;) {
    try {
      await lstat(existing);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  const physical = await realpath(existing);
  const candidates = process.platform === "win32" ? [tmpdir()] : [tmpdir(), "/tmp"];
  const roots = [...new Set(await Promise.all(candidates.map((dir) => realpath(dir))))];
  if (
    !roots.some((root) => within(root, physical)) ||
    (existing === normalized && roots.some((root) => relative(root, physical) === ""))
  ) {
    throw new Error("--out must be inside a temporary directory.");
  }
  if (existing === normalized) {
    const info = await lstat(normalized);
    if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(normalized)).length)
      throw new Error("--out must be an empty staging directory.");
  }
  await mkdir(normalized, { recursive: true });
  return normalized;
}

async function browser(entry: string, inputs: JavaScriptInputs): Promise<string> {
  const result = await build({
    absWorkingDir: packageRoot,
    entryPoints: [compiled(`src/${entry}.mjs`)],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    write: false,
    legalComments: "inline",
    metafile: true,
    plugins: [javascriptOnly(inputs)],
    logLevel: "silent",
  });
  if (!result.metafile || !result.outputFiles?.[0])
    throw new Error(`Browser assembly produced no output: ${entry}`);
  assertJavaScriptInputs(result.metafile, inputs, packageRoot, "browser");
  // Inline scripts must never contain an HTML script terminator, including one in a comment.
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}

export async function rendererAssets(
  inputs = javaScriptInputs(packageRoot),
): Promise<RendererAssets> {
  for (const file of [
    "temml/dist/Temml.woff2",
    "temml/dist/Temml-Local.css",
    "@fontsource/bangers/files/bangers-latin-400-normal.woff2",
  ])
    inputs.resolveDependency(file);
  const css = (name: string) => read(`assets/themes/${name}.css`);
  const [
    RUNTIME_JS,
    TABLE_JS,
    DELTA_JS,
    LIVE_JS,
    CLOSE_AFTER_JS,
    VIDEO_JS,
    VIDEO_EXPORT_JS,
    VIDEO_MUX_JS,
  ] = await Promise.all(
    [
      "browser/runtime/main",
      "browser/runtime/table",
      "browser/runtime/delta",
      "browser/runtime/live",
      "browser/runtime/close-after-reply",
      "browser/runtime/video",
      "browser/runtime/video-export",
      "browser/video-mux",
    ].map((entry) => browser(entry, inputs)),
  );
  if (
    [
      RUNTIME_JS,
      TABLE_JS,
      DELTA_JS,
      LIVE_JS,
      CLOSE_AFTER_JS,
      VIDEO_JS,
      VIDEO_EXPORT_JS,
      VIDEO_MUX_JS,
    ].some((value) => value === undefined)
  )
    throw new Error("Incomplete runtime assets.");
  return {
    BASE_CSS: css("base"),
    TABLE_CSS: css("table"),
    DIFF_CSS: css("diff"),
    DELTA_CSS: css("delta"),
    RTL_CSS: css("rtl"),
    CHART_CSS: css("chart"),
    MATH_CSS: composeMathCss(css("math")),
    CLOSE_AFTER_CSS: css("close-after-reply"),
    VIDEO_CSS: css("video"),
    FONT_CSS: Object.fromEntries(FONT_NAMES.map((name) => [name, composeFontCss(name)])),
    RUNTIME_JS: RUNTIME_JS!,
    TABLE_JS: TABLE_JS!,
    DELTA_JS: DELTA_JS!,
    LIVE_JS: LIVE_JS!,
    CLOSE_AFTER_JS: CLOSE_AFTER_JS!,
    VIDEO_JS: VIDEO_JS!,
    VIDEO_EXPORT_JS: VIDEO_EXPORT_JS!,
    VIDEO_MUX_JS: VIDEO_MUX_JS!,
  };
}

function inlineAssets(assets: RendererAssets): Plugin {
  return {
    name: "inline-renderer-assets",
    setup(b) {
      b.onLoad({ filter: /[\\/]src[\\/]node[\\/]assets\.mjs$/ }, () => ({
        loader: "js",
        contents: `export const VERSION = '0.5.11';\n${Object.entries(assets)
          .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
          .join("\n")}`,
      }));
    },
  };
}

// Preserve the customized CLI's deferred Temml compilation. Non-math renders
// and --version do not parse the math library when Node starts the bundle.
const deferredTemml = (inputs: JavaScriptInputs): Plugin => ({
  name: "deferred-temml",
  setup(b) {
    b.onResolve({ filter: /^temml$/ }, () => ({ path: "temml", namespace: "deferred-temml" }));
    b.onLoad({ filter: /.*/, namespace: "deferred-temml" }, () => {
      const min = readFileSync(inputs.resolveDependency("temml/dist/temml.min.js"), "utf8");
      return {
        loader: "js",
        contents: `import {runInThisContext} from 'node:vm';\nexport default runInThisContext(${JSON.stringify(`(function(){\n${min}\nreturn temml;\n})()`)});\n`,
      };
    });
  },
});

export async function assembleSkill(out: string): Promise<RendererAssets> {
  const destination = await outputDirectory(out);
  // Compilation must have completed before any JavaScript is assembled.
  const inputs = javaScriptInputs(packageRoot);
  const assets = await rendererAssets(inputs);
  const assetPlugin = inlineAssets(assets);
  const bundles = await Promise.all(
    ["am", "publish", "publish-html"].map(async (name) => {
      const result = await build({
        absWorkingDir: packageRoot,
        entryPoints: [compiled(`src/node/${name}.mjs`)],
        outfile: join(destination, "scripts", `${name}.mjs`),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        legalComments: "eof",
        write: false,
        metafile: true,
        plugins: [javascriptOnly(inputs), assetPlugin, deferredTemml(inputs)],
        logLevel: "silent",
        banner: {
          js: "// Built from strict TypeScript modules. See NOTICE for provenance and complete bundled terms.",
        },
      });
      if (!result.metafile || !result.outputFiles)
        throw new Error(`Assembly produced no output: ${name}`);
      assertJavaScriptInputs(result.metafile, inputs, packageRoot);
      return result.outputFiles;
    }),
  );
  await cp(join(packageRoot, "skill"), destination, { recursive: true });
  await mkdir(join(destination, "scripts"), { recursive: true });
  for (const files of bundles) for (const file of files) await writeFile(file.path, file.contents);
  await writeFile(join(destination, "NOTICE"), read("NOTICE"));
  return assets;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out" || !args[1])
    throw new Error("Usage: node .build/scripts/assemble.mjs --out ABS_STAGING_SKILL");
  await assembleSkill(args[1]);
}
