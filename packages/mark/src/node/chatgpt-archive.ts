import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { writeConversationBundle } from "./conversation-bundle.ts";
import { CHATGPT_ORIGIN as API_ORIGIN, isUuid } from "./conversation-context.ts";
import type { ConversationContext } from "./conversation-context.ts";
import {
  conversationImageReferences,
  renderConversation,
  validateConversation,
} from "./chatgpt-render.ts";
import {
  CredentialFailure,
  SESSION_NAME,
  hasCode,
  isRecord,
  isToken,
  privateHome,
  readSession,
  safeStatus,
  sessionFile,
} from "./chatgpt-session.ts";
import type { Configured, CredentialFailureReason, Session } from "./chatgpt-session.ts";

const PROBE_URL = `${API_ORIGIN}/backend-api/conversations?offset=0&limit=1`;
const LOCK_NAME = ".chatgpt-session.lock";
const MAX_SESSION_INPUT_BYTES = 256 * 1024;
const MAX_FORM_BYTES = 3 * MAX_SESSION_INPUT_BYTES + 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_HTML_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_IMAGES = 12;

export type SkipReason =
  | CredentialFailureReason
  | "credentials_busy"
  | "setup_cancelled"
  | "setup_timeout"
  | "input_invalid"
  | "publication_not_enabled"
  | "auth_rejected"
  | "target_unavailable"
  | "rate_limited"
  | "service_unavailable"
  | "network_error"
  | "response_redirected"
  | "response_too_large"
  | "response_invalid"
  | "credential_leak";

export type Skipped =
  | { status: "skipped"; reason: Exclude<SkipReason, "auth_rejected"> }
  | { status: "skipped"; reason: "auth_rejected"; canRefresh: true };

export type SetupResult = Configured | Skipped;
export type CaptureResult = { status: "captured"; bundle: string; warnings: string[] } | Skipped;

export interface ChatGPTDependencies {
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  setupTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface SetupSession {
  url: string;
  completion: Promise<SetupResult>;
  cancel(): void;
}

class SafeFailure extends Error {
  readonly reason: SkipReason;

