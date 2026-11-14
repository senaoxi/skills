import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

export function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
}

export function slug(value: unknown, label = "skill name"): string {
  const name = nonempty(value, label);
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`${label} must be a lowercase slug of at most 64 characters`);
  }
  return name;
}

export async function readJSON(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  try {
    const result: unknown = JSON.parse(text);
    return result;
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}`, { cause: error });
  }
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export function localPath(root: string, path: string, label = "path"): string {
  if (path.includes("\0") || !inside(root, resolve(root, path))) {
    throw new Error(`${label} escapes root: ${path}`);
  }
  return resolve(root, path);
}

export async function physicalPath(root: string, path: string): Promise<string> {
  const absolute = localPath(root, path);
  const physicalRoot = await realpath(root);
  let ancestor = absolute;
  while (!(await exists(ancestor))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error(`Cannot resolve path: ${absolute}`);
    ancestor = parent;
  }
  if (!inside(physicalRoot, await realpath(ancestor))) {
    throw new Error(`Path resolves outside root: ${absolute}`);
  }
  return absolute;
}

export function slash(path: string): string {
  return path.split(sep).join("/");
}

export async function filesUnder(
  root: string,
  skip: (name: string, directory: boolean) => boolean = () => false,
): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skip(name, entry.isDirectory())) continue;
      const absolute = resolve(root, name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link is not allowed: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute, name);
      else if (entry.isFile()) files.push(name);
      else throw new Error(`Special file is not allowed: ${absolute}`);
    }
  }
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected directory: ${root}`);
  await visit(root, "");
  return files;
}

export function distributionExcluded(path: string): boolean {
  const parts = path.split("/");
  if (
    parts.some((part) =>
      /^(?:tests?|__tests__|fixtures|node_modules|\.build|\.limina|\.git|\.github|\.agents|\.codex|\.vscode|\.idea|evals|reports|coverage)$/i.test(
        part,
      ),
    )
  )
    return true;
  const name = parts.at(-1) ?? "";
  return (
    /(?:\.[cm]?tsx?|\.map|\.tsbuildinfo)$/i.test(name) ||
    /(?:^|[.-])(?:test|spec)\.[cm]?js$/i.test(name) ||
    /^(?:tsconfig(?:\..+)?\.json|package(?:-lock)?\.json|pnpm-(?:lock|workspace)\.yaml|.*\.config\.[\w.]+|\.\w*rc(?:\..+)?|\.env(?:\..+)?|\.(?:gitignore|gitattributes|npmignore|skillsignore))$/i.test(
      name,
    )
  );
}

export async function copyStatic(source: string, destination: string): Promise<void> {
  for (const name of await filesUnder(source, (path) => distributionExcluded(path))) {
    const from = resolve(source, name);
    const to = resolve(destination, name);
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, await readFile(from));
    await chmod(to, (await lstat(from)).mode & 0o777);
  }
}

export async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const name of await filesUnder(root)) {
    const path = resolve(root, name);
    hash.update(json([name, (await lstat(path)).mode & 0o111]));
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  overflow: boolean;
};

export async function runCommand(options: {
  command: string;
  args: readonly string[];
  cwd: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<CommandResult> {
  return new Promise((accept, reject) => {
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      shell: false,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    const kill = (): void => {
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs ?? 120_000);
    const capture =
      (chunks: Buffer[]) =>
      (chunk: Buffer): void => {
        bytes += chunk.length;
        if (bytes > (options.maxOutputBytes ?? 8 * 1024 * 1024)) {
          overflow = true;
          kill();
        } else chunks.push(chunk);
      };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") {
        kill();
        reject(error);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      accept({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        overflow,
      });
    });
    child.stdin.end(options.input);
  });
}

export function requireSuccess(result: CommandResult, label: string): void {
  if (result.code !== 0 || result.timedOut || result.overflow) {
    throw new Error(
      `${label} failed (${result.timedOut ? "timeout" : result.overflow ? "output limit" : (result.code ?? result.signal)}):\n${result.stderr || result.stdout}`,
    );
  }
}

export function argumentsFor(
  args: readonly string[],
  values: readonly string[],
  flags: readonly string[] = [],
): {
  values: Map<string, string>;
  flags: Set<string>;
  positional: string[];
} {
  const parsed: { values: Map<string, string>; flags: Set<string>; positional: string[] } = {
    values: new Map(),
    flags: new Set(),
    positional: [],
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) break;
    if (!arg.startsWith("--")) {
      if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
      parsed.positional.push(arg);
      continue;
    }
    const [key, ...inline] = arg.slice(2).split("=");
    if (!key || parsed.values.has(key) || parsed.flags.has(key))
      throw new Error(`Duplicate option: ${arg}`);
    if (flags.includes(key) && inline.length === 0) parsed.flags.add(key);
    else if (values.includes(key)) {
      const value = inline.length ? inline.join("=") : args[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing --${key} value`);
      parsed.values.set(key, nonempty(value, `--${key}`));
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return parsed;
}

export function numberOption(
  value: string | undefined,
  fallback: number,
  label: string,
  integer = false,
): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isSafeInteger(number))) {
    throw new Error(`${label} must be a positive ${integer ? "integer" : "number"}`);
  }
  return number;
}

export async function entrypoint(url: string, main: () => Promise<void>): Promise<void> {
  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url)) {
    try {
      await main();
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
