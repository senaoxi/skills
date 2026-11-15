import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingMessage } from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  captureChatgptConversation,
  clearChatgptSession,
  startChatgptSetup,
} from "../src/node/chatgpt-archive.ts";
import type { SetupSession } from "../src/node/chatgpt-archive.ts";
import { chatgptStatus } from "../src/node/chatgpt-session.ts";
import { resolveConversationContext } from "../src/node/conversation-context.ts";
import { readConversationBundle } from "../src/node/conversation-bundle.ts";

import { conversation, id } from "./chatgpt-fixture.ts";
const accountId = "fedcba98-7654-3210-fedc-ba9876543210";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII=",
  "base64",
);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const probe = () =>
  json({ items: [], total: 0, limit: 1, offset: 0, has_missing_conversations: false });
const tokenValue = () => randomBytes(32).toString("hex");
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");

function resolvedContext(explicit = id) {
  const selected = resolveConversationContext({ explicit });
  if (selected.status !== "resolved") assert.fail(selected.reason);
  return selected.context;
}

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), "am-chatgpt-"));
  const home = path.join(base, "home");
  await mkdir(home, { mode: 0o700 });
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, home };
}

async function seed(home: string, token = tokenValue(), optIn = true): Promise<string> {
  await writeFile(
    path.join(home, "chatgpt_session.json"),
    JSON.stringify({
      schemaVersion: 1,
      accessToken: token,
      archivePublicationOptIn: optIn,
      updatedAt: "2026-11-14T00:00:00.000Z",
    }),
    { mode: 0o600 },
  );
  return token;
}

async function setup(
  t: TestContext,
  home: string,
  fetch: typeof globalThis.fetch = async () => probe(),
): Promise<SetupSession> {
  const result = await startChatgptSetup(home, {
    fetch,
    setupTimeoutMs: 5_000,
    requestTimeoutMs: 1_000,
  });
  if ("status" in result) assert.fail(`Setup did not start: ${result.reason}`);
  t.after(result.cancel);
  return result;
}

async function page(session: SetupSession) {
  const response = await fetch(session.url);
  const html = await response.text();
  const match = /name="csrf" value="([a-f0-9]+)"/.exec(html);
  assert.ok(match, "Setup must contain a CSRF form value");
  return { response, html, csrf: match[1], origin: new URL(session.url).origin };
}

async function submitJson(
  session: SetupSession,
  sessionJson: string,
  options: { csrf?: string; origin?: string; extra?: [string, string][] } = {},
) {
  const details = await page(session);
  const body = new URLSearchParams({
    csrf: options.csrf ?? details.csrf,
    sessionJson,
    consent: "yes",
  });
  for (const [name, value] of options.extra ?? []) body.append(name, value);
  return fetch(`${details.origin}/session`, {
    method: "POST",
    headers: { Origin: options.origin ?? details.origin },
    body,
  });
}

async function submit(
  session: SetupSession,
  token: string,
  options: { csrf?: string; origin?: string; accountId?: string } = {},
) {
  return submitJson(
    session,
    JSON.stringify({
      accessToken: token,
      ...(options.accountId ? { account: { id: options.accountId } } : {}),
    }),
    options,
  );
}

test("setup GET tolerates tracking queries without widening local request guards", async (t) => {
  const { home } = await fixture(t);
  let probes = 0;
  const session = await setup(t, home, async () => {
    probes += 1;
    return probe();
  });
  const details = await page(session);
  assert.equal(details.response.status, 200);
  for (const query of [
    "?utm_source=chatgpt.com",
    "?utm_source=chatgpt.com&utm_medium=chat&campaign=archive",
    "?",
    "?next=%3Cscript%3Equery-injection-sentinel%3C%2Fscript%3E&csrf=invalid",
  ]) {
    const response = await fetch(`${session.url}${query}`);
    assert.equal(response.status, 200, query);
    assert.equal(await response.text(), details.html, "Query values must not alter the form");
  }
  const pathname = new URL(session.url).pathname;
  for (const rejectedPath of [
    "/setup/invalid?utm_source=chatgpt.com",
    `${pathname}x?utm_source=chatgpt.com`,
    `${pathname}/?utm_source=chatgpt.com`,
    `/other?next=${pathname}`,
    `${pathname.replace("/setup/", "/setup%2f")}?utm_source=chatgpt.com`,
  ]) {
    const response = await fetch(`${details.origin}${rejectedPath}`);
    assert.equal(response.status, 403, rejectedPath);
  }
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      `${session.url}?utm_source=chatgpt.com`,
      { headers: { Host: "attacker.invalid" } },
      (response) => {
        response.once("end", () => resolve(response.statusCode));
        response.resume();
      },
    );
    request.once("error", reject);
    request.end();
  });
  assert.equal(wrongHost, 400);
  for (const route of ["/session", "/cancel"]) {
    const response = await fetch(`${details.origin}${route}?utm_source=chatgpt.com`, {
      method: "POST",
      headers: { Origin: details.origin },
      body: new URLSearchParams({ csrf: details.csrf }),
    });
    assert.equal(response.status, 403, route);
  }
  assert.equal(probes, 0);
  assert.deepEqual(
    (await readdir(home)).filter((name) => name.endsWith(".json")),
    [],
  );
});

