// Headless Chrome for the export commands. Video export and page export both start one Chrome with a throwaway profile,
// open a page and talk to it over the DevTools Protocol, with no npm dependency. This module holds what they share:
// discovery, the minimal CDP client, the start/wait/close of the browser, and the open-one-page dance.
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasCommand, isRecord } from "./sys.ts";
import type { Readable } from "node:stream";

export type ChromeProcess = ChildProcessByStdio<null, null, Readable>;
export interface CdpResults {
  "Target.createTarget": { targetId: string };
  "Target.attachToTarget": { sessionId: string };
  "Runtime.evaluate": {
    result: { value?: unknown };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  };
  "Page.printToPDF": { data: string };
  "Page.captureScreenshot": { data: string };
  "Page.enable": Record<string, unknown>;
  "Page.navigate": Record<string, unknown>;
  "Emulation.setDeviceMetricsOverride": Record<string, unknown>;
  "Emulation.setEmulatedMedia": Record<string, unknown>;
}
export type CdpMethod = keyof CdpResults;
export type CdpSend = <M extends CdpMethod>(
  method: M,
  params?: Record<string, unknown>,
  sessionId?: string,
) => Promise<CdpResults[M]>;
export interface CdpClient {
  send: CdpSend;
  once: (method: string) => Promise<unknown>;
  close: () => void;
}
export interface OpenPageOptions {
  env?: NodeJS.ProcessEnv;
  chromePath?: string | null;
  startTimeoutMs?: number;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  media?: string;
  flags?: string[];
  scriptError?: string;
}
export interface OpenedPage {
  page: CdpSend;
  evaluate: (expression: string) => Promise<unknown>;
  close: () => Promise<void>;
  tmp: string;
  chrome: ChromeProcess;
}
function validResult<M extends CdpMethod>(method: M, value: unknown): value is CdpResults[M] {
  if (!isRecord(value)) return false;
  switch (method) {
    case "Target.createTarget":
      return typeof value.targetId === "string";
    case "Target.attachToTarget":
      return typeof value.sessionId === "string";
    case "Page.printToPDF":
    case "Page.captureScreenshot":
      return typeof value.data === "string";
    case "Runtime.evaluate":
      return (
        isRecord(value.result) &&
        (value.exceptionDetails === undefined ||
          (isRecord(value.exceptionDetails) &&
            typeof value.exceptionDetails.text === "string" &&
            (value.exceptionDetails.exception === undefined ||
              (isRecord(value.exceptionDetails.exception) &&
                (value.exceptionDetails.exception.description === undefined ||
                  typeof value.exceptionDetails.exception.description === "string")))))
      );
    default:
      return true;
  }
}

export class ExportError extends Error {}

const CDP_TIMEOUT_MS = 30000;
const CHROME_START_TIMEOUT_MS = 20000;
const LOAD_TIMEOUT_MS = 30000; // a page that waits forever on a subresource becomes a readable failure

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  linux: [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
  ],
};

// The candidate paths for a platform. Windows also has a per-user Chrome under %LOCALAPPDATA%; the system-wide
// Program Files paths stay first. Pure, so the Windows list is testable on any platform.
export function chromePaths(platform = process.platform, env = process.env) {
  const list = [...(CHROME_PATHS[platform] ?? CHROME_PATHS.linux)];
  if (platform === "win32" && env.LOCALAPPDATA)
    list.push(`${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`);
  return list;
}

export function findChrome(env = process.env, platform = process.platform) {
  const custom = env.AM_CHROME || env.CHROME_PATH;
  if (custom) return custom;
  return (
    chromePaths(platform, env).find((p) =>
      p.includes("/") || p.includes("\\") ? existsSync(p) : hasCommand(p),
    ) ?? null
  );
}

