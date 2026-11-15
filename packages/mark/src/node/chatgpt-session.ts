import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { isUuid } from "./conversation-context.ts";

export const SESSION_NAME = "chatgpt_session.json";
const MAX_SESSION_FILE_BYTES = 64 * 1024;
const MAX_TOKEN_BYTES = 16_384;

export interface Session {
  schemaVersion: 1;
  accessToken: string;
  accountId?: string;
  archivePublicationOptIn?: boolean;
  updatedAt: string;
}

export interface Configured {
  status: "configured";
  hasAccountId: boolean;
  archivePublicationOptIn: boolean;
}

export type CredentialFailureReason =
  | "credentials_missing"
  | "credentials_invalid"
  | "credentials_unsafe"
  | "storage_unavailable";

export class CredentialFailure extends Error {
  readonly reason: CredentialFailureReason;

  constructor(reason: CredentialFailureReason) {
    super(reason);
    this.reason = reason;
  }
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= MAX_TOKEN_BYTES &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

function isSession(value: unknown): value is Session {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    isToken(value.accessToken) &&
    (value.accountId === undefined || isUuid(value.accountId)) &&
    (value.archivePublicationOptIn === undefined ||
      typeof value.archivePublicationOptIn === "boolean") &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    new Date(value.updatedAt).toISOString() === value.updatedAt
  );
}

export function safeStatus(session: Session): Configured {
  return {
    status: "configured",
    hasAccountId: Boolean(session.accountId),
    archivePublicationOptIn: session.archivePublicationOptIn === true,
  };
}

export async function privateHome(home: string, create: boolean): Promise<void> {
  if (create) await mkdir(home, { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(home, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error, "ENOENT")) throw new CredentialFailure("credentials_missing");
    if (hasCode(error, "ELOOP") || hasCode(error, "ENOTDIR"))
      throw new CredentialFailure("credentials_unsafe");
    throw error;
  }
  try {
    let info = await handle.stat();
    if (!info.isDirectory() || info.uid !== process.getuid?.())
      throw new CredentialFailure("credentials_unsafe");
    if (create && (info.mode & 0o7777) !== 0o700) {
      await handle.chmod(0o700);
      info = await handle.stat();
    }
    const current = await lstat(home);
    if (
      current.isSymbolicLink() ||
      current.ino !== info.ino ||
      current.dev !== info.dev ||
      (info.mode & 0o7777) !== 0o700
    ) {
      throw new CredentialFailure("credentials_unsafe");
    }
  } finally {
    await handle.close();
  }
}

export async function sessionFile(home: string) {
  const filename = path.join(home, SESSION_NAME);
  try {
    const handle = await open(
      filename,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        info.nlink !== 1 ||
        (info.mode & 0o7777) !== 0o600 ||
        info.size > MAX_SESSION_FILE_BYTES
      ) {
        throw new CredentialFailure("credentials_unsafe");
      }
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  } catch (error) {
    if (hasCode(error, "ENOENT")) throw new CredentialFailure("credentials_missing");
    if (hasCode(error, "ELOOP")) throw new CredentialFailure("credentials_unsafe");
    throw error;
  }
}

export async function readSession(home: string): Promise<Session> {
  await privateHome(home, false);
  const handle = await sessionFile(home);
  try {
    const raw: unknown = JSON.parse(await handle.readFile("utf8"));
    if (!isSession(raw)) throw new CredentialFailure("credentials_invalid");
    return raw;
  } catch (error) {
    if (error instanceof SyntaxError) throw new CredentialFailure("credentials_invalid");
    throw error;
  } finally {
    await handle.close();
  }
}

export async function chatgptStatus(
  home: string,
): Promise<Configured | { status: "skipped"; reason: CredentialFailureReason }> {
  try {
    await lstat(path.join(home, SESSION_NAME));
    return safeStatus(await readSession(home));
  } catch (error) {
    return {
      status: "skipped",
      reason:
        error instanceof CredentialFailure
          ? error.reason
          : hasCode(error, "ENOENT")
            ? "credentials_missing"
            : "storage_unavailable",
    };
  }
}
