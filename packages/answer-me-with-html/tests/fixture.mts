import { after } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleSkill } from "../scripts/assemble.mjs";

export const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
let fixture: Promise<string> | undefined;
export function skillFixture(): Promise<string> {
  fixture ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "am-compiled-skill-"));
    const assets = await assembleSkill(dir);
    await writeFile(join(dir, ".renderer-assets.json"), JSON.stringify(assets));
    return dir;
  })();
  return fixture;
}
after(async () => {
  if (fixture) await rm(await fixture, { recursive: true, force: true });
});
