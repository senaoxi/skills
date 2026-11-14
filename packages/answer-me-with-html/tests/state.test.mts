import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, writeState } from "../src/node/state.mjs";

test("a malformed subsystem entry never discards valid state or future extensions", async () => {
  const home = await mkdtemp(join(tmpdir(), "am-state-regression-"));
  try {
    const state = {
      firstSeen: 1,
      latestVersion: "9.0.0",
      catalogThemes: { invalid: "x" },
      futureExtension: { keep: true },
    };
    await writeFile(join(home, "state.json"), JSON.stringify(state));
    assert.deepEqual(readState(home), state);
    assert.deepEqual(writeState(home, { lastClean: 2 }), { ...state, lastClean: 2 });
    const persisted: unknown = JSON.parse(await readFile(join(home, "state.json"), "utf8"));
    assert.deepEqual(persisted, { ...state, lastClean: 2 });
    await writeFile(join(home, "state.json"), "null");
    assert.deepEqual(readState(home), {});
    await writeFile(join(home, "state.json"), "{bad");
    assert.deepEqual(readState(home), {});
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