  constructor(reason: SkipReason) {
    super(reason);
    this.reason = reason;
  }
}

function skipped(reason: SkipReason): Skipped {
  return reason === "auth_rejected"
    ? { status: "skipped", reason, canRefresh: true }
    : { status: "skipped", reason };
}

function failure(error: unknown, fallback: SkipReason): Skipped {
  return skipped(
    error instanceof SafeFailure || error instanceof CredentialFailure ? error.reason : fallback,
  );
}

type SessionInput =
  | { kind: "valid"; session: Pick<Session, "accessToken" | "accountId"> }
  | { kind: "invalid"; message: string };

function parseSessionInput(input: string): SessionInput {
  if (Buffer.byteLength(input, "utf8") > MAX_SESSION_INPUT_BYTES) {
    return { kind: "invalid", message: "The session JSON exceeds the 256 KiB limit." };
  }
  const text = input.trim();
  if (!text) {
    return {
      kind: "invalid",
      message: "Paste the complete session JSON response, including its braces.",
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    if (isToken(text) && !text.startsWith("{")) {
      return {
        kind: "invalid",
        message: "Paste the complete session JSON response, including its braces.",
      };
    }
    return {
      kind: "invalid",
      message: "The session JSON is malformed. Copy the complete response again.",
    };
  }
  if (!isRecord(value)) {
    return {
      kind: "invalid",
      message: "The session JSON must be an object containing accessToken.",
    };
  }
  if (!isToken(value.accessToken)) {
    return {
      kind: "invalid",
      message: "The session JSON must contain a valid accessToken string.",
    };
  }
  const accountId =
    isRecord(value.account) && isUuid(value.account.id) ? value.account.id : undefined;
  return {
    kind: "valid",
    session: { accessToken: value.accessToken, ...(accountId ? { accountId } : {}) },
  };
}

async function acquireSessionLock(home: string): Promise<() => Promise<void>> {
  const lock = path.join(home, LOCK_NAME);
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (hasCode(error, "EEXIST")) throw new SafeFailure("credentials_busy");
    throw error;
  }
  return async () => {
    await rmdir(lock);
  };
}

async function saveSession(home: string, session: Session): Promise<void> {
  try {
    const previous = await sessionFile(home);
    await previous.close();
  } catch (error) {
    if (!(error instanceof CredentialFailure && error.reason === "credentials_missing"))
      throw error;
  }
  const temporary = path.join(home, `.chatgpt-session-${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      await handle.chmod(0o600);
      await handle.writeFile(JSON.stringify(session) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path.join(home, SESSION_NAME));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function clearChatgptSession(home: string): Promise<{ status: "cleared" } | Skipped> {
  let release: (() => Promise<void>) | undefined;
  try {
    await privateHome(home, false);
    release = await acquireSessionLock(home);
    const handle = await sessionFile(home);
    await handle.close();
    await unlink(path.join(home, SESSION_NAME));
    return { status: "cleared" };
  } catch (error) {
    return failure(error, "storage_unavailable");
  } finally {
    await release?.().catch(() => undefined);
  }
}

function statusFailure(status: number): SkipReason {
  if (status === 401) return "auth_rejected";
  if (status === 403 || status === 404) return "target_unavailable";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "service_unavailable";
  return "response_invalid";
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const advertised = response.headers.get("content-length");
  if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > limit)) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeFailure("response_too_large");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new SafeFailure("response_too_large");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function requestBytes(
  url: string,
  headers: Record<string, string>,
  dependencies: ChatGPTDependencies,
  limit: number,
  json: boolean,
): Promise<{ bytes: Buffer; contentType: string }> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      abort.abort();
      reject(new SafeFailure("setup_cancelled"));
    };
    if (dependencies.signal?.aborted) cancel();
    else dependencies.signal?.addEventListener("abort", cancel, { once: true });
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new SafeFailure("network_error"));
    }, dependencies.requestTimeoutMs ?? 20_000);
  });
  try {
    const work = async () => {
      const response = await (dependencies.fetch ?? globalThis.fetch)(url, {
        method: "GET",
        headers,
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: abort.signal,
      });
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400) ||
        (response.url !== "" && response.url !== url)
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new SafeFailure("response_redirected");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new SafeFailure(statusFailure(response.status));
      }
      const contentType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (json && !/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new SafeFailure("response_invalid");
      }
      return { bytes: await boundedBody(response, limit), contentType };
    };
    return await Promise.race([work(), deadline, cancelled]);
  } catch (error) {
    if (error instanceof SafeFailure) throw error;
    throw new SafeFailure("network_error");
  } finally {
    if (timer) clearTimeout(timer);
    if (cancel) dependencies.signal?.removeEventListener("abort", cancel);
    abort.abort();
  }
}

function sessionHeaders(session: Session): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${session.accessToken}`,
    "X-Authorization": `Bearer ${session.accessToken}`,
    ...(session.accountId ? { "Chatgpt-Account-Id": session.accountId } : {}),
  };
}

async function apiJson(
  url: string,
  session: Session,
  dependencies: ChatGPTDependencies,
  limit = MAX_JSON_BYTES,
): Promise<unknown> {
  if (new URL(url).origin !== API_ORIGIN || !url.startsWith(`${API_ORIGIN}/backend-api/`)) {
    throw new SafeFailure("input_invalid");
  }
  const response = await requestBytes(url, sessionHeaders(session), dependencies, limit, true);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.bytes));
  } catch {
    throw new SafeFailure("response_invalid");
  }
}

function validProbe(raw: unknown): boolean {
  return (
    isRecord(raw) &&
    Array.isArray(raw.items) &&
    raw.items.every(
      (item: unknown) => isRecord(item) && isUuid(item.id) && typeof item.title === "string",
    ) &&
    typeof raw.limit === "number" &&
    Number.isSafeInteger(raw.limit) &&
    raw.limit >= 0 &&
    typeof raw.offset === "number" &&
    Number.isSafeInteger(raw.offset) &&
    raw.offset >= 0 &&
    (raw.total === null ||
      (typeof raw.total === "number" && Number.isSafeInteger(raw.total) && raw.total >= 0))
  );
}

