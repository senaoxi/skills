import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateConversation,
  conversationImageReferences,
  renderConversation,
} from "../src/node/chatgpt-render.ts";

type Entry = { id: string; parent?: string | null; children?: string[]; message: unknown };
const msg = (text: string, extra: Record<string, unknown> = {}) => ({
  author: { role: "assistant" },
  content: { content_type: "text", parts: [text] },
  ...extra,
});
function conversation(entries: Entry[], current = entries.at(-1)?.id) {
  return {
    id: "fixture-id",
    title: "Fixture",
    current_node: current,
    mapping: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
  };
}
const node = (
  id: string,
  parent: string | null,
  message: unknown,
  children: string[] = [],
): Entry => ({ id, parent, children, message });
const root = () => node("root", null, null, ["user"]);
const user = () =>
  node("user", "root", msg("Question <img src=x onerror=alert(1)>", { author: { role: "user" } }));
function html(raw: unknown, images?: ReadonlyMap<string, string>) {
  return renderConversation(validateConversation(raw), { images }).html.toString();
}

test("only the active ancestry and visible transcript enter HTML, raw branches and MCP parameters remain intact", () => {
  const raw = conversation([
    root(),
    user(),
    node("old", "user", msg("OTHER BRANCH")),
    node("system", "user", msg("SYSTEM SECRET", { author: { role: "system" } })),
    node(
      "hidden",
      "system",
      msg("HIDDEN SECRET", { metadata: { is_visually_hidden_from_conversation: true } }),
    ),
    node("context", "hidden", {
      author: { role: "assistant" },
      content: { content_type: "model_editable_context", model_set_context: "MEMORY SECRET" },
    }),
    node(
      "toolcall",
      "context",
      msg("TOOL PARAMETERS", {
        recipient: "mcp.excalidraw",
        metadata: { args: { scene: [{ id: "shape", x: 1 }] } },
      }),
    ),
    node(
      "toolresult",
      "toolcall",
      msg("INTERNAL MCP RESULT", { author: { role: "tool", name: "mcp.excalidraw" } }),
    ),
    node("thought", "toolresult", {
      author: { role: "assistant" },
      content: { content_type: "thoughts", thoughts: [{ content: "HIDDEN THOUGHT" }] },
    }),
    node("answer", "thought", msg("Current **answer**")),
  ]);
  const before = JSON.stringify([raw]);
  const rendered = html(raw);
  assert.match(rendered, /Current <strong>answer<\/strong>/);
  for (const secret of [
    "OTHER BRANCH",
    "SYSTEM SECRET",
    "HIDDEN SECRET",
    "MEMORY SECRET",
    "TOOL PARAMETERS",
    "INTERNAL MCP RESULT",
    "HIDDEN THOUGHT",
  ])
    assert.ok(!rendered.includes(secret), secret);
  assert.match(rendered, /Question &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(JSON.stringify([raw]), before);
  assert.deepEqual(
    raw.mapping.toolcall?.message,
    msg("TOOL PARAMETERS", {
      recipient: "mcp.excalidraw",
      metadata: { args: { scene: [{ id: "shape", x: 1 }] } },
    }),
  );
});

test("fallback Markdown and continuation boundaries follow recipient, channel and automation semantics without mutation", () => {
  const raw = conversation([
    root(),
    user(),
    node(
      "a",
      "user",
      msg("<box>DIL.useState('widget')</box>\n\n", {
        recipient: "all",
        channel: "analysis",
        metadata: { model_dil_v2: { fallbackMarkdown: "Readable `<escape><</escape>`" } },
      }),
    ),
    node("b", "a", msg("Final", { recipient: "all", channel: "final" })),
    node(
      "c",
      "b",
      msg("Scheduled", { recipient: "all", channel: "final", metadata: { automation_id: "task" } }),
    ),
    node("d", "c", msg("Official export without recipient")),
  ]);
  const before = JSON.stringify(raw);
  const output = html(raw);
  assert.match(output, /Readable <code>&lt;<\/code>/);
  assert.doesNotMatch(output, /DIL\.useState/);
  assert.equal((output.match(/class="message assistant"/g) ?? []).length, 3);
  assert.match(output, /visible analysis/);
  assert.match(output, /<p>Final<\/p>/);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(html(raw), output);
  const noChannelBreak = conversation([
    root(),
    user(),
    node("a", "user", msg("hel", { recipient: "all", channel: "final" })),
    node("b", "a", msg("lo", { recipient: "all", channel: "final" })),
  ]);
  assert.match(html(noChannelBreak), /<p>hello<\/p>/);
});

test("official-export preambles and internal reasoning stay excluded", () => {
  const raw = conversation([
    root(),
    user(),
    node("pre", "user", msg("TRANSIENT PREAMBLE")),
    node("recap", "pre", {
      author: { role: "assistant" },
      content: { content_type: "reasoning_recap", content: "Thought for 2 seconds" },
    }),
    node("final", "recap", msg("Visible final")),
  ]);
  const output = html(raw);
  assert.match(output, /Visible final/);
  assert.doesNotMatch(output, /TRANSIENT PREAMBLE|Thought for/);
});

test("citations render links and source lists while raw HTML and unsafe URL schemes cannot become active markup", () => {
  const marker = "\uE200cite\uE202turn0search0\uE201";
  const raw = conversation([
    root(),
    user(),
    node(
      "answer",
      "user",
      msg(
        `Cited ${marker}. Legacy 【11†(Wiki)】.\n\n\uE200url\uE202Official\uE202https://example.com/docs\uE201\n\n\uE200entity\uE202["id","A < B"]\uE201\n\n<script>alert(1)</script><iframe src=evil></iframe>\n\n[bad](javascript:alert%281%29) [encoded](javascript&#58;alert%281%29) [good](https://example.com)\n\n\`\`\`html\n<img onerror=alert(1)>\n\`\`\``,
        {
          metadata: {
            content_references: [
              {
                type: "grouped_webpages",
                matched_text: marker,
                items: [{ title: "Source <title>", url: "https://example.com/source" }],
              },
              {
                type: "sources_footnote",
                sources: [{ title: "Footnote", url: "https://example.org" }],
              },
            ],
            citations: [
              {
                metadata: {
                  title: "Wiki",
                  url: "https://example.net",
                  extra: { cited_message_idx: 11 },
                },
              },
            ],
          },
        },
      ),
    ),
  ]);
  const output = html(raw);
  assert.match(output, /href="https:\/\/example.com\/source"/);
  assert.match(output, /href="https:\/\/example.net\/"/);
  assert.match(output, /href="https:\/\/example.com\/docs"/);
  assert.match(output, /<strong>Sources<\/strong>/);
  assert.match(output, /href="https:\/\/example.org\/"/);
  assert.doesNotMatch(output, /<script|<iframe|href="javascript|<img onerror/);
  assert.match(output, /&lt;script&gt;/);
  assert.match(output, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(output, /[\uE200-\uE20F]/);
});

test("images embed only bounded allowed data MIME types; missing, remote and SVG images become visible placeholders", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const raw = conversation([
    root(),
    user(),
    node("picture", "user", {
      author: { role: "assistant" },
      content: {
        content_type: "multimodal_text",
        parts: [
          "Picture",
          { content_type: "image_asset_pointer", asset_pointer: "file-service://file-picture" },
          { content_type: "image_asset_pointer", asset_pointer: "file-service://file-missing" },
        ],
      },
    }),
    node(
      "markdown",
      "picture",
      msg("![Remote](https://remote.test/pic.png) ![svg](data:image/svg+xml;base64,PHN2Zz4=)"),
    ),
  ]);
  const parsed = validateConversation(raw);
  assert.deepEqual(conversationImageReferences(parsed), [
    "file-service://file-picture",
    "file-service://file-missing",
    "https://remote.test/pic.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
  ]);
  const output = renderConversation(parsed, {
    images: new Map([["file-service://file-picture", png]]),
  });
  assert.match(output.html.toString(), /<img src="data:image\/png;base64,/);
  assert.doesNotMatch(output.html.toString(), /<img[^>]+(?:remote\.test|svg\+xml)/);
  assert.equal((output.html.toString().match(/\[Image unavailable/g) ?? []).length, 3);
  assert.equal(output.warnings.length, 1);
  assert.match(output.html.toString(), /default-src 'none'/);
});

test("tool image outputs survive; unknown visible structured content has an escaped labelled fallback", () => {
  const raw = conversation([
    root(),
    user(),
    node("tool", "user", {
      author: { role: "tool", name: "python" },
      content: { content_type: "execution_output", text: "internal result" },
      metadata: {
        aggregate_result: {
          messages: [{ message_type: "image", image_url: "file-service://chart" }],
        },
      },
    }),
    node("mcp", "tool", {
      author: { role: "assistant" },
      content: {
        content_type: "mcp_result",
        scene: { type: "rectangle", label: "<script>x</script>" },
      },
    }),
  ]);
  const result = renderConversation(validateConversation(raw));
  assert.match(result.html.toString(), /Tool output \(python\)/);
  assert.match(result.html.toString(), /mcp_result/);
  assert.match(result.html.toString(), /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(result.html.toString(), /internal result|<script/);
  assert.ok(result.warnings.some((warning) => warning.includes("not reconstructed")));
});

test("schema boundary rejects ID mismatches, current-node errors, missing parents and cycles including inactive branches", () => {
  const good = conversation([root(), user(), node("answer", "user", msg("answer"))]);
  assert.equal(validateConversation(good, "fixture-id").id, "fixture-id");
  assert.throws(() => validateConversation(good, "different-id"), /Malformed/);
  assert.throws(() => validateConversation({ ...good, current_node: "absent" }), /Malformed/);
  assert.throws(
    () => validateConversation(conversation([root(), node("child", "absent", msg("oops"))])),
    /Malformed/,
  );
  assert.throws(
    () => validateConversation(conversation([node("a", "b", msg("a")), node("b", "a", msg("b"))])),
    /Malformed/,
  );
  assert.throws(
    () =>
      validateConversation(
        conversation(
          [...Object.values(good.mapping), node("x", "y", null), node("y", "x", null)],
          "answer",
        ),
      ),
    /Malformed/,
  );
  assert.throws(
    () =>
      validateConversation({
        ...good,
        mapping: { ...good.mapping, answer: { ...good.mapping.answer, id: "mismatch" } },
      }),
    /Malformed/,
  );
  assert.throws(
    () =>
      validateConversation(
        conversation([
          root(),
          node("bad", "root", {
            author: { role: "assistant" },
            content: { content_type: "text", parts: [42] },
          }),
        ]),
      ),
    /Malformed/,
  );
});

test("leaf fallback is deterministic and explicit invalid current-node never silently selects another branch", () => {
  const raw = conversation([
    node("root", null, null, ["answer"]),
    node("answer", "root", msg("fallback")),
  ]);
  assert.match(html({ ...raw, current_node: null }), /fallback/);
  assert.throws(() => html({ ...raw, current_node: "missing" }), /Malformed/);
});

test("math typesets without scripts; untrusted commands fall back to escaped TeX and code stays literal", () => {
  const raw = conversation([
    root(),
    user(),
    node(
      "answer",
      "user",
      msg(
        "Inline \\(\\frac{1}{2}\\).\n\n$$x^2 + y^2$$\n\n`$not math$`\n\n\\(\\href{javascript:alert(1)}{evil}\\)\n\n\\(\\unknowncommand{<script>}\\)",
      ),
    ),
  ]);
  const result = renderConversation(validateConversation(raw));
  const output = result.html.toString();
  assert.match(output, /<math/);
  assert.match(output, /<mfrac>/);
  assert.match(output, /<code>\$not math\$<\/code>/);
  assert.doesNotMatch(output, /<script|href="javascript/);
  assert.match(output, /math-fallback/);
  assert.ok(result.warnings.some((warning) => warning.includes("TeX")));
});

test("an explicit target supplies only normalized identity when API IDs are omitted, while supplied IDs remain authoritative", () => {
  const { id: omitted, ...raw } = conversation([
    root(),
    user(),
    node("answer", "user", msg("answer")),
  ]);
  const before = JSON.stringify(raw);
  const result = validateConversation(raw, "explicit-target");
  assert.equal(result.id, "explicit-target");
  assert.equal(JSON.stringify(result.raw), before);
  assert.ok(!Object.hasOwn(result.raw, "id"));
  assert.throws(() => validateConversation(raw), /Malformed/);
  assert.throws(() => validateConversation({ ...raw, id: "" }, "explicit-target"), /Malformed/);
  assert.throws(() => validateConversation({ ...raw, id: 42 }, "explicit-target"), /Malformed/);
  assert.throws(
    () => validateConversation({ ...raw, conversation_id: "other" }, "explicit-target"),
    /Malformed/,
  );
  assert.throws(
    () =>
      validateConversation(
        { ...raw, id: "explicit-target", conversation_id: "other" },
        "explicit-target",
      ),
    /Malformed/,
  );
});

test("repeated image references obey a cumulative embedded-byte budget", () => {
  const raw = conversation([
    node("images", null, {
      author: { role: "assistant" },
      content: {
        content_type: "multimodal_text",
        parts: Array.from({ length: 10 }, () => ({
          content_type: "image_asset_pointer",
          asset_pointer: "file-service://repeated",
        })),
      },
    }),
  ]);
  const result = renderConversation(validateConversation(raw), {
    images: new Map([
      ["file-service://repeated", "data:image/png;base64," + "A".repeat(4 * 1024 * 1024)],
    ]),
  });
  assert.ok(result.html.length < 33 * 1024 * 1024);
  assert.match(result.html.toString(), /Image unavailable/);
  assert.ok(result.warnings.length > 0);
});

test("an explicit validated image map controls raw data URI fallback", () => {
  const pointer = "data:image/png;base64,bm90LXBuZw==";
  const raw = conversation([
    node("image", null, {
      author: { role: "assistant" },
      content: {
        content_type: "multimodal_text",
        parts: [{ content_type: "image_asset_pointer", asset_pointer: pointer }],
      },
    }),
  ]);
  const result = renderConversation(validateConversation(raw), { images: new Map() });
  assert.doesNotMatch(result.html.toString(), /<img /);
  assert.match(result.html.toString(), /Image unavailable/);
  assert.ok(result.warnings.length > 0);
});
