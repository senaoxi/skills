// Only keys the user set explicitly are saved; reads merge with defaults, and a bad file / invalid value falls back to the default, so config problems never block rendering.

import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { amHome, ensureHome } from "./home.ts";
import { CHOICES, VOICES } from "./parse.ts";
import { loadThemes, AUTO } from "./themes/registry.ts";
import { SCALE } from "./themes/type-scale.ts";
import { isRecord, errorMessage } from "./sys.ts";
type ThemeSet = ReturnType<typeof loadThemes>;
export interface ConfigValues {
  open: boolean;
  theme: string;
  mode: string;
  style: string;
  scale: number;
  update_check: boolean;
  close_after_reply: boolean;
  voice: string;
}
export type ConfigKey = keyof ConfigValues;
type Spec = { label: string } & (
  | { type: "bool"; default: boolean }
  | { type: "number"; default: number; min: number; max: number; step: number }
  | { type: "enum"; default: string; choices: readonly string[] }
);
export const isConfigKey = (key: string): key is ConfigKey => Object.hasOwn(CONFIG_KEYS, key);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const CONFIG_KEYS = Object.freeze({
  open: { type: "bool", default: true, label: "Open the page in the browser after it is made" },
  theme: {
    type: "enum",
    choices: CHOICES.theme,
    default: AUTO,
    label: "Default theme (auto: paper for long text, blueprint for diagrams)",
  },
  mode: { type: "enum", choices: CHOICES.mode, default: "auto", label: "Default light/dark mode" },
  style: {
    type: "enum",
    choices: CHOICES.style,
    default: "80",
    label: "STE writing-check strictness",
  },
  scale: {
    type: "number",
    min: SCALE.min,
    max: SCALE.max,
    step: SCALE.step,
    default: 1,
    label:
      "Text size on the page (1 = default, 1.2 = 20% larger; diagrams and charts grow with it)",
  },
  update_check: {
    type: "bool",
    default: true,
    label:
      "Check for a new version once a day in the background and tell you (never updates by itself)",
  },
  close_after_reply: {
    type: "bool",
    default: false,
    label: "Close the page tab 3 seconds after the reply is copied (a Keep open button cancels it)",
  },
  voice: {
    type: "enum",
    choices: VOICES,
    default: "auto",
    label:
      "Video narration voice-over (auto: system TTS when available, otherwise captions; local: the service at AM_TTS_URL)",
  },
} satisfies Record<ConfigKey, Spec>);

const TRUE = new Set(["on", "true", "yes", "1", "开", "开启", "打开"]); // lang-ok: accepted Chinese input aliases
const FALSE = new Set(["off", "false", "no", "0", "关", "关闭"]); // lang-ok: accepted Chinese input aliases

export function configPath(env = process.env) {
  return join(amHome(env), "config.json");
}

const defaults = (): ConfigValues => ({
  open: CONFIG_KEYS.open.default,
  theme: CONFIG_KEYS.theme.default,
  mode: CONFIG_KEYS.mode.default,
  style: CONFIG_KEYS.style.default,
  scale: CONFIG_KEYS.scale.default,
  update_check: CONFIG_KEYS.update_check.default,
  close_after_reply: CONFIG_KEYS.close_after_reply.default,
  voice: CONFIG_KEYS.voice.default,
});

// The allowed values of a key; theme also allows the user's themes.
export function configChoices(key: string, themes: ThemeSet | null) {
  if (!isConfigKey(key)) return [];
  const spec = CONFIG_KEYS[key];
  return key === "theme"
    ? [AUTO, ...(themes?.names("page") ?? [])]
    : spec.type === "enum"
      ? spec.choices
      : [];
}

function coerce(key: string, raw: unknown, themes: ThemeSet | null): string | number | boolean {
  const spec = isConfigKey(key) ? CONFIG_KEYS[key] : undefined;
  if (!spec)
    throw new ConfigError(
      `No setting named "${key}". Available: ${Object.keys(CONFIG_KEYS).join(" | ")}`,
    );
  if (spec.type === "bool") {
    if (typeof raw === "boolean") return raw;
    const v = String(raw).trim().toLowerCase();
    if (TRUE.has(v)) return true;
    if (FALSE.has(v)) return false;
    throw new ConfigError(`${key} accepts only on / off`);
  }
  if (spec.type === "number") {
    const n = Number(String(raw).trim());
    const steps = n / spec.step;
    if (
      !Number.isFinite(n) ||
      n < spec.min ||
      n > spec.max ||
      Math.abs(steps - Math.round(steps)) >= 1e-9
    ) {
      throw new ConfigError(
        `${key} must be a number from ${spec.min} to ${spec.max}, in steps of ${spec.step}`,
      );
    }
    return n;
  }
  const v = String(raw).trim();
  const choices = configChoices(key, themes);
  if (!choices.includes(v))
    throw new ConfigError(`Invalid ${key} value "${v}". Choose one of: ${choices.join(" | ")}`);
  return v;
}

function readStored(env: NodeJS.ProcessEnv): { stored: Record<string, unknown>; warning?: string } {
  const file = configPath(env);
  if (!existsSync(file)) return { stored: {} };
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    return { stored: isRecord(data) ? data : {} };
  } catch (e) {
    return {
      stored: {},
      warning: `Cannot parse ${file}; using the default settings (${errorMessage(e)})`,
    };
  }
}

// themes: the theme set that theme values are checked against (default: the built-in themes plus the user's theme files).
export function readConfig(env = process.env, themes = loadThemes(amHome(env))) {
  const { stored, warning } = readStored(env);
  const values = defaults();
  const warnings = [warning];
  for (const [k, v] of Object.entries(stored)) {
    if (!isConfigKey(k)) continue;
    try {
      Object.assign(values, { [k]: coerce(k, v, themes) });
    } catch {
      // Invalid values keep the default. A default theme can vanish when its file is removed, so say so.
      if (k === "theme")
        warnings.push(
          `The default theme "${v}" cannot be used (${themes.problem(String(v), "page")}); using ${values.theme}`,
        );
    }
  }
  return {
    values,
    stored,
    warning: warnings.filter(Boolean).join("; ") || undefined,
    path: configPath(env),
  };
}

function writeStored(stored: Record<string, unknown>, env: NodeJS.ProcessEnv) {
  const file = configPath(env);
  if (!Object.keys(stored).length) {
    rmSync(file, { force: true });
    return;
  }
  ensureHome(dirname(file));
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
}

export function setConfig(
  key: string,
  raw: unknown,
  env = process.env,
  themes = loadThemes(amHome(env)),
) {
  const value = coerce(key, raw, themes);
  const { stored } = readStored(env);
  writeStored({ ...stored, [key]: value }, env);
  return value;
}

export function resetConfig(key: string | undefined, env = process.env) {
  if (key !== undefined && !isConfigKey(key)) coerce(key, "", null);
  const { stored } = readStored(env);
  const next =
    key === undefined ? {} : Object.fromEntries(Object.entries(stored).filter(([k]) => k !== key));
  writeStored(next, env);
}
