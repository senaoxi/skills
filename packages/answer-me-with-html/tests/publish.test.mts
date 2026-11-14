import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  readdir,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cli =
  process.env.AM_TEST_PUBLISH_SCRIPT ??
  fileURLToPath(new URL("../src/node/publish.mjs", import.meta.url));
const page = (title: string, text: string) =>
  "<!doctype html><html><head><title>" + title + "</title></head><body>" + text + "</body></html>";

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "am-vercel-"));
  const home = path.join(base, "home");
  const sources = path.join(base, "sources");
  await mkdir(sources);
  const preferredProbe = path.join(base, "preferred.mjs");
  await writeFile(
    preferredProbe,
    `
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
globalThis.fetch = async (url, options) => {
  appendFileSync(path.join(process.env.AM_HOME, "preferred-calls"), JSON.stringify({ url, redirect: options.redirect, headers: options.headers }) + "\\n");
  try {
    return new Response(readFileSync(path.join(process.env.AM_HOME, "alias-page")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return new Response(null, { status: 403 });
  }
};
`,
  );
  return {
    base,
    home,
    sources,
    run(...args: string[]) {
      return spawnSync(process.execPath, ["--import", preferredProbe, cli, ...args], {
        encoding: "utf8",
        env: { ...process.env, AM_HOME: home, PATH: base },
      });
    },
    reviewed(command: string, file: string, ...args: string[]) {
      const reviewed = this.run(
        "review",
        file,
        ...args.filter((argument) => argument !== "--json"),
        "--json",
      );
      assert.equal(reviewed.status, 0, reviewed.stderr);
      return this.run(
        command,
        file,
        ...args,
        "--reviewed-sha256",
        JSON.parse(reviewed.stdout).sha256,
      );
    },
    async stubVercel(body: string) {
      const executable = path.join(base, "vercel");
      await writeFile(executable, "#!/bin/sh\n" + body);
      await chmod(executable, 0o755);
    },
    async write(name: string, html: string) {
      const filename = path.join(sources, name);
      await writeFile(filename, html);
      return filename;
    },
    async dispose() {
      await rm(base, { force: true, recursive: true });
    },
  };
}

async function publicationFixture(
  f: Awaited<ReturnType<typeof fixture>>,
  {
    production = "",
    tamper = "",
    race = false,
    unknown = false,
    archiveFault = false,
    publicOrigin,
    aliasDomain,
    promotion = "ok",
    aliasPageUnavailable = false,
  }: {
    production?: string;
    tamper?: string;
    race?: boolean;
    unknown?: boolean;
    archiveFault?: boolean;
    publicOrigin?: string;
    aliasDomain?: string;
    promotion?: string;
    aliasPageUnavailable?: boolean;
  } = {},
) {
  await mkdir(f.home, { recursive: true });
  await writeFile(path.join(f.home, "production"), production);
  await f.stubVercel(
    [
      'printf "%s\\n" "$*" >> "$AM_HOME/calls"',
      'case "$1" in',
      '  project) printf \'{"id":"prj_mock","name":"demo","owner":{"slug":"team"}}\\n\' ;;',
      '  api) case "$2" in',
      ...(aliasDomain
        ? [
            `    /v2/deployments/dpl_live/aliases) printf '{"aliases":[{"alias":"${aliasDomain}"}]}\\n' ;;`,
            `    /v4/aliases/${aliasDomain}) printf '{"alias":"${aliasDomain}","projectId":"prj_mock","deployment":{"url":"%s"}}\\n' "$(/bin/cat "$AM_HOME/production")" ;;`,
          ]
        : []),
      `    /v13/deployments/candidate.vercel.app) printf '{"projectId":"prj_mock","url":"candidate.vercel.app","readyState":"READY"}\\n' ;;`,
      `    /v13/deployments/other.vercel.app) printf '{"projectId":"prj_wrong","url":"other.vercel.app","readyState":"READY"}\\n' ;;`,
      '    /v9/projects/prj_mock) production=$(/bin/cat "$AM_HOME/production")',
      '    if test -n "$production"; then',
      '      printf \'{"id":"prj_mock","targets":{"production":{"id":"dpl_live","url":"%s","aliasAssigned":true}}}\\n\' "$production"',
      '    else printf \'{"id":"prj_mock","targets":{}}\\n\'; fi ;;',
      "    *) exit 16 ;; esac ;;",
      '  deploy) case " $* " in *" --prod --skip-domain "*) ;; *) exit 24 ;; esac',
      '    /bin/rm -rf "$AM_HOME/candidate"',
      '    /bin/cp -R "$2" "$AM_HOME/candidate" || exit 17',
      ...(archiveFault
        ? ['    /bin/mkdir "$AM_HOME/vercel-shared-published.json" || exit 20']
        : []),
      ...(unknown ? ['    printf "simulated response loss\\n" >&2; exit 23'] : []),
      '    printf \'{"status":"ok","deployment":{"url":"https://candidate.vercel.app","readyState":"READY","target":"production"}}\\n\' ;;',
      '  curl) case "$2" in',
      "    https://candidate.vercel.app/*) file=${2#https://candidate.vercel.app/}",
      '      if test -z "$file"; then file=index.html; fi',
      ...(race ? ['      printf changed.vercel.app > "$AM_HOME/production"'] : []),
      ...(tamper ? [`      if test "$file" = ${tamper}; then printf corrupted; exit; fi`] : []),
      '      /bin/cat "$AM_HOME/candidate/$file" ;;',
      "    https://previous.vercel.app/*) file=${2#https://previous.vercel.app/}",
      '      /bin/cat "$AM_HOME/previous/${file:-index.html}" ;;',
      ...(aliasDomain
        ? [
            `    https://${aliasDomain}/pages/*) test "$(/bin/cat "$AM_HOME/production")" = candidate.vercel.app || exit 25`,
            aliasPageUnavailable
              ? "      exit 25 ;;"
              : '      /bin/cat "$AM_HOME/candidate/pages/${2##*/}" ;;',
          ]
        : []),
      "    *) exit 22 ;; esac ;;",
      "  promote)",
      ...(promotion === "pending"
        ? []
        : ['    printf candidate.vercel.app > "$AM_HOME/production"']),
      promotion === "ok" ? "    ;;" : "    exit 26 ;;",
      "  *) exit 19 ;;",
      "esac",
    ].join("\n"),
  );
  const setup = f.run(
    "setup",
    "--team",
    "team",
    "--project",
    "demo",
    "--project-id",
    "prj_mock",
    ...(publicOrigin ? ["--public-origin", publicOrigin] : []),
    ...(aliasDomain ? ["--alias-domain", aliasDomain] : []),
  );
  assert.equal(setup.status, 0, setup.stderr);
  return {
    calls: () => readFile(path.join(f.home, "calls"), "utf8"),
    serving: () => readFile(path.join(f.home, "production"), "utf8"),
  };
}

test("existing production without a matching archive stays untouched", async () => {
  const f = await fixture();
  try {
    const remote = await publicationFixture(f, { production: "previous.vercel.app" });
    const file = await f.write("new.html", page("New", "draft"));
    const result = f.reviewed("deliver", file, "--slug", "new");
    assert.equal(await remote.serving(), "previous.vercel.app");
    assert.doesNotMatch(await remote.calls(), /^(?:deploy|promote) /m);
    assert.equal(result.stdout, `Local: ${file}\n`);
    assert.match(result.stderr, /production.*archive|archive.*production/i);
  } finally {
    await f.dispose();
  }
});