test("local secret page validates before atomic owner-only storage and safe status", async (t) => {
  const { home } = await fixture(t);
  await chmod(home, 0o755);
  const candidate = tokenValue();
  let requests = 0;
  const session = await setup(t, home, async (url, options) => {
    requests += 1;
    assert.equal(String(url), "https://chatgpt.com/backend-api/conversations?offset=0&limit=1");
    assert.equal(options?.redirect, "manual");
    assert.equal(options?.credentials, "omit");
    const headers = new Headers(options?.headers);
    assert.ok(
      headers.get("authorization") === `Bearer ${candidate}`,
      "Probe must authenticate with the candidate",
    );
    assert.equal(headers.get("chatgpt-account-id"), accountId);
    assert.deepEqual(
      (await readdir(home)).filter((name) => name.endsWith(".json")),
      [],
    );
    return probe();
  });
  const details = await page(session);
  assert.equal(details.response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(details.response.headers.get("referrer-policy"), "same-origin");
  assert.match(details.response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.match(details.html, /type="password" name="sessionJson" required maxlength="262144"/);
  assert.match(details.html, /https:\/\/chatgpt\.com\/api\/auth\/session\?utm_source=chatgpt\.com/);
  assert.doesNotMatch(details.html, /name="(?:token|accountId)"/);
  assert.match(details.html, /without asking again/);
  assert.match(details.html, /new agent session[^<]*archive as context/);
  assert.match(details.html, /full, unredacted conversation JSON/);
  assert.ok(!details.html.includes(candidate), "Setup page must not echo the candidate");
  const rejected = await submit(session, candidate, { origin: "https://attacker.invalid" });
  assert.equal(rejected.status, 403);
  assert.equal(requests, 0);
  const badCsrf = await submit(session, candidate, { csrf: "invalid" });
  assert.equal(badCsrf.status, 403);
  assert.equal(requests, 0);
  const accepted = await submit(session, candidate, { accountId });
  assert.equal(accepted.status, 200);
  const final = await session.completion;
  assert.equal(final.status, "configured");
  const configured = await chatgptStatus(home);
  assert.equal(configured.status, "configured");
  if (configured.status === "configured") {
    assert.equal(configured.hasAccountId, true);
    assert.equal(configured.archivePublicationOptIn, true);
  }
  assert.ok(
    !JSON.stringify(final).includes(candidate),
    "Setup result must not echo the credential",
  );
  assert.ok(!JSON.stringify(configured).includes(candidate), "Status must not echo the credential");
  assert.equal((await stat(home)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(home, "chatgpt_session.json"))).mode & 0o777, 0o600);
  const saved: unknown = JSON.parse(
    await readFile(path.join(home, "chatgpt_session.json"), "utf8"),
  );
  assert.ok(
    typeof saved === "object" &&
      saved !== null &&
      "accessToken" in saved &&
      saved.accessToken === candidate,
    "Validated credential must be stored",
  );
  assert.deepEqual(await readdir(home), ["chatgpt_session.json"]);
  assert.equal(requests, 1);
});

test("JSON-only format errors remain private and allow a corrected retry without replacing old settings", async (t) => {
  const { home } = await fixture(t);
  await seed(home);
  const filename = path.join(home, "chatgpt_session.json");
  const before = digest(await readFile(filename));
  const secret = tokenValue();
  let calls = 0;
  const session = await setup(t, home, async () => {
    calls += 1;
    return probe();
  });
  const cases = [
    { input: "", message: /complete session JSON response/ },
    { input: secret, message: /complete session JSON response/ },
    { input: `{ "accessToken": "${secret}",`, message: /JSON is malformed/ },
    { input: JSON.stringify(secret), message: /JSON must be an object/ },
    { input: "null", message: /JSON must be an object/ },
    { input: "42", message: /JSON must be an object/ },
    { input: "true", message: /JSON must be an object/ },
    { input: JSON.stringify([{ accessToken: secret }]), message: /JSON must be an object/ },
    {
      input: JSON.stringify({ user: { id: accountId }, padding: secret }),
      message: /valid accessToken string/,
    },
    {
      input: JSON.stringify({ accessToken: 123, padding: secret }),
      message: /valid accessToken string/,
    },
    { input: JSON.stringify({ accessToken: [secret] }), message: /valid accessToken string/ },
    { input: JSON.stringify({ accessToken: `${secret}\n` }), message: /valid accessToken string/ },
    {
      input: JSON.stringify({ accessToken: "x".repeat(16_385), padding: secret }),
      message: /valid accessToken string/,
    },
  ];
  for (const entry of cases) {
    const response = await submitJson(session, entry.input);
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, entry.message);
    assert.match(html, /type="password" name="sessionJson"/);
    assert.doesNotMatch(html, /name="sessionJson"[^>]*value=/);
    assert.ok(!html.includes(secret), "Local errors must not echo secret padding");
    assert.equal(calls, 0);
    assert.equal(digest(await readFile(filename)), before);
  }
  const response = await submitJson(
    session,
    ` \n${JSON.stringify({ accessToken: secret }, null, 2)}\n `,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await session.completion, {
    status: "configured",
    hasAccountId: false,
    archivePublicationOptIn: true,
  });
  assert.equal(calls, 1);
  assert.equal((await chatgptStatus(home)).status, "configured");
});

