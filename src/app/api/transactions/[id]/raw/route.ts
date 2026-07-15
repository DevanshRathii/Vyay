import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { getUserId, notFound, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * On-demand raw-email fetch for the "Report a bad parse" flow — not
 * included in the list endpoint's response to keep that payload small.
 * Dual-read: `raw` is the plaintext original email for non-keyed accounts;
 * `encPayload` is the sealed blob for keyed accounts (its `.raw` field is
 * the same content) — the client decrypts, the server never does.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const row = (
    await db
      .select({ raw: transactions.raw, encPayload: transactions.encPayload })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .limit(1)
  )[0];
  if (!row) return notFound("Transaction not found.");

  return NextResponse.json(row);
}
