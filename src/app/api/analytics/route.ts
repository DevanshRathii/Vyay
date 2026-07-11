import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { computeAnalytics, type AnalyticsRow } from "@/lib/analytics-core";
import { getUserId, getUserPublicKey, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

const ROW_COLUMNS = {
  occurredAt: transactions.occurredAt,
  amountPaise: transactions.amountPaise,
  direction: transactions.direction,
  categoryId: transactions.categoryId,
  channel: transactions.channel,
  merchant: transactions.merchantNormalized,
  merchantRaw: transactions.merchant,
} as const;

/**
 * Aggregations for the dashboard. Works over the selected date range and a
 * fixed 12-month trailing window for the trend chart. Aggregation happens in
 * JS (computeAnalytics, shared with the client-side keyed path) over a
 * narrow column selection — fast well beyond typical inbox sizes.
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  if (await getUserPublicKey(userId)) {
    return NextResponse.json(
      { error: "Analytics for zero-access-encrypted accounts are computed client-side." },
      { status: 410 },
    );
  }

  const params = new URL(req.url).searchParams;
  const now = Date.now();
  const fromParam = params.get("from");
  const toParam = params.get("to");
  const from = fromParam !== null ? Number(fromParam) : now - 30 * 24 * 3600 * 1000;
  const to = toParam !== null ? Number(toParam) : now;
  const yearAgo = now - 366 * 24 * 3600 * 1000;

  // Slice-and-dice filters — drilling into a category/channel/merchant from
  // the dashboard re-requests this endpoint scoped to that slice, so every
  // aggregate below (stat cards, trend charts, the other two panels) stays
  // consistent with what's on screen rather than only filtering one panel.
  const filters = {
    from,
    to,
    yearAgo,
    filterCategory: params.get("categoryId"),
    filterChannel: params.get("channel"),
    filterMerchant: params.get("merchant"),
  };

  // amountPaise is only nullable for keyed accounts, which never reach this
  // handler (guarded above) — coalesce to satisfy the shared column type.
  const allRows: AnalyticsRow[] = (
    await db
      .select(ROW_COLUMNS)
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          gte(transactions.occurredAt, Math.min(from, yearAgo)),
          lte(transactions.occurredAt, to),
        ),
      )
  ).map((r) => ({ ...r, amountPaise: r.amountPaise ?? 0 }));

  const cats = await db.select().from(categories).where(eq(categories.userId, userId));

  // Previous period, same duration and same filters, for the trend badges on
  // the stat cards — a separate, narrower query rather than widening the
  // main one. Skipped for "all time" (from=0 has no meaningful "before").
  let previousRows: AnalyticsRow[] = [];
  if (from > 0) {
    const duration = to - from;
    const prevFrom = Math.max(0, from - duration);
    previousRows = (
      await db
        .select(ROW_COLUMNS)
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            isNull(transactions.deletedAt),
            gte(transactions.occurredAt, prevFrom),
            lte(transactions.occurredAt, from),
          ),
        )
    ).map((r) => ({ ...r, amountPaise: r.amountPaise ?? 0 }));
  }

  return NextResponse.json(computeAnalytics(allRows, cats, filters, previousRows));
}