test("setup rejects unexpected or duplicated form fields before probing", async (t) => {
  const { home } = await fixture(t);
  let calls = 0;
  const session = await setup(t, home, async () => {
    calls += 1;
    return probe();
  });
  const candidate = tokenValue();
  const details = await page(session);
  for (const extra of [
    [["token", candidate]],
    [["accountId", accountId]],
    [["sessionJson", JSON.stringify({ accessToken: candidate })]],
    [["csrf", details.csrf]],
    [["consent", "yes"]],
  ] satisfies [string, string][][]) {
    const response = await submitJson(session, JSON.stringify({ accessToken: candidate }), {
      extra,
    });
    assert.equal(response.status, extra[0][0] === "csrf" ? 403 : 400);
    assert.ok(!(await response.text()).includes(candidate));
    assert.equal(calls, 0);
  }
  assert.equal((await submit(session, candidate)).status, 200);
  assert.equal((await session.completion).status, "configured");
});

test("only optional UUID account.id selects an account and unrelated session fields never reach storage", async (t) => {
  for (const hint of [
    { account: { id: accountId }, expected: accountId },
    { account: { id: "not-a-uuid" }, expected: undefined },
    { account: { id: 123 }, expected: undefined },
    { account: null, expected: undefined },
    { account: [accountId], expected: undefined },
    { account: undefined, expected: undefined },
  ]) {
    const { home } = await fixture(t);
    const candidate = tokenValue();
    const unrelated = tokenValue();
    let calls = 0;
    const session = await setup(t, home, async (_url, options) => {
      calls += 1;
      assert.equal(new Headers(options?.headers).get("chatgpt-account-id"), hint.expected ?? null);
      return probe();
    });
    const response = await submitJson(
      session,
      JSON.stringify({
        accessToken: candidate,
        account: hint.account,
        user: { id: accountId, email: unrelated },
        expires: "2099-01-01T00:00:00Z",
        refreshToken: unrelated,
        unknown: { value: unrelated },
      }),
    );
    assert.equal(response.status, 200);
    const result = await session.completion;
    assert.deepEqual(result, {
      status: "configured",
      hasAccountId: Boolean(hint.expected),
      archivePublicationOptIn: true,
    });
    const filename = path.join(home, "chatgpt_session.json");
    const raw = await readFile(filename, "utf8");
    const saved: unknown = JSON.parse(raw);
    assert.ok(typeof saved === "object" && saved !== null);
    assert.deepEqual(
      Object.keys(saved).sort(),
      [
        "accessToken",
        ...(hint.expected ? ["accountId"] : []),
        "archivePublicationOptIn",
        "schemaVersion",
        "updatedAt",
      ].sort(),
    );
    assert.ok(!raw.includes(unrelated), "Only minimal credential fields may be stored");
    assert.ok(
      !JSON.stringify(result).includes(candidate),
      "Completion must remain credential-free",
    );
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    assert.equal(calls, 1);
  }
});

