import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveConversationContext } from "../src/node/conversation-context.ts";

const id = "01234567-89ab-cdef-0123-456789abcdef";
const other = "89abcdef-0123-4567-89ab-cdef01234567";
const url = (value = id) => `https://chatgpt.com/c/${value}`;
const host = (fields: object) => ({ provider: "chatgpt-web", ...fields });
const selected = (source: string, value = id) => ({
  status: "resolved",
  context: { provider: "chatgpt-web", source, conversationId: value, conversationUrl: url(value) },
});
const unresolved = (reason: string) => ({ status: "unresolved", reason });

test("explicit UUID and private URL use the same canonical ChatGPT target", () => {
  for (const explicit of [id, id.toUpperCase(), url(), url(id.toUpperCase()) + "/"]) {
    assert.deepEqual(resolveConversationContext({ explicit }), selected("user-input"));
  }
});

test("rejects other identities and URLs outside the private conversation route", () => {
  for (const explicit of [
    "",
    "latest",
    "01234567-89ab-cdef-0123-456789abcdeg",
    id + "\n",
    `conv_${id}`,
    `thr_${id}`,
    `https://chatgpt.com/share/${id}`,
    `https://chatgpt.com/local/${id}`,
    `https://chatgpt.com/backend-api/conversation/${id}`,
    `https://example.com/c/${id}`,
    `https://chatgpt.com.example.com/c/${id}`,
    `https://user@chatgpt.com/c/${id}`,
    `https://chatgpt.com:8443/c/${id}`,
    `http://chatgpt.com/c/${id}`,
    `https://chatgpt.com/share/../c/${id}`,
    `https://chatgpt.com/C/${id}`,
    url() + "?utm_source=example",
    url() + "?",
    url() + "#fragment",
    url() + "#",
  ]) {
    assert.deepEqual(
      resolveConversationContext({ explicit, hostContext: host({ conversationId: id }) }),
      unresolved("input_invalid"),
      explicit,
    );
  }
});

test("current host UUID and URL take priority over the active browser tab", () => {
  const browserTabs = [{ active: true, url: url(other) }];
  for (const fields of [
    { conversationId: id.toUpperCase(), browserTabs },
    { conversationUrl: url(), browserTabs },
    { conversationId: id, conversationUrl: url(id.toUpperCase()), browserTabs },
  ]) {
    assert.deepEqual(
      resolveConversationContext({ hostContext: host(fields) }),
      selected("host-context"),
    );
  }
  assert.deepEqual(
    resolveConversationContext({ hostContext: host({ conversationId: url() }) }),
    unresolved("conversation_context_invalid"),
  );
  assert.deepEqual(
    resolveConversationContext({ hostContext: host({ conversationUrl: id }) }),
    unresolved("conversation_context_invalid"),
  );
});

test("active-tab selection requires one explicitly active tab in the invoking browser context", () => {
  const recent = { url: url(other), lastOpened: "2099-01-01", title: "Current conversation" };
  for (const browserTabs of [
    [recent],
    [recent, { url: url() }],
    [recent, { active: "true", url: url() }],
  ]) {
    assert.deepEqual(
      resolveConversationContext({ hostContext: host({ browserTabs }) }),
      unresolved("conversation_missing"),
    );
  }
  assert.deepEqual(
    resolveConversationContext({
      hostContext: host({ browserTabs: [recent, { active: true, url: url() }] }),
    }),
    selected("browser-active-tab"),
  );
  for (const second of [url(other), "https://example.com/", url()]) {
    assert.deepEqual(
      resolveConversationContext({
        hostContext: host({
          browserTabs: [
            { active: true, url: url() },
            { active: true, url: second },
          ],
        }),
      }),
      unresolved("conversation_ambiguous"),
    );
  }
  assert.deepEqual(
    resolveConversationContext({
      hostContext: host({ browserTabs: [recent, { active: true, url: "https://example.com/" }] }),
    }),
    unresolved("conversation_missing"),
  );
});

test("explicit selection wins after identity agreement and reports contradictory current context", () => {
  assert.deepEqual(
    resolveConversationContext({ explicit: url(), hostContext: host({ conversationId: id }) }),
    selected("user-input"),
  );
  for (const fields of [
    { conversationId: other },
    { conversationUrl: url(other) },
    { browserTabs: [{ active: true, url: url(other) }] },
    { conversationId: id, conversationUrl: url(other) },
  ]) {
    assert.deepEqual(
      resolveConversationContext({ explicit: id, hostContext: host(fields) }),
      unresolved("conversation_conflict"),
    );
  }
  assert.deepEqual(
    resolveConversationContext({
      explicit: url(),
      hostContext: host({
        browserTabs: [
          { active: true, url: url() },
          { active: true, url: url(other) },
        ],
      }),
    }),
    selected("user-input"),
  );
});

test("hosts without usable context leave only the manual target available", () => {
  for (const hostContext of [undefined, null, host({}), host({ session_id: id })]) {
    assert.deepEqual(
      resolveConversationContext({ hostContext }),
      unresolved("conversation_missing"),
    );
    assert.deepEqual(
      resolveConversationContext({ explicit: id, hostContext }),
      selected("user-input"),
    );
  }
  for (const provider of ["codex", "claude-code", "deepseek", "devspace", "platform"]) {
    assert.deepEqual(
      resolveConversationContext({ hostContext: { provider, conversationId: id } }),
      unresolved("conversation_context_invalid"),
    );
  }
  assert.deepEqual(
    resolveConversationContext({
      hostContext: host({ conversationId: id, conversationUrl: url(other) }),
    }),
    unresolved("conversation_conflict"),
  );
});
