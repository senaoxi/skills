import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { skillFixture } from "./fixture.mjs";
import { cleanPublishedHtml } from "../src/node/publish-html.mjs";

const renderer =
  process.env.AM_TEST_RENDERER_SCRIPT ?? path.join(await skillFixture(), "scripts/am.mjs");
const hash = (body: string) => createHash("sha256").update(body).digest("base64");
const scripts = (html: string) =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

async function render(t: TestContext, command: string, draft: string, ...args: string[]) {
  const cwd = await mkdtemp(path.join(tmpdir(), "am-publish-html-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, "source.ts"), 'export const value = "VISIBLE-CODE";\n');
  const result = spawnSync(
    process.execPath,
    [renderer, command, "-", "-o", "out.html", "--no-open", ...args],
    {
      cwd,
      input: draft,
      encoding: "utf8",
      env: { ...process.env, AM_HOME: path.join(cwd, "home") },
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return readFile(path.join(cwd, "out.html"), "utf8");
}

test("published renderer markup retains component and reply controls while removing unsupported data attributes", async (t) => {
  const original = await render(
    t,
    "render",
    [
      "---",
      "title: Public fixture",
      "template: doc",
      "lang: en",
      "---",
      "## Example",
      "",
      "```ts src=source.ts lines=1-1",
      "```",
      "",
      "```flow",
      "Start -> End",
      "+ End -> Next",
      "```",
      "",
      "```ask multi",
      "What should run?",
      "* Build",
      "- Test",
      "```",
      "",
      "| Item | Value |",
      "| --- | --- |",
      "| Build | 1 |",
      "",
      "{table sort filter}",
      "",
      "```html",
      '<!-- PRIVATE-COMMENT --><div DATA-secret="HIDDEN>ATTRIBUTE" data-am-other=HIDDEN-AM data-flag class="fixture">Public text</div>',
      "```",
      "",
    ].join("\n"),
  );
  const cleaned = cleanPublishedHtml(original);
  for (const marker of [
    "PRIVATE-COMMENT",
    "DATA-secret",
    "HIDDEN>ATTRIBUTE",
    "data-am-other",
    "HIDDEN-AM",
    "data-flag",
    'id="am-source"',
    "data-am-src=",
    "data-am-lines=",
    "source.ts",
  ]) {
    assert.ok(original.includes(marker), `fixture contains ${marker}`);
    assert.ok(!cleaned.includes(marker), `online copy removes ${marker}`);
  }
  assert.match(cleaned, /<div class="fixture">Public text<\/div>/);
  assert.match(cleaned, /data-am="copy-code"[^>]*>/);
  assert.match(cleaned, /<code data-lang="ts">/);
  assert.ok(cleaned.includes("VISIBLE-CODE"));
  assert.match(cleaned, /<g[^>]*data-key="Next"[^>]*data-delta="added"/);
  assert.match(cleaned, /<fieldset class="am-ask" data-ask="am\d+" data-multi>/);
  assert.match(cleaned, /<input[^>]*value="Build" data-suggested>/);
  assert.match(cleaned, /<button[^>]*data-am="reply" data-ui="[^"]+">/);
  assert.match(cleaned, /<table data-am-table="sort filter">/);
  assert.match(cleaned, /<input type="search" data-am-table-filter/);
  assert.equal(cleanPublishedHtml(cleaned), cleaned);
});

test("published pages retain exact script bodies authorized by the renderer's CSP", async (t) => {
  const rawScript = 'globalThis.fixture = "RAW-SCRIPT";';
  const original = await render(
    t,
    "render",
    [
      "---",
      "title: Script fixture",
      "template: doc",
      "lang: en",
      "---",
      "## Raw",
      "",
      "```html",
      `<meta http-equiv="Content-Security-Policy" content="script-src 'sha256-${hash(rawScript)}'">`,
      `<script>${rawScript}</script>`,
      '<script src="https://example.invalid/raw.js"></script>',
      '<script type="application/json" id="raw-data">{"private":"RAW-DATA"}</script>',
      "```",
      "",
    ].join("\n"),
  );
  const cleaned = cleanPublishedHtml(original);
  for (const marker of ["RAW-SCRIPT", "https://example.invalid/raw.js", "RAW-DATA"]) {
    assert.ok(original.includes(marker), `fixture contains ${marker}`);
    assert.ok(!cleaned.includes(marker), `online copy removes ${marker}`);
  }
  const runtime = scripts(original).at(-1);
  assert.ok(runtime !== undefined && runtime.length > 0);
  assert.deepEqual(scripts(cleaned), [runtime]);
  assert.ok(cleaned.includes(`'sha256-${hash(runtime)}'`));
});

test("HTML without the renderer's policy drops executable scripts", () => {
  const original =
    '<!doctype html><html><head><title>Page</title></head><body><script>const value = "UNSIGNED";</script><p>Public text</p></body></html>';
  assert.equal(
    cleanPublishedHtml(original),
    "<!doctype html><html><head><title>Page</title></head><body><p>Public text</p></body></html>",
  );
});

test("published video retains the generated JSON payload and its signed player scripts", async (t) => {
  const original = await render(
    t,
    "video",
    [
      "---",
      "title: Video fixture",
      "lang: en",
      "---",
      "## Scene",
      "",
      "```flow",
      "First -> Next",
      "```",
      "> This is the first scene.",
      "",
      "```html",
      '<script type="application/json" id="amv-data">{"private":"RAW-VIDEO-DATA"}</script>',
      "```",
      "",
    ].join("\n"),
    "--voice",
    "off",
  );
  const cleaned = cleanPublishedHtml(original);
  const data = /<script type="application\/json" id="amv-data">([\s\S]*?)<\/script>/g;
  assert.ok(original.includes("RAW-VIDEO-DATA"));
  assert.ok(!cleaned.includes("RAW-VIDEO-DATA"));
  const lastData = [...original.matchAll(data)].at(-1);
  assert.ok(lastData);
  const originalData = lastData[1];
  assert.deepEqual(
    [...cleaned.matchAll(data)].map((m) => m[1]),
    [originalData],
  );
  assert.ok(JSON.parse(originalData).segments.length > 1);
  assert.equal(scripts(original).length, 3);
  assert.deepEqual(scripts(cleaned), scripts(original));
  for (const body of scripts(cleaned)) assert.ok(cleaned.includes(`'sha256-${hash(body)}'`));
  assert.equal(cleanPublishedHtml(cleaned), cleaned);
});
