import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { checkPack } from "../scripts/check-pack.mjs";
import { exists } from "../scripts/toolchain-core.mjs";
import { put, temporary } from "./toolchain-fixtures.mjs";
import { resolve } from "node:path";
import test from "node:test";

test("real npm dry-run enforces the allowlist without lifecycle scripts or tarballs", async (t) => {
  const root = await temporary(t);
  await put(root, "package.json", {
    name: "fixture-skills-pack",
    version: "0.0.0",
    private: true,
    files: ["skills", "README.md", "LICENSE"],
    scripts: { prepack: "node -e \"require('node:fs').writeFileSync('hook-ran','bad')\"" },
  });
  await put(root, "README.md", "Fixture readme\n");
  await put(root, "LICENSE", "Fixture terms\n");
  await put(root, "skills/example/SKILL.md", "Fixture skill\n");
  await put(root, "scripts/private.mts", "export {};\n");
  assert.equal((await checkPack(root)).files, 4);
  assert.equal(await exists(resolve(root, "hook-ran")), false);
  assert.equal(
    (await readdir(root)).some((file) => file.endsWith(".tgz")),
    false,
  );
  await put(root, "package.json", {
    name: "fixture-skills-pack",
    version: "0.0.0",
    files: ["skills", "scripts", "README.md", "LICENSE"],
  });
  await assert.rejects(checkPack(root), /Unexpected packed path: scripts\/private.mts/);
});
