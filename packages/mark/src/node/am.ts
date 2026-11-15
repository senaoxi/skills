#!/usr/bin/env node
import { errorMessage, isRecord } from "./sys.ts";
import { main, oldNodeHint } from "./cli.ts";

// background: allow the background check for a new version (not triggered when tests call main directly).
main(process.argv.slice(2), { background: true, scriptPath: process.argv[1] }).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(
      `✗ Internal error: ${isRecord(err) && typeof err.stack === "string" ? err.stack : errorMessage(err)}\n`,
    );
    const hint = oldNodeHint();
    if (hint) process.stderr.write(`  ${hint}\n`);
    process.exitCode = 1;
  },
);
