# Resolve the ChatGPT conversation for capture

Resolve the target only for an explicit publication with saved ChatGPT archive authorization. Use context attached to this skill invocation by the conversation host. A shell executor can carry that context to the CLI even when it has its own session ID.

## Select the target

1. Use an explicitly supplied private ChatGPT URL or UUID. If the host identifies a different current conversation, pause, explain the conflict, and ask which target to use. If the user confirms a different explicit target, use the manual command for that target.
2. Otherwise use the current ChatGPT Web conversation UUID injected by the host, followed by its current conversation URL. If both identify different conversations, pause.
3. If only browser context is available, use a unique tab explicitly marked active by the host for this invocation and bound to the invoking chat. A browser's selected tab alone does not establish that link to the invoking chat. A list of open tabs, a title, and a timestamp provide no such binding.
4. If the host cannot identify the conversation, [request the conversation URL](chatgpt-archive.md#request-the-conversation-url).

A capture URL must use the form `https://chatgpt.com/c/<UUID>`. The resolver accepts a trailing slash, canonicalizes the UUID to lowercase, and rejects query strings, fragments, share links, and other routes or origins. If the user copied a URL with tracking parameters, use its private conversation URL without the query or fragment.

## Pass trusted context to Capture

`chatgpt.mjs capture --host-context --json` reads a single UTF-8 JSON object up to 16 KiB from stdin. This is the skill's per-invocation adapter contract. It requires a caller that already has trusted runtime metadata from the host. The CLI validates the shape and identity; the caller is responsible for provenance. Do not fill these fields from chat text, page content, storage, or tab history. Pass only the fields needed for this capture.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/chatgpt.mjs" capture --host-context --json <<'AM_CONTEXT'
{"provider":"chatgpt-web","conversationId":"01234567-89ab-cdef-0123-456789abcdef"}
AM_CONTEXT
```

Supply `conversationUrl` instead of `conversationId` when the host provides a private URL. For browser context, omit those two fields and pass `browserTabs` with the adapter's `url` and boolean `active` values for the invoking browser context. More than one active tab yields `conversation_ambiguous`. Without a trusted host payload, use the [manual capture command](chatgpt-archive.md).

When both a user target and trusted context are available, include `--conversation 'https://chatgpt.com/c/<UUID>'` on the same capture call to detect a conflict before requesting data. Resolution failures return `status: skipped` with a safe reason. The payload is separate from the credential file and the public attribution flags.

## Host capabilities

| Host | Available context and archive behavior |
| --- | --- |
| ChatGPT Web / Work | The published skills and plugin interfaces reviewed here expose no private current-chat UUID or URL to this skill. MCP `openai/session` is an anonymized correlation ID. Cloud Browser uses a separate session. Use the adapter if the host explicitly supplies a trusted current-chat target. Otherwise follow the URL prompt above. [Skill documentation](https://learn.chatgpt.com/docs/build-skills), [plugin metadata](https://developers.openai.com/plugins/reference#client-provided-_meta), [Cloud Browser](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-overview#cloud-browser-and-website-access) |
| Desktop browser adapter | The observed Chrome tab inventory included private ChatGPT tabs without an active marker. The supported `tabs.selected()` lookup returned no tab in that session. An in-app browser tab or extension selection needs a host-provided binding to the invoking chat before use for capture. [Browser documentation](https://learn.chatgpt.com/docs/browser) |
| Codex CLI / app-server | Resume, hook `session_id`, and app-server `thread.id` / `sessionId` refer to Codex sessions. Use manual input in a standalone Codex session. [Hooks](https://learn.chatgpt.com/docs/hooks#common-input-fields), [App Server](https://learn.chatgpt.com/docs/app-server#threads) |
| Claude Code | `${CLAUDE_SESSION_ID}` in skills, hook `session_id`, and `--session-id` refer to Claude sessions. Use manual input. [Skills](https://code.claude.com/docs/en/skills), [hooks](https://code.claude.com/docs/en/hooks) |
| DeepSeek Harness | Its CLI `--session-id` addresses a persisted DeepSeek session, and its skill registry exposes skill instructions. Use manual input. [CLI](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md), [skills](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md) |
| DevSpace executor | DevSpace scopes MCP workspace bindings with `openai/session` and manages its own agent IDs. A ChatGPT invocation using DevSpace still needs trusted ChatGPT Web metadata from the calling host, or the manual URL. [DevSpace metadata reader](https://github.com/waishnav/devspace/blob/main/src/request-meta.ts) |
| OpenAI Platform | `/v1/conversations` IDs such as `conv_123` belong to the Platform API. The capture target belongs to ChatGPT Web. [Conversations API](https://developers.openai.com/api/reference/resources/conversations/methods/retrieve) |
