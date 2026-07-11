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
