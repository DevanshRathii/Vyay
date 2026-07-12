import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Server-only. Do NOT import this into client bundles — it holds
 * BLIND_INDEX_KEY, which must never reach the browser.
 *
 * Preserves the two SQL equality matches that must keep working once
 * amounts are sealed client-side: duplicate detection (ingest.ts
 * flagPotentialDuplicate) and Apple Shortcut matching (match.ts). A DB leak
 * alone (without this env secret) cannot reverse these HMACs back to an
 * amount. Someone with BOTH the DB and BLIND_INDEX_KEY could brute-force
 * amounts (small value space) — accepted risk; the secret never lives in
 * the DB.
 */

function keyBytes(): Uint8Array {
  const raw = process.env.BLIND_INDEX_KEY;
  if (!raw) throw new Error("BLIND_INDEX_KEY is not set. Generate one with: openssl rand -base64 32");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("BLIND_INDEX_KEY must be 32 bytes, base64-encoded.");
  return new Uint8Array(buf);
}

export function amountBidx(userId: string, direction: string, amountPaise: number): string {
  const mac = hmac(sha256, keyBytes(), new TextEncoder().encode(`${userId}:${direction}:${amountPaise}`));
  return Buffer.from(mac).toString("hex");
}

/** Strip everything but letters/digits and lowercase — bank reference
 *  numbers (UPI RRN, UTR) are formatted inconsistently across a bank's own
 *  channels (email vs SMS vs statement narration adds spaces/dashes). */
export function normalizeReference(referenceNumber: string): string {
  return referenceNumber.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Below this length a normalized reference is too short to trust as a
 *  strong duplicate signal (avoids collisions on junk/truncated refs). */
const MIN_REF_LENGTH = 6;

/** null when the reference isn't distinctive enough to index — callers must
 *  fall back to the weaker amount+time dedup signal in that case. */
export function refBidx(userId: string, referenceNumber: string): string | null {
  const normalized = normalizeReference(referenceNumber);
  if (normalized.length < MIN_REF_LENGTH) return null;
  const mac = hmac(sha256, keyBytes(), new TextEncoder().encode(`${userId}:ref:${normalized}`));
  return Buffer.from(mac).toString("hex");
}
