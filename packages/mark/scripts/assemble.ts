import { readFileSync, realpathSync } from "node:fs";
import { cp, lstat, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";
import type { RendererAssets } from "../src/node/assets.ts";
import { composeFontCss, FONT_NAMES } from "../src/node/themes/font-css.ts";
import { composeMathCss } from "../src/node/themes/math-css.ts";
import { lockedDependencies, within } from "./locked-dependencies.ts";

const bundleBanner =
  "// Built from strict TypeScript modules. See NOTICE for provenance and complete bundled terms.";
const temmlId = "\0mark-deferred-temml";
type Target = { platform: "browser" } | { platform: "node"; assets: RendererAssets };

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

function inPackage(directory: string, file: string): boolean {
  return within(directory, file) && !relative(directory, file).split(sep).includes("node_modules");
}

export async function assembleSkill(packageRoot: string, out: string): Promise<RendererAssets> {
  const destination = await outputDirectory(out);
  const root = await realpath(packageRoot);
  const sourceRoot = join(root, "src");
  const assetsFile = join(sourceRoot, "node", "assets.ts");
  const dependencies = lockedDependencies(root);
  const need = createRequire(join(root, "package.json"));
  const isDependency = (file: string) =>
    dependencies.some(({ directory }) => inPackage(directory, file));
  const readText = (file: string) => readFileSync(join(root, file), "utf8").replace(/\r\n?/g, "\n");
  const resolveDependency = (specifier: string): string => {
    const file = realpathSync(need.resolve(specifier));
    if (!isDependency(file))
      throw new Error(`Input is outside the declared locked dependency closure: ${file}`);
    return file;
  };

  async function bundle(entry: string, target: Target): Promise<string> {
    const { platform } = target;
    const build = await rolldown({
      cwd: root,
      input: join(sourceRoot, `${entry}.ts`),
      platform,
      transform: { target: platform === "node" ? "node20" : "es2022" },
      external: (id) => platform === "node" && isBuiltin(id),
      onLog(level, log, handle) {
        handle(log.code === "UNRESOLVED_IMPORT" ? "error" : level, log);
      },
      plugins: [
        {
          name: "mark-source-inputs",
          resolveId(id) {
            if (platform === "node" && id === "temml") return temmlId;
          },
          load(id) {
            if (id === temmlId) {
              const min = readFileSync(resolveDependency("temml/dist/temml.min.js"), "utf8");
              const code = JSON.stringify(`(function(){\n${min}\nreturn temml;\n})()`);
              return `import {runInThisContext} from 'node:vm';\nexport default runInThisContext(${code});\n`;
            }
            const file = realpathSync(id);
            if (inPackage(sourceRoot, file)) {
              if (!file.endsWith(".ts"))
                throw new Error(`Mark bundle inputs in src must be authored .ts files: ${id}`);
            } else if (!isDependency(file)) {
              throw new Error(`Input is outside Mark sources and locked dependencies: ${id}`);
            }
            if (target.platform === "node" && file === assetsFile)
              return `export const VERSION = '0.5.11';\n${Object.entries(target.assets)
                .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
                .join("\n")}`;
          },
        },
      ],
    });
    try {
      const { output } = await build.generate({
        codeSplitting: false,
        comments: { legal: true },
        ...(platform === "node" ? { format: "es", banner: bundleBanner } : { format: "iife" }),
      });
      const [chunk] = output;
      if (output.length !== 1 || chunk?.type !== "chunk" || !chunk.isEntry)
        throw new Error(`Expected one bundle for ${entry}`);
      for (const id of [...chunk.imports, ...chunk.dynamicImports]) {
        if (platform !== "node" || !isBuiltin(id))
          throw new Error(`Unbundled runtime dependency in ${entry}: ${id}`);
      }
      return chunk.code;
    } finally {
      await build.close();
    }
  }

  for (const file of [
    "temml/dist/Temml.woff2",
    "temml/dist/Temml-Local.css",
    "@fontsource/bangers/files/bangers-latin-400-normal.woff2",
  ])
    resolveDependency(file);
  const css = (name: string) => readText(`assets/themes/${name}.css`);
  // Inline scripts cannot contain an HTML script terminator, even in a comment.
  const script = async (entry: string) =>
    (await bundle(`browser/${entry}`, { platform: "browser" })).replace(
      /<\/script/gi,
      "<\\/script",
    );
  const [
    RUNTIME_JS,
    TABLE_JS,
    DELTA_JS,
    LIVE_JS,
    CLOSE_AFTER_JS,
    VIDEO_JS,
    VIDEO_EXPORT_JS,
    VIDEO_MUX_JS,
  ] = await Promise.all([
    script("runtime/main"),
    script("runtime/table"),
    script("runtime/delta"),
    script("runtime/live"),
    script("runtime/close-after-reply"),
    script("runtime/video"),
    script("runtime/video-export"),
    script("video-mux"),
  ]);
  const assets: RendererAssets = {
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
    RUNTIME_JS,
    TABLE_JS,
    DELTA_JS,
    LIVE_JS,
    CLOSE_AFTER_JS,
    VIDEO_JS,
    VIDEO_EXPORT_JS,
    VIDEO_MUX_JS,
  };
  const bundles = await Promise.all(
    ["am", "publish", "publish-html", "chatgpt"].map(async (name) => ({
      name,
      code: await bundle(`node/${name}`, { platform: "node", assets }),
    })),
  );
  await cp(join(root, "skills"), destination, { recursive: true });
  const scripts = join(destination, "scripts");
  await mkdir(scripts, { recursive: true });
  for (const { name, code } of bundles) await writeFile(join(scripts, `${name}.mjs`), code);
  await writeFile(join(destination, "LICENSE"), readText("LICENSE"));
  await writeFile(join(destination, "NOTICE"), readText("NOTICE"));
  return assets;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out" || !args[1])
    throw new Error("Usage: pnpm artifact:prepare --out ABS_STAGING_SKILL");
  await assembleSkill(process.cwd(), args[1]);
}
