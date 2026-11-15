import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const runnerTemp = process.env.RUNNER_TEMP;
if (runnerTemp === undefined) throw new Error("RUNNER_TEMP is required.");
const output = join(runnerTemp, "skills-sync-report");
mkdirSync(output, { recursive: true });
const paths = ["skills", "skills-sources.json", "skills-lock.json", "LICENSE"];

function git(args: string[], allowed = [0]) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status === null || !allowed.includes(result.status)) {
    throw new Error(result.error?.message ?? (result.stderr || `git exited ${result.status}`));
  }
  return result.stdout;
}
function entries(args: string[]) {
  return git(args).split("\0").filter(Boolean);
}

const untracked = entries(["ls-files", "--others", "--exclude-standard", "-z", "--", ...paths]);
const ignored = entries([
  "ls-files",
  "--others",
  "--ignored",
  "--exclude-standard",
  "-z",
  "--",
  ...paths,
]);
let patch = git(["diff", "--binary", "--full-index", "HEAD", "--", ...paths]);
for (const path of untracked) {
  patch += git(["diff", "--no-index", "--binary", "--full-index", "--", "/dev/null", path], [0, 1]);
}
writeFileSync(join(output, "skills-sync.patch"), patch);
writeFileSync(
  join(output, "status.txt"),
  git(["status", "--short", "--untracked-files=all", "--ignored=matching", "--", ...paths]),
);
const report = {
  repository: process.env.GITHUB_REPOSITORY,
  revision: process.env.GITHUB_SHA,
  sync: process.env.SYNC_OUTCOME,
  distribution: process.env.DISTRIBUTION_OUTCOME,
  trackedChanges: entries(["diff", "--name-only", "-z", "HEAD", "--", ...paths]),
  untracked,
  ignored,
  patch: "skills-sync.patch",
  review:
    "Review the patch, source provenance, and complete license notices before applying. Ignored paths require inspection and are excluded from the patch.",
};
writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
const log = join(runnerTemp, "skills-sync.log");
if (existsSync(log)) copyFileSync(log, join(output, "sync.log"));
const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary === undefined) throw new Error("GITHUB_STEP_SUMMARY is required.");
appendFileSync(
  stepSummary,
  `External skill sync: ${report.sync}. Distribution: ${report.distribution}.\n\n` +
    `Tracked changes: ${report.trackedChanges.length}. New paths: ${untracked.length}. Ignored paths: ${ignored.length}.\n\n` +
    "Download skills-sync-report to review the patch and provenance. No repository changes are committed or pushed.\n",
);
if (ignored.length) {
  console.error(
    "Ignored files exist inside the managed artifacts. Inspect the report before integration.",
  );
  process.exitCode = 1;
}
