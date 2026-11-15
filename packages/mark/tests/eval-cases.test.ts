import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, posix } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const casesDirectory =
  process.env.AM_EVAL_CASES_DIR ?? fileURLToPath(new URL("../evals/cases/", import.meta.url));
const categories = new Set([
  "explicit-activation",
  "ordinary-question",
  "local-only",
  "missing-tools",
  "complex-resources",
  "setup-authorization",
]);
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const keys = new Set([
  "schemaVersion",
  "id",
  "category",
  "prompt",
  "followUps",
  "context",
  "fixtures",
  "expected",
  "rubric",
]);

function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as Record<string, unknown>;
}
function nonempty(value: unknown, label: string): string {
  assert.equal(typeof value, "string", label);
  assert.ok(typeof value === "string" && value.trim().length > 0, label);
  return value;
}
function strings(value: unknown, label: string, allowEmpty = false): string[] {
  assert.ok(Array.isArray(value), label);
  assert.ok(allowEmpty || value.length > 0, label);
  return value.map((entry: unknown) => nonempty(entry, label));
}
function array(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), label);
  return value;
}
interface Fixture {
  scope: string;
  path: string;
  content: string;
}
function fixture(value: unknown, label: string): Fixture {
  const data = object(value, label);
  assert.ok(data.scope === "workspace" || data.scope === "home", `${label}: scope`);
  const path = nonempty(data.path, `${label}: path`);
  assert.ok(
    !isAbsolute(path) && !path.includes("\\") && !path.includes("\0"),
    `${label}: portable relative path`,
  );
  assert.equal(posix.normalize(path), path, `${label}: normalized path`);
  assert.ok(
    !path.split("/").some((part) => part === ".." || part === "." || part === ""),
    `${label}: contained path`,
  );
  assert.equal(data.encoding, "utf8", `${label}: encoding`);
  const content = nonempty(data.content, `${label}: content`);
  assert.equal(
    data.sha256,
    createHash("sha256").update(content).digest("hex"),
    `${label}: content digest`,
  );
  if (data.provenance !== undefined) object(data.provenance, `${label}: provenance`);
  return { scope: data.scope, path, content };
}

const filenames = (await readdir(casesDirectory)).filter((file) => file.endsWith(".json")).sort();
const loaded = await Promise.all(
  filenames.map(async (file) => {
    const value: unknown = JSON.parse(await readFile(join(casesDirectory, file), "utf8"));
    return { file, value };
  }),
);

for (const { file, value } of loaded) {
  test(`eval case data is complete and portable: ${file}`, () => {
    const data = object(value, file);
    assert.ok(
      Object.keys(data).every((key) => keys.has(key)),
      `${file}: declared data fields`,
    );
    assert.equal(data.schemaVersion, 1);
    const id = nonempty(data.id, `${file}: id`);
    assert.match(id, slug);
    assert.equal(file, `${id}.json`);
    assert.ok(categories.has(nonempty(data.category, `${file}: category`)));
    nonempty(data.prompt, `${file}: prompt`);

    const context = object(data.context, `${file}: context`);
    if (data.category === "setup-authorization") {
      strings(data.followUps, `${file}: subsequent user turns`);
      nonempty(context.history, `${file}: historical setup context`);
    }
    assert.ok(posix.isAbsolute(nonempty(context.cwd, `${file}: cwd`)));
    const home = nonempty(context.home, `${file}: home`);
    assert.ok(posix.isAbsolute(home));
    const processEnvironment = object(
      context.processEnvironment,
      `${file}: isolated process environment`,
    );
    const dataHome = nonempty(processEnvironment.AM_HOME, `${file}: isolated data directory`);
    assert.ok(
      dataHome.startsWith(`${home}/`) && posix.normalize(dataHome) === dataHome,
      `${file}: AM_HOME stays within the evaluation home`,
    );
    const environment = object(context.environment, `${file}: environment`);
    const node = object(environment.node, `${file}: Node prerequisites`);
    assert.equal(typeof node.available, "boolean");
    const browser = object(environment.browser, `${file}: browser prerequisites`);
    assert.equal(typeof browser.available, "boolean");
    strings(context.instructions, `${file}: setup instructions`);

    const fixtures = array(data.fixtures, `${file}: fixtures`).map((item, index) =>
      fixture(item, `${file}: fixture ${index}`),
    );
    const fixtureNames = fixtures.map((item) => `${item.scope}/${item.path}`);
    assert.equal(
      new Set(fixtureNames).size,
      fixtureNames.length,
      `${file}: no duplicate fixture writes`,
    );

    const expected = object(data.expected, `${file}: expected`);
    assert.equal(typeof expected.activation, "boolean");
    assert.ok(expected.artifact === "none" || expected.artifact === "html");
    assert.ok(expected.delivery === "chat" || expected.delivery === "local");
    assert.equal(expected.publishing, "forbidden", `${file}: no publication authorization`);
    strings(expected.required, `${file}: required behavior`);
    strings(expected.forbidden, `${file}: forbidden behavior`);
    const anchors = array(expected.preservedData, `${file}: preserved resource data`);
    for (const anchor of anchors) {
      const entry = object(anchor, `${file}: resource anchor`);
      const path = nonempty(entry.fixture, `${file}: anchored fixture`);
      const resource = fixtures.find((item) => item.scope === "workspace" && item.path === path);
      assert.ok(resource, `${file}: resource anchor names a supplied workspace file`);
      for (const fragment of strings(entry.fragments, `${file}: resource fragments`)) {
        assert.ok(
          resource.content.includes(fragment),
          `${file}: resource fragment exists in supplied content`,
        );
      }
    }

    const rubric = array(data.rubric, `${file}: rubric`);
    assert.ok(rubric.length > 0, `${file}: grading criteria`);
    const criterionIds = new Set<string>();
    for (const criterion of rubric) {
      const item = object(criterion, `${file}: criterion`);
      const criterionId = nonempty(item.id, `${file}: criterion id`);
      assert.match(criterionId, slug);
      assert.ok(!criterionIds.has(criterionId), `${file}: unique criterion ids`);
      criterionIds.add(criterionId);
      assert.equal(item.severity, "must");
      nonempty(item.criterion, `${file}: grading criterion`);
    }
  });
}

test("eval cases have unique IDs and cover all approved categories", () => {
  assert.ok(loaded.length > 0, "the evaluation dataset is nonempty");
  const ids = loaded.map(({ value, file }) => nonempty(object(value, file).id, `${file}: id`));
  assert.equal(new Set(ids).size, ids.length);
  const covered = new Set(
    loaded.map(({ value, file }) => nonempty(object(value, file).category, `${file}: category`)),
  );
  assert.deepEqual([...covered].sort(), [...categories].sort());
});
