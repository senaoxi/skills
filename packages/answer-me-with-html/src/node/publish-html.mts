import { createHash } from "node:crypto";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_IMAGE_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "cHRM",
  "gAMA",
  "sRGB",
  "sBIT",
  "acTL",
  "fcTL",
  "fdAT",
]);

function invalidImage(): never {
  throw new Error("An embedded image could not be cleaned for online publication.");
}

function cleanPng(image: Buffer): Buffer {
  if (!image.subarray(0, 8).equals(PNG_SIGNATURE)) invalidImage();
  const parts: Buffer[] = [PNG_SIGNATURE];
  for (let offset = 8; offset + 12 <= image.length;) {
    const size = image.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (end > image.length) invalidImage();
    const type = image.toString("ascii", offset + 4, offset + 8);
    if (PNG_IMAGE_CHUNKS.has(type)) parts.push(image.subarray(offset, end));
    if (type === "IEND" && size === 0) return Buffer.concat(parts);
    offset = end;
  }
  invalidImage();
}

function cleanJpeg(image: Buffer): Buffer {
  if (image[0] !== 0xff || image[1] !== 0xd8) invalidImage();
  const parts: Buffer[] = [image.subarray(0, 2)];
  let offset = 2;
  while (offset < image.length) {
    const start = offset;
    if (image[offset++] !== 0xff) invalidImage();
    while (image[offset] === 0xff) offset += 1;
    const type = image[offset++];
    if (type === 0xd9) return Buffer.concat([...parts, image.subarray(start, offset)]);
    if (offset + 2 > image.length || !type || type === 0xd8) invalidImage();
    const size = image.readUInt16BE(offset);
    const end = offset + size;
    if (size < 2 || end > image.length) invalidImage();
    if (type < 0xe0 || (type > 0xef && type !== 0xfe)) {
      parts.push(image.subarray(start, end));
    } else if (
      type === 0xee &&
      size === 14 &&
      image.toString("ascii", offset + 2, offset + 7) === "Adobe"
    ) {
      parts.push(image.subarray(start, end));
    }
    offset = end;
    if (type !== 0xda) continue;
    while (offset < image.length) {
      const marker = image.indexOf(0xff, offset);
      if (marker === -1 || marker + 1 >= image.length) invalidImage();
      let next = marker + 1;
      while (image[next] === 0xff) next += 1;
      const code = image[next];
      if (code !== 0 && !(code >= 0xd0 && code <= 0xd7)) {
        parts.push(image.subarray(end, marker));
        offset = marker;
        break;
      }
      offset = next + 1;
    }
  }
  invalidImage();
}

function gifSubblocksEnd(image: Buffer, offset: number): number {
  while (offset < image.length) {
    const size = image[offset++];
    if (size === 0) return offset;
    offset += size;
  }
  invalidImage();
}

function cleanGif(image: Buffer): Buffer {
  if (image.length < 13 || !/^GIF8[79]a$/.test(image.toString("ascii", 0, 6))) invalidImage();
  const colorTableSize = (flags: number) => (flags & 0x80 ? 3 * (2 << (flags & 7)) : 0);
  let offset = 13 + colorTableSize(image[10]);
  const parts: Buffer[] = [image.subarray(0, offset)];
  while (offset < image.length) {
    const start = offset;
    const type = image[offset++];
    if (type === 0x3b) return Buffer.concat([...parts, image.subarray(start, offset)]);
    if (type === 0x2c && offset + 9 < image.length) {
      const data = offset + 9 + colorTableSize(image[offset + 8]) + 1;
      offset = gifSubblocksEnd(image, data);
      parts.push(image.subarray(start, offset));
    } else if (type === 0x21 && offset < image.length) {
      const label = image[offset++];
      const end = gifSubblocksEnd(image, offset);
      if (label === 0xf9 && end - offset === 6 && image[offset] === 4) {
        parts.push(image.subarray(start, end));
      } else if (
        label === 0xff &&
        end - offset === 17 &&
        image.toString("ascii", offset + 1, offset + 12) === "NETSCAPE2.0" &&
        image[offset] === 11 &&
        image[offset + 12] === 3 &&
        image[offset + 13] === 1
      ) {
        parts.push(image.subarray(start, end));
      }
      offset = end;
    } else {
      invalidImage();
    }
  }
  invalidImage();
}

function cleanWebpChunks(image: Buffer, frame = false): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < image.length) {
    if (offset + 8 > image.length) invalidImage();
    const type = image.toString("ascii", offset, offset + 4);
    const size = image.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size & 1);
    if (end > image.length) invalidImage();
    if (["VP8 ", "VP8L", "ALPH"].includes(type)) {
      const chunk = Buffer.from(image.subarray(offset, end));
      if (size & 1) chunk[chunk.length - 1] = 0;
      parts.push(chunk);
    } else if (!frame && type === "VP8X" && size === 10) {
      const chunk = Buffer.from(image.subarray(offset, end));
      chunk[8] &= 0x12;
      parts.push(chunk);
    } else if (!frame && type === "ANIM" && size === 6) {
      parts.push(image.subarray(offset, end));
    } else if (!frame && type === "ANMF" && size > 16) {
      const data = cleanWebpChunks(image.subarray(offset + 24, offset + 8 + size), true);
      const header = Buffer.from(image.subarray(offset, offset + 24));
      header.writeUInt32LE(16 + data.length, 4);
      parts.push(header, data);
    }
    offset = end;
  }
  if (parts.length === 0) invalidImage();
  return Buffer.concat(parts);
}

