import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { packageRoot, skillFixture } from "./fixture.mjs";
const stage = await skillFixture();
process.env.AM_RENDERER_ASSETS = join(stage, ".renderer-assets.json");
const { COMPONENTS } = await import("../src/node/components/index.mjs");
const { parseDoc, ParseError } = await import("../src/node/parse.mjs");
const { readPage, sourceTag } = await import("../src/node/page.mjs");
import { occurrenceKeys } from "../src/shared/runtime/remark-text.mjs";
import { planLayout } from "../src/shared/runtime/layout-plan.mjs";

function normalize(html: string): string {
  return html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/g, "")
    .replace(/<script(?![^>]*type="application\/json")[^>]*>[\s\S]*?<\/script>\n?/g, "")
    .replace(/(<b>DATE<\/b><span>)\d{4}-\d{2}-\d{2}(<\/span>)/g, "$1[render date]$2");
}
function isGolden(value: unknown): value is {
  samples: { name: string; draft: string; sha256: string; command?: "render" | "video" }[];
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "samples" in value &&
    Array.isArray(value.samples) &&
    value.samples.every(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        "name" in item &&
        typeof item.name === "string" &&
        "draft" in item &&
        typeof item.draft === "string" &&
        "sha256" in item &&
        typeof item.sha256 === "string" &&
        (!("command" in item) || item.command === "render" || item.command === "video"),
    )
  );
}

test("standalone renderer preserves customized baseline across every captured grammar and language", async () => {
  const skill = await skillFixture();
  const data: unknown = JSON.parse(
    await readFile(join(packageRoot, "tests/fixtures/renderer-golden.json"), "utf8"),
  );
  assert.ok(isGolden(data));
  for (const sample of data.samples) {
    const out = join(skill, `${sample.name}.html`);
    const result = spawnSync(
      process.execPath,
      [
        join(skill, "scripts/am.mjs"),
        sample.command ?? "render",
        "-",
        ...(sample.command === "video" ? ["--voice", "off"] : []),
        "--no-open",
        "-o",
        out,
      ],
      {
        input: sample.draft,
        encoding: "utf8",
        cwd: skill,
        env: { ...process.env, AM_HOME: join(skill, "home"), AM_NO_UPDATE_CHECK: "1", CI: "1" },
      },
    );
    assert.equal(result.status, 0, `${sample.name}: ${result.stderr}`);
    const html = await readFile(out, "utf8");
    assert.equal(
      createHash("sha256").update(normalize(html)).digest("hex"),
      sample.sha256,
      `${sample.name}: markup, styles, fonts or source changed`,
    );
    assert.doesNotMatch(
      html,
      /<meta name="generator"|class="am-colophon"|class="amv-brand"|data-am="update"/,
    );
    assert.equal(readPage(html).source, sample.draft);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
    assert.ok(scripts.length > 0, sample.name);
    for (const script of scripts) {
      const hash = createHash("sha256").update(script).digest("base64");
      assert.ok(html.includes(`sha256-${hash}`), "CSP pins each actual compiled browser script");
    }
  }
});

test("every component public example still renders and malformed layout counts remain errors", () => {
  assert.ok(COMPONENTS.size >= 14);
  for (const [name, component] of COMPONENTS) {
    const example = component.example.match(/^```(\S+)[ \t]*(.*)\n([\s\S]*?)\n```$/);
    assert.ok(example, name);
    let counter = 0;
    assert.ok(
      component.render(example[3]!, { args: example[2]!, uid: () => `example-${++counter}` })
        .length > 0,
      name,
    );
  }
  for (const cols of ["2.5", "-3.5", ".5"]) {
    assert.throws(() => parseDoc(`---\ncols: ${cols}\n---\n## A\nText.`), ParseError);
  }
});

test("shared helpers and hidden source retain duplicate identity and exact escaped draft", () => {
  assert.deepEqual(occurrenceKeys(["same", "same", "other"]), ["same", "same\t1", "other"]);
  const source = "<script>\"&'</textarea>\n中文 $x$";
  assert.equal(readPage(`<html lang="en">${sourceTag(source)}`).source, source);
  const result = planLayout({
    width: 600,
    gap: 16,
    cols: 2,
    panels: [{ samples: [{ w: 200, h: 100 }] }, { samples: [{ w: 180, h: 130 }] }],
  });
  assert.ok(result.rows.length > 0);
  assert.ok(result.rows.every((row) => Number.isFinite(row.height)));
});

test("theme validation preserves raw diagnostic candidates and catalog extension fields", async () => {
  const { normalizeTheme } = await import("../src/node/themes/check.mjs");
  const { readInstalled } = await import("../src/node/themes/catalog.mjs");
  const result = normalizeTheme("custom", {
    label: ["First", "Second"],
    tokens: { common: { "--paper": 12 } },
  });
  assert.ok(result.theme);
  assert.equal(result.theme.tokens.common["--paper"], 12);
  assert.equal(result.theme.label.en, "First");
  assert.ok(result.errors.includes("tokens.common: --paper must be a string without ; { } <"));
  const home = await mkdtemp(join(stage, "catalog-"));
  const entry = { version: "1.2.3", sha256: "digest", extension: { keep: true } };
  await writeFile(
    join(home, "state.json"),
    JSON.stringify({ catalogThemes: { custom: entry, invalid: 12 } }),
  );
  assert.deepEqual(readInstalled(home), { custom: entry });
});

test("saved browser replies preserve mixed fields and defer comment and remark coercion", async () => {
  const { replyState, readProperty, markState } = await import("../src/browser/types.mjs");
  const saved = {
    asks: { good: { picked: ["Redis"], touched: true }, broken: { picked: 12 } },
    comments: { A: "valid", B: 12, C: false, D: { nested: 1 } },
    extension: { keep: true },
  };
  const restored = replyState(saved);
  assert.deepEqual(restored, saved);
  assert.equal(readProperty(restored.comments, "B"), 12);
  assert.equal(String(readProperty(restored.comments, "D")), "[object Object]");
  assert.equal(readProperty("0123", "1"), "1");
  assert.deepEqual(
    markState([
      { key: "a", kind: "keep", note: 12 },
      { key: "b", kind: "bad", note: "drop" },
    ]),
    [{ key: "a", kind: "keep", note: 12 }],
  );
});

test("saved video timings preserve coercion and optional payload values", async () => {
  const { parseTimeline, addTime, timeBefore, timeAtLeast } =
    await import("../src/shared/video/timeline.mjs");
  const raw = {
    duration: "8",
    fps: null,
    extension: { keep: true },
    segments: [
      {
        start: "",
        end: "8",
        id: 7,
        title: false,
        beats: [{ start: null, end: "7", html: 12, focus: false }],
      },
    ],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(parseTimeline(JSON.stringify(raw)))), raw);
  assert.equal(addTime("2", 0.5), "20.5");
  assert.equal(addTime(null, 0.5), 0.5);
  assert.equal(timeBefore("2", "10"), false);
  assert.equal(timeAtLeast("2", "10"), true);
});