test("session JSON, encoded form and stored credential use independent byte budgets", async (t) => {
  const { home } = await fixture(t);
  const candidate = '\"\\'.repeat(8192);
  let calls = 0;
  const session = await setup(t, home, async (_url, options) => {
    calls += 1;
    assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${candidate}`);
    return probe();
  });
  const skeleton = { accessToken: candidate, padding: "" };
  const overhead = Buffer.byteLength(JSON.stringify(skeleton));
  const input = JSON.stringify({ ...skeleton, padding: "%".repeat(256 * 1024 - overhead) });
  assert.equal(Buffer.byteLength(input), 256 * 1024);
  assert.ok(input.length > 16_384);
  const accepted = await submitJson(session, input);
  assert.equal(accepted.status, 200);
  assert.equal((await session.completion).status, "configured");
  const filename = path.join(home, "chatgpt_session.json");
  assert.ok((await stat(filename)).size < 64 * 1024);
  assert.equal((await chatgptStatus(home)).status, "configured");
  assert.equal(calls, 1);
  const before = digest(await readFile(filename));
  const retry = await setup(t, home, async () => {
    calls += 1;
    return probe();
  });
  for (const value of [
    input + " ",
    JSON.stringify({ accessToken: candidate, padding: "界".repeat(70_000) + "x".repeat(25_000) }),
  ]) {
    assert.ok(Buffer.byteLength(value) > 256 * 1024);
    assert.ok(
      Buffer.byteLength(
        new URLSearchParams({
          csrf: "x".repeat(64),
          sessionJson: value,
          consent: "yes",
        }).toString(),
      ) <=
        3 * 256 * 1024 + 1024,
      "The decoded input limit is tested independently of the form transport limit",
    );
    const response = await submitJson(retry, value);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /256 KiB limit/);
    assert.equal(calls, 1);
    assert.equal(digest(await readFile(filename)), before);
  }
  const details = await page(retry);
  const rejected = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpRequest(
      `${details.origin}/session`,
      {
        method: "POST",
        headers: {
          Origin: details.origin,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": 3 * 256 * 1024 + 1025,
        },
      },
      resolve,
    );
    request.once("error", reject);
    request.setTimeout(2_000, () => request.destroy(new Error("No response to oversized form")));
    // Wait for header rejection before writing a body the server will refuse to read.
    request.flushHeaders();
  });
  assert.equal(rejected.statusCode, 400);
  rejected.setEncoding("utf8");
  let rejection = "";
  for await (const chunk of rejected) rejection += chunk;
  assert.match(rejection, /form could not be read/);
  assert.equal(calls, 1);
  assert.equal(digest(await readFile(filename)), before);
  assert.equal((await submit(retry, tokenValue())).status, 200);
  assert.equal((await retry.completion).status, "configured");
});

test("cancel and rejected candidate preserve the previously stored credential", async (t) => {
  const { home } = await fixture(t);
  await seed(home);
  const before = digest(await readFile(path.join(home, "chatgpt_session.json")));
  const cancelled = await setup(t, home);
  const details = await page(cancelled);
  const response = await fetch(`${details.origin}/cancel`, {
    method: "POST",
    headers: { Origin: details.origin },
    body: new URLSearchParams({ csrf: details.csrf }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await cancelled.completion, { status: "skipped", reason: "setup_cancelled" });
  assert.equal(digest(await readFile(path.join(home, "chatgpt_session.json"))), before);
  const invalid = await setup(t, home, async () =>
    json({ error: "untrusted external error" }, 401),
  );
  const rejected = await submit(invalid, tokenValue());
  assert.equal(rejected.status, 400);
  assert.deepEqual(await invalid.completion, {
    status: "skipped",
    reason: "auth_rejected",
    canRefresh: true,
  });
  assert.equal(digest(await readFile(path.join(home, "chatgpt_session.json"))), before);
});

test("cancel during validation cannot commit later and a concurrent setup cannot mutate the session", async (t) => {
  const { home } = await fixture(t);
  await seed(home);
  const before = digest(await readFile(path.join(home, "chatgpt_session.json")));
  let probeStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    probeStarted = resolve;
  });
  let releaseProbe: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    releaseProbe = resolve;
  });
  const running = await setup(t, home, async () => {
    probeStarted();
    await blocked;
    return probe();
  });
  const second = await startChatgptSetup(home);
  assert.deepEqual(second, { status: "skipped", reason: "credentials_busy" });
  assert.deepEqual(await clearChatgptSession(home), {
    status: "skipped",
    reason: "credentials_busy",
  });
  const request = submit(running, tokenValue()).catch(() => undefined);
  await started;
  running.cancel();
  assert.deepEqual(await running.completion, { status: "skipped", reason: "setup_cancelled" });
  releaseProbe();
  await request;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(digest(await readFile(path.join(home, "chatgpt_session.json"))), before);
});

test("setup timeout is bounded and does not write credentials", async (t) => {
  const { home } = await fixture(t);
  const session = await startChatgptSetup(home, { setupTimeoutMs: 20 });
  if ("status" in session) assert.fail("Setup must start");
  assert.deepEqual(await session.completion, { status: "skipped", reason: "setup_timeout" });
  assert.deepEqual(await readdir(home), []);
});

test("unsafe credential files and symlink homes are refused without revealing or deleting them", async (t) => {
  const { base, home } = await fixture(t);
  const candidate = await seed(home);
  await chmod(path.join(home, "chatgpt_session.json"), 0o644);
  assert.deepEqual(await chatgptStatus(home), { status: "skipped", reason: "credentials_unsafe" });
  assert.deepEqual(await clearChatgptSession(home), {
    status: "skipped",
    reason: "credentials_unsafe",
  });
  await chmod(path.join(home, "chatgpt_session.json"), 0o600);
  const original = path.join(base, "original.json");
  await writeFile(original, await readFile(path.join(home, "chatgpt_session.json")), {
    mode: 0o600,
  });
  await rm(path.join(home, "chatgpt_session.json"));
  await symlink(original, path.join(home, "chatgpt_session.json"));
  assert.deepEqual(await chatgptStatus(home), { status: "skipped", reason: "credentials_unsafe" });
  const linkedHome = path.join(base, "linked-home");
  await symlink(home, linkedHome);
  assert.deepEqual(await startChatgptSetup(linkedHome), {
    status: "skipped",
    reason: "credentials_unsafe",
  });
  assert.ok(
    (await readFile(original, "utf8")).includes(candidate),
    "Refusal must preserve the original file",
  );
});

test("a FIFO credential path is rejected without blocking status or capture", async (t) => {
  const { home } = await fixture(t);
  const made = spawnSync("mkfifo", [path.join(home, "chatgpt_session.json")], {
    encoding: "utf8",
    timeout: 3_000,
  });
  if (made.error && "code" in made.error && made.error.code === "ENOENT") {
    t.skip("mkfifo is unavailable");
    return;
  }
  assert.equal(made.status, 0, "FIFO fixture must be created");
  const cli =
    process.env.AM_TEST_CHATGPT_SCRIPT ??
    fileURLToPath(new URL("../src/node/chatgpt.ts", import.meta.url));
  for (const args of [
    ["status", "--json"],
    ["capture", "--conversation", id, "--json"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      env: { ...process.env, AM_HOME: home },
      encoding: "utf8",
      timeout: 3_000,
    });
    assert.equal(result.status, 0, "FIFO rejection must finish before the deadline");
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "skipped",
      reason: "credentials_unsafe",
    });
  }
});

test("capture requires saved permission and clear removes the credentials", async (t) => {
  const { home } = await fixture(t);
  await seed(home, tokenValue(), false);
  const status = await chatgptStatus(home);
  assert.equal(status.status, "configured");
  if (status.status === "configured") assert.equal(status.archivePublicationOptIn, false);
  let calls = 0;
  assert.deepEqual(
    await captureChatgptConversation(
      { home, context: resolvedContext() },
      {
        fetch: async () => {
          calls += 1;
          return json(conversation());
        },
      },
    ),
    { status: "skipped", reason: "publication_not_enabled" },
  );
  assert.equal(calls, 0);
  assert.deepEqual(await clearChatgptSession(home), { status: "cleared" });
  assert.deepEqual(await chatgptStatus(home), { status: "skipped", reason: "credentials_missing" });
});

test("one capture freezes the untouched raw object and matching readable HTML", async (t) => {
  const { home } = await fixture(t);
  await seed(home);
  const raw = conversation();
  const original = structuredClone(raw);
  let calls = 0;
  const result = await captureChatgptConversation(
    { home, context: resolvedContext(`https://chatgpt.com/c/${id}`) },
    {
      fetch: async (url) => {
        calls += 1;
        assert.equal(String(url), `https://chatgpt.com/backend-api/conversation/${id}`);
        return json(raw);
      },
    },
  );
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  const frozen = await readConversationBundle(result.bundle);
  assert.deepEqual(JSON.parse(frozen.json.toString("utf8")), [original]);
  assert.deepEqual(raw, original);
  assert.match(frozen.html.toString("utf8"), /Frozen <strong>answer<\/strong>/);
  assert.doesNotMatch(frozen.html.toString("utf8"), /Hidden alternate branch/);
  assert.equal(calls, 1);
  await clearChatgptSession(home);
  assert.deepEqual(await readConversationBundle(result.bundle), frozen);
  assert.equal(calls, 1);
});

test("a payload without an ID remains semantically unchanged when fetched by an explicit ID", async (t) => {
  const { home } = await fixture(t);
  await seed(home);
  const { id: _unused, ...raw } = conversation();
  const result = await captureChatgptConversation(
    { home, context: resolvedContext() },
    { fetch: async () => json(raw) },
  );
  assert.equal(result.status, "captured");
  if (result.status === "captured") {
    const frozen = await readConversationBundle(result.bundle);
    assert.deepEqual(JSON.parse(frozen.json.toString("utf8")), [raw]);
    assert.equal("id" in JSON.parse(frozen.json.toString("utf8"))[0], false);
  }
});

test("authentication, permission, throttling, service and transport failures stay distinct and preserve credentials", async (t) => {
  const { home } = await fixture(t);
  const candidate = await seed(home);
  const before = digest(await readFile(path.join(home, "chatgpt_session.json")));
  for (const [status, reason] of [
    [401, "auth_rejected"],
    [403, "target_unavailable"],
    [404, "target_unavailable"],
    [429, "rate_limited"],
    [503, "service_unavailable"],
  ] satisfies [number, string][]) {
    const result = await captureChatgptConversation(
      { home, context: resolvedContext() },
      { fetch: async () => json({ error: candidate }, status) },
    );
    assert.equal(result.status, "skipped");
    if (result.status === "skipped") {
      assert.equal(result.reason, reason);
      assert.equal("canRefresh" in result, status === 401);
    }
    assert.ok(
      !JSON.stringify(result).includes(candidate),
      "External error contents must not reach status",
    );
    assert.equal(digest(await readFile(path.join(home, "chatgpt_session.json"))), before);
  }
  const result = await captureChatgptConversation(
    { home, context: resolvedContext() },
    {
      fetch: async () => {
        throw new Error(candidate);
      },
    },
  );
  assert.deepEqual(result, { status: "skipped", reason: "network_error" });
  const timed = await captureChatgptConversation(
    { home, context: resolvedContext() },
    { requestTimeoutMs: 10, fetch: async () => new Promise<Response>(() => undefined) },
  );
  assert.deepEqual(timed, { status: "skipped", reason: "network_error" });
});

test("redirect, size, content type, malformed JSON, mismatched ID and cycles cannot produce bundles", async (t) => {
  const { home } = await fixture(t);
  await seed(home);
  const wrong = conversation();
  wrong.id = accountId;
  const cyclic = conversation();
  cyclic.mapping.question.parent = "answer";
  const cases: [() => Response, string][] = [
    [
      () => new Response(null, { status: 302, headers: { location: "https://attacker.invalid/" } }),
      "response_redirected",
    ],
    [
      () =>
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": String(33 * 1024 * 1024),
          },
        }),
      "response_too_large",
    ],
    [() => new Response("{}", { headers: { "content-type": "text/html" } }), "response_invalid"],
    [
      () => new Response("{broken", { headers: { "content-type": "application/json" } }),
      "response_invalid",
    ],
    [() => json(wrong), "response_invalid"],
    [() => json(cyclic), "response_invalid"],
  ];
  for (const [response, reason] of cases) {
    const result = await captureChatgptConversation(
      { home, context: resolvedContext() },
      { fetch: async () => response() },
    );
    assert.equal(result.status, "skipped");
    if (result.status === "skipped") assert.equal(result.reason, reason);
  }
  assert.deepEqual(await readdir(home), ["chatgpt_session.json"]);
});

