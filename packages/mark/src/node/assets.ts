// The assembler replaces this development loader with literal assets. Published
// entry scripts therefore need only Node, with no files or packages to resolve.
import { readFileSync } from "node:fs";

export const VERSION = "0.5.11";
const keys = [
  "BASE_CSS",
  "RUNTIME_JS",
  "TABLE_JS",
  "TABLE_CSS",
  "DIFF_CSS",
  "DELTA_CSS",
  "RTL_CSS",
  "CHART_CSS",
  "MATH_CSS",
  "DELTA_JS",
  "LIVE_JS",
  "CLOSE_AFTER_CSS",
  "CLOSE_AFTER_JS",
  "VIDEO_CSS",
  "VIDEO_JS",
  "VIDEO_EXPORT_JS",
  "VIDEO_MUX_JS",
] as const;
export type AssetKey = (typeof keys)[number];
export type RendererAssets = Record<AssetKey, string> & { FONT_CSS: Record<string, string> };

function loadAssets(): RendererAssets {
  const file = process.env.AM_RENDERER_ASSETS;
  if (!file)
    throw new Error(
      "Set AM_RENDERER_ASSETS to a compiled test fixture asset JSON before importing the development renderer.",
    );
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof data !== "object" || data === null) throw new Error("Invalid renderer assets.");
  for (const key of keys) {
    if (!(key in data) || typeof Reflect.get(data, key) !== "string")
      throw new Error(`Missing renderer asset: ${key}`);
  }
  if (!("FONT_CSS" in data) || typeof data.FONT_CSS !== "object" || data.FONT_CSS === null)
    throw new Error("Invalid font assets.");
  for (const value of Object.values(data.FONT_CSS)) {
    if (typeof value !== "string") throw new Error("Invalid font asset.");
  }
  // Both the closed asset keys and the font dictionary were checked above.
  return data as RendererAssets;
}
const assets = loadAssets();
export const {
  BASE_CSS,
  RUNTIME_JS,
  TABLE_JS,
  TABLE_CSS,
  DIFF_CSS,
  DELTA_CSS,
  RTL_CSS,
  CHART_CSS,
  MATH_CSS,
  FONT_CSS,
  DELTA_JS,
  LIVE_JS,
  CLOSE_AFTER_CSS,
  CLOSE_AFTER_JS,
  VIDEO_CSS,
  VIDEO_JS,
  VIDEO_EXPORT_JS,
  VIDEO_MUX_JS,
} = assets;