function cleanWebp(image: Buffer): Buffer {
  if (
    image.length < 12 ||
    image.toString("ascii", 0, 4) !== "RIFF" ||
    image.toString("ascii", 8, 12) !== "WEBP"
  )
    invalidImage();
  const end = image.readUInt32LE(4) + 8;
  if (end > image.length || end < 12) invalidImage();
  const data = cleanWebpChunks(image.subarray(12, end));
  const header = Buffer.from(image.subarray(0, 12));
  header.writeUInt32LE(4 + data.length, 4);
  return Buffer.concat([header, data]);
}

const IMAGE_CLEANERS: Readonly<Record<string, (image: Buffer) => Buffer>> = {
  png: cleanPng,
  jpeg: cleanJpeg,
  jpg: cleanJpeg,
  gif: cleanGif,
  webp: cleanWebp,
};

function cleanImageUrls(text: string): string {
  return text.replace(/data:image\/[^\s"'()<>]*/gi, (url) => {
    const match = /^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(url);
    const format = match?.[1].toLowerCase();
    if (!match || !format || !Object.hasOwn(IMAGE_CLEANERS, format)) {
      throw new Error(
        "Online publication supports embedded PNG, JPEG, GIF, and WebP images. Use a supported format for the online copy.",
      );
    }
    const cleaned = IMAGE_CLEANERS[format](Buffer.from(match[2], "base64"));
    return "data:image/" + format + ";base64," + cleaned.toString("base64");
  });
}

const RENDERER_POLICY =
  /^<!doctype html>\s*(<html\b[^>]*>)\s*<head>\s*<meta charset="utf-8">\s*<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ([^";]*);/;
const VIDEO_DATA_OPEN = '<script type="application/json" id="amv-data">';

const RENDERER_DATA_ATTRIBUTES = new Set([
  "data-action",
  "data-am",
  "data-am-root-dir",
  "data-am-root-lang",
  "data-am-root-mode",
  "data-am-root-style",
  "data-am-root-theme",
  "data-am-table",
  "data-am-table-filter",
  "data-am-tex",
  "data-amv",
  "data-ask",
  "data-delta",
  "data-done",
  "data-expand",
  "data-flow",
  "data-i",
  "data-icon",
  "data-id",
  "data-key",
  "data-label",
  "data-lang",
  "data-line-after",
  "data-line-before",
  "data-max",
  "data-min",
  "data-mode",
  "data-multi",
  "data-n",
  "data-o",
  "data-pause",
  "data-play",
  "data-scale",
  "data-side",
  "data-span",
  "data-speed",
  "data-step",
  "data-style",
  "data-suggested",
  "data-theme",
  "data-title",
  "data-ui",
  "data-video",
  "data-view",
  "data-voice",
]);

const MARKUP =
  /<!--[\s\S]*?-->|(<(script|style|textarea)(?=[\t\n\f\r />])(?:[^"'<>]|"[^"]*"|'[^']*')*>)([\s\S]*?)(?:<\/\2\s*>|$)|<\/?[a-z](?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
const ATTRIBUTES = /(\s+)([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
const SOURCE_CODE_CAPTION =
  /(<figure class="am-codeblock" data-am-src="[^"]*"(?: data-am-lines="[^"]*")?><figcaption class="am-code-head"><span class="am-code-title")( title="[^"]*")?>([^<]*)<\/span>/g;

export function cleanPublishedHtml(html: string): string {
  const withoutSourceCaptions = html.replace(
    SOURCE_CODE_CAPTION,
    (_caption: string, opening: string, tooltip: string | undefined, title: string) =>
      opening + ">" + (tooltip ? title : "") + "</span>",
  );
  const [, root, scriptSource] = RENDERER_POLICY.exec(withoutSourceCaptions) ?? [];
  const scriptHashes = new Set(scriptSource?.match(/'sha256-[A-Za-z0-9+/]{43}='/g));
  const videoDataAt = root?.endsWith(" data-video>")
    ? withoutSourceCaptions.lastIndexOf(VIDEO_DATA_OPEN)
    : -1;
  return withoutSourceCaptions.replace(
    MARKUP,
    (
      token: string,
      opening: string | undefined,
      rawText: string | undefined,
      contents: string | undefined,
      offset: number,
    ) => {
      if (token.startsWith("<!--")) return "";
      const element = rawText?.toLowerCase();
      if (element === "script") {
        if (offset === videoDataAt && opening === VIDEO_DATA_OPEN) return token;
        if (opening !== "<script>" || !token.endsWith("</script>")) return "";
        const digest = createHash("sha256")
          .update(contents ?? "")
          .digest("base64");
        return scriptHashes.has(`'sha256-${digest}'`) ? token : "";
      }
      const tag = opening ?? token;
      if (
        element === "textarea" &&
        /\sid\s*=\s*(?:"am-source"|'am-source'|am-source(?=\s|>))/i.test(tag)
      ) {
        return "";
      }
      const cleaned = tag.replace(
        ATTRIBUTES,
        (attribute: string, _spaces: string, name: string, value: string | undefined) => {
          const lower = name.toLowerCase();
          if (lower.startsWith("data-") && !RENDERER_DATA_ATTRIBUTES.has(lower)) return "";
          return value ? attribute.slice(0, -value.length) + cleanImageUrls(value) : attribute;
        },
      );
      const body = token.slice(tag.length);
      return cleaned + (element === "style" ? cleanImageUrls(body) : body);
    },
  );
}