test("a damaged archive cannot omit a page in current production", async () => {
  const f = await fixture();
  try {
    const remote = await publicationFixture(f, { production: "previous.vercel.app" });
    const existing = await f.write("existing.html", page("Existing", "retained"));
    assert.equal(f.run("stage", existing, "--slug", "existing").status, 0);
    await cp(path.join(f.home, "vercel-shared-site"), path.join(f.home, "previous"), {
      recursive: true,
    });
    await writeFile(
      path.join(f.home, "vercel-shared-published.json"),
      JSON.stringify({
        schemaVersion: 1,
        projectDigest: createHash("sha256").update("team/prj_mock").digest("hex"),
        origin: "https://previous.vercel.app",
        pages: {},
      }),
    );
    const file = await f.write("new.html", page("New", "draft"));
    const result = f.reviewed("deliver", file, "--slug", "new");
    assert.equal(await remote.serving(), "previous.vercel.app");
    assert.doesNotMatch(await remote.calls(), /^(?:deploy|promote) /m);
    assert.equal(result.stdout, `Local: ${file}\n`);
    assert.match(result.stderr, /archive is missing or has extra pages/);
  } finally {
    await f.dispose();
  }
});

test("verified deployment survives a failed archive write and recovers without another upload", async () => {
  const f = await fixture();
  try {
    const remote = await publicationFixture(f, { archiveFault: true });
    const file = await f.write("new.html", page("New", "draft"));
    const output = f.reviewed("deliver", file, "--slug", "new", "--json");
    assert.equal(output.status, 1, output.stderr);
    const pending = JSON.parse(output.stdout);
    assert.deepEqual(pending.remote, { state: "verified", url: "https://candidate.vercel.app" });
    assert.equal(pending.archive, "pending");
    assert.equal(pending.delivery.kind, "immutable");
    assert.equal(pending.production.state, "not-written");
    assert.equal(await remote.serving(), "");
    const directory = path.join(f.home, "vercel-shared-pending");
    const journal = JSON.parse(await readFile(path.join(directory, "journal.json"), "utf8"));
    assert.equal(journal.phase, "verified");
    assert.equal(journal.origin, pending.remote.url);
    const receipt = path.join(f.home, "vercel-shared-published.json");
    await rm(receipt, { recursive: true });
    await rm(file);
    const recovered = f.run("recover", "--json");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).archive, "saved");
    const saved = JSON.parse(await readFile(receipt, "utf8"));
    assert.equal(saved.schemaVersion, 2);
    assert.equal(saved.origin, pending.remote.url);
    await assert.rejects(stat(directory), { code: "ENOENT" });
    const calls = await remote.calls();
    assert.equal(calls.match(/^deploy /gm)?.length, 1);
    assert.doesNotMatch(calls, /^promote /m);
    assert.match(calls, /^api \/v13\/deployments\/candidate.vercel.app /m);
  } finally {
    await f.dispose();
  }
});

test("an unknown upload blocks another upload and recovery requires the matching project and snapshot", async () => {
  const f = await fixture();
  try {
    const remote = await publicationFixture(f, { unknown: true });
    const file = await f.write("new.html", page("New", "draft"));
    const publication = f.reviewed("deliver", file, "--slug", "new", "--json");
    assert.equal(publication.status, 1);
    assert.deepEqual(JSON.parse(publication.stdout).remote, { state: "unknown" });
    assert.match(JSON.parse(publication.stdout).error, /response loss/);
    const retry = f.reviewed("deliver", file, "--slug", "new", "--json");
    assert.equal(retry.status, 1);
    assert.match(JSON.parse(retry.stdout).error, /pending publication/);
    const recovery = f.run("recover", "--json");
    assert.equal(recovery.status, 1);
    assert.match(JSON.parse(recovery.stdout).error, /upload result is unknown/);
    const wrongProject = f.run("recover", "--deployment", "https://other.vercel.app", "--json");
    assert.equal(wrongProject.status, 1);
    assert.match(
      JSON.parse(wrongProject.stdout).error,
      /not an immutable deployment of the pinned/,
    );
    const snapshot = path.join(f.home, "vercel-shared-pending", "site", "pages", "new.html");
    const bytes = await readFile(snapshot);
    await writeFile(snapshot, "tampered");
    const tampered = f.run("recover", "--deployment", "https://candidate.vercel.app", "--json");
    assert.equal(tampered.status, 1);
    assert.match(JSON.parse(tampered.stdout).error, /Pending snapshot differs/);
    await writeFile(snapshot, bytes);
    const remotePage = path.join(f.home, "candidate", "pages", "new.html");
    await writeFile(remotePage, "tampered remote");
    const invalidRemote = f.run(
      "recover",
      "--deployment",
      "https://candidate.vercel.app",
      "--json",
    );
    assert.equal(invalidRemote.status, 1);
    assert.match(JSON.parse(invalidRemote.stdout).error, /deployment differs/);
    await writeFile(remotePage, bytes);
    const recovered = f.run("recover", "--deployment", "https://candidate.vercel.app", "--json");
    assert.equal(recovered.status, 0, recovered.stdout);
    assert.equal(JSON.parse(recovered.stdout).archive, "saved");
    assert.equal((await remote.calls()).match(/^deploy /gm)?.length, 1);
  } finally {
    await f.dispose();
  }
});

test("publication lock contention still returns a local answer", async () => {
  const f = await fixture();
  try {
    const remote = await publicationFixture(f);
    await writeFile(path.join(f.home, "vercel-shared-publish.lock"), "");
    const file = await f.write("new.html", page("New", "draft"));
    const result = f.reviewed("deliver", file, "--slug", "new");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `Local: ${file}\n`);
    assert.match(result.stderr, /Another publication is in progress/);
    assert.doesNotMatch(await remote.calls(), /^(?:deploy|promote) /m);
  } finally {
    await f.dispose();
  }
});

test("candidate verification failure never changes production", async () => {
  const f = await fixture();
  try {
    const remote = await publicationFixture(f, { tamper: "pages/new.html" });
    const file = await f.write("new.html", page("New", "draft"));
    const result = f.reviewed("deliver", file, "--slug", "new");
    assert.equal(await remote.serving(), "");
    const calls = await remote.calls();
    assert.match(calls, /^deploy .* --skip-domain /m);
    assert.match(calls, /^curl https:\/\/candidate\.vercel\.app\/pages\/new\.html /m);
    assert.doesNotMatch(calls, /^promote /m);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Remote publication: unknown/);
    assert.match(result.stdout, /Archive: pending recovery/);
    assert.match(result.stderr, /differs/i);
  } finally {
    await f.dispose();
  }
});

