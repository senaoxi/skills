# Capture an optional ChatGPT archive

Use this guide to configure local ChatGPT credentials or attach a conversation archive to an explicitly requested publication. Ordinary HTML answers do not trigger capture.

## Set up or update local credentials

Start the helper in a retained background session. Keep its handle so you can read the final result of this setup attempt.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/chatgpt.mjs" setup --json
```

Give the user the `url` from the `setup_ready` event. The user opens that localhost page, then opens [their signed-in ChatGPT session](https://chatgpt.com/api/auth/session?utm_source=chatgpt.com) in their own browser. Ask them to copy the complete JSON response into the single masked local input. Do not ask them to extract `accessToken` or enter an account ID. Bare tokens are not accepted.

The agent must not open or inspect the session endpoint response, or automate or inspect credential entry. Never put session JSON or its secrets in chat, host or MCP forms, tool arguments, CLI arguments, environment variables, logs, or publication artifacts. Start the helper and read only its safe status.

Before the user submits, explain that the token is a privileged account login credential. The helper uses authenticated GET requests, but that does not make the credential read-only. Explain that archive capture is optional and show the [archive disclosure](#explain-archive-sharing) before the user authorizes it. The local form also displays the archive disclosure.

### Wait for the user to finish setup

1. After showing the `setup_ready` link, offer a native completion button, such as **Done**, and ask the user to select it after the local form reports a successful save. With `request_user_input_async`, offer the completion action alone. With `request_user_input` or `AskUserQuestion`, add a cancellation option, such as **Cancel setup**.
2. When a choice tool is unavailable, ask the user to reply in chat after saving the form. When awaiting the reply after a text prompt or a non-blocking tool call, end the turn with setup pending and keep the helper running. Resume on the user's reply.
3. Each time the user indicates completion, run the `status --json` command below for the same resolved `AM_HOME` and briefly poll the retained helper for its final result. Only after both this setup attempt and the fresh status report `status: configured` with `archivePublicationOptIn: true`, report that setup is complete, for example with **Configured**, and proceed.
4. Handle the check result before continuing.
   - If the user cancels in chat, stop the active helper through its cancellation path and report its result. A `setup_cancelled` result ends this step.
   - If the helper is still running and setup is pending, tell the user, reuse the form link, and offer the completion button again or use the same text fallback.
   - If the helper has ended and the check fails, report the safe reason, restart setup when possible, and repeat the interaction with the new link.

### How setup saves credentials

The helper parses the complete JSON locally and extracts the top-level `accessToken`. It uses `account.id` only as an optional account hint when that value is a UUID. It never uses `user.id`. Missing or invalid account hints do not block a probe without an account header. There is no manual account ID field. Invalid JSON or a missing or invalid `accessToken` produces a field-specific error without echoing the input. Ask the user to retry with the complete JSON in the local form.

The helper probes the candidate with a fixed-origin authenticated GET and validates the response before saving it. A successful conversation-list probe establishes authentication for that request. It does not prove access to every conversation. The helper atomically saves a minimal credential record with mode `0600` on POSIX systems to `$AM_HOME/chatgpt_session.json`. The record contains the schema version, access token, optional account ID, sharing consent, and timestamp. It never stores the raw session JSON, user information, `expires`, other secrets, or unrelated fields. The default path is `~/.agents/.mark/chatgpt_session.json`. This file is separate from Vercel settings and must stay out of reviews, journals, catalogs, uploads, and diagnostics.

The local form asks once for permission to attach the full conversation on later explicitly requested publications. A successful save records that permission as `archivePublicationOptIn: true`. Reuse this permission without asking again. A legacy credential without it does not authorize publication.

### Inspect or remove credentials

Run `setup` again to update credentials with a fresh complete session JSON response. Existing minimal credential records remain usable. Cancellation or a rejected candidate preserves any previous credential. Inspect or remove the saved credential with:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/chatgpt.mjs" status --json
node "${CLAUDE_SKILL_DIR}/scripts/chatgpt.mjs" clear --json
```

Status does not expose the token. Removing it does not remove an archive already published to Vercel.

## Select the conversation and capture once

Read safe credential status first. When `archivePublicationOptIn` is true, reuse that authorization and resolve the target through [trusted host context or explicit input](chatgpt-host-context.md). Authorization and target selection are independent. Without credentials or with a legacy credential that has no opt-in, proceed to ordinary article Review without running Capture.

