import { desc, eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shortcutEvents } from "@/lib/db/schema";
import { getUserId, unauthorized } from "@/lib/session";
import { findCandidates } from "@/lib/match";

export const dynamic = "force-dynamic";

/** Pending Shortcut events with their live candidate transactions. */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const events = await db
    .select()
    .from(shortcutEvents)
    .where(and(eq(shortcutEvents.userId, userId), eq(shortcutEvents.status, "pending")))
    .orderBy(desc(shortcutEvents.createdAt));

  const rows = await Promise.all(
    events.map(async (e) => ({
      ...e,
      candidates: (
        await findCandidates(userId, {
          amountPaise: e.amountPaise,
          direction: e.direction,
          at: e.createdAt,
        })
      ).map((t) => ({
        id: t.id,
        occurredAt: t.occurredAt,
        merchant: t.merchant,
        channel: t.channel,
        bank: t.bank,
        amountPaise: t.amountPaise,
        categoryId: t.categoryId,
      })),
    })),
  );
  return NextResponse.json({ rows });
}
