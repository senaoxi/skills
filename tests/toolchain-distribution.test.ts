import assert from "node:assert/strict";
import { rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  skillFrontmatter,
  validateDistributions,
  validateSkillDirectory,
} from "../scripts/toolchain-distribution.ts";
import { discoverSkills } from "../scripts/toolchain-projects.ts";
import { prepareSkill } from "../scripts/build-skills.ts";
import { docsPackage, put, skillText, temporary } from "./toolchain-fixtures.ts";

test("frontmatter validates real YAML while retaining extension values", () => {
  const metadata = skillFrontmatter(skillText("example"), "example");
  assert.deepEqual(metadata.metadata, { extension: "preserved" });
  assert.equal(metadata.license, "MIT");
  assert.equal(
    skillFrontmatter("---\nname: example\ndescription: >-\n  A multiline\n  description.\n---\n")
      .description,
    "A multiline description.",
  );
});

test("frontmatter rejects invalid slugs, length bounds, duplicates and wrong declarations", () => {
  for (const name of ["Upper", "-bad", "bad--slug", "bad_thing", "a".repeat(65)]) {
    assert.throws(() => skillFrontmatter(skillText(name)), /lowercase slug/);
  }
  assert.doesNotThrow(() => skillFrontmatter(skillText("a".repeat(64))));
  assert.throws(() => skillFrontmatter(skillText("example"), "different"), /does not match/);
  assert.throws(
    () => skillFrontmatter("---\nname: example\ndescription: a\nname: duplicate\n---\n"),
    /Invalid skill frontmatter/,
  );
  assert.throws(() => skillFrontmatter("---\nname: example\ndescription: 42\n---\n"), /string/);
  assert.throws(
    () => skillFrontmatter(`---\nname: example\ndescription: ${"x".repeat(1025)}\n---\n`),
    /1024/,
  );
});

test("distribution links accept local documents, encoded names, anchors and external schemes", async (t) => {
  const root = await temporary(t);
  await put(
    root,
    "SKILL.md",
    skillText(
      "example",
      "[Guide](references/a%20b.md#part)\n[remote](https://example.invalid)\n[ref][guide]\n[guide]: <references/a b.md>\n![image](assets/icon.svg)\n<a href='references/a%20b.md'>Guide</a>\n```md\n[ignored](missing.md)\n```\n`[also ignored](missing.md)`\n",
    ),
  );
  await put(root, "references/a b.md", "# Part\n[back](../SKILL.md)\n");
  await put(root, "assets/icon.svg", "<svg/>");
  assert.deepEqual(await validateSkillDirectory(root, "example"), { name: "example", files: 3 });
});

test("distribution rejects broken references and encoded traversal through different observations", async (t) => {
  const root = await temporary(t);
  for (const target of [
    "missing.md",
    "../outside.md",
    "%2e%2e/outside.md",
    "/etc/passwd",
    "file:///etc/passwd",
  ]) {
    await put(root, "SKILL.md", skillText("example", `[bad](${target})\n`));
    await assert.rejects(validateSkillDirectory(root), /Missing local reference|escapes|File URL/);
  }
  await put(root, "SKILL.md", skillText("example", "[guide]: missing.md\n"));
  await assert.rejects(validateSkillDirectory(root), /Missing local reference/);
});

test("distribution refuses source files, tests, maps, config and symbolic links", async (t) => {
  for (const forbidden of [
    "scripts/extra.ts",
    "scripts/types.d.ts",
    "scripts/foo.mjs.map",
    "tests/foo.mjs",
    "scripts/foo.test.mjs",
    "tsconfig.json",
    "vite.config.mjs",
    ".npmrc",
    ".env.local",
    ".github/workflows/ci.yml",
  ]) {
    const root = await temporary(t);
    await put(root, "SKILL.md", skillText("example"));
    await put(root, forbidden, "forbidden\n");
    await assert.rejects(validateSkillDirectory(root), /Forbidden distribution file/);
  }
  const root = await temporary(t);
  await put(root, "SKILL.md", skillText("example"));
  await symlink(resolve(root, "SKILL.md"), resolve(root, "linked.md"));
  await assert.rejects(validateSkillDirectory(root), /Symbolic link/);
});

test("static HTML, HTM and SVG references cover quoted, unquoted and encoded local paths", async (t) => {
  const root = await temporary(t);
  await put(root, "SKILL.md", skillText("example"));
  await put(root, "assets/icon.svg", '<svg><use xlink:href="sprite.svg#icon"/></svg>');
  await put(root, "assets/sprite.svg", "<svg/>");
  await put(root, "assets/a b.png", "image");
  await put(
    root,
    "page.html",
    `<!doctype html><img src=assets/icon.svg><a href="other.HTM?x=1&amp;y=2">Next</a>
<!-- <img src="missing-comment.png"> -->
<script>const example = '<img src="missing-string.png">';</script>`,
  );
  await put(
    root,
    "other.HTM",
    '<img src="assets/a%20b.png"><a href="#anchor">Here</a><a href="https://example.invalid">Remote</a>',
  );
  assert.equal((await validateSkillDirectory(root)).files, 6);
  for (const [file, body] of [
    ["page.html", '<img src="missing.png">'],
    ["other.HTM", '<a href="../outside.md">bad</a>'],
    ["page.html", '<img src="&#46;&#46;&#47;outside.png">'],
    ["page.html", '<img src="%2e%2e/outside.png">'],
    ["assets/icon.svg", '<use xlink:href="../../outside.svg#x"/>'],
    ["page.html", '<img src="file:///outside.png">'],
  ]) {
    const fixture = await temporary(t);
    await put(fixture, "SKILL.md", skillText("example"));
    await put(fixture, file, body);
    await assert.rejects(
      validateSkillDirectory(fixture),
      /Missing local reference|escapes|File URL/,
    );
  }
});

