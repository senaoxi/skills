import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { installSkills, resolveSource } from "skills";

const runnerTemp = process.env.RUNNER_TEMP;
if (runnerTemp === undefined) throw new Error("RUNNER_TEMP is required.");
const sourceDirectory = join(runnerTemp, "skills install source 空间");
const extracted = spawnSync("tar", ["-xzf", "mark.tar.gz"], {
  cwd: sourceDirectory,
  encoding: "utf8",
});
assert.equal(extracted.status, 0, extracted.error?.message ?? extracted.stderr);
const source = await resolveSource(join(sourceDirectory, "mark"), { config: { telemetry: false } });
try {
  for (const name of ["consumer with spaces", "用户目录"]) {
    const consumer = join(runnerTemp, name);
    await mkdir(consumer, { recursive: true });
    const installed = await installSkills(source, {
      cwd: consumer,
      scope: "project",
      agents: ["universal"],
      skills: ["mark"],
      mode: "copy",
      duplicates: "error",
      symlinks: "reject",
      config: { telemetry: false },
    });
    assert.equal(installed.failed.length, 0, JSON.stringify(installed));
    assert.equal(installed.skipped.length, 0, JSON.stringify(installed));
    assert.equal(installed.installed.length, 1, JSON.stringify(installed));
    const skill = resolve(installed.installed[0].path);
    assert.equal(skill, resolve(consumer, ".agents/skills/mark"));
    for (const file of ["SKILL.md", "NOTICE", "scripts/am.mjs", "scripts/publish.mjs"]) {
      assert.ok((await stat(join(skill, file))).isFile(), file);
    }
    const output = join(consumer, "answer with spaces.html");
    const rendered = spawnSync(
      process.execPath,
      [join(skill, "scripts/am.mjs"), "render", "-", "--no-open", "-o", output],
      {
        cwd: consumer,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, NODE_PATH: "" },
        input:
          "---\ntitle: Windows path smoke\n---\n## A Installed skill\nRender through a consumer path.\n",
      },
    );
    assert.equal(
      rendered.status,
      0,
      rendered.error?.message ?? `${rendered.stdout}\n${rendered.stderr}`,
    );
    assert.match(await readFile(output, "utf8"), /Windows path smoke/);
    process.stdout.write(`Installed and rendered: ${consumer}\n`);
  }
} finally {
  await source.dispose();
}
