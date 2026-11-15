// Once a day a background child process reads package.json on GitHub and writes the result into state.json.
// A later render prints one update hint for the agent; pages do not carry update notices.
import { spawn } from "node:child_process";
import { DAY, writeState, type State } from "./state.ts";
import type { ConfigValues } from "./config.ts";
import { isRecord } from "./sys.ts";
import { parseVersion, newer } from "./version.ts";

export const UPDATE = Object.freeze({
  checkEveryDays: 1,
  hintEveryDays: 3,
  timeoutMs: 5000,
  url: "https://raw.githubusercontent.com/QingYunA/answer-me-with-html/main/package.json",
});

export { parseVersion, newer };

// update_check off, CI and AM_NO_UPDATE_CHECK each turn off both the background check and the update notice.
export const updateEnabled = (env: NodeJS.ProcessEnv, config: Pick<ConfigValues, "update_check">) =>
  !(config.update_check === false || env.CI || env.AM_NO_UPDATE_CHECK);

export function updateHint(state: State, current: string, now = Date.now()) {
  if (!newer(state.latestVersion, current)) return null;
  if (state.lastUpdateHint && now - Number(state.lastUpdateHint) < UPDATE.hintEveryDays * DAY)
    return null;
  return `! Update hint: the upstream Answer me with HTML renderer has version ${state.latestVersion} (bundled ${current}). Update Mark from its own installation source.`;
}

export function shouldCheckUpdate(
  state: State,
  env: NodeJS.ProcessEnv,
  config: Pick<ConfigValues, "update_check">,
  now = Date.now(),
) {
  if (!updateEnabled(env, config)) return false;
  return (
    !state.lastUpdateCheck || now - Number(state.lastUpdateCheck) >= UPDATE.checkEveryDays * DAY
  );
}

export function spawnUpdateCheck(home: string, scriptPath: string) {
  writeState(home, { lastUpdateCheck: Date.now() });
  try {
    spawn(process.execPath, [scriptPath, "__update-check"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, AM_HOME: home },
    })
      .on("error", () => {})
      .unref();
  } catch {
    // A failed background check does not affect normal use.
  }
}

// Accept only x.y.z version numbers, so arbitrary remote text never reaches the agent's context.
export async function runUpdateCheck(home: string, fetchImpl: typeof fetch = fetch) {
  try {
    const data: unknown = await fetchJson(fetchImpl, UPDATE.url);
    const version = isRecord(data) && typeof data.version === "string" ? data.version : "";
    if (!parseVersion(version)) return null;
    const latest = version.trim();
    writeState(home, { latestVersion: latest, lastUpdateCheck: Date.now() });
    return latest;
  } catch {
    return null;
  }
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(UPDATE.timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
