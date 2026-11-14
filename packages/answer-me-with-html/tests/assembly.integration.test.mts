import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { assembleSkill } from "../scripts/assemble.mjs";
import { javascriptOnly, javaScriptInputs } from "../scripts/javascript-only.mjs";
import { packageRoot, skillFixture } from "./fixture.mjs";

test("assembler rejects source TS and output paths outside an empty temporary directory", async () => {
  await assert.rejects(
    build({
      absWorkingDir: packageRoot,
      entryPoints: ["src/shared/runtime/rtl-letter.mts"],
      bundle: true,
      write: false,
      logLevel: "silent",
      plugins: [javascriptOnly(javaScriptInputs(packageRoot))],
    }),
    /Native TypeScript compilation required/,
  );
  await assert.rejects(assembleSkill(packageRoot), /temporary directory/);
  await assert.rejects(assembleSkill("relative"), /absolute/);
  const stage = await skillFixture();
  const before = await readdir(stage);
  await assert.rejects(assembleSkill(stage), /empty staging directory/);
  assert.deepEqual(await readdir(stage), before);
});

test("standalone scripts and complete terms are present without installable runtime dependencies", async () => {
  const stage = await skillFixture();
  assert.ok(!existsSync(join(stage, "node_modules")));
  for (const entry of ["am", "publish", "publish-html"]) {
    const source = await readFile(join(stage, "scripts", `${entry}.mjs`), "utf8");
    assert.doesNotMatch(source, /from ["'](?:marked|temml|@dagrejs\/dagre)["']/);
  }
  const notice = await readFile(join(stage, "NOTICE"), "utf8");
  for (const term of [
    "edccab07c012e2141585f8ddb18a62e01664fa2b",
    "Apache License",
    "SIL OPEN FONT LICENSE",
    "Permission is hereby granted",
    "Ron Kok",
    "Chris Pettitt",
    "Christopher Jeffrey",
  ])
    assert.ok(notice.includes(term), term);
  assert.match(
    await readFile(join(stage, "agents/openai.yaml"), "utf8"),
    /allow_implicit_invocation:\s*false/,
  );
});

const localNode20 = join(homedir(), ".nvm/versions/node/v20.19.0/bin/node");
const node20 = process.env.AM_TEST_NODE20 ?? (existsSync(localNode20) ? localNode20 : undefined);
test(
  "Node 20 runs isolated renderer and publisher entrypoints with no npm installation",
  { skip: node20 ? false : "Set AM_TEST_NODE20 to a Node 20 executable." },
  async () => {
    assert.ok(node20);
    const skill = await skillFixture();
    const home = await mkdtemp(join(tmpdir(), "am-node20-"));
    try {
      const env = {
        ...process.env,
        HOME: home,
        AM_HOME: join(home, "data"),
        AM_NO_UPDATE_CHECK: "1",
        CI: "1",
      };
      const run = (script: string, args: string[], input?: string) =>
        spawnSync(node20, [join(skill, "scripts", script), ...args], {
          cwd: home,
          env,
          input,
          encoding: "utf8",
        });
      assert.equal(run("am.mjs", ["--version"]).stdout.trim(), "0.5.11");
      const output = join(home, "page.html");
      const rendered = run(
        "am.mjs",
        ["render", "-", "--no-open", "-o", output],
        "---\nlang: en\ntitle: Node 20\n---\n## A\nUse $x^2$.\n",
      );
      assert.equal(rendered.status, 0, rendered.stderr);
      assert.match(await readFile(output, "utf8"), /<math /);
      const publish = run("publish.mjs", ["status"]);
      assert.equal(publish.status, 0, publish.stderr);
      const sanitizer = run("publish-html.mjs", []);
      assert.equal(sanitizer.status, 0, sanitizer.stderr);
      const configure = run("am.mjs", ["config", "set", "open", "off"]);
      assert.equal(configure.status, 0, configure.stderr);
      assert.ok(existsSync(join(home, "data/config.json")));
      const defaults = spawnSync(
        node20,
        [join(skill, "scripts/am.mjs"), "config", "set", "open", "off"],
        { cwd: home, encoding: "utf8", env: { ...env, AM_HOME: "" } },
      );
      assert.equal(defaults.status, 0, defaults.stderr);
      assert.ok(existsSync(join(home, ".agents/.answer-me-with-html/config.json")));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
