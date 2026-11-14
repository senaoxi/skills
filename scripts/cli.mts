import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { syncGlobalSkills } from "./global-skills.mjs";
import { manageRepository } from "./skills.mjs";
import type { AddCommand, AvailableCommand, Command } from "./manager-types.mjs";
import { errorMessage } from "./manager-shared.mjs";

const help = `Manage this repository's skills.

  pnpm skills sync
  pnpm skills sync --global [--mode copy|symlink]
  pnpm skills add SOURCE (--skill SELECTOR)... [--ref REF]
  pnpm skills add SOURCE --all [--ref REF]
  pnpm skills remove NAME...
  pnpm skills remove --source SOURCE_ID
  pnpm skills list
  pnpm skills list --available SOURCE [--ref REF]
  pnpm skills help

Git sources require a concrete ref. Existing exact sources reuse their ref.
Local sources must stay inside this repository and are saved as relative paths.
Add rejects active origins and installed-name collisions. Use pnpm skills sync to refresh.
Remove uses canonical installed names from list. Batches succeed together.
Sync --global copies skills/ to ~/.agents/skills by default and prompts before overwriting same-named entries.
No subcommand prints this help.
`;
class UsageError extends Error {}
function usage(message: string): never {
  throw new UsageError(`${message}\nRun pnpm skills help for usage.`);
}
function value(args: readonly string[], index: number, flag: string): string {
  const result = args[index + 1];
  if (!result || result.startsWith("--")) usage(`${flag} requires a value`);
  return result;
}
export function parseCommand(args: readonly string[]): Command {
  if (!args.length) return { type: "help" };
  const [verb, ...rest] = args;
  if (["help", "--help", "-h"].includes(verb)) {
    if (rest.length) usage("help takes no arguments");
    return { type: "help" };
  }
  if (verb === "sync") {
    if (!rest.length) return { type: "sync" };
    if (rest[0] === "--global") {
      if (rest.length === 1) return { type: "sync-global", mode: "copy" };
      const [, flag, mode] = rest;
      if (rest.length === 3 && flag === "--mode" && (mode === "copy" || mode === "symlink"))
        return { type: "sync-global", mode };
    }
    usage("sync accepts only --global [--mode copy|symlink]");
  }
  if (verb === "add") {
    const [source, ...flags] = rest;
    if (!source || source.startsWith("-")) usage("add requires one source");
    const command: AddCommand = { type: "add", source, skills: [], all: false };
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      if (flag === "--skill") command.skills.push(value(flags, i++, flag));
      else if (flag === "--ref" && command.ref === undefined) command.ref = value(flags, i++, flag);
      else if (flag === "--all" && !command.all) command.all = true;
      else usage(`Unknown or repeated argument ${flag}`);
    }
    if (command.all === Boolean(command.skills.length))
      usage("add needs either --all or one or more --skill values");
    if (new Set(command.skills).size !== command.skills.length) usage("Repeated --skill selector");
    if (command.skills.includes("*")) usage("Use --all instead of --skill '*'");
    return command;
  }
  if (verb === "remove") {
    if (rest[0] === "--source" && rest.length === 2 && !rest[1].startsWith("-"))
      return { type: "remove", sourceId: rest[1] };
    if (
      !rest.length ||
      rest.some((name) => name.startsWith("-")) ||
      new Set(rest).size !== rest.length
    )
      usage("remove needs installed names or --source SOURCE_ID");
    return { type: "remove", names: rest };
  }
  if (verb === "list") {
    if (!rest.length) return { type: "list" };
    if (rest[0] !== "--available") usage("list accepts only --available SOURCE [--ref REF]");
    const command: AvailableCommand = { type: "available", source: value(rest, 0, "--available") };
    if (rest.length === 4 && rest[2] === "--ref") command.ref = value(rest, 2, "--ref");
    else if (rest.length !== 2) usage("list accepts only --available SOURCE [--ref REF]");
    return command;
  }
  usage(`Unknown command ${verb}`);
}

export async function executeCli(args: readonly string[], cwd = process.cwd()): Promise<string> {
  const command = parseCommand(args);
  if (command.type === "help") return help;
  if (command.type === "sync-global") {
    const destination = join(homedir(), ".agents", "skills");
    const count = await syncGlobalSkills({
      source: join(cwd, "skills"),
      destination,
      mode: command.mode,
      confirm: confirmGlobalSync,
    });
    if (count === null) return "Global skill sync cancelled.";
    if (count === 0) return "No skill directories found in skills/.";
    return `Synced ${count} skills to ${destination} (${command.mode}).`;
  }

  if (command.type === "list") return JSON.stringify(await manageRepository(cwd, command), null, 2);
  if (command.type === "available")
    return JSON.stringify(await manageRepository(cwd, command), null, 2);
  const result = await manageRepository(cwd, command);

  return `Managed ${result.skills} skills from ${result.sources} sources. Updated skills-sources.json, skills/, skills-lock.json and LICENSE.`;
}

async function confirmGlobalSync(destination: string): Promise<boolean> {
  process.stderr.write(
    `This will overwrite same-named skills in the global skills directory ${destination}.\nContinue? [y/N] `,
  );
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const answer of input) return /^(y|yes)$/i.test(answer.trim());
    return false;
  } finally {
    input.close();
  }
}

async function runCli(args: string[]): Promise<void> {
  try {
    if (!process.env.NODE_USE_ENV_PROXY) {
      await restartWithProxyDefault(args);
      return;
    }
    console.log(await executeCli(args));
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

async function restartWithProxyDefault(args: string[]): Promise<void> {
  // Node configures its proxy agents before loading the entry module.
  const child = spawn(process.execPath, [...process.execArgv, import.meta.filename, ...args], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const listeners = signals.map((signal) => {
    const forward = (): void => {
      child.kill(signal);
    };
    process.on(signal, forward);
    return { signal, forward };
  });
  let status: { code: number | null; signal: NodeJS.Signals | null };
  try {
    status = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    for (const { signal, forward } of listeners) process.off(signal, forward);
  }
  if (status.signal) process.kill(process.pid, status.signal);
  else process.exitCode = status.code ?? 1;
}

function isDirectCliExecution(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === import.meta.filename;
  } catch {
    return false;
  }
}

if (isDirectCliExecution()) await runCli(process.argv.slice(2));
