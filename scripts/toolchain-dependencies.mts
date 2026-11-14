import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { parseAllDocuments } from "yaml";
import { isDeepStrictEqual } from "node:util";
import { exists, inside, nonempty, object, slash } from "./toolchain-core.mjs";

export type HashedFile = { path: string; sha256: string; executable: boolean };
export type DependencySnapshot = {
  files: HashedFile[];
  links: { path: string; target: string }[];
  allowed: { path: string; sha256: string }[];
};

export async function hashFile(path: string): Promise<HashedFile> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Expected regular input file: ${path}`);
  return {
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    executable: (info.mode & 0o111) !== 0,
  };
}

type Dependency = { name: string; target: string; optional: boolean };

function packageName(value: unknown): string {
  const name = nonempty(value, "dependency name");
  if (
    !/^(?:@[^/\\\s]+\/)?[^/\\\s]+$/.test(name) ||
    name.split("/").some((part) => part === "." || part === ".." || part.startsWith("."))
  )
    throw new Error(`Invalid dependency name: ${name}`);
  return name;
}

function dependencies(manifest: Record<string, unknown>, includeDev: boolean): Dependency[] {
  const entries = new Map<string, Dependency>();
  for (const field of [
    "dependencies",
    ...(includeDev ? ["devDependencies"] : []),
    "peerDependencies",
    "optionalDependencies",
  ]) {
    if (manifest[field] === undefined) continue;
    for (const [key, raw] of Object.entries(object(manifest[field], field))) {
      const name = packageName(key);
      const specifier = nonempty(raw, `dependency ${name}`);
      const alias = /^npm:((?:@[^/]+\/)?[^@]+)(?:@.*)?$/.exec(specifier);
      const target = alias?.[1] === undefined ? name : packageName(alias[1]);
      let optional = field === "optionalDependencies";
      if (field === "peerDependencies") {
        if (entries.has(name)) continue;
        const metadata =
          manifest.peerDependenciesMeta === undefined
            ? {}
            : object(manifest.peerDependenciesMeta, "peerDependenciesMeta");
        optional =
          metadata[name] !== undefined && object(metadata[name], `peer ${name}`).optional === true;
      }
      entries.set(name, { name, target, optional });
    }
  }
  return [...entries.values()];
}

/** Follow active package installation links/manifests, never TypeScript imports or store caches. */
export async function dependencySnapshot(
  root: string,
  packages: readonly string[],
): Promise<DependencySnapshot> {
  root = await realpath(root);
  const installed: string[] = [];
  const workspace = await Promise.all(packages.map((path) => realpath(path)));
  if (workspace.some((path) => !inside(root, path)))
    throw new Error("Workspace dependency escapes repository");
  const files = new Map<string, HashedFile>();
  const links = new Map<string, string>();
  async function confined(path: string): Promise<string | undefined> {
    if (!inside(root, path)) throw new Error(`Dependency path escapes repository: ${path}`);
    let current = root;
    for (const part of relative(root, path).split(sep).filter(Boolean)) {
      current = resolve(current, part);
      if (!(await exists(current))) return undefined;
      if ((await lstat(current)).isSymbolicLink()) {
        const target = await realpath(current);
        if (!inside(root, target))
          throw new Error(`Dependency link escapes repository: ${current}`);
        links.set(slash(relative(root, current)), slash(relative(root, target)));
      }
    }
    return realpath(path);
  }
  for (const directory of [root, ...workspace]) {
    const path = resolve(directory, "node_modules");
    const physical = await confined(path);
    if (physical === undefined) continue;
    installed.push(physical);
  }
  const owned = new Set([root, ...workspace]);
  const manifests = new Map<string, Record<string, unknown>>();
  const active = new Set<string>();
  const owners = new Map<string, { identity: string; bundled: boolean }>();
  const visitedFiles = new Set<string>();
  async function manifest(path: string): Promise<Record<string, unknown>> {
    const cached = manifests.get(path);
    if (cached) return cached;
    const file = await confined(resolve(path, "package.json"));
    if (file === undefined) throw new Error(`Missing installed package manifest: ${path}`);
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    const data = object(parsed, `installed package ${path}`);
    manifests.set(path, data);
    return data;
  }
  function bundled(data: Record<string, unknown>, name: string): boolean {
    const value = data.bundleDependencies ?? data.bundledDependencies;
    return (
      (value === true &&
        ["dependencies", "optionalDependencies"].some(
          (field) => data[field] !== undefined && Object.hasOwn(object(data[field], field), name),
        )) ||
      (Array.isArray(value) && value.includes(name))
    );
  }
  async function findDependency(from: string, name: string): Promise<string | undefined> {
    for (let directory = from; inside(root, directory); directory = dirname(directory)) {
      if (basename(directory) !== "node_modules") {
        const candidate = resolve(directory, "node_modules", name);
        if ((await confined(candidate)) !== undefined) return candidate;
      }
      if (directory === root) break;
    }
    return undefined;
  }
  async function followDependencies(
    path: string,
    data: Record<string, unknown>,
    includeDev: boolean,
  ): Promise<void> {
    for (const dependency of dependencies(data, includeDev)) {
      const location = await findDependency(path, dependency.name);
      if (location === undefined) {
        if (dependency.optional) continue;
        throw new Error(`Missing active dependency ${dependency.name} required by ${path}`);
      }
      await activate(
        location,
        dependency.target,
        !includeDev && bundled(data, dependency.name) ? path : undefined,
      );
    }
  }
  async function inventory(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await confined(path);
      if (target === undefined) throw new Error(`Missing active dependency link: ${path}`);
      if (
        workspace.some((pkg) => inside(pkg, target)) &&
        !installed.some((base) => inside(base, target))
      )
        return;
      if (!installed.some((base) => inside(base, target)))
        throw new Error(`Dependency link escapes installed roots: ${path}`);
      if (![...owners.keys()].some((owner) => inside(owner, target))) {
        let owner = (await lstat(target)).isDirectory() ? target : dirname(target);
        while (
          installed.some((base) => inside(base, owner)) &&
          !(await exists(resolve(owner, "package.json")))
        )
          owner = dirname(owner);
        if (!installed.some((base) => inside(base, owner)))
          throw new Error(`Dependency file has no installed package owner: ${path}`);
        await activate(owner);
      }
      await inventory(target);
      return;
    }
    if (visitedFiles.has(path)) return;
    visitedFiles.add(path);
    if (info.isDirectory()) {
      for (const child of (await readdir(path)).sort()) {
        if (child === "node_modules" && owners.has(path)) {
          await visiblePackages(resolve(path, child), path);
        } else await inventory(resolve(path, child));
      }
    } else if (info.isFile()) files.set(path, await hashFile(path));
    else throw new Error(`Special dependency file is forbidden: ${path}`);
  }
  async function activate(path: string, expected?: string, bundledBy?: string): Promise<void> {
    const physical = await confined(path);
    if (physical === undefined) throw new Error(`Missing active dependency: ${path}`);
    const workspacePackage = owned.has(physical);
    if (!workspacePackage && !installed.some((base) => inside(base, physical)))
      throw new Error(`Dependency link escapes installed roots: ${path}`);
    if (!(await lstat(physical)).isDirectory())
      throw new Error(`Expected installed package directory: ${path}`);
    const data = await manifest(physical);
    const name = packageName(data.name);
    if (expected !== undefined && name !== expected)
      throw new Error(
        `Installed dependency identity mismatch: ${path}: expected ${expected}, found ${name}`,
      );
    if (active.has(physical)) return;
    active.add(physical);
    if (!workspacePackage) {
      owners.set(physical, {
        identity: `${name}@${nonempty(data.version, "installed package version")}`,
        bundled:
          bundledBy !== undefined &&
          owners.has(bundledBy) &&
          inside(resolve(bundledBy, "node_modules"), physical),
      });
      await inventory(physical);
    }
    await followDependencies(physical, data, workspacePackage);
  }
  async function visiblePackages(directory: string, parent?: string): Promise<void> {
    const physical = await confined(directory);
    if (physical === undefined) return;
    if (!installed.some((base) => inside(base, physical)))
      throw new Error(`Dependency directory escapes installed roots: ${directory}`);
    const data = parent === undefined ? {} : await manifest(parent);
    const specs = new Map(
      dependencies(data, parent === undefined || owned.has(parent)).map((entry) => [
        entry.name,
        entry,
      ]),
    );
    for (const entry of (await readdir(physical)).sort()) {
      if (entry.startsWith(".")) {
        if (entry === ".bin") await inventory(resolve(directory, entry));
        else if (entry === ".modules.yaml" || entry === ".package-lock.json")
          files.set(resolve(physical, entry), await hashFile(resolve(physical, entry)));
        continue;
      }
      const scope = resolve(directory, entry);
      const scopePath = entry.startsWith("@") ? await confined(scope) : undefined;
      if (scopePath !== undefined && !installed.some((base) => inside(base, scopePath)))
        throw new Error(`Dependency directory escapes installed roots: ${scope}`);
      const names = entry.startsWith("@")
        ? (await readdir(scopePath ?? scope)).sort().map((name) => `${entry}/${name}`)
        : [entry];
      for (const key of names) {
        const name = packageName(key);
        await activate(
          resolve(directory, name),
          specs.get(name)?.target ?? name,
          parent !== undefined && !owned.has(parent) && bundled(data, name) ? parent : undefined,
        );
      }
    }
  }
  for (const directory of [root, ...workspace]) {
    await visiblePackages(
      resolve(directory, "node_modules"),
      (await exists(resolve(directory, "package.json"))) ? directory : undefined,
    );
    if (await exists(resolve(directory, "package.json")))
      await followDependencies(directory, await manifest(directory), true);
  }
  if (!files.size)
    return {
      files: [],
      links: [...links].map(([path, target]) => ({ path, target })),
      allowed: [],
    };
  const documents = parseAllDocuments(await readFile(resolve(root, "pnpm-lock.yaml"), "utf8"), {
    uniqueKeys: true,
  });
  if (!documents.length) throw new Error("Empty pnpm dependency lock");
  const locked = new Map<string, unknown>();
  for (const document of documents) {
    if (document.errors.length)
      throw new Error(`Invalid pnpm dependency lock: ${document.errors[0]?.message}`);
    const raw: unknown = document.toJS({ maxAliasCount: 100 });
    const packages = object(object(raw, "pnpm lock document").packages, "locked packages");
    for (const [identity, metadata] of Object.entries(packages)) {
      if (locked.has(identity) && !isDeepStrictEqual(locked.get(identity), metadata))
        throw new Error(`Conflicting pnpm lock package across documents: ${identity}`);
      locked.set(identity, metadata);
    }
  }
  for (const { identity, bundled } of owners.values()) {
    if (!bundled && !locked.has(identity))
      throw new Error(`Installed package is absent from pnpm lock: ${identity}`);
  }
  const sorted = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: sorted,
    links: [...links]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, target]) => ({ path, target })),
    allowed: sorted
      .filter((file) => [...owners.keys()].some((owner) => inside(owner, file.path)))
      .map(({ path, sha256 }) => ({ path, sha256 })),
  };
}