test("decoded raw strings and object keys containing the configured secret refuse the entire archive", async (t) => {
  const { home } = await fixture(t);
  const candidate = await seed(home);
  for (const secretInKey of [false, true]) {
    const raw = {
      ...conversation(),
      leak: secretInKey ? { [candidate]: "value" } : { nested: [candidate] },
    };
    let body = JSON.stringify(raw);
    body = body.replaceAll(
      candidate,
      [...candidate]
        .map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
        .join(""),
    );
    const result = await captureChatgptConversation(
      { home, context: resolvedContext() },
      {
        fetch: async () => new Response(body, { headers: { "content-type": "application/json" } }),
      },
    );
    assert.deepEqual(result, { status: "skipped", reason: "credential_leak" });
    assert.ok(
      !JSON.stringify(result).includes(candidate),
      "Leak refusal must not disclose the secret",
    );
  }
  assert.deepEqual(await readdir(home), ["chatgpt_session.json"]);
});

test("a response with an accessToken field is refused even when the value differs from the saved token", async (t) => {
  const { home } = await fixture(t);
  await seed(home);
  const result = await captureChatgptConversation(
    { home, context: resolvedContext() },
    {
      fetch: async () =>
        json({ ...conversation(), extra: { accessToken: "synthetic-other-secret" } }),
    },
  );
  assert.deepEqual(result, { status: "skipped", reason: "credential_leak" });
  assert.deepEqual(await readdir(home), ["chatgpt_session.json"]);
});

