import { isObject } from "./types.ts";
interface VideoExportOptions {
  wav?: Buffer | null;
  env?: NodeJS.ProcessEnv;
  onProgress?: (done: number, total: number) => void;
  startTimeoutMs?: number;
  bitrate?: number;
}
interface EncodingProgress {
  running: boolean;
  done: number;
  total: number;
  error: string | null;
  codec: string;
  audio: boolean;
}
function encodingProgress(value: unknown): EncodingProgress {
  if (
    !isObject(value) ||
    typeof value.running !== "boolean" ||
    typeof value.done !== "number" ||
    typeof value.total !== "number" ||
    (value.error !== null && typeof value.error !== "string") ||
    typeof value.codec !== "string" ||
    typeof value.audio !== "boolean"
  )
    throw new ExportError("Player returned invalid encoding progress");
  return {
    running: value.running,
    done: value.done,
    total: value.total,
    error: value.error,
    codec: value.codec,
    audio: value.audio,
  };
}
// Writing a video file next to the player page. Two ways:
//   MP4    local Chrome (headless, via the Chrome DevTools Protocol) calls the player page's render(t) frame by frame and
//          screenshots it, then ffmpeg encodes H.264 and muxes the narration track. No Playwright / Puppeteer dependency.
//   WebM   the page encodes its own frames with WebCodecs and muxes the container with src/video/webm.js, which every
//          player page carries (it drives the export button too). This module only starts it, watches it and writes the
//          bytes it hands back. Needs Chrome only, no ffmpeg. VP9 video and Opus audio.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hasCommand } from "../sys.ts";
import { openPage, ExportError } from "../chrome.ts";

export { findChrome, devtoolsUrl, connect, ExportError } from "../chrome.ts";

const CHROME_START_TIMEOUT_MS = 20000;
const WIDTH = 1920;
const HEIGHT = 1080;
const QUALITY = 92; // the JPEG quality of every captured frame
const WEBM_BITRATE = 3_500_000; // VP9 at 1080p30: flat slides stay clean at this rate
const WEBM_SLICE = 1_048_572; // 1 MiB rounded to a multiple of 3, so every base64 slice stands on its own
const WEBM_POLL_MS = 250; // how often the CLI looks at the page's progress

// Start Chrome, open the page in export mode (stage 1:1, no controls) and hand the session to the caller, which must
// close it: `finally { await player.close() }`. The Chrome launch and CDP client are shared with page export (src/chrome.js).
async function openPlayer(
  htmlFile: string,
  { env, startTimeoutMs }: Pick<VideoExportOptions, "env" | "startTimeoutMs">,
) {
  const player = await openPage(pathToFileURL(htmlFile).href, {
    env,
    startTimeoutMs,
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    scriptError: "Player page script error",
  });
  const { page, evaluate, close, tmp } = player;
  try {
    const raw = await evaluate(
      "document.fonts.ready.then(() => { window.__amv.exportMode(); return { duration: window.__amv.duration, fps: window.__amv.fps }; })",
    );
    if (!isObject(raw) || typeof raw.duration !== "number" || typeof raw.fps !== "number")
      throw new ExportError("Player returned invalid video timing");
    const info = { duration: raw.duration, fps: raw.fps };
    const screenshot = async () =>
      (
        await page("Page.captureScreenshot", {
          format: "jpeg",
          quality: QUALITY,
          clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
        })
      ).data;
    return { info, evaluate, screenshot, close, tmp };
  } catch (e) {
    await close();
    throw e;
  }
}

