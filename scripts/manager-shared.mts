import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export const digest = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
export function fail(message: string): never {
  throw new Error(message);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function record(value: unknown, label: string): Record<string, unknown> {
  if (!object(value)) fail(`Invalid ${label}`);
  return value;
}
export function keys(
  value: unknown,
  allowed: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    fail(`Invalid ${label}`);
}
export function present(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
export function safeRelative(path: unknown): path is string {
  return (
    present(path) &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !/^[a-z]:/i.test(path) &&
    (path === "." || path.split("/").every((part) => part && part !== "." && part !== ".."))
  );
}
export function safeName(name: unknown): name is string {
  return safeRelative(name) && name !== "." && !name.includes("/");
}
export function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function parseJSON(text: string): unknown {
  return JSON.parse(text);
}
