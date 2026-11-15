const MAX_CONTEXT_BYTES = 16 * 1024;

type HostContextInput = { status: "received"; value: unknown } | { status: "invalid" };

export async function readHostContext(input: NodeJS.ReadStream): Promise<HostContextInput> {
  if (input.isTTY) return { status: "invalid" };
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of input) {
      if (!(chunk instanceof Buffer)) return { status: "invalid" };
      size += chunk.length;
      if (size > MAX_CONTEXT_BYTES) return { status: "invalid" };
      chunks.push(chunk);
    }
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)),
    );
    return { status: "received", value };
  } catch {
    return { status: "invalid" };
  }
}
