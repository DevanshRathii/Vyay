import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { PARSER_VERSION } from "@/lib/parser-version";
import { getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Called by the client once it's finished decrypting, reprocessing, and
 * re-sealing a keyed account's transactions (src/lib/parser-sync.ts) — the
 * server can't know this happened any other way, since it never saw the
 * plaintext. Trusted at face value: worst case of a false report is simply
 * that user doesn't get reprocessed again until the next PARSER_VERSION
 * bump, which is the same "nothing happens" outcome as never calling this
 * at all — no security or correctness exposure either way.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  await db.update(users).set({ parserVersionApplied: PARSER_VERSION }).where(eq(users.id, userId));
  return NextResponse.json({ ok: true });
}
