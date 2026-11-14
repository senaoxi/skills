// Small helpers that deal with the operating system.
import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";

// The error codes of a file operation the operating system or a host sandbox refused (EROFS: a read-only file system).
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const errorCode = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.code === "string" ? error.code : undefined;
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const DENIED = new Set(["EPERM", "EACCES", "EROFS"]);
export const isDenied = (e: unknown) => DENIED.has(errorCode(e) ?? "");

export function hasCommand(cmd: string) {
  return (
    spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" })
      .status === 0
  );
}

// Rename a file over another one. On Windows a rename fails while another process holds either file, typically a virus scanner
// reading the file that was just written, so it is tried again a few times, about 300 ms in all. Other errors are thrown at once.
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function renameOver(
  from: string,
  to: string,
  { platform = process.platform, rename = renameSync, wait = sleep } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return rename(from, to);
    } catch (e) {
      if (platform !== "win32" || attempt > 5 || !BUSY.has(errorCode(e) ?? "")) throw e;
      wait(20 * attempt);
    }
  }
}
