#!/usr/bin/env node
import { resolve } from "node:path";
import {
  captureChatgptConversation,
  clearChatgptSession,
  startChatgptSetup,
} from "./chatgpt-archive.ts";
import { chatgptStatus } from "./chatgpt-session.ts";
import { amHome } from "./home.ts";
import { readHostContext } from "./chatgpt-host-context.ts";
import { resolveConversationContext } from "./conversation-context.ts";

function output(result: unknown): void {
  process.stdout.write(JSON.stringify(result) + "\n");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  let conversation: string | undefined;
  let json = false;
  let hostContext = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json" && !json) json = true;
    else if (argument === "--host-context" && !hostContext) hostContext = true;
    else if (
      argument === "--conversation" &&
      conversation === undefined &&
      args[index + 1] !== undefined &&
      !args[index + 1].startsWith("--")
    ) {
      conversation = args[++index];
    } else {
      output({ status: "skipped", reason: "input_invalid" });
      process.exitCode = 2;
      return;
    }
  }
  if (command !== "capture" && (conversation !== undefined || hostContext)) {
    output({ status: "skipped", reason: "input_invalid" });
    process.exitCode = 2;
    return;
  }
  const home = resolve(amHome());
  switch (command) {
    case "status":
      output(await chatgptStatus(home));
      return;
    case "clear":
      output(await clearChatgptSession(home));
      return;
    case "capture": {
      const host = hostContext ? await readHostContext(process.stdin) : undefined;
      if (host?.status === "invalid") {
        output({ status: "skipped", reason: "conversation_context_invalid" });
        return;
      }
      const selected = resolveConversationContext({
        explicit: conversation,
        hostContext: host?.value,
      });
      if (selected.status === "unresolved") {
        output({ status: "skipped", reason: selected.reason });
        return;
      }
      output(await captureChatgptConversation({ home, context: selected.context }));
      return;
    }
    case "setup": {
      const setup = await startChatgptSetup(home);
      if ("status" in setup) {
        output(setup);
        return;
      }
      output({ event: "setup_ready", url: setup.url });
      process.once("SIGINT", setup.cancel);
      process.once("SIGTERM", setup.cancel);
      const result = await setup.completion;
      process.removeListener("SIGINT", setup.cancel);
      process.removeListener("SIGTERM", setup.cancel);
      output(result);
      return;
    }
    default:
      output({ status: "skipped", reason: "input_invalid" });
      process.exitCode = 2;
  }
}

main().catch(() => {
  output({ status: "skipped", reason: "storage_unavailable" });
  process.exitCode = 1;
});
