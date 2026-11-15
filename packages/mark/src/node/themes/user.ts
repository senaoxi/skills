import { errorMessage, isTheme } from "./types.ts";
import type { Theme, ThemeProblem } from "./types.ts";
// User themes: one JSON file per theme in <AM_HOME>/themes/; the file name is the theme name.
// A file with problems is skipped and reported; it never stops a render that uses another theme.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { normalizeTheme } from "./check.ts";

// A folder the session may not read. Not isDenied from sys.js: the website bundles this file for the browser.
const DENIED = new Set(["EPERM", "EACCES"]);

// Read one theme file. Returns { name, theme, errors }; theme is null when the file cannot be read as JSON.
export function readThemeFile(file: string, builtinNames: readonly string[]) {
  const name = basename(file).replace(/\.json$/i, "");
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { name, theme: null, errors: [`cannot read it as JSON (${errorMessage(e)})`] };
  }
  return { name, ...normalizeTheme(name, data, builtinNames) };
}

// Returns { themes, broken, warning }: usable themes, name → reason for the files that were skipped, and why the folder could not be
// read. A folder the session may not read (a host sandbox) gives the built-in themes only, so a render with -o still works.
export function readUserThemes(home: string, builtinNames: readonly string[]) {
  const dir = join(home, "themes");
  const themes: Theme[] = [];
  const broken = new Map<string, ThemeProblem>();
  if (!existsSync(dir)) return { themes, broken };
  let files;
  try {
    files = readdirSync(dir);
  } catch (e) {
    const code = e !== null && typeof e === "object" && "code" in e ? String(e.code) : "";
    if (!DENIED.has(code)) throw e;
    return {
      themes,
      broken,
      warning: `Cannot read the themes folder ${dir} (${code}); using the built-in themes only`,
    };
  }
  for (const f of files.filter((x) => x.toLowerCase().endsWith(".json")).sort()) {
    const { name, theme, errors } = readThemeFile(join(dir, f), builtinNames);
    if (errors.length || !theme || !isTheme(theme))
      broken.set(name, { file: `themes/${f}`, reason: errors.join("; ") });
    else themes.push(theme);
  }
  return { themes, broken };
}
