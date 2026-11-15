import { Marked } from "marked";
import type { MarkedExtension } from "marked";
import temml from "temml";

type JsonRecord = Record<string, unknown>;
type Source = { label: string; url: string };
type Reference = {
  marker: string;
  type: string;
  widgetType: string;
  alt: string;
  sources: Source[];
  images: string[];
  data: unknown;
};
type Part =
  | { kind: "text"; text: string }
  | { kind: "image"; pointer: string }
  | { kind: "unsupported"; label: string; data: unknown };
type Message = {
  role: string;
  name: string;
  recipient: string | undefined;
  channel: string;
  contentType: string;
  parts: Part[];
  references: Reference[];
  citations: { index: number; source: Source }[];
  attachments: string[];
  hidden: boolean;
  preamble: boolean;
  automation: boolean;
};
type Node = {
  id: string;
  parent: string | null | undefined;
  children: string[] | undefined;
  message: Message | null;
};
export type Conversation = {
  readonly raw: Readonly<JsonRecord>;
  readonly id: string;
  readonly title: string;
  readonly branch: readonly Node[];
};

function invalid(): never {
  throw new Error("Malformed conversation payload");
}
function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function obj(value: unknown): JsonRecord {
  return record(value) ? value : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function source(value: unknown): Source {
  const item = obj(value);
  return {
    label: str(item.attribution) || str(item.title) || str(item.url) || "Source",
    url: str(item.url),
  };
}
function sources(value: unknown): Source[] {
  return array(value).flatMap((item) => [
    source(item),
    ...array(obj(item).supporting_websites).map(source),
  ]);
}
function reference(value: unknown): Reference {
  const ref = obj(value);
  const type = str(ref.type);
  let links = sources(type === "sources_footnote" ? ref.sources : ref.items);
  if (!links.length) links = sources(ref.fallback_items);
  if (!links.length && (ref.url || ref.title || ref.attribution)) links = [source(ref)];
  if (!links.length)
    links = array(ref.safe_urls)
      .filter((url): url is string => typeof url === "string")
      .map((url) => ({ label: url, url }));
  if (!links.length && type === "file" && str(ref.name))
    links = [{ label: str(ref.name), url: "" }];
  return {
    marker: str(ref.matched_text),
    type,
    widgetType: str(obj(ref.data).widget_type),
    alt: str(ref.alt),
    sources: links,
    images: array(ref.images)
      .map((item) => {
        const image = obj(item);
        return str(obj(image.image_result ?? image).content_url);
      })
      .filter(Boolean),
    data: obj(ref.data).content,
  };
}
function parsePart(value: unknown): Part {
  if (typeof value === "string") return { kind: "text", text: value };
  if (!record(value) || typeof value.content_type !== "string") invalid();
  if (value.content_type === "image_asset_pointer") {
    if (typeof value.asset_pointer !== "string" || !value.asset_pointer) invalid();
    return { kind: "image", pointer: value.asset_pointer };
  }
  if (value.content_type === "audio_transcription")
    return { kind: "text", text: `[Audio transcription] ${str(value.text)}` };
  return { kind: "unsupported", label: value.content_type, data: value };
}
function parseMessage(value: unknown): Message | null {
  if (value === undefined || value === null) return null;
  if (
    !record(value) ||
    !record(value.author) ||
    typeof value.author.role !== "string" ||
    !record(value.content) ||
    typeof value.content.content_type !== "string"
  )
    invalid();
  const content = value.content;
  const metadata = obj(value.metadata);
  const contentType = str(content.content_type);
  let parts: Part[];
  if (contentType === "text" || contentType === "multimodal_text") {
    if (!Array.isArray(content.parts)) invalid();
    if (contentType === "text" && !content.parts.every((part) => typeof part === "string"))
      invalid();
    parts = content.parts.map(parsePart);
    const fallback = obj(metadata.model_dil_v2).fallbackMarkdown;
    if (contentType === "text" && typeof fallback === "string" && fallback.trim()) {
      const original = content.parts.join("");
      const leading = original.slice(0, original.length - original.trimStart().length);
      const trailing = original.slice(original.trimEnd().length);
      parts = [
        {
          kind: "text",
          text: leading + fallback.replaceAll(/<escape>([\s\S]*?)<\/escape>/g, "$1") + trailing,
        },
      ];
    }
  } else if (contentType === "execution_output") {
    parts = array(obj(metadata.aggregate_result).messages)
      .filter((item) => obj(item).message_type === "image")
      .map((item) => ({ kind: "image", pointer: str(obj(item).image_url) }));
    if (!parts.length)
      parts = [{ kind: "unsupported", label: "Execution result", data: str(content.text) }];
  } else if (contentType === "code") {
    parts = [{ kind: "unsupported", label: "Code", data: str(content.text) }];
  } else if (contentType === "tether_quote") {
    parts = [{ kind: "text", text: str(content.title) || str(content.text) }];
  } else if (contentType === "tether_browsing_display") {
    parts = [
      {
        kind: "text",
        text: sources(obj(metadata._cite_metadata).metadata_list).map(linkMarkdown).join("\n\n"),
      },
    ];
  } else {
    parts = [{ kind: "unsupported", label: contentType, data: content }];
  }
  return {
    role: value.author.role,
    name: str(value.author.name),
    recipient: typeof value.recipient === "string" ? value.recipient : undefined,
    channel: str(value.channel),
    contentType,
    parts,
    references: array(metadata.content_references).map(reference),
    citations: array(metadata.citations).map((item) => {
      const meta = obj(obj(item).metadata);
      const index = obj(meta.extra).cited_message_idx;
      return { index: typeof index === "number" ? index : -1, source: source(meta) };
    }),
    attachments: array(metadata.attachments)
      .filter((item) => !str(obj(item).mime_type).startsWith("image/"))
      .map((item) => str(obj(item).name))
      .filter(Boolean),
    hidden: Boolean(metadata.is_visually_hidden_from_conversation),
    preamble: Boolean(metadata.is_thinking_preamble_message),
    automation: Boolean(metadata.automation_id),
  };
}

export function validateConversation(raw: unknown, expectedId?: string): Conversation {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(raw);
  } catch {
    invalid();
  }
  if (!encoded || Buffer.byteLength(encoded) > 32 * 1024 * 1024) invalid();
  if (!record(raw) || !record(raw.mapping)) invalid();
  for (const supplied of [raw.id, raw.conversation_id]) {
    if (
      supplied !== undefined &&
      (typeof supplied !== "string" || !supplied || supplied.length > 200)
    )
      invalid();
  }
  const id = str(raw.id) || str(raw.conversation_id) || expectedId;
  if (!id || id.length > 200 || (expectedId !== undefined && id !== expectedId)) invalid();
  if (raw.id !== undefined && raw.conversation_id !== undefined && raw.id !== raw.conversation_id)
    invalid();
  if (raw.title !== undefined && raw.title !== null && typeof raw.title !== "string") invalid();
  const entries = Object.entries(raw.mapping);
  if (!entries.length || entries.length > 20_000) invalid();
  const nodes = new Map<string, Node>();
  for (const [key, value] of entries) {
    if (!key || key.length > 200 || !record(value) || value.id !== key) invalid();
    if (value.parent !== undefined && value.parent !== null && typeof value.parent !== "string")
      invalid();
    if (
      value.children !== undefined &&
      (!Array.isArray(value.children) ||
        !value.children.every((child) => typeof child === "string"))
    )
      invalid();
    const parent =
      typeof value.parent === "string" ? value.parent : value.parent === null ? null : undefined;
    const children = Array.isArray(value.children)
      ? value.children.filter((child): child is string => typeof child === "string")
      : undefined;
    nodes.set(key, { id: key, parent, children, message: parseMessage(value.message) });
  }
  for (const node of nodes.values()) {
    if (node.parent !== null && node.parent !== undefined && !nodes.has(node.parent)) invalid();
    if (node.children?.some((child) => !nodes.has(child))) invalid();
  }
  const complete = new Set<string>();
  for (const start of nodes.keys()) {
    const path = new Set<string>();
    let cursor: string | null | undefined = start;
    while (cursor !== undefined && cursor !== null && !complete.has(cursor)) {
      if (path.has(cursor)) invalid();
      path.add(cursor);
      cursor = nodes.get(cursor)?.parent;
    }
    for (const item of path) complete.add(item);
  }
  if (
    raw.current_node !== undefined &&
    raw.current_node !== null &&
    typeof raw.current_node !== "string"
  )
    invalid();
  let current =
    str(raw.current_node) || [...nodes.values()].find((node) => !node.children?.length)?.id;
  if (!current || !nodes.has(current)) invalid();
  const branch: Node[] = [];
  while (current) {
    const node = nodes.get(current);
    if (!node) invalid();
    if (node.parent === undefined) break;
    branch.push(node);
    current = node.parent ?? undefined;
  }
  branch.reverse();
  // The API includes these flags. Official exports may omit them but retain the preamble.
  for (let index = 0; index < branch.length - 1; index++) {
    const message = branch[index]?.message;
    const child = branch[index + 1]?.message;
    if (
      message?.role === "assistant" &&
      message.recipient === undefined &&
      message.contentType === "text" &&
      (child?.contentType === "thoughts" || child?.contentType === "reasoning_recap")
    )
      message.preamble = true;
  }
  return { raw, id, title: str(raw.title) || "ChatGPT Conversation", branch };
}

