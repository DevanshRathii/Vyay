import { eq } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { PARSER_VERSION } from "@/lib/parser-version";
import { reparseUserTransactions } from "@/lib/reparse";
import { badRequest, getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Non-keyed accounts only — the server can read their stored raw email, so
 * it does the reprocessing directly (same engine reparseUserTransactions
 * already used for the user-triggered "Re-parse" button, just invoked
 * automatically instead of by a click). Keyed accounts 400 here; the client
 * handles those itself (src/lib/parser-sync.ts) and calls /complete when done
 * — the server can't decrypt a keyed account's raw email to do this for them.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const row = (
    await db.select({ publicKey: users.publicKey }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (row?.publicKey) return badRequest("Keyed accounts sync client-side.");

  waitUntil(
    (async () => {
      await reparseUserTransactions(userId);
      await db.update(users).set({ parserVersionApplied: PARSER_VERSION }).where(eq(users.id, userId));
    })().catch((err) => {
      console.error(`[vyay] automatic parser-sync failed for user ${userId}:`, err);
    }),
  );

  return NextResponse.json({ started: true });
}