function setupHtml(csrf: string, error?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Configure ChatGPT conversation capture</title><style nonce="${csrf}">body{font:16px system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem;line-height:1.5}label{display:block;margin:1rem 0}input[type=password],input[type=text]{display:block;width:100%;box-sizing:border-box;padding:.65rem}button{padding:.65rem 1rem;margin-right:1rem}small{display:block}</style></head><body>
<h1>Optional ChatGPT conversation capture</h1>
<p>Paste the complete ChatGPT session JSON response here. Only the access token and an optional account ID are saved in an owner-only local file after validation. It is separate from Vercel settings.</p>
<p>In your own signed-in browser, open <a href="https://chatgpt.com/api/auth/session?utm_source=chatgpt.com" target="_blank" rel="noreferrer noopener">your ChatGPT session</a> and copy the entire JSON response into this form, including its braces. Do not send the response or token to an agent.</p>
<p>Enabling this option allows later explicitly requested publications to attach the ChatGPT conversation selected by trusted host context or a private URL.</p>
<p id="archive-disclosure">To resume work in a new agent session, provide the downloaded archive as context.
<strong>The archive includes the full, unredacted conversation JSON.</strong>
It can include conversation branches, tool arguments, and sensitive information. The raw JSON and a readable HTML copy will be available to your site's audience without asking again. Share only conversations you intend this audience to see.</p>
<p>Run the clear command to disable future attachments. Cancelling preserves any existing authorization.</p>
${error ? `<p role="alert">${error} Existing settings were preserved. You can try again below.</p>` : ""}
<form method="post" action="/session" autocomplete="off">
<input type="hidden" name="csrf" value="${csrf}">
<label>Complete ChatGPT session JSON response<input type="password" name="sessionJson" required maxlength="${MAX_SESSION_INPUT_BYTES}" autocomplete="off" spellcheck="false"></label>
<label><input type="checkbox" name="consent" value="yes" required aria-describedby="archive-disclosure"> Allow conversation archive attachments on later explicitly requested publications to the site's audience.</label>
<button type="submit">Validate and enable conversation sharing</button>
</form>
<form method="post" action="/cancel"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Cancel capture setup</button></form>
<p><small>Paste the session JSON only into this local form. Never paste it into a chat, command argument, environment variable, or tool form.</small></p>
</body></html>`;
}

function localResponse(response: ServerResponse, status: number, csrf: string, body: string): void {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${csrf}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    Connection: "close",
  });
  response.end(body);
}

async function formBody(request: IncomingMessage): Promise<URLSearchParams> {
  if (
    request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/x-www-form-urlencoded"
  ) {
    throw new SafeFailure("input_invalid");
  }
  const advertised = request.headers["content-length"];
  if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_FORM_BYTES)) {
    throw new SafeFailure("input_invalid");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) throw new SafeFailure("input_invalid");
    size += chunk.byteLength;
    if (size > MAX_FORM_BYTES) throw new SafeFailure("input_invalid");
    chunks.push(chunk);
  }
  return new URLSearchParams(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)),
  );
}

function singleHeader(request: IncomingMessage, name: string): boolean {
  let count = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i].toLowerCase() === name) count += 1;
  }
  return count === 1;
}

export async function startChatgptSetup(
  home: string,
  dependencies: ChatGPTDependencies = {},
): Promise<SetupSession | Skipped> {
  let release: (() => Promise<void>) | undefined;
  try {
    await privateHome(home, true);
    release = await acquireSessionLock(home);
  } catch (error) {
    return failure(error, "storage_unavailable");
  }
  const csrf = randomBytes(32).toString("hex");
  let state: "waiting" | "validating" | "committing" | "finished" = "waiting";
  let resolveCompletion: (result: SetupResult) => void = () => undefined;
  const completion = new Promise<SetupResult>((resolve) => {
    resolveCompletion = resolve;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let host = "";
  let origin = "";
  const setupAbort = new AbortController();
  const currentState = () => state;
  const finish = (result: SetupResult) => {
    if (state === "finished") return;
    state = "finished";
    if (timer) clearTimeout(timer);
    setupAbort.abort();
    server.close();
    server.closeIdleConnections();
    setImmediate(() => server.closeAllConnections());
    void release?.()
      .catch(() => undefined)
      .finally(() => resolveCompletion(result));
  };
  const server = createServer((request, response) => {
    request.setTimeout(5_000, () => request.destroy());
    void (async () => {
      if (!singleHeader(request, "host") || request.headers.host !== host) {
        localResponse(response, 400, csrf, "Invalid local request.");
        return;
      }
      if (request.method === "GET" && request.url?.split("?", 1)[0] === `/setup/${csrf}`) {
        localResponse(response, 200, csrf, setupHtml(csrf));
        return;
      }
      if (
        request.method !== "POST" ||
        (request.url !== "/session" && request.url !== "/cancel") ||
        !singleHeader(request, "origin") ||
        request.headers.origin !== origin ||
        (request.headers["sec-fetch-site"] !== undefined &&
          request.headers["sec-fetch-site"] !== "same-origin")
      ) {
        localResponse(response, 403, csrf, "Invalid local request.");
        return;
      }
      const form = await formBody(request);
      if (form.getAll("csrf").length !== 1 || form.get("csrf") !== csrf) {
        localResponse(response, 403, csrf, "Invalid local request.");
        return;
      }
      if (
        state === "committing" ||
        state === "finished" ||
        (state === "validating" && request.url !== "/cancel")
      ) {
        localResponse(response, 409, csrf, "A setup request is already being processed.");
        return;
      }
      if (request.url === "/cancel") {
        response.once("finish", () => finish(skipped("setup_cancelled")));
        localResponse(
          response,
          200,
          csrf,
          "Setup cancelled. Existing settings were preserved. You may close this tab.",
        );
        return;
      }
      if (
        form.getAll("sessionJson").length !== 1 ||
        form.has("token") ||
        form.has("accountId") ||
        form.getAll("consent").length !== 1 ||
        form.get("consent") !== "yes"
      ) {
        localResponse(
          response,
          400,
          csrf,
          setupHtml(
            csrf,
            "Submit one complete session JSON response and allow conversation sharing.",
          ),
        );
        return;
      }
      const parsed = parseSessionInput(form.get("sessionJson") ?? "");
      if (parsed.kind === "invalid") {
        localResponse(response, 400, csrf, setupHtml(csrf, parsed.message));
        return;
      }
      state = "validating";
      const candidate: Session = {
        schemaVersion: 1,
        ...parsed.session,
        archivePublicationOptIn: true,
        updatedAt: new Date().toISOString(),
      };
      let result: SetupResult;
      try {
        const probe = await apiJson(
          PROBE_URL,
          candidate,
          { ...dependencies, signal: setupAbort.signal },
          1024 * 1024,
        );
        if (!validProbe(probe)) throw new SafeFailure("response_invalid");
        if (currentState() !== "validating") return;
        state = "committing";
        if (timer) clearTimeout(timer);
        await saveSession(home, candidate);
        result = safeStatus(candidate);
      } catch (error) {
        if (currentState() === "finished") return;
        result = failure(error, "storage_unavailable");
      }
      response.once("finish", () => finish(result));
      localResponse(
        response,
        result.status === "configured" ? 200 : 400,
        csrf,
        result.status === "configured"
          ? "ChatGPT capture settings saved. You may close this tab."
          : "The candidate could not be validated or saved. Existing settings were preserved. You may close this tab.",
      );
    })().catch(() => {
      if (!response.headersSent) {
        localResponse(
          response,
          400,
          csrf,
          setupHtml(
            csrf,
            "The local form could not be read. Submit a complete session JSON response within the size limit.",
          ),
        );
      } else response.end();
    });
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.maxHeadersCount = 30;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new SafeFailure("storage_unavailable");
    host = `127.0.0.1:${address.port}`;
    origin = `http://${host}`;
    timer = setTimeout(
      () => {
        if (state !== "committing") finish(skipped("setup_timeout"));
      },
      dependencies.setupTimeoutMs ?? 5 * 60_000,
    );
    return {
      url: `${origin}/setup/${csrf}`,
      completion,
      cancel: () => {
        if (state !== "committing") finish(skipped("setup_cancelled"));
      },
    };
  } catch (error) {
    server.close();
    await release().catch(() => undefined);
    return failure(error, "storage_unavailable");
  }
}