function imageConversation() {
  const raw = conversation();
  return {
    ...raw,
    mapping: {
      ...raw.mapping,
      answer: {
        ...raw.mapping.answer,
        message: {
          ...raw.mapping.answer.message,
          content: {
            content_type: "multimodal_text",
            parts: [
              "An image",
              { content_type: "image_asset_pointer", asset_pointer: "sediment://file-test" },
            ],
          },
        },
      },
    },
  };
}

test("image lookup authenticates only to ChatGPT and raster asset download is credential-free", async (t) => {
  const { home } = await fixture(t);
  const candidate = await seed(home);
  const raw = imageConversation();
  const observed: { host: string; auth: boolean; account: boolean; cookies: boolean }[] = [];
  const result = await captureChatgptConversation(
    { home, context: resolvedContext() },
    {
      fetch: async (url, options) => {
        const target = new URL(String(url));
        const headers = new Headers(options?.headers);
        observed.push({
          host: target.hostname,
          auth: headers.has("authorization") || headers.has("x-authorization"),
          account: headers.has("chatgpt-account-id"),
          cookies: headers.has("cookie"),
        });
        assert.equal(options?.redirect, "manual");
        assert.equal(options?.credentials, "omit");
        if (target.pathname.includes("/conversation/")) return json(raw);
        if (target.pathname.includes("/files/download/")) {
          assert.ok(
            headers.get("authorization") === `Bearer ${candidate}`,
            "File lookup must use the configured credential",
          );
          return json({
            status: "success",
            download_url: "https://files.oaiusercontent.com/image.png?signature=synthetic",
          });
        }
        return new Response(png, { headers: { "content-type": "image/png" } });
      },
    },
  );
  assert.equal(result.status, "captured");
  assert.deepEqual(observed, [
    { host: "chatgpt.com", auth: true, account: false, cookies: false },
    { host: "chatgpt.com", auth: true, account: false, cookies: false },
    { host: "files.oaiusercontent.com", auth: false, account: false, cookies: false },
  ]);
  if (result.status === "captured") {
    const frozen = await readConversationBundle(result.bundle);
    assert.deepEqual(JSON.parse(frozen.json.toString("utf8")), [raw]);
    assert.match(frozen.html.toString("utf8"), /data:image\/png;base64,/);
  }
});

