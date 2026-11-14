import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { assertNativeCompilerEvidence } from "./compiler-evidence.mjs";
import { argumentsFor, entrypoint, json } from "./toolchain-core.mjs";
import { compileReceiptPath, recordBuild } from "./toolchain-compile.mjs";

await entrypoint(import.meta.url, async () => {
  const args = argumentsFor(process.argv.slice(2), []);
  if (args.positional.length)
    throw new Error("Usage: record-build (only after successful native compilation)");
  await rm(resolve(process.cwd(), compileReceiptPath), { force: true });
  const root = process.cwd();
  process.stdout.write(json(await recordBuild(root, () => assertNativeCompilerEvidence(root))));
});
