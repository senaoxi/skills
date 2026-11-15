export const CHATGPT_ORIGIN = "https://chatgpt.com";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_PATH = /^\/c\/([^/?#]+)\/?$/;
declare const conversationIdBrand: unique symbol;
type ChatgptConversationId = string & { readonly [conversationIdBrand]: true };

export interface ConversationContext {
  readonly provider: "chatgpt-web";
  readonly conversationId: ChatgptConversationId;
  readonly conversationUrl: string;
  readonly source: "host-context" | "browser-active-tab" | "user-input";
}

export type ConversationResolution =
  | { status: "resolved"; context: ConversationContext }
  | {
      status: "unresolved";
      reason:
        | "conversation_missing"
        | "conversation_ambiguous"
        | "conversation_conflict"
        | "conversation_context_invalid"
        | "input_invalid";
    };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && UUID.test(value);
}

function isConversationId(value: unknown): value is ChatgptConversationId {
  return isUuid(value);
}

function parseId(input: unknown): ChatgptConversationId | undefined {
  const canonical = typeof input === "string" ? input.toLowerCase() : undefined;
  return isConversationId(canonical) ? canonical : undefined;
}

function parseUrl(input: unknown): ChatgptConversationId | undefined {
  if (typeof input !== "string") return undefined;
  if (input.slice(0, CHATGPT_ORIGIN.length).toLowerCase() !== CHATGPT_ORIGIN) return undefined;
  const pathname = input.slice(CHATGPT_ORIGIN.length);
  const match = PRIVATE_PATH.exec(pathname);
  return match?.[0] === pathname ? parseId(match[1]) : undefined;
}

function resolved(
  conversationId: ChatgptConversationId,
  source: ConversationContext["source"],
): ConversationResolution {
  return {
    status: "resolved",
    context: {
      provider: "chatgpt-web",
      conversationId,
      conversationUrl: `${CHATGPT_ORIGIN}/c/${conversationId}`,
      source,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveHostContext(input: unknown): ConversationResolution {
  if (input == null) return { status: "unresolved", reason: "conversation_missing" };
  if (!isRecord(input) || input.provider !== "chatgpt-web")
    return { status: "unresolved", reason: "conversation_context_invalid" };

  const { conversationId, conversationUrl, browserTabs } = input;
  const id = parseId(conversationId);
  const urlId = parseUrl(conversationUrl);
  if ((conversationId !== undefined && !id) || (conversationUrl !== undefined && !urlId))
    return { status: "unresolved", reason: "conversation_context_invalid" };
  if (id && urlId && id !== urlId) return { status: "unresolved", reason: "conversation_conflict" };
  const current = id ?? urlId;
  if (current) return resolved(current, "host-context");

  if (browserTabs !== undefined && (!Array.isArray(browserTabs) || !browserTabs.every(isRecord)))
    return { status: "unresolved", reason: "conversation_context_invalid" };
  const activeTabs = browserTabs?.filter((tab) => tab.active === true) ?? [];
  if (activeTabs.length > 1) return { status: "unresolved", reason: "conversation_ambiguous" };
  const activeId = parseUrl(activeTabs[0]?.url);
  return activeId
    ? resolved(activeId, "browser-active-tab")
    : { status: "unresolved", reason: "conversation_missing" };
}

export function resolveConversationContext({
  explicit,
  hostContext,
}: {
  explicit?: string;
  hostContext?: unknown;
} = {}): ConversationResolution {
  if (explicit === undefined) return resolveHostContext(hostContext);

  const explicitId = parseId(explicit) ?? parseUrl(explicit);
  if (!explicitId) return { status: "unresolved", reason: "input_invalid" };

  const automatic = resolveHostContext(hostContext);
  if (automatic.status === "resolved" && automatic.context.conversationId !== explicitId)
    return { status: "unresolved", reason: "conversation_conflict" };
  if (
    automatic.status === "unresolved" &&
    (automatic.reason === "conversation_conflict" ||
      automatic.reason === "conversation_context_invalid")
  )
    return automatic;
  return resolved(explicitId, "user-input");
}