When the target is missing or ambiguous, [request the conversation URL](#request-the-conversation-url). If two targets conflict, explain the conflict, show the [archive disclosure](#explain-archive-sharing), and ask which target to use with the same article-only option. Pass a private URL or UUID that the user supplies to the manual capture command.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/chatgpt.mjs" capture \
  --conversation 'https://chatgpt.com/c/CONVERSATION_UUID' --json
```

The command returns `status: captured` and an immutable `bundle` directory, or `status: skipped` and a safe reason. Retain a successful bundle for every Review of that selection. Capture runs before Review. Publish, gallery rebuild, and recovery use frozen bytes.

Handle unsuccessful capture by cause:

| Condition | Next action |
| --- | --- |
| `conversation_missing` or `conversation_ambiguous` | [Request the conversation URL](#request-the-conversation-url). |
| `conversation_conflict`, `conversation_context_invalid`, or `input_invalid` | Explain the target or context issue and resolve it before Capture. |
| `auth_rejected` (HTTP 401) | Offer the separate local `setup` update. If the user refreshes authentication, retry the failed capture once. |
| `target_unavailable` (HTTP 403 or 404) | Report the access or availability failure. Check the target and the account's access. |
| `rate_limited`, `network_error`, or `service_unavailable` | Report the failure. Retry at most once after the transient condition clears. |
| Invalid, redirected, oversized, or credential-bearing API response | Report the specific reason. The capture attempt produced no publishable archive. |
| `storage_unavailable` or an unreadable credential record | Resolve the reported local failure before retrying. |

After a failed capture of an opted-in archive, ask the user before continuing with the article alone. Keep a successful bundle if Review or Publish needs a retry. Bearer-token access can vary by account, target permissions, and server challenges.

### Request the conversation URL

Show an editable native URL or free-text field directly in the initial prompt. Ask the user to paste the private `https://chatgpt.com/c/<UUID>` link from the address bar of the current ChatGPT conversation. When the host supports action labels, make submitting the URL the primary action.

Show the [archive disclosure](#explain-archive-sharing) beside the URL field, or in the chat message immediately before the prompt if the host cannot include it. With chat-only input, show the disclosure in the same message as the URL request and before the article-only option.

Offer article-only publication as a separate, unselected secondary action. If the host can only show a free-text field, describe that choice in the field's help and accept an explicit article-only request in the same field. If the host has no suitable input field, ask the user to paste the URL in chat and offer article-only publication on the next line.

Wait for a valid target or an explicit article-only choice before continuing. For the article-only choice, use `--article-only` on both Review and Publish for this publication.

## Explain archive sharing

Use these facts for the archive disclosure.

- A downloaded archive can supply the previous conversation as context when attached to a new agent session.
- The raw JSON contains the full, unredacted conversation data returned by ChatGPT. It can include conversation branches, tool parameters, and sensitive information.
- After publication, anyone who can access the site can download both the raw JSON and the readable HTML.

## Review and publish the frozen archive

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" review /absolute/path/article.html \
  --slug topic-name --conversation-bundle /absolute/path/captured-bundle --json
```

Read every selected resource path returned by review. Inspect the exact outgoing article, editable download, raw JSON, and archive HTML for the site's audience. The returned digest covers the selected bytes. The JSON may include branches and tool arguments that the readable HTML does not display. Do not limit review to the visible current branch.

Then follow [Vercel snapshot delivery](vercel-shared.md) with the returned digest:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/publish.mjs" publish /absolute/path/article.html \
  --slug topic-name --reviewed-sha256 REVIEWED_SHA256 --json
```

`publish` uses the frozen review selection. It can publish a reviewed archive or recover a saved snapshot without loading ChatGPT credential status. A matching `--conversation-bundle` can be passed for caller compatibility. If any selected content changes, run Review again with the appropriate bundle. A Review and Publish without archive resources check saved opt-in unless the user chose `--article-only` on both commands.

The article and gallery link to `conversations/<slug>.json` and `conversations/<slug>.html`. Replacing a page without a new bundle removes that page's previous conversation resources. Other pages retain their archives. A captured bundle alone does not authorize publication.

## Understand what the files contain

The JSON is an array containing the untouched API conversation object. It preserves all returned branches, tool metadata, and initial MCP arguments. The HTML follows the current node's parent chain and renders the supported visible branch. It includes interactive-message Markdown fallback, citations, and supported embedded images. Unsupported content or unavailable images can use placeholders.

The archive is a snapshot of content stored by the server at capture time. It excludes later messages and the later publication result. It does not guarantee restoration of arbitrary MCP widgets or a native ChatGPT session. Keep the raw JSON for data that the readable HTML cannot represent.
