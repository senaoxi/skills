import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { assembleSkill } from "../scripts/assemble.ts";

async function fixture(t: TestContext) {
  const workspace = await mkdtemp(join(tmpdir(), "mark-assembly-inputs-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const root = join(workspace, "package");
  const put = async (name: string, source: string) => {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  };
  const declared = ["temml", "@fontsource/bangers", "locked"];
  const installed = [...declared, "transitive", "undeclared"];
  const snapshots = Object.fromEntries(
    installed.map((name) => [
      `${name}@1.0.0`,
      name === "locked" ? { dependencies: { transitive: "1.0.0" } } : {},
    ]),
  );
  await Promise.all([
    put(
      "package.json",
      JSON.stringify({
        type: "module",
        dependencies: Object.fromEntries(declared.map((name) => [name, "1.0.0"])),
      }),
    ),
    put(
      "pnpm-lock.yaml",
      JSON.stringify({
        lockfileVersion: "9.0",
        importers: {
          ".": {
            dependencies: Object.fromEntries(
              declared.map((name) => [name, { specifier: "1.0.0", version: "1.0.0" }]),
            ),
          },
        },
        packages: Object.fromEntries(
          installed.map((name) => [
            `${name}@1.0.0`,
            { resolution: { integrity: "sha512-fixture" } },
          ]),
        ),
        snapshots,
      }),
    ),
    ...installed.map((name) =>
      put(
        `node_modules/${name}/package.json`,
        JSON.stringify({
          name,
          version: "1.0.0",
          type: "module",
          main: "index.mjs",
        }),
      ),
    ),
    put("node_modules/locked/index.mjs", 'export { suffix } from "transitive";'),
    put("node_modules/transitive/index.mjs", 'export const suffix = " + locked transitive";'),
    put("node_modules/undeclared/index.mjs", 'console.log("unexpected dependency");'),
    put("node_modules/temml/dist/Temml.woff2", "placeholder"),
    put("node_modules/temml/dist/Temml-Local.css", "/* fixture Temml styles */"),
    put("node_modules/@fontsource/bangers/files/bangers-latin-400-normal.woff2", "placeholder"),
    put("skills/SKILL.md", "---\nname: fixture\ndescription: Fixture.\n---\n"),
    put("LICENSE", "fixture license"),
    put("NOTICE", "fixture notice"),
    ...["base", "table", "diff", "delta", "rtl", "chart", "math", "close-after-reply", "video"].map(
      (name) => put(`assets/themes/${name}.css`, ":root {}"),
    ),
    ...["main", "table", "delta", "live", "close-after-reply", "video", "video-export"].map(
      (name) => put(`src/browser/runtime/${name}.ts`, "export {};"),
    ),
    put("src/browser/video-mux.ts", "export {};"),
    ...["publish", "publish-html", "chatgpt"].map((name) =>
      put(`src/node/${name}.ts`, "export {};"),
    ),
    put("src/node/message.ts", 'export const message: string = "current source";'),
  ]);
  return {
    root,
    stage: join(workspace, "stage"),
    put,
    entry: (source: string) => put("src/node/am.ts", source),
  };
}

const source = `
  import { message } from "./message.js";
  import { suffix } from "locked";
  console.log(message + suffix);
`;

test("the standalone script uses authored TypeScript and bundles locked transitive dependencies", async (t) => {
  const f = await fixture(t);
  await f.entry(source);
  await f.put(".build/src/node/message.js", 'export const message = "stale output";');
  await f.put(".build/src/node/am.js", 'console.log("stale entry");');
  await assembleSkill(f.root, f.stage);
  assert.equal(
    execFileSync(process.execPath, [join(f.stage, "scripts/am.mjs")], {
      cwd: f.stage,
      encoding: "utf8",
    }).trim(),
    "current source + locked transitive",
  );
});

test("the assembler rejects authored JavaScript shadowing a TypeScript module", async (t) => {
  const f = await fixture(t);
  await f.entry(source);
  await f.put("src/node/message.js", 'export const message = "authored JavaScript";');
  await assert.rejects(
    assembleSkill(f.root, f.stage),
    /must be authored \.ts files: .*[/\\]message\.js/,
  );
  assert.deepEqual(await readdir(f.stage), []);
});

test("the assembler rejects generated or undeclared inputs and external runtime imports", async (t) => {
  const f = await fixture(t);
  await f.put(".build/src/node/orphan.js", 'console.log("unexpected build output");');
  await f.put("foreign.ts", 'console.log("unexpected TypeScript input");');
  for (const [code, failure] of [
    ['import "../../.build/src/node/orphan.js";', /outside Mark sources and locked dependencies/],
    ['import "../../foreign.ts";', /outside Mark sources and locked dependencies/],
    ['import "undeclared";', /outside Mark sources and locked dependencies/],
    ['await import("https://example.invalid/external.mjs");', /Unbundled runtime dependency/],
  ] as const) {
    await f.entry(code);
    await assert.rejects(assembleSkill(f.root, f.stage), failure);
  }
  assert.deepEqual(await readdir(f.stage), []);
});