// Start Chrome with a throwaway profile and open one page in it. Every caller exports one page, so this owns the target,
// the session and the cleanup: `finally { await close() }`. width and height set the window and the emulated viewport;
// deviceScaleFactor is what makes the captured pixels larger than the CSS pixels. flags adds Chrome switches.
export async function openPage(
  url: string,
  {
    env = process.env,
    chromePath = findChrome(env),
    startTimeoutMs = CHROME_START_TIMEOUT_MS,
    width,
    height = 900,
    deviceScaleFactor = 1,
    media,
    flags = [],
    scriptError = "Page script error",
  }: OpenPageOptions = {},
): Promise<OpenedPage> {
  if (!chromePath)
    throw new ExportError(
      "No Chrome / Chromium / Edge found. Set the browser path with the AM_CHROME environment variable",
    );

  const tmp = mkdtempSync(join(tmpdir(), "am-chrome-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(tmp, "profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      ...(width
        ? [`--force-device-scale-factor=${deviceScaleFactor}`, `--window-size=${width},${height}`]
        : []),
      ...flags,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  let cdp: CdpClient | null = null;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    cdp?.close();
    await new Promise<void>((r) => {
      if (chrome.exitCode !== null) return r();
      const timer = setTimeout(r, 3000);
      chrome.once("exit", () => {
        clearTimeout(timer);
        r();
      });
      chrome.kill();
    });
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Chrome's child processes can still write to the profile after the main process exits; a leftover temp
      // directory does not change what the caller did.
    }
  };

  try {
    cdp = await connect(await devtoolsUrl(chrome, startTimeoutMs));
    const connection = cdp;
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page: CdpSend = (method, params) => connection.send(method, params, sessionId);
    if (width)
      await page("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor,
        mobile: false,
      });
    if (media) await page("Emulation.setEmulatedMedia", { media });
    await page("Page.enable");
    // about:blank is already loaded, and Page.enable does not replay its load event, so this waiter is the navigation's.
    const loaded = cdp.once("Page.loadEventFired");
    await page("Page.navigate", { url });
    await waitForLoad(loaded);
    const evaluate = async (expression: string) => {
      const r = await page("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new ExportError(
          `${scriptError}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
        );
      return r.result.value;
    };
    return { page, evaluate, close, tmp, chrome };
  } catch (e) {
    await close();
    throw e;
  }
}

// Resolve when the page's load event arrives, or fail after timeoutMs. Without the timer, a page whose script or
// subresource never finishes keeps Chrome and the CLI alive with no output; the rejection reaches openPage's catch,
// which closes Chrome. The timer is cleared when the load event wins, so it never holds the process open.
export function waitForLoad(loaded: Promise<unknown>, timeoutMs = LOAD_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    loaded,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new ExportError(`The page did not finish loading within ${timeoutMs / 1000} seconds`),
          ),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

// Waits for Chrome to print its DevTools URL. A failure message carries the end of Chrome's stderr,
// so a crash at start can be told apart from a slow start.
export function devtoolsUrl(chrome: ChromeProcess, timeoutMs = CHROME_START_TIMEOUT_MS) {
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    const fail = (msg: string) => {
      clearTimeout(timer);
      const tail = buf.trim().split("\n").slice(-5).join("\n");
      reject(new ExportError(tail ? `${msg}. Chrome stderr:\n${tail}` : msg));
    };
    const timer = setTimeout(
      () => fail(`Chrome did not start in time (${timeoutMs / 1000} s)`),
      timeoutMs,
    );
    chrome.on("error", (e) => fail(`Cannot start Chrome: ${e.message}`));
    chrome.on("close", (code, signal) =>
      fail(`Chrome exited (${code ?? signal}) before it started`),
    );
    chrome.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });
}

// Minimal CDP client: requests/responses paired by id, events awaited once by method name.
export function connect(url: string): Promise<CdpClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map<
      number,
      { ok: (value: unknown) => void; fail: (error: Error) => void }
    >();
    const waiters = new Map<string, (value: unknown) => void>();
    let id = 0;
    ws.addEventListener("error", () =>
      reject(new ExportError("Cannot connect to Chrome DevTools")),
    );
    ws.addEventListener("message", (ev) => {
      const msg: unknown = JSON.parse(String(ev.data));
      if (!isRecord(msg)) return;
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        const request = pending.get(msg.id);
        if (!request) return;
        pending.delete(msg.id);
        if (isRecord(msg.error) && typeof msg.error.message === "string")
          request.fail(new ExportError(`CDP ${msg.error.message}`));
        else request.ok(msg.result);
      } else if (typeof msg.method === "string" && waiters.has(msg.method)) {
        waiters.get(msg.method)?.(msg.params);
        waiters.delete(msg.method);
      }
    });
    const send: CdpSend = <M extends CdpMethod>(
      method: M,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ) => {
      return new Promise<CdpResults[M]>((ok, fail) => {
        const msgId = ++id;
        const timer = setTimeout(() => {
          pending.delete(msgId);
          fail(
            new ExportError(
              `Chrome is not responding (${method} took more than ${CDP_TIMEOUT_MS / 1000} seconds)`,
            ),
          );
        }, CDP_TIMEOUT_MS);
        pending.set(msgId, {
          ok: (value) => {
            clearTimeout(timer);
            if (validResult(method, value)) ok(value);
            else fail(new ExportError(`Invalid Chrome DevTools response (${method})`));
          },
          fail: (error) => {
            clearTimeout(timer);
            fail(error);
          },
        });
        ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    };
    ws.addEventListener("open", () =>
      resolve({
        send,
        once: (method) => new Promise((r) => waiters.set(method, r)),
        close: () => ws.close(),
      }),
    );
  });
}
