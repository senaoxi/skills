import { after } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleSkill } from "../scripts/assemble.ts";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
let fixture: Promise<string> | undefined;
export function skillFixture(): Promise<string> {
  fixture ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "mark-test-skill-"));
    try {
      const assets = await assembleSkill(packageRoot, dir);
      await writeFile(join(dir, ".renderer-assets.json"), JSON.stringify(assets));
      return dir;
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  })();
  return fixture;
}
after(async () => {
  const dir = await fixture?.catch(() => undefined);
  if (dir) await rm(dir, { recursive: true, force: true });
});