test("a concurrent production change survives an immutable publication", async () => {
  const f = await fixture();
  try {
    const remote = await publicationFixture(f, { race: true });
    const file = await f.write("new.html", page("New", "draft"));
    const result = f.reviewed("deliver", file, "--slug", "new");
    assert.equal(await remote.serving(), "changed.vercel.app");
    const calls = await remote.calls();
    assert.match(calls, /^curl https:\/\/candidate\.vercel\.app\/pages\/new\.html /m);
    assert.doesNotMatch(calls, /^promote /m);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Published: https:\/\/candidate\.vercel\.app/m);
    const other = await f.write("other.html", page("Other", "follow-up"));
    const next = f.reviewed("deliver", other, "--slug", "other", "--json");
    assert.equal(next.status, 0, next.stderr);
    assert.equal(JSON.parse(next.stdout).pages, 2);
    assert.equal(await remote.serving(), "changed.vercel.app");
    assert.equal((await remote.calls()).match(/^api \/v9\/projects\//gm)?.length, 1);
    assert.equal(
      await readFile(path.join(f.home, "candidate", "pages", "new.html"), "utf8"),
      page("New", "draft"),
    );
  } finally {
    await f.dispose();
  }
});

test("review binds publication to the final sanitized bytes and provenance", async () => {
  const f = await fixture();
  try {
    const remote = await publicationFixture(f);
    const original = page("Review", "<!-- source note --><p>Selected content</p>");
    const file = await f.write("review.html", original);
    const flags = [
      "--slug",
      "reviewed",
      "--context-source",
      "codex",
      "--context-title",
      "First title",
    ];
    const review = f.run("review", file, ...flags, "--json");
    assert.equal(review.status, 0, review.stderr);
    const { path: reviewedPath, sha256 } = JSON.parse(review.stdout);
    const bytes = await readFile(reviewedPath);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
    assert.match(bytes.toString(), /First title/);
    assert.doesNotMatch(bytes.toString(), /source note/);
    const publish = (...options: string[]) =>
      f.run("publish", file, ...options, "--reviewed-sha256", sha256, "--json");
    await writeFile(file, original.replace("Selected content", "New content"));
    const changedSource = publish(...flags);
    assert.equal(changedSource.status, 1);
    assert.equal(JSON.parse(changedSource.stdout).remote.state, "not-attempted");
    await writeFile(file, original);
    const changedContext = publish(...flags.slice(0, -1), "Second title");
    assert.equal(changedContext.status, 1);
    assert.match(JSON.parse(changedContext.stdout).error, /reviewed-sha256/);
    const clearedContext = publish("--slug", "reviewed", "--clear-context");
    assert.equal(clearedContext.status, 1);
    assert.doesNotMatch(await remote.calls(), /^deploy /m);
    const accepted = publish(...flags);
    assert.equal(accepted.status, 0, accepted.stdout);
    assert.deepEqual(
      await readFile(path.join(f.home, "candidate", "pages", "reviewed.html")),
      bytes,
    );
  } finally {
    await f.dispose();
  }
});

test("verify reports stale legacy production separately from the recorded immutable page", async () => {
  const f = await fixture();
  try {
    const remote = await publicationFixture(f, {
      production: "changed.vercel.app",
      publicOrigin: "https://explainers.example.test",
    });
    const html = page("Existing", "retained");
    const existing = await f.write("existing.html", html);
    assert.equal(f.run("stage", existing, "--slug", "existing").status, 0);
    const staged = path.join(f.home, "vercel-shared-site");
    await cp(staged, path.join(f.home, "previous"), { recursive: true });
    const catalog = JSON.parse(await readFile(path.join(staged, "pages.json"), "utf8"));
    await writeFile(
      path.join(f.home, "vercel-shared-published.json"),
      JSON.stringify({
        schemaVersion: 1,
        projectDigest: createHash("sha256").update("team/prj_mock").digest("hex"),
        origin: "https://previous.vercel.app",
        pages: {
          existing: {
            ...catalog.pages.existing,
            digest: createHash("sha256").update(html).digest("hex"),
          },
        },
      }),
    );
    const checked = f.run("verify", "--slug", "existing", "--json");
    assert.equal(checked.status, 0, checked.stdout);
    const result = JSON.parse(checked.stdout);
    assert.deepEqual(result.production, {
      state: "not-written",
      current: "https://changed.vercel.app",
      relation: "different",
    });
    assert.deepEqual(result.remote, { state: "verified", url: "https://previous.vercel.app" });
    assert.deepEqual(result.preferred, {
      state: "protected",
      url: "https://explainers.example.test/pages/existing.html",
      status: 403,
    });
    const observed = JSON.parse(await readFile(path.join(f.home, "preferred-calls"), "utf8"));
    assert.deepEqual(observed, { url: result.preferred.url, redirect: "manual" });
    assert.match(await remote.calls(), /^api \/v9\/projects\/prj_mock /m);
    assert.doesNotMatch(await remote.calls(), /explainers\.example\.test|^deploy /m);
    const fresh = await f.write("fresh.html", page("Fresh", "new draft"));
    const blocked = f.reviewed("publish", fresh, "--slug", "fresh", "--json");
    assert.equal(blocked.status, 1);
    assert.match(JSON.parse(blocked.stdout).error, /production.*legacy archive/);
    assert.doesNotMatch(await remote.calls(), /^deploy /m);
  } finally {
    await f.dispose();
  }
});

test("selected pages accumulate, gallery escapes titles and never includes unrelated pages", async () => {
  const f = await fixture();
  try {
    const first = await f.write("first.html", page("Require & Bindings", "first"));
    const second = await f.write("second.html", page("<script>unsafe</script>", "second"));
    const third = await f.write("not-selected.html", page("Private draft", "private"));
    assert.equal(f.run("stage", first, "--slug", "require-bindings").status, 0);
    assert.equal(f.run("stage", second, "--slug", "module-resolution").status, 0);
    const files = await readdir(path.join(f.home, "vercel-shared-site", "pages"));
    assert.deepEqual(files.sort(), ["module-resolution.html", "require-bindings.html"]);
    const index = await readFile(path.join(f.home, "vercel-shared-site", "index.html"), "utf8");
    assert.match(index, /Require &amp; Bindings/);
    assert.match(index, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.doesNotMatch(index, /Private draft/);
    assert.match(index, /<title>Explainers<\/title>/);
    assert.doesNotMatch(index, /href="https?:\/\//);
    assert.equal(
      await readFile(
        path.join(f.home, "vercel-shared-site", "pages", "require-bindings.html"),
        "utf8",
      ),
      page("Require & Bindings", "first"),
    );
    void third;
  } finally {
    await f.dispose();
  }
});

test("a changed existing slug requires --replace and preserves old bytes on rejection", async () => {
  const f = await fixture();
  try {
    const first = await f.write("first.html", page("First", "before"));
    const second = await f.write("second.html", page("Second", "after"));
    const pagePath = path.join(f.home, "vercel-shared-site", "pages", "stable.html");
    assert.equal(f.run("stage", first, "--slug", "stable").status, 0);
    const denied = f.run("stage", second, "--slug", "stable");
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /--replace/);
    assert.equal(await readFile(pagePath, "utf8"), page("First", "before"));
    assert.equal(f.run("stage", second, "--slug", "stable", "--replace").status, 0);
    assert.equal(await readFile(pagePath, "utf8"), page("Second", "after"));
  } finally {
    await f.dispose();
  }
});

test("invalid traversal, non-HTML and missing slug cannot stage files", async () => {
  const f = await fixture();
  try {
    const first = await f.write("first.html", page("Safe", "safe"));
    const other = await f.write("other.txt", "secret");
    assert.notEqual(f.run("stage", first, "--slug", "../outside").status, 0);
    assert.notEqual(f.run("stage", first).status, 0);
    assert.notEqual(f.run("stage", other, "--slug", "other").status, 0);
    const pages = path.join(f.home, "vercel-shared-site", "pages");
    await assert.rejects(readdir(pages), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

test("uninitialized delivery keeps the original HTML outside the publication archive", async () => {
  const f = await fixture();
  try {
    assert.equal(f.run("status").stdout, "uninitialized\n");
    await assert.rejects(stat(f.home), { code: "ENOENT" });
    const input = page("Offline", "safe");
    const file = await f.write("offline.html", input);
    const outcome = f.run(
      "deliver",
      file,
      "--slug",
      "offline",
      "--context-source",
      "codex",
      "--context-title",
      "Local task",
    );
    assert.equal(outcome.status, 0);
    assert.equal(outcome.stdout, `Local: ${file}\n`);
    assert.equal(outcome.stderr, "");
    assert.match(f.run("publish", file, "--slug", "offline").stderr, /publishing is disabled/);
    await assert.rejects(stat(path.join(f.home, "vercel-shared-site")), { code: "ENOENT" });
    assert.equal(await readFile(file, "utf8"), input);
  } finally {
    await f.dispose();
  }
});

test("default settings stay in the data directory and take precedence over legacy settings", async () => {
  const f = await fixture();
  try {
    const preload = [
      'import os from "node:os";',
      'import { syncBuiltinESMExports } from "node:module";',
      "os.homedir = () => process.env.AM_TEST_USER_DIR;",
      "syncBuiltinESMExports();",
    ].join("\n");
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        ["--import", "data:text/javascript," + encodeURIComponent(preload), cli, ...args],
        {
          encoding: "utf8",
          env: { ...process.env, AM_HOME: "", AM_TEST_USER_DIR: f.base, PATH: f.base },
        },
      );
    const agentsDir = path.join(f.base, ".agents");
    const settingsDir = path.join(agentsDir, ".answer-me-with-html");
    const oldExternalSettings = path.join(agentsDir, "answer-me-with-html-vercel.md");
    const previous = path.join(settingsDir, "answer-me-with-html.md");
    const previousVercel = path.join(settingsDir, "answer-me-with-html-vercel.md");
    await mkdir(settingsDir, { recursive: true });
    const original = [
      "- Delivery mode: vercel",
      "- Vercel team: example-team",
      "- Vercel project: demo",
      "- Vercel project ID: prj_demo",
      "",
    ].join("\n");
    await writeFile(oldExternalSettings, original);
    assert.equal(run("status").stdout, "uninitialized\n");
    await writeFile(previous, "- Delivery mode: local\n");
    assert.equal(run("status").stdout, "local\n");
    await writeFile(previousVercel, original);
    assert.equal(run("status").stdout, "vercel\n");
    const setup = run("setup", "--local");
    assert.equal(setup.status, 0, setup.stderr);
    const settings = path.join(settingsDir, "publish-vercel.md");
    assert.equal(setup.stdout, "Local delivery saved to " + settings + "\n");
    assert.match(await readFile(settings, "utf8"), /^- Delivery mode: local$/m);
    assert.equal(run("status").stdout, "local\n");
    assert.equal(await readFile(previousVercel, "utf8"), original);
    assert.equal(await readFile(oldExternalSettings, "utf8"), original);
    await assert.rejects(stat(path.join(agentsDir, "publish-vercel.md")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(agentsDir, "answer-me-with-html")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(f.base, ".answer-me-with-html")), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

test("setup discovers up to five domains without saving, accepts an omitted bound alias, and can clear the choice", async () => {
  const f = await fixture();
  try {
    const args = ["setup", "--team", "team", "--project-id", "prj_mock"];
    const configPath = path.join(f.home, "publish-vercel.md");
    await f.stubVercel(
      [
        'case "$1:$2" in',
        `project:inspect) printf '{"id":"prj_mock","name":"demo","owner":{"slug":"team"}}\n' ;;`,
        `api:/v9/projects/prj_mock) printf '{"id":"prj_mock","targets":{"production":{"id":"dpl_live","url":"live.vercel.app","aliasAssigned":true}}}\n' ;;`,
        `api:/v2/deployments/dpl_live/aliases) printf '%s\n' '${JSON.stringify({
          aliases: [
            { alias: "demo.vercel.app" },
            ...["f", "a", "c", "e", "d", "b", "a"].map((letter) => ({
              alias: letter + ".example.test",
            })),
            { alias: "redirect.example.test", redirect: "a.example.test" },
          ],
        })}' ;;`,
        "*) exit 1 ;; esac",
      ].join("\n"),
    );

    const discovery = f.run(...args, "--list-domains");
    assert.equal(discovery.status, 0, discovery.stderr);
    assert.deepEqual(JSON.parse(discovery.stdout), {
      project: "demo",
      domains: ["a", "b", "c", "d", "e"].map((letter) => letter + ".example.test"),
      more: true,
    });
    await assert.rejects(stat(f.home), { code: "ENOENT" });

    const invalid = f.run(...args, "--alias-domain", "unbound.example.test");
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /not bound to the current production/);
    await assert.rejects(stat(configPath), { code: "ENOENT" });
    const chosen = f.run(...args, "--alias-domain", "f.example.test");
    assert.equal(chosen.status, 0, chosen.stderr);
    const saved = await readFile(configPath, "utf8");
    assert.match(saved, /^- Vercel project: demo$/m);
    assert.match(saved, /^- Vercel delivery alias: f\.example\.test$/m);

    const skipped = f.run(...args);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.doesNotMatch(await readFile(configPath, "utf8"), /Vercel delivery alias/);
  } finally {
    await f.dispose();
  }
});

test("setup offers no aliases when the project has no production deployment", async () => {
  const f = await fixture();
  try {
    await publicationFixture(f);
    const outcome = f.run("setup", "--team", "team", "--project-id", "prj_mock", "--list-domains");
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.deepEqual(JSON.parse(outcome.stdout), { project: "demo", domains: [], more: false });
  } finally {
    await f.dispose();
  }
});

test("selected alias publishes the complete production gallery and handles production changes", async (t) => {
  for (const scenario of [
    "promote",
    "production changed",
    "lost promotion response",
    "promotion still pending",
    "alias page publicly accessible",
    "alias page inaccessible",
  ]) {
    await t.test(scenario, async () => {
      const f = await fixture();
      try {
        const aliasDomain = "explainers.example.test";
        const remote = await publicationFixture(f, {
          production: "previous.vercel.app",
          aliasDomain,
          race: scenario === "production changed",
          promotion:
            scenario === "lost promotion response"
              ? "lost"
              : scenario === "promotion still pending"
                ? "pending"
                : "ok",
          aliasPageUnavailable: scenario === "alias page inaccessible",
        });
        const old = await f.write("old.html", page("Live article", "keep me"));
        const file = await f.write("article.html", page("New article", "body"));
        if (scenario === "alias page publicly accessible")
          await cp(file, path.join(f.home, "alias-page"));
        assert.equal(f.run("stage", old, "--slug", "old").status, 0);
        await cp(path.join(f.home, "vercel-shared-site"), path.join(f.home, "previous"), {
          recursive: true,
        });

        const publication = f.reviewed("publish", file, "--slug", "article", "--json");
        let result = JSON.parse(publication.stdout);
        if (scenario === "lost promotion response" || scenario === "promotion still pending") {
          assert.equal(publication.status, 1);
          assert.equal(result.production.state, "unknown");
          assert.equal(result.archive, "pending");
          if (scenario === "promotion still pending") {
            const waiting = f.run("recover", "--json");
            assert.equal(waiting.status, 1);
            assert.equal(JSON.parse(waiting.stdout).production.state, "unknown");
            assert.equal((await remote.calls()).match(/^promote /gm)?.length, 1);
            await writeFile(path.join(f.home, "production"), "candidate.vercel.app");
          }
          const recovered = f.run("recover", "--json");
          assert.equal(recovered.status, 0, recovered.stdout);
          result = JSON.parse(recovered.stdout);
        } else {
          assert.equal(publication.status, 0, publication.stdout);
        }

        const conflict = scenario === "production changed";
        assert.equal(result.production.state, conflict ? "conflict" : "promoted");
        const hostname = conflict ? "candidate.vercel.app" : aliasDomain;
        const access =
          scenario === "alias page publicly accessible"
            ? "anonymous"
            : scenario === "alias page inaccessible"
              ? "unverified"
              : "authenticated";
        assert.deepEqual(result.delivery, {
          kind: conflict ? "immutable" : "alias",
          url: "https://" + hostname + "/pages/article.html",
          access,
        });
        assert.equal(result.archive, "saved");
        assert.equal(result.pages, 2);
        const calls = await remote.calls();
        assert.equal(calls.match(/^deploy /gm)?.length, 1);
        assert.equal(calls.match(/^promote /gm)?.length ?? 0, conflict ? 0 : 1);
        assert.equal(
          await readFile(path.join(f.home, "candidate", "pages", "old.html"), "utf8"),
          await readFile(old, "utf8"),
        );
      } finally {
        await f.dispose();
      }
    });
  }
});

test("deliver prints the confirmed alias even when its page cannot be fetched", async () => {
  const f = await fixture();
  try {
    await publicationFixture(f, {
      production: "previous.vercel.app",
      aliasDomain: "explainers.example.test",
      aliasPageUnavailable: true,
    });
    const old = await f.write("old.html", page("Live article", "keep me"));
    assert.equal(f.run("stage", old, "--slug", "old").status, 0);
    await cp(path.join(f.home, "vercel-shared-site"), path.join(f.home, "previous"), {
      recursive: true,
    });
    const file = await f.write("article.html", page("New article", "body"));
    const publication = f.reviewed("deliver", file, "--slug", "article");
    assert.equal(publication.status, 0, publication.stderr);
    const lines = publication.stdout.trim().split("\n");
    assert.ok(lines.includes("Published: https://explainers.example.test/pages/article.html"));
    assert.ok(
      lines.includes("Verified Vercel deployment: https://candidate.vercel.app/pages/article.html"),
    );
    assert.ok(lines.includes("Access: unverified"));
  } finally {
    await f.dispose();
  }
});

test("first-use local setup persists and a stale first-use setup cannot enable publishing", async () => {
  const f = await fixture();
  try {
    const configPath = path.join(f.home, "publish-vercel.md");
    assert.equal(f.run("setup", "--local", "--if-uninitialized").status, 0);
    assert.match(await readFile(configPath, "utf8"), /^- Delivery mode: local$/m);
    await assert.rejects(stat(path.join(f.home, "vercel-shared-project.json")), { code: "ENOENT" });
    if (process.platform !== "win32") assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    const status = f.run("status");
    assert.equal(status.status, 0);
    assert.equal(status.stdout, "local\n");

    await f.stubVercel('printf called > "$AM_HOME/cli-called"\nexit 18\n');
    const stale = f.run(
      "setup",
      "--if-uninitialized",
      "--team",
      "example-team",
      "--project",
      "demo",
      "--project-id",
      "prj_demo",
    );
    assert.equal(stale.status, 0, stale.stderr);
    const file = await f.write("offline.html", page("Local", "draft"));
    const delivery = f.run("deliver", file, "--slug", "offline");
    assert.equal(delivery.stdout, `Local: ${file}\n`);
    assert.equal(delivery.stderr, "");
    assert.equal(f.run("status").stdout, "local\n");
    await assert.rejects(stat(path.join(f.home, "cli-called")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(f.home, "vercel-shared-site")), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

test("setup respects an existing project binding when switching to local delivery", async () => {
  const f = await fixture();
  try {
    await mkdir(f.home);
    const configPath = path.join(f.home, "vercel-shared-project.json");
    const legacy = {
      schemaVersion: 1,
      team: "example-team",
      project: "demo",
      projectId: "prj_demo",
      lastVerifiedDeployment: "https://deployment.example.test",
    };
    await writeFile(configPath, JSON.stringify(legacy));
    assert.equal(f.run("status").stdout, "local\n");
    const markdown = path.join(f.home, "publish-vercel.md");
    await assert.rejects(stat(markdown), { code: "ENOENT" });
    assert.equal(f.run("setup", "--local", "--if-uninitialized").status, 0);
    assert.equal(f.run("status").stdout, "local\n");
    assert.equal(f.run("setup", "--local").status, 0);
    assert.equal(f.run("status").stdout, "local\n");
    const other = f.run(
      "setup",
      "--team",
      "example-team",
      "--project",
      "other",
      "--project-id",
      "prj_other",
    );
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /archive is bound to a different project/);
    const saved = await readFile(markdown, "utf8");
    assert.match(saved, /^- Delivery mode: local$/m);
    assert.match(saved, /^- Vercel project ID: prj_demo$/m);
    assert.match(saved, /^- Last verified deployment: https:\/\/deployment\.example\.test$/m);
    assert.equal(await readFile(configPath, "utf8"), JSON.stringify(legacy));

    const file = await f.write("local.html", page("Local", "draft"));
    await f.stubVercel('printf called > "$AM_HOME/cli-called"\nexit 18\n');
    const delivery = f.run("deliver", file, "--slug", "local");
    assert.equal(delivery.stdout, `Local: ${file}\n`);
    assert.equal(delivery.stderr, "");
    assert.notEqual(f.run("publish", file, "--slug", "local").status, 0);
    await assert.rejects(stat(path.join(f.home, "cli-called")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(f.home, "vercel-shared-site")), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

test("setup rejects a credential-bearing domain or mismatched project before enabling delivery", async () => {
  const f = await fixture();
  try {
    assert.equal(f.run("setup", "--local").status, 0);
    const options = ["--team", "example-team", "--project", "demo", "--project-id", "prj_demo"];
    const badOrigin = f.run(
      "setup",
      ...options,
      "--public-origin",
      "https://user:sample-password@explainers.example.test/",
    );
    assert.notEqual(badOrigin.status, 0);
    assert.match(badOrigin.stderr, /bare HTTPS origin/);
    assert.doesNotMatch(badOrigin.stderr, /sample-password/);

    await f.stubVercel(
      'printf \'{"id":"prj_wrong","name":"demo","owner":{"slug":"example-team"}}\\n\'\n',
    );
    const mismatch = f.run("setup", ...options);
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /identity differs/);
    assert.equal(f.run("status").stdout, "local\n");
  } finally {
    await f.dispose();
  }
});

test("invalid Markdown settings block publishing even with a valid older configuration", async () => {
  const f = await fixture();
  try {
    await mkdir(f.home);
    await writeFile(
      path.join(f.home, "vercel-shared-project.json"),
      JSON.stringify({
        schemaVersion: 1,
        team: "example-team",
        project: "demo",
        projectId: "prj_demo",
      }),
    );
    await writeFile(path.join(f.home, "publish-vercel.md"), "- Delivery mode: vercel\n");
    assert.notEqual(f.run("status").status, 0);
    const file = await f.write("local.html", page("Local", "draft"));
    const delivery = f.run("deliver", file, "--slug", "local");
    assert.equal(delivery.stdout, `Local: ${file}\n`);
    assert.match(delivery.stderr, /Invalid pinned Vercel project/);
    await assert.rejects(stat(path.join(f.home, "vercel-shared-site")), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

test("deliver falls back when Vercel CLI fails and preserves the source", async () => {
  const f = await fixture();
  try {
    const input = page("Network outage", "safe");
    const file = await f.write("outage.html", input);
    await mkdir(f.home);
    await writeFile(
      path.join(f.home, "vercel-shared-project.json"),
      JSON.stringify({
        schemaVersion: 1,
        mode: "vercel",
        team: "test-team",
        project: "test-project",
        projectId: "prj_fake",
      }),
    );
    await f.stubVercel("echo simulated-outage >&2\nexit 19\n");
    const outcome = f.reviewed("deliver", file, "--slug", "outage");
    assert.equal(outcome.status, 0);
    assert.match(outcome.stderr, /simulated-outage/);
    assert.match(outcome.stdout, /Local:/);
    assert.equal(await readFile(file, "utf8"), input);
  } finally {
    await f.dispose();
  }
});

test("deliver does not claim local HTML fallback for an invalid source file", async () => {
  const f = await fixture();
  try {
    const file = await f.write("invalid.html", "not-html");
    const outcome = f.run("deliver", file, "--slug", "invalid");
    assert.notEqual(outcome.status, 0);
    assert.doesNotMatch(outcome.stdout, /Local:/);
    assert.match(outcome.stderr, /does not look like/);
  } finally {
    await f.dispose();
  }
});

test("preferred public domain updates link presentation without changing Vercel verification origin", async () => {
  const f = await fixture();
  try {
    await mkdir(f.home);
    const configPath = path.join(f.home, "vercel-shared-project.json");
    const original = {
      schemaVersion: 1,
      mode: "vercel",
      team: "test-team",
      project: "test-project",
      projectId: "prj_fake",
      origin: "https://previous.example.test",
    };
    await writeFile(configPath, JSON.stringify(original));
    const result = f.run(
      "set-public-origin",
      "--public-origin",
      "https://explainers.example.test/",
    );
    assert.equal(result.status, 0, result.stderr);
    const markdown = path.join(f.home, "publish-vercel.md");
    const config = await readFile(markdown, "utf8");
    assert.match(config, /^- Preferred link origin: https:\/\/explainers\.example\.test$/m);
    assert.match(config, /^- Legacy verification origin: https:\/\/previous\.example\.test$/m);
    assert.match(config, /^- Vercel project ID: prj_fake$/m);
    for (const bad of [
      "http://explainers.example.test/",
      "https://explainers.example.test/private",
      "https://explainers.example.test/?a=b",
    ]) {
      const outcome = f.run("set-public-origin", "--public-origin", bad);
      assert.notEqual(outcome.status, 0, bad);
      assert.equal(await readFile(markdown, "utf8"), config);
    }
  } finally {
    await f.dispose();
  }
});

test("project groups and Posts appear separately with descending publication timestamps", async () => {
  const f = await fixture();
  try {
    const older = await f.write("older.html", page("Older project", "older"));
    const newer = await f.write("newer.html", page("Newer project", "newer"));
    const generic = await f.write("generic.html", page("Unrelated topic", "generic"));
    assert.equal(
      f.run(
        "stage",
        older,
        "--slug",
        "older",
        "--group",
        "example-project",
        "--published-at",
        "2026-09-19",
      ).status,
      0,
    );
    assert.equal(
      f.run("stage", generic, "--slug", "generic", "--published-at", "2026-10-18").status,
      0,
    );
    assert.equal(
      f.run(
        "stage",
        newer,
        "--slug",
        "newer",
        "--group",
        "example-project",
        "--published-at",
        "2026-10-19",
      ).status,
      0,
    );
    const index = await readFile(path.join(f.home, "vercel-shared-site", "index.html"), "utf8");
    const projectGroup = index.indexOf('id="group-example-project"');
    const posts = index.indexOf('id="group-posts"');
    assert.ok(projectGroup > 0 && posts > projectGroup);
    assert.ok(index.indexOf("./pages/newer.html") < index.indexOf("./pages/older.html"));
    assert.ok(index.indexOf("./pages/older.html") < posts);
    assert.ok(index.indexOf("./pages/generic.html") > posts);
    assert.match(index, /datetime="2026-10-19T00:00:00.000Z"/);
    assert.match(index, /<title>Explainers<\/title>/);
    assert.match(index, /group-watermark/);
    assert.match(index, /max-width:624px/);
    const catalog = JSON.parse(
      await readFile(path.join(f.home, "vercel-shared-site", "pages.json"), "utf8"),
    );
    assert.equal(catalog.pages.older.group, "example-project");
    assert.equal(catalog.pages.generic.group, "posts");
  } finally {
    await f.dispose();
  }
});

test("re-stage preserves original publication timestamp unless explicitly changed", async () => {
  const f = await fixture();
  try {
    const source = await f.write("article.html", page("First title", "first"));
    const replacement = await f.write("replacement.html", page("Updated title", "second"));
    assert.equal(
      f.run(
        "stage",
        source,
        "--slug",
        "stable",
        "--group",
        "example-project",
        "--published-at",
        "2026-09-21",
      ).status,
      0,
    );
    assert.equal(
      f.run("stage", replacement, "--slug", "stable", "--group", "example-project", "--replace")
        .status,
      0,
    );
    let catalog = JSON.parse(
      await readFile(path.join(f.home, "vercel-shared-site", "pages.json"), "utf8"),
    );
    assert.equal(catalog.pages.stable.publishedAt, "2026-09-21T00:00:00.000Z");
    assert.equal(f.run("stage", replacement, "--slug", "stable", "--group", "Posts").status, 0);
    catalog = JSON.parse(
      await readFile(path.join(f.home, "vercel-shared-site", "pages.json"), "utf8"),
    );
    assert.equal(catalog.pages.stable.group, "posts");
    assert.equal(catalog.pages.stable.publishedAt, "2026-09-21T00:00:00.000Z");
    const rejected = f.run(
      "stage",
      replacement,
      "--slug",
      "stable",
      "--published-at",
      "2026-02-30",
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /not a real calendar day/);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(f.home, "vercel-shared-site", "pages.json"), "utf8")),
      catalog,
    );
  } finally {
    await f.dispose();
  }
});

test("migrates an existing flat archive without changing URLs and records a date proxy", async () => {
  const f = await fixture();
  try {
    const archive = path.join(f.home, "vercel-shared-site", "pages");
    await mkdir(archive, { recursive: true });
    const old = path.join(archive, "require-bindings.html");
    await writeFile(old, page("Existing require", "legacy"));
    const { utimes } = await import("node:fs/promises");
    const older = new Date("2026-09-17T11:42:31.000Z");
    await utimes(old, older, older);
    const incoming = await f.write("incoming.html", page("New project", "new"));
    assert.equal(
      f.run(
        "stage",
        incoming,
        "--slug",
        "new-project",
        "--group",
        "example-project",
        "--published-at",
        "2026-10-19",
      ).status,
      0,
    );
    const catalog = JSON.parse(
      await readFile(path.join(f.home, "vercel-shared-site", "pages.json"), "utf8"),
    );
    assert.equal(catalog.pages["require-bindings"].group, "posts");
    assert.equal(catalog.pages["require-bindings"].publishedAt, older.toISOString());
    const index = await readFile(path.join(f.home, "vercel-shared-site", "index.html"), "utf8");
    assert.match(index, /href="\.\/pages\/require-bindings\.html"/);
    assert.match(index, /href="\.\/pages\/new-project\.html"/);
    assert.equal(await readFile(old, "utf8"), page("Existing require", "legacy"));
  } finally {
    await f.dispose();
  }
});

test("ChatGPT provenance is visible in the generated page copy and searchable index", async () => {
  const f = await fixture();
  try {
    const source =
      "<!doctype html><html><head><title>Module &amp; resolution</title>" +
      '</head><body><main><header class="am-head"><h1>Module resolution</h1>' +
      '<div class="am-head-meta"><span><b>source</b>TypeScript</span></div></header>' +
      "</main></body></html>";
    const pathToPage = await f.write("chat.html", source);
    const url = "https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc";
    const title = 'TS resolution <script>alert("x")</script>';
    const result = f.run(
      "stage",
      pathToPage,
      "--slug",
      "module",
      "--group",
      "example-project",
      "--context-source",
      "chatgpt",
      "--context-title",
      title,
      "--context-url",
      url,
    );
    assert.equal(result.status, 0, result.stderr);
    const archived = await readFile(
      path.join(f.home, "vercel-shared-site", "pages", "module.html"),
      "utf8",
    );
    const index = await readFile(path.join(f.home, "vercel-shared-site", "index.html"), "utf8");
    assert.equal(
      await readFile(pathToPage, "utf8"),
      source,
      "original rendered page remains intact",
    );
    assert.match(archived, /data-am-conversation-provenance="true"/);
    assert.match(archived, /aria-label="Source conversation"/);
    assert.match(archived, /<b>ChatGPT<\/b>/);
    assert.match(archived, /href="https:\/\/chatgpt.com\/c\/12345678-1234-1234-1234-123456789abc"/);
    assert.match(archived, /rel="noopener noreferrer"/);
    assert.match(archived, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.doesNotMatch(archived, /<script>alert\("x"\)<\/script>/);
    assert.match(index, /class="entry-origin"/);
    assert.match(index, /<span class="entry-origin-platform">ChatGPT<\/span>/);
    const catalog = JSON.parse(
      await readFile(path.join(f.home, "vercel-shared-site", "pages.json"), "utf8"),
    );
    assert.deepEqual(catalog.pages.module.context, { source: "chatgpt", title, url });
    assert.equal((archived.match(/am-context-provenance:start/g) || []).length, 1);
    const repeated = f.run("stage", pathToPage, "--slug", "module");
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(
      await readFile(path.join(f.home, "vercel-shared-site", "pages", "module.html"), "utf8"),
      archived,
      "re-staging same source preserves attribution and has no duplicate markup",
    );
  } finally {
    await f.dispose();
  }
});

test("Codex provenance records a session title without adding a fabricated conversation URL", async () => {
  const f = await fixture();
  try {
    const pageFile = await f.write("codex.html", page("CI review", "details"));
    const output = f.run(
      "stage",
      pageFile,
      "--slug",
      "ci-review",
      "--context-source",
      "codex",
      "--context-title",
      "Review workspace GitHub CI",
    );
    assert.equal(output.status, 0, output.stderr);
    const archivedPath = path.join(f.home, "vercel-shared-site", "pages", "ci-review.html");
    const decorated = await readFile(archivedPath, "utf8");
    assert.match(decorated, /<b>Codex<\/b>/);
    assert.match(decorated, /Review workspace GitHub CI/);
    assert.doesNotMatch(decorated, /chatgpt.com|href=/);
    const index = await readFile(path.join(f.home, "vercel-shared-site", "index.html"), "utf8");
    assert.match(index, /<span class="entry-origin-platform">Codex<\/span>/);
    const update = f.run(
      "stage",
      pageFile,
      "--slug",
      "ci-review",
      "--context-source",
      "codex",
      "--context-title",
      "Review CI after fixes",
    );
    assert.equal(update.status, 0, update.stderr);
    const updated = await readFile(archivedPath, "utf8");
    assert.match(updated, /Review CI after fixes/);
    assert.doesNotMatch(updated, /Review workspace GitHub CI/);
    assert.equal((updated.match(/am-context-provenance:start/g) || []).length, 1);
  } finally {
    await f.dispose();
  }
});

test("rejects incomplete or unsafe conversation provenance before changing the archive", async () => {
  const f = await fixture();
  try {
    const pageFile = await f.write("page.html", page("Safe", "content"));
    const attempts = [
      ["--context-source", "chatgpt"],
      ["--context-source", "chatgpt", "--context-title", "   "],
      ["--context-source", "chatgpt", "--context-url", "https://chatgpt.com/c/one"],
      ["--context-source", "chatgpt", "--context-title", "Has URL but blank", "--context-url", ""],
      ["--context-title", "Missing platform"],
      [
        "--context-source",
        "chatgpt",
        "--context-title",
        "X",
        "--context-url",
        "https://example.com/c/test",
      ],
      [
        "--context-source",
        "chatgpt",
        "--context-title",
        "X",
        "--context-url",
        "javascript:alert(1)",
      ],
      [
        "--context-source",
        "chatgpt",
        "--context-title",
        "X",
        "--context-url",
        "https://chatgpt.com/",
      ],
      [
        "--context-source",
        "codex",
        "--context-title",
        "X",
        "--context-url",
        "https://chatgpt.com/c/one",
      ],
      ["--context-source", "codex", "--context-title", "Line\nbreak"],
      ["--context-source", "unknown", "--context-title", "Untyped"],
    ];
    for (const flags of attempts) {
      const result = f.run("stage", pageFile, "--slug", "test-page", ...flags);
      assert.notEqual(result.status, 0, flags.join(" "));
      assert.match(result.stderr, /Error:/);
    }
    const catalogPath = path.join(f.home, "vercel-shared-site", "pages.json");
    await assert.rejects(readFile(catalogPath, "utf8"), { code: "ENOENT" });
    assert.equal(await readFile(pageFile, "utf8"), page("Safe", "content"));
  } finally {
    await f.dispose();
  }
});

test("Vercel outage returns the original render without staging it for publication", async () => {
  const f = await fixture();
  try {
    const input = page("Local with provenance", "private contextual draft");
    const file = await f.write("source.html", input);
    await mkdir(f.home);
    await writeFile(
      path.join(f.home, "vercel-shared-project.json"),
      JSON.stringify({
        schemaVersion: 1,
        mode: "vercel",
        team: "team",
        project: "demo",
        projectId: "prj_demo",
      }),
    );
    await f.stubVercel("exit 19\n");
    const output = f.reviewed(
      "deliver",
      file,
      "--slug",
      "with-context",
      "--context-source",
      "codex",
      "--context-title",
      "Actual Codex session",
    );
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.stdout, "Local: " + file + "\n");
    await assert.rejects(stat(path.join(f.home, "vercel-shared-site", "pages")), {
      code: "ENOENT",
    });
    await assert.rejects(stat(path.join(f.home, "vercel-shared-published.json")), {
      code: "ENOENT",
    });
    assert.equal(await readFile(file, "utf8"), input);
  } finally {
    await f.dispose();
  }
});

test("metadata-free legacy pages remain valid and are not falsely attributed", async () => {
  const f = await fixture();
  try {
    const old = await f.write("old.html", page("Historical article", "no known context"));
    const newFile = await f.write("new.html", page("New article", "has a source"));
    assert.equal(f.run("stage", old, "--slug", "old").status, 0);
    assert.equal(
      f.run(
        "stage",
        newFile,
        "--slug",
        "new",
        "--context-source",
        "codex",
        "--context-title",
        "Research and implement",
      ).status,
      0,
    );
    const catalog = JSON.parse(
      await readFile(path.join(f.home, "vercel-shared-site", "pages.json"), "utf8"),
    );
    assert.equal(catalog.pages.old.context, undefined);
    assert.equal(catalog.pages.new.context.source, "codex");
    assert.equal(
      await readFile(path.join(f.home, "vercel-shared-site", "pages", "old.html"), "utf8"),
      page("Historical article", "no known context"),
    );
  } finally {
    await f.dispose();
  }
});

test("deliver publishes ChatGPT context with a model-generated title and no conversation URL", async () => {
  const f = await fixture();
  try {
    const rendered = page("TypeScript check", "real content");
    const file = await f.write("generated.html", rendered);
    assert.equal(f.run("setup", "--local", "--if-uninitialized").status, 0);
    const remote = await publicationFixture(f, { publicOrigin: "https://explainers.example.test" });
    assert.equal(f.run("status").stdout, "vercel\n");
    assert.match(
      await remote.calls(),
      /^project inspect prj_mock --scope team --non-interactive --json\n$/,
    );
    const settings = path.join(f.home, "publish-vercel.md");
    const saved = await readFile(settings, "utf8");
    assert.match(saved, /^- Delivery mode: vercel$/m);
    assert.match(saved, /^- Vercel team: team$/m);
    assert.match(saved, /^- Vercel project: demo$/m);
    assert.match(saved, /^- Vercel project ID: prj_mock$/m);
    assert.match(saved, /^- Preferred link origin: https:\/\/explainers\.example\.test$/m);

    const output = f.reviewed(
      "deliver",
      file,
      "--slug",
      "article",
      "--group",
      "example-project",
      "--context-source",
      "chatgpt",
      "--context-title",
      "Compare TS resolution",
    );
    assert.equal(output.status, 0, output.stderr);
    assert.match(output.stdout, /Published: https:\/\/candidate\.vercel\.app\/pages\/article.html/);
    assert.match(
      output.stdout,
      /Verified Vercel deployment: https:\/\/candidate\.vercel\.app\/pages\/article.html/,
    );
    assert.match(
      output.stdout,
      /^Preferred: https:\/\/explainers\.example\.test\/pages\/article\.html \(protected, HTTP 403\)$/m,
    );
    assert.doesNotMatch(output.stdout, /Local:/, output.stderr);
    if (process.platform !== "win32") assert.equal((await stat(settings)).mode & 0o777, 0o600);
    assert.equal(await readFile(file, "utf8"), rendered);
    const staged = await readFile(path.join(f.home, "candidate", "pages", "article.html"), "utf8");
    assert.match(staged, /<b>ChatGPT<\/b>/);
    assert.match(staged, /<span>Compare TS resolution<\/span>/);
    assert.doesNotMatch(staged, /chatgpt.com|href=/);
    const index = await readFile(path.join(f.home, "candidate", "index.html"), "utf8");
    assert.match(index, /Compare TS resolution/);
    assert.doesNotMatch(index, /chatgpt.com/);
    const catalog = JSON.parse(
      await readFile(path.join(f.home, "candidate", "pages.json"), "utf8"),
    );
    assert.deepEqual(catalog.pages.article.context, {
      source: "chatgpt",
      title: "Compare TS resolution",
    });
  } finally {
    await f.dispose();
  }
});

test("publishing verifies the entire gallery and preserves existing production pages", async () => {
  for (const tamper of ["", "pages/existing.html"]) {
    const f = await fixture();
    try {
      const remote = await publicationFixture(f, {
        production: "previous.vercel.app",
        tamper,
        publicOrigin: "https://explainers.example.test",
      });
      const existing = await f.write("existing.html", page("Existing", "retained"));
      assert.equal(f.run("stage", existing, "--slug", "existing").status, 0);
      await cp(path.join(f.home, "vercel-shared-site"), path.join(f.home, "previous"), {
        recursive: true,
      });
      const settings = path.join(f.home, "publish-vercel.md");
      await writeFile(
        settings,
        (await readFile(settings, "utf8")) +
          "- Last verified deployment: https://previous.vercel.app\n",
      );

      const input = page("Online", "published content");
      const file = await f.write("online.html", input);
      const outcome = f.reviewed("deliver", file, "--slug", "online");
      assert.equal(outcome.status, tamper ? 1 : 0, outcome.stderr);
      assert.equal(await readFile(file, "utf8"), input);
      const calls = await remote.calls();
      assert.match(calls, /^curl https:\/\/candidate\.vercel\.app\/pages\/existing\.html /m);
      if (tamper) {
        assert.match(outcome.stdout, /Remote publication: unknown/);
        assert.match(outcome.stderr, /differs.*existing\.html/);
        assert.doesNotMatch(calls, /^promote /m);
        assert.equal(await remote.serving(), "previous.vercel.app");
        continue;
      }

      assert.match(
        outcome.stdout,
        /Published: https:\/\/candidate\.vercel\.app\/pages\/online\.html/,
      );
      assert.match(
        outcome.stdout,
        /Verified Vercel deployment: https:\/\/candidate\.vercel\.app\/pages\/online\.html/,
      );
      assert.ok(outcome.stdout.includes(`Editable source: ${file}\n`));
      assert.equal(await remote.serving(), "previous.vercel.app");
      assert.match(calls, /deploy .* --prod --skip-domain .*\n(?:curl .*\n){4}/);
      assert.doesNotMatch(calls, /^promote /m);
      assert.equal(
        await readFile(path.join(f.home, "candidate", "pages", "existing.html"), "utf8"),
        await readFile(existing, "utf8"),
      );
      const config = await readFile(settings, "utf8");
      assert.match(config, /^- Last verified deployment: https:\/\/previous\.vercel\.app$/m);
      const verified = f.run("verify", "--slug", "online");
      assert.equal(verified.status, 0, verified.stderr);
      assert.match(
        verified.stdout,
        /Preferred: https:\/\/explainers\.example\.test\/pages\/online\.html/,
      );
    } finally {
      await f.dispose();
    }
  }
});

test("legacy delivery settings retain opaque unrelated project values", async () => {
  const f = await fixture();
  try {
    await mkdir(f.home, { recursive: true });
    for (const project of [123, null, false, [], { note: "legacy" }]) {
      await writeFile(
        path.join(f.home, "vercel-shared-project.json"),
        JSON.stringify({ schemaVersion: 1, mode: "local", project }),
      );
      const status = f.run("status");
      assert.equal(status.status, 0, status.stderr);
      assert.equal(status.stdout, "local\n");
    }
    await writeFile(
      path.join(f.home, "vercel-shared-project.json"),
      JSON.stringify({ schemaVersion: 1, mode: false }),
    );
    const invalidMode = f.run("status");
    assert.equal(invalidMode.status, 1);
    assert.match(invalidMode.stderr, /Invalid delivery mode in/);
  } finally {
    await f.dispose();
  }
});

test("staging preserves unrelated catalog fields and the original accepted context record", async () => {
  const f = await fixture();
  try {
    const site = path.join(f.home, "vercel-shared-site");
    await mkdir(path.join(site, "pages"), { recursive: true });
    await writeFile(path.join(site, "pages", "old.html"), page("Old", "Existing page"));
    const metadata = {
      group: "posts",
      publishedAt: "2026-01-01T00:00:00.000Z",
      extra: { note: "retain metadata" },
      context: {
        source: "chatgpt",
        title: "  Preserve existing whitespace  ",
        url: "https://chatgpt.com/c/example/",
        extra: "retain context",
      },
    };
    await writeFile(
      path.join(site, "pages.json"),
      JSON.stringify({ schemaVersion: 1, extra: "retain catalog", pages: { old: metadata } }),
    );
    const input = await f.write("next.html", page("Next", "New page"));
    const result = f.run("stage", input, "--slug", "next", "--published-at", "2026-02-01");
    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(await readFile(path.join(site, "pages.json"), "utf8"));
    assert.equal(saved.extra, "retain catalog");
    assert.deepEqual(saved.pages.old, metadata);
    assert.equal(saved.pages.next.publishedAt, "2026-02-01T00:00:00.000Z");
  } finally {
    await f.dispose();
  }
});

test("catalog archive consistency is checked before absent pages' metadata", async () => {
  const f = await fixture();
  try {
    const site = path.join(f.home, "vercel-shared-site");
    await mkdir(site, { recursive: true });
    await writeFile(
      path.join(site, "pages.json"),
      JSON.stringify({ schemaVersion: 1, pages: { missing: null } }),
    );
    const input = await f.write("next.html", page("Next", "New page"));
    const result = f.run("stage", input, "--slug", "next");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing archived HTML for catalog page: missing/);
  } finally {
    await f.dispose();
  }
});

test("partial pending journals preserve the original blocking error and pending status", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.home, "vercel-shared-pending"), { recursive: true });
    await writeFile(
      path.join(f.home, "vercel-shared-project.json"),
      JSON.stringify({ schemaVersion: 1, mode: "vercel", team: "team", projectId: "prj_mock" }),
    );
    const input = await f.write("next.html", page("Next", "New page"));
    const journal = { source: "/tmp/original-source.html", slug: "original", phase: "prepared" };
    await writeFile(
      path.join(f.home, "vercel-shared-pending", "journal.json"),
      JSON.stringify(journal),
    );
    const publication = f.run("publish", input, "--slug", "next", "--json");
    const blocked = JSON.parse(publication.stdout);
    assert.equal(publication.status, 1);
    assert.equal(
      blocked.error,
      "A pending publication must be resolved with recover before another upload.",
    );
    assert.deepEqual(blocked.remote, { state: "not-attempted" });
    assert.equal(blocked.source, journal.source);
    assert.equal(blocked.slug, journal.slug);
    const recovery = f.run("recover", "--json");
    const invalid = JSON.parse(recovery.stdout);
    assert.equal(recovery.status, 1);
    assert.equal(invalid.error, "Invalid pending publication journal.");
    assert.deepEqual(invalid.remote, { state: "not-attempted" });
    assert.equal(invalid.source, journal.source);
  } finally {
    await f.dispose();
  }
});