function visible(message: Message): boolean {
  if (
    message.role === "system" ||
    message.role === "developer" ||
    message.hidden ||
    message.preamble
  )
    return false;
  if (message.recipient !== undefined && message.recipient !== "all") return false;
  if (
    ["thoughts", "reasoning_recap", "model_editable_context", "user_editable_context"].includes(
      message.contentType,
    )
  )
    return false;
  if (
    message.role === "assistant" &&
    message.contentType === "text" &&
    !message.parts.some((part) => part.kind === "text" && part.text.trim())
  )
    return false;
  if (message.role === "tool")
    return message.name !== "file_search" && message.parts.some((part) => part.kind === "image");
  return ["user", "assistant", "tool"].includes(message.role);
}
function messages(conversation: Conversation): Message[] {
  const result: Message[] = [];
  for (const node of conversation.branch) {
    if (!node.message || !visible(node.message)) continue;
    const message = structuredClone(node.message);
    const previous = result.at(-1);
    if (
      previous?.role === "assistant" &&
      message.role === "assistant" &&
      previous.recipient === "all" &&
      message.recipient === "all" &&
      previous.contentType === "text" &&
      message.contentType === "text" &&
      !message.automation
    ) {
      const first = message.parts[0];
      const last = previous.parts.at(-1);
      if (first?.kind === "text" && last?.kind === "text") {
        last.text += (previous.channel !== message.channel ? "\n\n" : "") + first.text;
        previous.parts.push(...message.parts.slice(1));
      } else previous.parts.push(...message.parts);
      previous.references.push(...message.references);
      previous.citations.push(...message.citations);
      previous.attachments.push(...message.attachments);
    } else result.push(message);
  }
  return result;
}
function escape(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function safeUrl(input: string): string | null {
  const url = input.trim();
  if (/[\u0000-\u0020\u007f]/u.test(url)) return null;
  try {
    const parsed = new URL(url);
    return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}
function markdownText(text: string): string {
  return text.replaceAll(/([\\\[\]`*_<>])/g, "\\$1").replaceAll(/[\r\n]/g, " ");
}
function linkMarkdown(source: Source): string {
  const url = safeUrl(source.url);
  return url
    ? `[${markdownText(source.label)}](<${url.replaceAll(">", "%3E").replaceAll("<", "%3C")}>)`
    : markdownText(source.label);
}
function normalize(text: string): string {
  return text.replaceAll(/[\u00A0\u202F\u2007\u2060]/gu, " ").replaceAll(/[\uE203\uE204]/gu, "");
}
function references(text: string, message: Message): string {
  let result = normalize(text);
  for (const ref of [...message.references].sort(
    (left, right) => right.marker.length - left.marker.length,
  )) {
    if (
      !ref.marker ||
      ref.type === "sources_footnote" ||
      ref.type === "url" ||
      (ref.type === "client_defined_widget" && ref.widgetType === "code_block")
    )
      continue;
    let replacement = ref.sources.length
      ? `(${ref.sources.map(linkMarkdown).join(", ")})`
      : ref.alt.replaceAll(/\[([^\]]*)\]\(\)/g, "$1");
    if (ref.images.length)
      replacement = ref.images
        .map((pointer) => `![Image](<${pointer.replaceAll("<", "%3C").replaceAll(">", "%3E")}>)`)
        .join("\n\n");
    if (!replacement && ref.data !== undefined)
      replacement = `\n\nWidget data\n\n\`\`\`json\n${JSON.stringify(ref.data, null, 2)}\n\`\`\`\n\n`;
    result = result.replaceAll(normalize(ref.marker), () => replacement);
  }
  result = result.replaceAll(
    /\uE200url\uE202([^\uE200\uE201\uE202]*)\uE202([^\uE200\uE201\uE202]+)\uE201/gu,
    (_, label: string, url: string) => linkMarkdown({ label, url }),
  );
  result = result.replaceAll(/\uE200entity\uE202([^\uE200\uE201]*)\uE201/gu, (_, data: string) => {
    try {
      const value: unknown = JSON.parse(data);
      return Array.isArray(value) && typeof value[1] === "string"
        ? markdownText(value[1])
        : "[Entity]";
    } catch {
      return "[Entity]";
    }
  });
  result = result.replaceAll(/【(\d+)†\((.+?)\)】/g, (marker: string, index: string) => {
    const citation = message.citations.find((item) => item.index === Number(index));
    return citation ? `(${linkMarkdown(citation.source)})` : marker;
  });
  result = result
    .replaceAll(/\uE200(?:cite|image_group)(?:\uE202[^\uE200\uE201]*)+\uE201/gu, "")
    .replaceAll(/[\uE200-\uE20F]/g, "");
  const footnotes = message.references
    .filter((ref) => ref.type === "sources_footnote")
    .flatMap((ref) => ref.sources);
  if (footnotes.length)
    result += `\n\n**Sources**\n\n${footnotes.map((item) => `- ${linkMarkdown(item)}`).join("\n")}`;
  return result;
}

function mathExtension(warnings: Set<string>): MarkedExtension {
  const render = (raw: string, tex: string, display: boolean) => {
    try {
      return temml.renderToString(tex, {
        displayMode: display,
        trust: false,
        strict: true,
        throwOnError: true,
        maxExpand: 1000,
        maxSize: [30, 30],
      });
    } catch {
      warnings.add("A formula could not be typeset; its TeX was retained.");
      return `<code class="math-fallback">${escape(raw)}</code>`;
    }
  };
  return {
    extensions: [
      {
        name: "archiveMathBlock",
        level: "block",
        start(input) {
          return input.search(/(?:^|\n)(?:\$\$|\\\[)/);
        },
        tokenizer(input) {
          const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:[ \t]*\n|$)/.exec(input);
          return match
            ? { type: "archiveMathBlock", raw: match[0], tex: match[1] ?? match[2] ?? "" }
            : undefined;
        },
        renderer(token) {
          return `<div class="math">${render(token.raw, str(token.tex), true)}</div>`;
        },
      },
      {
        name: "archiveMathInline",
        level: "inline",
        start(input) {
          return input.search(/\\\(|\$(?=\S)/);
        },
        tokenizer(input) {
          const match = /^(?:\\\(([^\n]+?)\\\)|\$(?![\s$])([^\n$]*?[^\s$])\$(?!\d))/.exec(input);
          return match
            ? { type: "archiveMathInline", raw: match[0], tex: match[1] ?? match[2] ?? "" }
            : undefined;
        },
        renderer(token) {
          return render(token.raw, str(token.tex), false);
        },
      },
    ],
  };
}

export function conversationImageReferences(conversation: Conversation): string[] {
  const refs = new Set<string>();
  const parser = new Marked(mathExtension(new Set()), {
    walkTokens(token) {
      if (token.type === "image") refs.add(token.href);
    },
  });
  for (const message of messages(conversation)) {
    for (const part of message.parts) {
      if (part.kind === "image") refs.add(part.pointer);
      else if (part.kind === "text" && message.role === "assistant")
        parser.parse(references(part.text, message), { async: false });
    }
    for (const reference of message.references)
      for (const image of reference.images) refs.add(image);
  }
  return [...refs];
}

export function renderConversation(
  conversation: Conversation,
  options: { images?: ReadonlyMap<string, string> } = {},
): { html: Buffer; warnings: string[] } {
  const warnings = new Set<string>();
  let embeddedImageBytes = 0;
  const image = (pointer: string, label: string): string => {
    const data = options.images
      ? (options.images.get(pointer) ?? "")
      : pointer.startsWith("data:")
        ? pointer
        : "";
    if (
      /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data) &&
      data.length <= 16 * 1024 * 1024 &&
      embeddedImageBytes + data.length <= 32 * 1024 * 1024
    ) {
      embeddedImageBytes += data.length;
      return `<img src="${escape(data)}" alt="${escape(label)}" loading="lazy">`;
    }
    warnings.add("An image could not be embedded; a placeholder was included.");
    return `<p class="unavailable">[Image unavailable${label && label !== "Image" ? `: ${escape(label)}` : ""}]</p>`;
  };
  const marked = new Marked(mathExtension(warnings), {
    gfm: true,
    breaks: false,
    renderer: {
      html({ text }) {
        return escape(text);
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        const url = safeUrl(href);
        return url ? `<a href="${escape(url)}" rel="noreferrer noopener">${label}</a>` : label;
      },
      image({ href, text }) {
        return image(href, text);
      },
    },
  });
  const items = messages(conversation)
    .map((message) => {
      const label =
        message.role === "user"
          ? "You"
          : message.role === "tool"
            ? `Tool output${message.name ? ` (${message.name})` : ""}`
            : message.channel === "analysis"
              ? "Assistant (visible analysis)"
              : "Assistant";
      const body = message.parts
        .map((part) => {
          if (part.kind === "image") return image(part.pointer, "Image");
          if (part.kind === "unsupported") {
            warnings.add(
              "Unsupported content was retained as labelled text; interactive widgets are not reconstructed.",
            );
            return `<p>${escape(part.label)}</p><pre><code>${escape(typeof part.data === "string" ? part.data : (JSON.stringify(part.data, null, 2) ?? ""))}</code></pre>`;
          }
          if (message.role !== "assistant") return `<p class="plain">${escape(part.text)}</p>`;
          return marked.parse(references(part.text, message), { async: false });
        })
        .join("\n");
      const attachments = message.attachments.length
        ? `<ul class="attachments">${message.attachments.map((name) => `<li>Attachment: ${escape(name)}</li>`).join("")}</ul>`
        : "";
      return `<article class="message ${message.role}"><h2>${escape(label)}</h2>${body}${attachments}</article>`;
    })
    .join("\n");
  const notice = warnings.size
    ? `<aside aria-label="Archive limitations"><ul>${[...warnings].map((warning) => `<li>${escape(warning)}</li>`).join("")}</ul></aside>`
    : "";
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(conversation.title)}</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#202124;background:#fafafa;margin:0 auto;padding:2rem 1rem;max-width:860px}h1{line-height:1.2;overflow-wrap:anywhere}h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:#62666c}.message{padding:1rem 1.25rem;margin:1.5rem 0;background:white;border:1px solid #ddd;border-radius:12px}.user{background:#f1f3f5}.plain{white-space:pre-wrap}pre{overflow:auto;background:#f1f3f5;padding:1rem;border-radius:6px}code{font-family:ui-monospace,monospace}img{max-width:100%;height:auto}a{color:#075abc;overflow-wrap:anywhere}table{border-collapse:collapse;display:block;overflow:auto}td,th{padding:.4rem .7rem;border:1px solid #bbb}blockquote{border-left:3px solid #bbb;margin-left:0;padding-left:1rem}aside,.unavailable{color:#655324}.attachments{font-size:.9rem}</style></head><body><main><h1>${escape(conversation.title)}</h1><p>Conversation transcript. Interactive tools are retained in the accompanying JSON.</p>${items}${notice}</main></body></html>\n`;
  return { html: Buffer.from(html), warnings: [...warnings] };
}
