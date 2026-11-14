// Once a day a background child process reads package.json on GitHub and writes the result into state.json.
// A later render prints one update hint for the agent; pages do not carry update notices.
import { spawn } from "node:child_process";
import { DAY, writeState, type State } from "./state.mjs";
import type { ConfigValues } from "./config.mjs";
import { isRecord } from "./sys.mjs";
import { parseVersion, newer } from "./version.mjs";

export const UPDATE = Object.freeze({
  checkEveryDays: 1,
  hintEveryDays: 3,
  timeoutMs: 5000,
  url: "https://raw.githubusercontent.com/QingYunA/answer-me-with-html/main/package.json",
});

export { parseVersion, newer };

// The update command for each install method, as the user types it. dsh needs the
// profile and the package name, so it is filled in by dshUpdateCommand.
export const UPDATE_COMMANDS = Object.freeze({
  plugin: "claude plugin update answer-me-with-html@answer-me-with-html",
  repo: "git pull && npm install",
  skills: "npx skills update answer-me-with-html -y",
  dsh: "dsh plugin --profile <profile> up <package>",
});

// How this copy was installed. scriptPath is the path of the running am script.
export function installMethod(scriptPath = "") {
  if (/[\\/]\.claude[\\/]plugins[\\/]/.test(scriptPath)) return "plugin";
  if (/[\\/]bin[\\/]am\.js$/.test(scriptPath)) return "repo";
  if (/[\\/]\.dsh[\\/]profiles[\\/][^\\/]+[\\/]node_modules[\\/]/.test(scriptPath)) return "dsh";
  return "skills";
}

// The DSH profile and package name, from ~/.dsh/profiles/<profile>/node_modules/<package>/… — null when
// the path does not parse (a linked copy outside a profile, or a layout that changed).
const DSH_PATH =
  /[\\/]\.dsh[\\/]profiles[\\/]([^\\/]+)[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/;
// Only plain names go into a command the agent runs or the user pastes; anything else stays a placeholder.
const PROFILE_NAME = /^[\w.-]+$/;
const PACKAGE_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
function dshUpdateCommand(scriptPath = "") {
  const m = scriptPath.match(DSH_PATH);
  if (!m) return UPDATE_COMMANDS.dsh;
  const pkg = m[2].replace(/\\/g, "/");
  return `dsh plugin --profile ${PROFILE_NAME.test(m[1]) ? m[1] : "<profile>"} up ${PACKAGE_NAME.test(pkg) ? pkg : "<package>"}`;
}

// Give the update command for the install method, as an instruction for the Agent.
export function updateCommand(scriptPath = "") {
  const method = installMethod(scriptPath);
  if (method === "plugin") {
    return `run ${UPDATE_COMMANDS.plugin} in a terminal (or click Update now on the Installed tab of /plugin), then /reload-plugins`;
  }
  if (method === "repo") return `run ${UPDATE_COMMANDS.repo} in the answer-me-with-html repository`;
  if (method === "dsh") return `run ${dshUpdateCommand(scriptPath)}`;
  return `run ${UPDATE_COMMANDS.skills}`;
}

// update_check off, CI and AM_NO_UPDATE_CHECK each turn off both the background check and the update notice.
export const updateEnabled = (env: NodeJS.ProcessEnv, config: Pick<ConfigValues, "update_check">) =>
  !(config.update_check === false || env.CI || env.AM_NO_UPDATE_CHECK);

export function updateHint(
  state: State,
  current: string,
  scriptPath: string | undefined,
  now = Date.now(),
) {
  if (!newer(state.latestVersion, current)) return null;
  if (state.lastUpdateHint && now - Number(state.lastUpdateHint) < UPDATE.hintEveryDays * DAY)
    return null;
  return `! Update hint: Answer me with HTML ${state.latestVersion} is available (current ${current}). Ask the user whether to update: ${updateCommand(scriptPath)}.`;
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