test("unsafe asset origins, redirects, SVG and oversized images remain visible placeholders", async (t) => {
  const { home } = await fixture(t);
  await seed(home);
  const cases: [string, () => Response, boolean][] = [
    ["https://127.0.0.1/image.png", () => new Response(png), false],
    ["https://attacker.invalid/image.png", () => new Response(png), false],
    ["https://files.oaiusercontent.com.attacker.invalid/image.png", () => new Response(png), false],
    [
      "https://files.oaiusercontent.com/image.png",
      () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }),
      true,
    ],
    [
      "https://files.oaiusercontent.com/image.png",
      () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
      true,
    ],
    [
      "https://files.oaiusercontent.com/image.png",
      () =>
        new Response("small", {
          headers: { "content-type": "image/png", "content-length": String(9 * 1024 * 1024) },
        }),
      true,
    ],
  ];
  for (const [url, asset, expectedDownload] of cases) {
    let downloads = 0;
    const result = await captureChatgptConversation(
      { home, context: resolvedContext() },
      {
        fetch: async (request) => {
          const target = String(request);
          if (target.includes("/conversation/")) return json(imageConversation());
          if (target.includes("/files/download/"))
            return json({ status: "success", download_url: url });
          downloads += 1;
          return asset();
        },
      },
    );
    assert.equal(result.status, "captured");
    assert.equal(downloads, expectedDownload ? 1 : 0);
    if (result.status === "captured") {
      assert.ok(result.warnings.includes("image_unavailable"));
      const frozen = await readConversationBundle(result.bundle);
      assert.doesNotMatch(frozen.html.toString("utf8"), /<img[^>]+src="https?:/);
      assert.match(frozen.html.toString("utf8"), /unavailable|not available|Unsupported/i);
    }
  }
});

