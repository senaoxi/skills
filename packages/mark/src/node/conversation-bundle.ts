import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ConversationBytes {
  json: Buffer;
  html: Buffer;
}

const limits = { json: 32 * 1024 * 1024, html: 64 * 1024 * 1024 };
const names = ["conversation.json", "conversation.html", "manifest.json"];
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const invalid = () => new Error("Conversation bundle is missing, invalid, or modified.");

function bounded(bytes: ConversationBytes) {
  if (
    !Buffer.isBuffer(bytes.json) ||
    !Buffer.isBuffer(bytes.html) ||
    !bytes.json.length ||
    !bytes.html.length ||
    bytes.json.length > limits.json ||
    bytes.html.length > limits.html
  )
    throw invalid();
}

export async function writeConversationBundle(
  home: string,
  bytes: ConversationBytes,
): Promise<string> {
  bounded(bytes);
  const directory = path.join(home, "conversation-captures");
  let bundle: string | undefined;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory()) throw invalid();
    bundle = await mkdtemp(path.join(directory, "capture-"));
    await writeFile(path.join(bundle, "conversation.json"), bytes.json, {
      mode: 0o400,
      flag: "wx",
    });
    await writeFile(path.join(bundle, "conversation.html"), bytes.html, {
      mode: 0o400,
      flag: "wx",
    });
    await writeFile(
      path.join(bundle, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, json: digest(bytes.json), html: digest(bytes.html) }) +
        "\n",
      { mode: 0o400, flag: "wx" },
    );
    return bundle;
  } catch {
    if (bundle) await rm(bundle, { recursive: true, force: true }).catch(() => {});
    throw invalid();
  }
}

export async function readConversationBundle(directory: string): Promise<ConversationBytes> {
  try {
    if (!(await lstat(directory)).isDirectory()) throw invalid();
    const entries = await readdir(directory, { withFileTypes: true });
    if (
      entries.length !== names.length ||
      entries.some((entry) => !entry.isFile() || !names.includes(entry.name))
    )
      throw invalid();
    const read = async (name: string, limit: number) => {
      const file = await open(
        path.join(directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const information = await file.stat();
        if (!information.isFile() || information.size > limit) throw invalid();
        const bytes = await file.readFile();
        if (bytes.length > limit) throw invalid();
        return bytes;
      } finally {
        await file.close();
      }
    };
    const manifest: unknown = JSON.parse((await read("manifest.json", 4096)).toString("utf8"));
    if (
      !manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      !("schemaVersion" in manifest) ||
      manifest.schemaVersion !== 1 ||
      !("json" in manifest) ||
      !("html" in manifest) ||
      Object.keys(manifest).length !== 3
    )
      throw invalid();
    const bytes = {
      json: await read("conversation.json", limits.json),
      html: await read("conversation.html", limits.html),
    };
    bounded(bytes);
    if (digest(bytes.json) !== manifest.json || digest(bytes.html) !== manifest.html)
      throw invalid();
    return bytes;
  } catch {
    throw invalid();
  }
}