export async function exportMp4(
  htmlFile: string,
  mp4File: string,
  {
    wav,
    env = process.env,
    onProgress = () => {},
    startTimeoutMs = CHROME_START_TIMEOUT_MS,
  }: VideoExportOptions = {},
) {
  if (!("WebSocket" in globalThis))
    throw new ExportError("MP4 export needs Node.js 22 or later (built-in WebSocket)");
  if (!hasCommand("ffmpeg"))
    throw new ExportError(
      "MP4 export needs ffmpeg: on macOS run brew install ffmpeg; on Linux install it with the package manager",
    );

  const player = await openPlayer(htmlFile, { env, startTimeoutMs });
  try {
    const { info, evaluate, screenshot, tmp } = player;
    const wavFile = wav ? join(tmp, "voice.wav") : null;
    if (wav && wavFile) writeFileSync(wavFile, wav);
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-framerate",
        String(info.fps),
        "-c:v",
        "mjpeg",
        "-i",
        "-",
        ...(wavFile ? ["-i", wavFile] : []),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "20",
        "-preset",
        "medium",
        ...(wavFile ? ["-c:a", "aac", "-b:a", "160k", "-shortest"] : []),
        "-movflags",
        "+faststart",
        mp4File,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let ffErr = "";
    let exited = false;
    ffmpeg.stderr.on("data", (d) => {
      ffErr += d;
    });
    // When ffmpeg exits early, writing to stdin raises EPIPE; swallow it here and let done report the error.
    ffmpeg.stdin.on("error", () => {});
    const done = new Promise<void>((resolve, reject) => {
      ffmpeg.on("error", (e) => {
        exited = true;
        reject(new ExportError(`Cannot run ffmpeg: ${e.message}`));
      });
      ffmpeg.on("close", (code) => {
        exited = true;
        if (code === 0) resolve();
        else reject(new ExportError(`ffmpeg failed (${code}): ${ffErr.slice(0, 300)}`));
      });
    });
    done.catch(() => {}); // attach the handler first, so no unhandled rejection occurs during the frame loop

    const frames = Math.ceil(info.duration * info.fps);
    for (let i = 0; i < frames && !exited; i++) {
      await evaluate(`render(${i / info.fps})`);
      const data = await screenshot();
      if (exited) break;
      if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) {
        await Promise.race([
          new Promise<void>((r) => ffmpeg.stdin.once("drain", () => r())),
          done.catch(() => {}),
        ]);
      }
      if (i % 30 === 0 || i === frames - 1) onProgress(i + 1, frames);
    }
    if (!exited) ffmpeg.stdin.end();
    await done;
    return { frames, duration: info.duration };
  } finally {
    await player.close();
  }
}

// The export without ffmpeg: the page encodes the picture and the narration with WebCodecs and muxes the container
// itself (src/runtime/video-export.js), so this only starts it, reports progress and writes the bytes it hands back.
// `am video --webm` takes this path; `--mp4` always goes through ffmpeg.
export async function exportWebm(
  htmlFile: string,
  webmFile: string,
  {
    env = process.env,
    onProgress = () => {},
    startTimeoutMs = CHROME_START_TIMEOUT_MS,
    bitrate = WEBM_BITRATE,
  }: VideoExportOptions = {},
) {
  if (!("WebSocket" in globalThis))
    throw new ExportError("The built-in encoder needs Node.js 22 or later (built-in WebSocket)");

  const player = await openPlayer(htmlFile, { env, startTimeoutMs });
  try {
    const { info, evaluate } = player;
    if (!(await evaluate("window.__amvEnc.supported()"))) {
      throw new ExportError(
        "This browser cannot encode video (WebCodecs is missing). Install ffmpeg to export an MP4",
      );
    }
    const started = await evaluate(`window.__amvEnc.start(${JSON.stringify({ bitrate })})`);
    if (!isObject(started)) throw new ExportError("Player returned an invalid encoding result");
    if (typeof started.error === "string" && started.error)
      throw new ExportError(`The browser could not encode the video: ${started.error}`);

    let state: EncodingProgress;
    for (;;) {
      state = encodingProgress(await evaluate("window.__amvEnc.progress()"));
      if (state.error) throw new ExportError(`The browser stopped encoding: ${state.error}`);
      onProgress(state.done, state.total);
      if (!state.running) break;
      await new Promise((r) => setTimeout(r, WEBM_POLL_MS));
    }

    const size = await evaluate("window.__amvEnc.size()");
    if (typeof size !== "number") throw new ExportError("Player returned an invalid encoded size");
    const file = Buffer.alloc(size);
    for (let at = 0; at < size; at += WEBM_SLICE) {
      const slice = await evaluate(
        `window.__amvEnc.bytes(${at}, ${Math.min(WEBM_SLICE, size - at)})`,
      );
      if (typeof slice !== "string") throw new ExportError("Player returned invalid encoded bytes");
      Buffer.from(slice, "base64").copy(file, at);
    }
    writeFileSync(webmFile, file);
    return {
      frames: state.done,
      duration: info.duration,
      codec: state.codec,
      audio: Boolean(state.audio),
    };
  } finally {
    await player.close();
  }
}