test("runtime JS literal dependencies allow Node builtins, bundled helpers and contained modules", async (t) => {
  const root = await temporary(t);
  await put(root, "SKILL.md", skillText("example"));
  await put(
    root,
    "scripts/main.mjs",
    `import fs from 'node:fs';
import { createRequire as makeRequire } from 'node:module';
export { value } from './part.mjs';
await import(\`./part.mjs?reload=1\`);
const requireLocal = makeRequire(import.meta.url);
requireLocal('./settings');
const __require = (name) => name;
__require('fs/promises');
function require_bundled(name) { return name; }
require_bundled('internal-bundled-label');
// require('not-a-dependency-in-a-comment')
const sample = "import('not-a-dependency-in-a-string')";
const computed = './part.mjs';
await import(computed);`,
  );
  await put(root, "scripts/part.mjs", "export const value = 42;\n");
  await put(root, "scripts/settings.json", "{}\n");
  await put(
    root,
    "scripts/legacy.cjs",
    "const fs = require('fs'); module.require('./settings');\n",
  );
  assert.equal((await validateSkillDirectory(root)).files, 5);
});

test("runtime JS literal dependencies reject missing, escaping, bare and absolute imports", async (t) => {
  for (const source of [
    "import './missing.mjs';",
    "export * from './missing.mjs';",
    "await import('./missing.mjs');",
    "require('./missing');",
    "require('../../outside.cjs');",
    "import '../../outside.mjs';",
    "await import('./%2e%2e/%2e%2e/outside.mjs');",
    "import value from 'unshipped-package';",
    "export * from '@scope/unshipped';",
    "await import('unshipped-package');",
    "require('unshipped-package');",
    "__require('unshipped-package');",
    "import {createRequire} from 'node:module'; const loader = createRequire(import.meta.url); loader('unshipped-package');",
    "import '/outside.mjs';",
    "require('C:/outside.cjs');",
    "await import('file:///outside.mjs');",
    "import './directory';",
  ]) {
    const root = await temporary(t);
    await put(root, "SKILL.md", skillText("example"));
    await put(root, "scripts/main.mjs", source);
    await put(root, "scripts/directory/index.js", "module.exports = 42;\n");
    await assert.rejects(
      validateSkillDirectory(root),
      /Missing runtime import|escapes|bare runtime dependency|Absolute/,
    );
  }
});

async function resourcesPackage(root: string, resources: unknown): Promise<string> {
  const directory = await docsPackage(root);
  await put(directory, "package.json", {
    name: "@senaoxi/skill-example",
    private: true,
    type: "module",
    skillBuild: { name: "example", resources },
  });
  return directory;
}

test("resource discovery validates an optional array of canonical skill-relative paths", async (t) => {
  const root = await temporary(t);
  await docsPackage(root);
  assert.equal((await discoverSkills(root))[0].resources, undefined);
  await resourcesPackage(root, ["assets/runtime.bin", "NOTICE"]);
  assert.deepEqual((await discoverSkills(root))[0].resources, ["assets/runtime.bin", "NOTICE"]);
  for (const resources of [
    "NOTICE",
    [42],
    ["../outside"],
    ["/outside"],
    ["C:/outside"],
    ["assets/../outside"],
    ["assets\\outside"],
    ["./NOTICE"],
    ["NOTICE", "NOTICE"],
    [""],
  ]) {
    await resourcesPackage(root, resources);
    await assert.rejects(discoverSkills(root), /skillBuild.resources/);
  }
});

test("declared resources are required in prepared and formal local outputs while external mirrors stay exempt", async (t) => {
  const root = await temporary(t);
  const directory = await resourcesPackage(root, ["assets/runtime.bin"]);
  const [pkg] = await discoverSkills(root);
  const staging = await temporary(t);
  await assert.rejects(prepareSkill(root, pkg, staging), /Missing declared skill resource/);
  await put(directory, "skills/assets/runtime.bin", "runtime data\n");
  const ready = await prepareSkill(root, pkg, await temporary(t));
  assert.equal(
    (await validateSkillDirectory(ready.directory, "example", pkg.resources)).name,
    "example",
  );
  await put(root, "skills/example/SKILL.md", skillText("example"));
  await put(root, "skills/external/SKILL.md", skillText("external"));
  await put(root, "skills/external/source.ts", "import 'external-package';\n");
  await assert.rejects(validateDistributions(root), /Missing declared skill resource/);
  await put(root, "skills/example/assets/runtime.bin", "runtime data\n");
  assert.deepEqual(await validateDistributions(root), { skills: 1, files: 2 });
  await rm(resolve(root, "skills/example/assets/runtime.bin"));
  await assert.rejects(validateDistributions(root), /Missing declared skill resource/);
});

test("direct resource validation rejects traversal and symlink escapes", async (t) => {
  const root = await temporary(t);
  await put(root, "SKILL.md", skillText("example"));
  await assert.rejects(validateSkillDirectory(root, "example", ["../outside"]), /skill-relative/);
  const outside = await temporary(t);
  await put(outside, "data.bin", "outside\n");
  await symlink(resolve(outside, "data.bin"), resolve(root, "linked.bin"));
  await assert.rejects(validateSkillDirectory(root, "example", ["linked.bin"]), /Symbolic link/);
});