test("CLI status and capture skip without opening secret entry, and unknown secret flags are rejected", async (t) => {
  const { home } = await fixture(t);
  const cli =
    process.env.AM_TEST_CHATGPT_SCRIPT ??
    fileURLToPath(new URL("../src/node/chatgpt.ts", import.meta.url));
  for (const args of [
    ["status", "--json"],
    ["capture", "--conversation", id, "--json"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      env: { ...process.env, AM_HOME: home },
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "skipped",
      reason: "credentials_missing",
    });
    assert.equal(result.stderr, "");
  }
  const invalid = spawnSync(
    process.execPath,
    [cli, "setup", "--token", "not-a-credential", "--json"],
    { env: { ...process.env, AM_HOME: home }, encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(invalid.status, 2);
  assert.deepEqual(JSON.parse(invalid.stdout), { status: "skipped", reason: "input_invalid" });
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /not-a-credential/);
});

test("CLI rejects oversized or malformed host context without echoing its contents", async (t) => {
  const { home } = await fixture(t);
  const cli =
    process.env.AM_TEST_CHATGPT_SCRIPT ??
    fileURLToPath(new URL("../src/node/chatgpt.ts", import.meta.url));
  for (const input of ['{"provider":"unique-marker"', '"' + "unique-marker".repeat(2000) + '"']) {
    const result = spawnSync(process.execPath, [cli, "capture", "--host-context", "--json"], {
      input,
      env: { ...process.env, AM_HOME: home },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "skipped",
      reason: "conversation_context_invalid",
    });
    assert.doesNotMatch(result.stdout + result.stderr, /unique-marker/);
  }
});

test("asset URLs cannot carry the configured credential through percent encoding", async (t) => {
  const { home } = await fixture(t);
  const token = await seed(home);
  const original = conversation();
  const raw = {
    ...original,
    mapping: {
      ...original.mapping,
      answer: {
        ...original.mapping.answer,
        message: {
          ...original.mapping.answer.message,
          content: {
            content_type: "multimodal_text",
            parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file-leak" }],
          },
        },
      },
    },
  };
  const percent = (value: string) =>
    [...value].map((character) => "%" + character.charCodeAt(0).toString(16)).join("");
  for (const encoded of [
    token,
    percent(token),
    percent(token[0]) + token.slice(1),
    encodeURIComponent(percent(token)),
  ]) {
    let externalRequests = 0;
    const result = await captureChatgptConversation(
      { home, context: resolvedContext() },
      {
        fetch: async (input) => {
          const url = new URL(String(input));
          if (url.pathname.startsWith("/backend-api/conversation/")) return json(raw);
          if (url.pathname.startsWith("/backend-api/files/download/"))
            return json({
              status: "success",
              download_url: "https://files.oaiusercontent.com/picture.png?credential=" + encoded,
            });
          externalRequests += 1;
          return new Response(png, { headers: { "content-type": "image/png" } });
        },
      },
    );
    assert.deepEqual(result, { status: "skipped", reason: "credential_leak" });
    assert.equal(externalRequests, 0);
  }
});
