import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  argumentsFor,
  entrypoint,
  json,
  nonempty,
  object,
  physicalPath,
  requireSuccess,
  runCommand,
} from "./toolchain-core.mjs";
import { validateDistributions } from "./toolchain-distribution.mjs";

export function packFiles(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== 1) throw new Error("Expected one npm pack JSON result");
  const result = object(raw[0], "npm pack result");
  if (!Array.isArray(result.files)) throw new Error("npm pack result is missing files");
  const files = result.files.map((entry: unknown) =>
    nonempty(object(entry, "packed file").path, "packed file path"),
  );
  const seen = new Set<string>();
  for (const file of files) {
    if (
      file.includes("\\") ||
      file.split("/").some((part) => !part || part === "." || part === "..") ||
      !(
        file === "package.json" ||
        file === "README.md" ||
        file === "LICENSE" ||
        /^skills\/[^/]+\/.+/.test(file)
      )
    ) {
      throw new Error(`Unexpected packed path: ${file}`);
    }
    if (seen.has(file)) throw new Error(`Duplicate packed path: ${file}`);
    seen.add(file);
  }
  for (const required of ["package.json", "README.md", "LICENSE"]) {
    if (!seen.has(required)) throw new Error(`Required packed file is missing: ${required}`);
  }
  if (!files.some((file) => file.startsWith("skills/")))
    throw new Error("Package contains no skills");
  return files;
}

export async function checkPack(root: string): Promise<{ files: number; command: string }> {
  await validateDistributions(root);
  const args = ["pack", "--dry-run", "--ignore-scripts", "--json"];
  const cache = await mkdtemp(resolve(tmpdir(), "skills-pack-cache-"));
  let result: Awaited<ReturnType<typeof runCommand>>;
  try {
    result = await runCommand({
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      args,
      cwd: root,
      env: { ...process.env, npm_config_cache: cache },
    });
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
  requireSuccess(result, "npm pack dry run");
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm pack returned invalid JSON: ${result.stdout}`);
  }
  const files = packFiles(raw);
  for (const file of files) await physicalPath(root, resolve(root, file));
  return { files: files.length, command: "npm pack --dry-run --ignore-scripts --json" };
}

await entrypoint(import.meta.url, async () => {
  const args = argumentsFor(process.argv.slice(2), []);
  if (args.positional.length) throw new Error("Usage: check-pack");
  process.stdout.write(json(await checkPack(process.cwd())));
});