function containsSecret(raw: unknown, token: string): boolean {
  const pending: unknown[] = [raw];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string" && value.includes(token)) return true;
    if (Array.isArray(value)) for (const item of value) pending.push(item);
    else if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (key === "accessToken" || key.includes(token)) return true;
        pending.push(item);
      }
    }
  }
  return false;
}

function rasterMatches(bytes: Buffer, contentType: string): boolean {
  switch (contentType) {
    case "image/png":
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg":
      return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/gif":
      return /^(GIF87a|GIF89a)$/.test(bytes.subarray(0, 6).toString("ascii"));
    case "image/webp":
      return (
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP"
      );
    default:
      return false;
  }
}

function safeAssetUrl(raw: string, token: string): string | undefined {
  let decoded = raw;
  for (let depth = 0; depth < 4; depth += 1) {
    if (decoded.includes(token)) throw new SafeFailure("credential_leak");
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return undefined;
    }
    if (next === decoded) break;
    if (depth === 3) return undefined;
    decoded = next;
  }
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !(url.hostname === "oaiusercontent.com" || url.hostname.endsWith(".oaiusercontent.com"))
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

async function resolveImage(
  pointer: string,
  session: Session,
  dependencies: ChatGPTDependencies,
): Promise<{ bytes: Buffer; contentType: string } | undefined> {
  if (pointer.startsWith("data:")) {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      pointer,
    );
    if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return undefined;
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.toString("base64").replace(/=+$/, "") !== match[2].replace(/=+$/, ""))
      return undefined;
    return rasterMatches(bytes, match[1]) ? { bytes, contentType: match[1] } : undefined;
  }
  const match = /^(?:sediment|file-service):\/\/([A-Za-z0-9_-]{1,160})$/.exec(pointer);
  if (!match) return undefined;
  const details = await apiJson(
    `${API_ORIGIN}/backend-api/files/download/${encodeURIComponent(match[1])}?post_id=&inline=false`,
    session,
    dependencies,
    64 * 1024,
  );
  if (!isRecord(details) || details.status === "error" || typeof details.download_url !== "string")
    return undefined;
  const url = safeAssetUrl(details.download_url, session.accessToken);
  if (!url) return undefined;
  const asset = await requestBytes(
    url,
    { Accept: "image/png,image/jpeg,image/gif,image/webp" },
    dependencies,
    MAX_IMAGE_BYTES,
    false,
  );
  if (!rasterMatches(asset.bytes, asset.contentType)) return undefined;
  return asset;
}

