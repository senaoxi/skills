import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, parse } from "node:path";
import { spawnSync } from "node:child_process";
import { assembleSkill } from "../scripts/assemble.ts";
import { packageRoot, skillFixture } from "./fixture.ts";

test("assembler requires a new or empty temporary directory", async () => {
  await assert.rejects(assembleSkill(packageRoot, parse(packageRoot).root), /temporary directory/);
  await assert.rejects(assembleSkill(packageRoot, tmpdir()), /temporary directory/);
  await assert.rejects(assembleSkill(packageRoot, "relative"), /absolute/);
  const stage = await skillFixture();
  const before = await readdir(stage);
  await assert.rejects(assembleSkill(packageRoot, stage), /empty staging directory/);
  assert.deepEqual(await readdir(stage), before);
});

test("standalone scripts and complete terms are present without installable runtime dependencies", async () => {
  const stage = await skillFixture();
  assert.ok(!existsSync(join(stage, "node_modules")));
  for (const entry of ["am", "publish", "publish-html", "chatgpt"]) {
    const source = await readFile(join(stage, "scripts", `${entry}.mjs`), "utf8");
    assert.doesNotMatch(source, /from ["'](?:marked|temml|@dagrejs\/dagre)["']/);
  }
  assert.match(await readFile(join(stage, "scripts/am.mjs"), "utf8"), /\/\*! Temml .*MIT License/);
  const license = await readFile(join(stage, "LICENSE"), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Mark contributors/);
  assert.match(license, /The above copyright notice and this permission notice/);
  assert.ok(!existsSync(join(stage, "licenses")));
  const notice = await readFile(join(stage, "NOTICE"), "utf8");
  for (const term of [
    "edccab07c012e2141585f8ddb18a62e01664fa2b",
    "Copyright (c) 2026 Answer me with HTML contributors",
    "Apache License",
    "SIL OPEN FONT LICENSE",
    "Permission is hereby granted",
    "Ron Kok",
    "Chris Pettitt",
    "Christopher Jeffrey",
    "Pionxzh",
  ])
    assert.ok(notice.includes(term), term);
  assert.match(
    await readFile(join(stage, "agents/openai.yaml"), "utf8"),
    /allow_implicit_invocation:\s*false/,
  );
  assert.match(
    await readFile(join(stage, "references/chatgpt-host-context.md"), "utf8"),
    /capture --host-context --json/,
  );
});

const localNode20 = join(homedir(), ".nvm/versions/node/v20.19.0/bin/node");
const node20 = process.env.AM_TEST_NODE20 ?? (existsSync(localNode20) ? localNode20 : undefined);
test(
  "Node 20 runs isolated renderer, publisher, and archive entrypoints with no npm installation",
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
      const run = (script: string, args: string[], input?: string, dataDir = env.AM_HOME) =>
        spawnSync(node20, [join(skill, "scripts", script), ...args], {
          cwd: home,
          env: { ...env, AM_HOME: dataDir },
          input,
          encoding: "utf8",
        });
      const chatgpt = run("chatgpt.mjs", ["status", "--json"]);
      assert.equal(chatgpt.status, 0, chatgpt.stderr);
      assert.deepEqual(JSON.parse(chatgpt.stdout), {
        status: "skipped",
        reason: "credentials_missing",
      });
      const captured = run(
        "chatgpt.mjs",
        ["capture", "--host-context", "--json"],
        JSON.stringify({
          provider: "chatgpt-web",
          conversationUrl: "https://chatgpt.com/c/01234567-89ab-cdef-0123-456789abcdef",
        }),
      );
      assert.equal(captured.status, 0, captured.stderr);
      assert.deepEqual(JSON.parse(captured.stdout), {
        status: "skipped",
        reason: "credentials_missing",
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
      const defaults = run("am.mjs", ["config", "set", "open", "off"], undefined, "");
      assert.equal(defaults.status, 0, defaults.stderr);
      const defaultDir = join(home, ".agents", ".mark");
      assert.ok(existsSync(join(defaultDir, "config.json")));
      await writeFile(join(defaultDir, "delivery.md"), "- Delivery mode: local\n");
      assert.equal(run("publish.mjs", ["status"], undefined, "").stdout, "local\n");
      assert.equal(publish.stdout, "uninitialized\n");

      if (process.platform !== "win32") {
        await writeFile(
          join(defaultDir, "chatgpt_session.json"),
          JSON.stringify({
            schemaVersion: 1,
            accessToken: "synthetic-test-token",
            archivePublicationOptIn: false,
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
          { mode: 0o600 },
        );
        const session = run("chatgpt.mjs", ["status", "--json"], undefined, "");
        assert.equal(session.status, 0, session.stderr);
        assert.deepEqual(JSON.parse(session.stdout), {
          status: "configured",
          hasAccountId: false,
          archivePublicationOptIn: false,
        });
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
