import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import type { TestContext } from "node:test";
import ts from "typescript";
import { recordBuild } from "../scripts/toolchain-compile.mjs";
import { exists, json } from "../scripts/toolchain-core.mjs";

export async function temporary(t: TestContext): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "skills-toolchain-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

export async function put(root: string, path: string, value: string | object): Promise<void> {
  const absolute = resolve(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, typeof value === "string" ? value : json(value));
}

export const skillText = (name: string, body = "A fixture skill.\n"): string =>
  `---\nname: ${name}\ndescription: A useful fixture.\nlicense: MIT\nmetadata:\n  extension: preserved\n---\n\n${body}`;

export async function docsPackage(
  root: string,
  name = "example",
  prepare = false,
): Promise<string> {
  const directory = resolve(root, "packages", name);
  if (!(await exists(resolve(root, "pnpm-workspace.yaml"))))
    await put(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n");
  await put(directory, "package.json", {
    name: `@senaoxi/skill-${name}`,
    private: true,
    type: "module",
    skillBuild: { name },
    ...(prepare ? { scripts: { "artifact:prepare": "node .build/scripts/assemble.mjs" } } : {}),
  });
  await put(directory, "skill/SKILL.md", skillText(name));
  return directory;
}

export async function solution(root: string, references: string[]): Promise<void> {
  await put(root, "tsconfig.json", { files: [], references: references.map((path) => ({ path })) });
}

export async function project(
  root: string,
  directory: string,
  files: string[],
  output?: string,
): Promise<void> {
  await put(root, `${directory}/tsconfig.json`, {
    compilerOptions: {
      strict: true,
      noEmit: true,
      allowJs: false,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
      types: [],
    },
    files,
    liminaOptions: {
      outputs: { rootDir: ".", outDir: output ?? `../.build/${directory.replaceAll("/", "-")}` },
    },
  });
}

export async function emitFixture(root: string, source: string, output: string): Promise<void> {
  const text = await readFile(resolve(root, source), "utf8");
  const compiled = ts.transpileModule(text, {
    fileName: source,
    compilerOptions: {
      module: ts.ModuleKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.length) throw new Error(JSON.stringify(compiled.diagnostics));
  await put(root, output, compiled.outputText);
}

/** Receipt-mechanics fixture only; compiler-evidence.test exercises the real native gate. */
export async function recordFixtureBuild(root: string) {
  return recordBuild(root, async () => {});
}
