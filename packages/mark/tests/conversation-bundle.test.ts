import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  readConversationBundle,
  writeConversationBundle,
} from "../src/node/conversation-bundle.ts";

const bytes = {
  json: Buffer.from('[{"id":"selected","mapping":{}}]\n'),
  html: Buffer.from("<!doctype html><p>Conversation</p>"),
};

test("capture bundles preserve both byte streams in distinct private directories", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "am-bundle-"));
  try {
    const first = await writeConversationBundle(home, bytes);
    const second = await writeConversationBundle(home, bytes);
    assert.notEqual(first, second);
    assert.deepEqual((await readdir(first)).sort(), [
      "conversation.html",
      "conversation.json",
      "manifest.json",
    ]);
    assert.deepEqual(await readConversationBundle(first), bytes);
    assert.deepEqual(await readConversationBundle(second), bytes);
    if (process.platform !== "win32") {
      assert.equal((await stat(first)).mode & 0o777, 0o700);
      for (const file of await readdir(first))
        assert.equal((await stat(path.join(first, file))).mode & 0o777, 0o400);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("capture bundle readers reject corruption, extra resources, symlinks and unsupported manifests", async (t) => {
  for (const mode of [
    "json",
    "html",
    "missing",
    "extra",
    "file-link",
    "directory-link",
    "version",
    "manifest-fields",
  ]) {
    await t.test(mode, async () => {
      const home = await mkdtemp(path.join(tmpdir(), "am-bundle-"));
      try {
        let directory = await writeConversationBundle(home, bytes);
        if (mode === "json" || mode === "html") {
          const file = path.join(directory, "conversation." + mode);
          await chmod(file, 0o600);
          await writeFile(file, "mutated");
        } else if (mode === "missing") {
          await rm(path.join(directory, "conversation.html"));
        } else if (mode === "extra") {
          await writeFile(path.join(directory, "chatgpt_session.json"), "synthetic-private-value");
        } else if (mode === "file-link") {
          const outside = path.join(home, "outside.html");
          await writeFile(outside, bytes.html);
          await rm(path.join(directory, "conversation.html"));
          await symlink(outside, path.join(directory, "conversation.html"));
        } else if (mode === "directory-link") {
          const link = path.join(home, "linked");
          await symlink(directory, link, "dir");
          directory = link;
        } else {
          const file = path.join(directory, "manifest.json");
          const manifest = JSON.parse(await readFile(file, "utf8"));
          if (mode === "version") manifest.schemaVersion = 2;
          else manifest.extra = "synthetic-private-value";
          await chmod(file, 0o600);
          await writeFile(file, JSON.stringify(manifest));
        }
        await assert.rejects(readConversationBundle(directory), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Conversation bundle is missing, invalid, or modified.");
          return true;
        });
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });
  }
});

test("capture bundle limits reject empty and oversized input before creating a capture", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "am-bundle-"));
  try {
    await assert.rejects(writeConversationBundle(home, { ...bytes, json: Buffer.alloc(0) }));
    await assert.rejects(
      writeConversationBundle(home, { ...bytes, json: Buffer.alloc(32 * 1024 * 1024 + 1) }),
    );
    await assert.rejects(stat(path.join(home, "conversation-captures")), { code: "ENOENT" });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
