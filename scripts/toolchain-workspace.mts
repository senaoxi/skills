import { readFile, readdir } from "node:fs/promises";
import { matchesGlob, resolve } from "node:path";
import { parseDocument } from "yaml";
import { exists, nonempty, object, physicalPath } from "./toolchain-core.mjs";

export async function workspaceDirectories(root: string): Promise<string[]> {
  const directory = resolve(root, "packages");
  if (!(await exists(directory))) return [];
  await physicalPath(root, directory);
  const config = resolve(root, "pnpm-workspace.yaml");
  await physicalPath(root, config);
  const document = parseDocument(await readFile(config, "utf8"), { uniqueKeys: true });
  if (document.errors.length)
    throw new Error(`Invalid pnpm-workspace.yaml: ${document.errors[0]?.message}`);
  const raw: unknown = document.toJS({ maxAliasCount: 20 });
  const patterns = object(raw, "pnpm workspace").packages;
  if (!Array.isArray(patterns) || !patterns.length)
    throw new Error("pnpm workspace packages must be a nonempty array");
  const values = patterns.map((item: unknown) => nonempty(item, "workspace pattern"));
  for (const value of values) {
    if (!/^!?packages\/[^/\\]+$/.test(value) || value.endsWith("/..") || value.endsWith("/.")) {
      throw new Error(`Workspace patterns must select direct packages/* directories: ${value}`);
    }
  }
  if (!values.some((value) => !value.startsWith("!")))
    throw new Error("Workspace needs a positive packages pattern");
  const members: string[] = [];
  for (const child of await readdir(directory, { withFileTypes: true })) {
    if (child.isSymbolicLink()) throw new Error(`Package symlink is not allowed: ${child.name}`);
    if (!child.isDirectory()) continue;
    const path = `packages/${child.name}`;
    const included = values
      .filter((value) => !value.startsWith("!"))
      .some((value) => matchesGlob(path, value));
    const excluded = values
      .filter((value) => value.startsWith("!"))
      .some((value) => matchesGlob(path, value.slice(1)));
    if (included && !excluded && (await exists(resolve(root, path, "package.json"))))
      members.push(resolve(root, path));
  }
  return members.sort();
}
