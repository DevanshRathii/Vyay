import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { shortcutEvents, transactions } from "@/lib/db/schema";
import { badRequest, getUserId, notFound, unauthorized } from "@/lib/session";
import { applyEventToTransaction } from "@/lib/match";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["resolve", "dismiss"]),
  transactionId: z.string().optional(),
});

/** Resolve a pending Shortcut event against a chosen transaction, or dismiss it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const event = (
    await db
      .select()
      .from(shortcutEvents)
      .where(and(eq(shortcutEvents.id, id), eq(shortcutEvents.userId, userId)))
      .limit(1)
  )[0];
  if (!event) return notFound("Match not found.");
  if (event.status !== "pending") return badRequest("This match is already closed.");

  if (parsed.data.action === "dismiss") {
    await db.update(shortcutEvents).set({ status: "dismissed" }).where(eq(shortcutEvents.id, id));
    return NextResponse.json({ ok: true });
  }

  if (!parsed.data.transactionId) return badRequest("transactionId is required to resolve.");
  const txn = (
    await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, parsed.data.transactionId), eq(transactions.userId, userId)))
      .limit(1)
  )[0];
  if (!txn) return notFound("Transaction not found.");

  await applyEventToTransaction(event, txn.id, "resolved");
  return NextResponse.json({ ok: true });
}
