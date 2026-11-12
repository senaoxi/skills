import { manageRepository } from "./skills.mjs";

const help = `Manage this repository's external skills.

  pnpm skills sync
  pnpm skills add SOURCE (--skill SELECTOR)... [--ref REF]
  pnpm skills add SOURCE --all [--ref REF]
  pnpm skills remove NAME...
  pnpm skills remove --source SOURCE_ID
  pnpm skills list
  pnpm skills list --available SOURCE [--ref REF]
  pnpm skills help

Git sources require a concrete ref. Existing exact sources reuse their ref.
Add rejects active origins and installed-name collisions. Use pnpm skills sync to refresh.
Remove uses canonical installed names from list. Batches succeed together.
No subcommand prints this help.
`;
class UsageError extends Error {}
function usage(message) {
  throw new UsageError(`${message}\nRun pnpm skills help for usage.`);
}
function value(args, index, flag) {
  const result = args[index + 1];
  if (!result || result.startsWith("--")) usage(`${flag} requires a value`);
  return result;
}
export function parseCommand(args) {
  if (!args.length) return { type: "help" };
  const [verb, ...rest] = args;
  if (["help", "--help", "-h"].includes(verb)) {
    if (rest.length) usage("help takes no arguments");
    return { type: "help" };
  }
  if (verb === "sync") {
    if (rest.length) usage("sync takes no arguments");
    return { type: "sync" };
  }
  if (verb === "add") {
    const [source, ...flags] = rest;
    if (!source || source.startsWith("-")) usage("add requires one source");
    const command = { type: "add", source, skills: [], all: false };
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
    const command = { type: "available", source: value(rest, 0, "--available") };
    if (rest.length === 4 && rest[2] === "--ref") command.ref = value(rest, 2, "--ref");
    else if (rest.length !== 2) usage("list accepts only --available SOURCE [--ref REF]");
    return command;
  }
  usage(`Unknown command ${verb}`);
}

try {
  const command = parseCommand(process.argv.slice(2));
  if (command.type === "help") console.log(help);
  else {
    const result = await manageRepository(process.cwd(), command);
    if (command.type === "list" || command.type === "available")
      console.log(JSON.stringify(result, null, 2));
    else
      console.log(
        `Managed ${result.skills} skills from ${result.sources} sources. Updated skills-sources.json, skills/, skills-lock.json and LICENSE.`,
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