export async function captureChatgptConversation(
  options: { home: string; context: ConversationContext },
  dependencies: ChatGPTDependencies = {},
): Promise<CaptureResult> {
  const id = options.context.conversationId;
  try {
    const session = await readSession(options.home);
    if (session.archivePublicationOptIn !== true) return skipped("publication_not_enabled");
    const raw = await apiJson(
      `${API_ORIGIN}/backend-api/conversation/${id}`,
      session,
      dependencies,
    );
    if (containsSecret(raw, session.accessToken)) throw new SafeFailure("credential_leak");
    let conversation;
    try {
      conversation = validateConversation(raw, id);
    } catch {
      throw new SafeFailure("response_invalid");
    }
    const images = new Map<string, string>();
    const warnings = new Set<string>();
    const pointers = conversationImageReferences(conversation);
    let imageBytes = 0;
    for (const [index, pointer] of pointers.entries()) {
      if (index >= MAX_IMAGES) {
        warnings.add("image_limit_exceeded");
        continue;
      }
      try {
        const asset = await resolveImage(pointer, session, dependencies);
        if (!asset) {
          warnings.add("image_unavailable");
          continue;
        }
        if (asset.bytes.includes(Buffer.from(session.accessToken)))
          throw new SafeFailure("credential_leak");
        imageBytes += asset.bytes.length;
        if (imageBytes > MAX_IMAGE_TOTAL_BYTES) {
          warnings.add("image_limit_exceeded");
          continue;
        }
        images.set(pointer, `data:${asset.contentType};base64,${asset.bytes.toString("base64")}`);
      } catch (error) {
        if (error instanceof SafeFailure && error.reason === "credential_leak") throw error;
        warnings.add("image_unavailable");
      }
    }
    let rendered;
    try {
      rendered = renderConversation(conversation, { images });
    } catch {
      throw new SafeFailure("response_invalid");
    }
    const json = Buffer.from(JSON.stringify([raw], null, 2) + "\n", "utf8");
    if (json.length > MAX_JSON_BYTES || rendered.html.length > MAX_HTML_BYTES)
      throw new SafeFailure("response_too_large");
    if (
      json.includes(Buffer.from(session.accessToken)) ||
      rendered.html.includes(Buffer.from(session.accessToken))
    ) {
      throw new SafeFailure("credential_leak");
    }
    for (const warning of rendered.warnings) warnings.add(warning);
    const bundle = await writeConversationBundle(options.home, { json, html: rendered.html });
    return { status: "captured", bundle, warnings: [...warnings].sort() };
  } catch (error) {
    return failure(error, "storage_unavailable");
  }
}
