import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import type { TestContext } from "node:test";
import { exists, json } from "../scripts/toolchain-core.ts";

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
    ...(prepare
      ? {
          scripts: {
            "artifact:prepare": "node scripts/assemble.ts",
          },
        }
      : {}),
  });
  await put(directory, "skills/SKILL.md", skillText(name));
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
