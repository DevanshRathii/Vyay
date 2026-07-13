import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { PARSER_VERSION } from "@/lib/parser-version";
import { getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Whether this account's existing ledger needs reprocessing against the
 * current parser/categorizer logic. `keyed` tells the client which path to
 * take (server does the work directly vs. client must decrypt-reparse-
 * reseal itself, since a keyed account's raw email is sealed and
 * unreadable server-side) — internal plumbing only, never surfaced as
 * user-facing copy or a choice the user makes.
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const row = (
    await db
      .select({ publicKey: users.publicKey, parserVersionApplied: users.parserVersionApplied })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) return unauthorized();

  return NextResponse.json({
    needsSync: row.parserVersionApplied < PARSER_VERSION,
    keyed: row.publicKey !== null,
  });
}
