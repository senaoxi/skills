import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { parseAllDocuments } from "yaml";

export interface LockedDependency {
  name: string;
  version: string;
  directory: string;
}
interface Lock {
  root: string;
  importer: Record<string, unknown>;
  snapshots: Record<string, unknown>;
  packages: Record<string, unknown>;
}
export function within(base: string, file: string): boolean {
  const rel = relative(base, file);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
function record(value: unknown, description: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${description}: expected an object`);
  return value as Record<string, unknown>;
}
function readRecord(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  return record(value, file);
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${label}`);
  return value;
}
function strings(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  return Object.fromEntries(
    Object.entries(record(value, label)).map(([name, value]) => [
      name,
      text(value, `${label}.${name}`),
    ]),
  );
}
function version(reference: string): string {
  const base = reference.split("(")[0]!;
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(base))
    throw new Error(`Dependency must resolve to a locked registry version: ${reference}`);
  return base;
}
function lockFor(packageRoot: string): Lock {
  for (let root = packageRoot; ; root = dirname(root)) {
    const file = join(root, "pnpm-lock.yaml");
    if (existsSync(file)) {
      for (const document of parseAllDocuments(readFileSync(file, "utf8"))) {
        if (document.errors.length)
          throw new Error(`Invalid lockfile ${file}: ${document.errors[0]!.message}`);
        const value: unknown = document.toJSON();
        const data = record(value, "pnpm lock document");
        const importers = record(data.importers, "pnpm lock importers");
        const key = relative(root, packageRoot).split("\\").join("/") || ".";
        if (importers[key] !== undefined)
          return {
            root,
            importer: record(importers[key], "package lock importer"),
            snapshots: record(data.snapshots, "pnpm lock snapshots"),
            packages: record(data.packages, "pnpm locked packages"),
          };
      }
      throw new Error(`No locked importer for ${packageRoot} in ${file}`);
    }
    if (dirname(root) === root) throw new Error(`No pnpm lockfile for ${packageRoot}`);
  }
}
function installed(
  name: string,
  from: string,
): { directory: string; manifest: Record<string, unknown> } {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))
    throw new Error(`Invalid dependency name: ${name}`);
  const need = createRequire(join(from, "package.json"));
  let entry: string;
  try {
    entry = need.resolve(`${name}/package.json`);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED"
    )
      throw error;
    entry = need.resolve(name);
  }
  for (let directory = dirname(realpathSync(entry)); ; directory = dirname(directory)) {
    const file = join(directory, "package.json");
    if (existsSync(file)) {
      const manifest = readRecord(file);
      if (manifest.name === name) return { directory, manifest };
    }
    if (dirname(directory) === directory)
      throw new Error(`Cannot identify installed dependency ${name}`);
  }
}

/** Follow the existing package-manager lock graph, not a second resolver graph. */
export function lockedDependencies(packageRoot: string): LockedDependency[] {
  const lock = lockFor(packageRoot);
  const declared = readRecord(join(packageRoot, "package.json"));
  const anchors = [...new Set([join(packageRoot, "node_modules"), join(lock.root, "node_modules")])]
    .filter(existsSync)
    .map((directory) => {
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`Invalid dependency installation root: ${directory}`);
      return realpathSync(directory);
    });
  const dependencies: LockedDependency[] = [];
  const visited = new Set<string>();
  function visit(name: string, reference: string, from: string, optional: boolean): void {
    const expected = version(reference);
    const snapshotKey = `${name}@${reference}`;
    const snapshot = record(lock.snapshots[snapshotKey], `locked snapshot ${snapshotKey}`);
    const metadata = record(
      lock.packages[`${name}@${expected}`],
      `locked package ${name}@${expected}`,
    );
    text(
      record(metadata.resolution, `locked resolution ${name}`).integrity,
      `locked integrity ${name}`,
    );
    let current: ReturnType<typeof installed>;
    try {
      current = installed(name, from);
    } catch (error) {
      if (
        optional &&
        error instanceof Error &&
        "code" in error &&
        error.code === "MODULE_NOT_FOUND"
      )
        return;
      throw error;
    }
    if (current.manifest.version !== expected)
      throw new Error(`Installed dependency differs from lock: ${name}@${expected}`);
    if (!anchors.some((anchor) => within(anchor, current.directory)))
      throw new Error(`Locked dependency escapes the installation: ${current.directory}`);
    const key = process.platform === "win32" ? current.directory.toLowerCase() : current.directory;
    if (visited.has(key)) return;
    visited.add(key);
    dependencies.push({ name, version: expected, directory: current.directory });
    for (const [name, reference] of Object.entries(
      strings(snapshot.dependencies, "locked dependencies"),
    ))
      visit(name, reference, current.directory, false);
    for (const [name, reference] of Object.entries(
      strings(snapshot.optionalDependencies, "locked optional dependencies"),
    ))
      visit(name, reference, current.directory, true);
  }
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const declarations = strings(declared[group], `declared ${group}`);
    const entries =
      lock.importer[group] === undefined ? {} : record(lock.importer[group], `locked ${group}`);
    for (const [name, specifier] of Object.entries(declarations)) {
      const entry = record(entries[name], `locked importer dependency ${name}`);
      if (entry.specifier !== specifier)
        throw new Error(`Dependency declaration differs from lock: ${name}`);
      visit(
        name,
        text(entry.version, `locked version ${name}`),
        packageRoot,
        group === "optionalDependencies",
      );
    }
  }
  return dependencies;
}
