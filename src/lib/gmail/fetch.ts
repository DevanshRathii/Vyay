import type { gmail_v1 } from "@googleapis/gmail";
import type { EmailMessage } from "@/lib/parsing/types";

function decodeB64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&apos;": "'", "&nbsp;": " ", "&#8377;": "₹", "&#x20b9;": "₹", "&rupee;": "₹",
};

/**
 * Collapse runs of horizontal whitespace and blank lines. Some senders' plain-
 * text templates (and occasionally malformed HTML) pad with very long runs of
 * spaces for table-style visual alignment — left uncollapsed, that's
 * pathological input for the regex-based parsing engine downstream
 * (catastrophic backtracking on the ambiguous \s* runs in the reference-
 * number patterns). Applied once at extraction time, and again whenever
 * re-parsing an older stored body that predates this fix.
 */
export function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITY_MAP[e.toLowerCase()] ?? " ");
  return collapseWhitespace(text);
}

/** Walk the MIME tree collecting text; prefers text/plain, falls back to HTML. */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: gmail_v1.Schema$MessagePart) => {
    if (part.body?.data) {
      const text = decodeB64Url(part.body.data);
      if (part.mimeType === "text/plain") plain.push(text);
      else if (part.mimeType === "text/html") html.push(text);
      else if (!part.mimeType?.startsWith("multipart")) plain.push(text);
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  const body = plain.length > 0 ? plain.join("\n").trim() : html.length > 0 ? htmlToText(html.join("\n")) : "";
  return collapseWhitespace(body);
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function toEmailMessage(msg: gmail_v1.Schema$Message): EmailMessage {
  return {
    id: msg.id!,
    threadId: msg.threadId ?? undefined,
    internalDate: Number(msg.internalDate ?? Date.now()),
    from: header(msg, "From"),
    subject: header(msg, "Subject"),
    body: extractBody(msg.payload),
    snippet: msg.snippet ?? undefined,
  };
}

export function headerFromMetadata(msg: gmail_v1.Schema$Message): { from: string; subject: string } {
  return { from: header(msg, "From"), subject: header(msg, "Subject") };
}
