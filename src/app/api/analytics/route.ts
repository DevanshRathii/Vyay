import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { getUserId, getUserPublicKey, unauthorized } from "@/lib/session";
import { istDateKey, istMonthKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Aggregations for the dashboard. Works over the selected date range and a
 * fixed 12-month trailing window for the trend chart. Aggregation happens in
 * JS over a narrow column selection — fast well beyond typical inbox sizes.
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
  const filterCategory = params.get("categoryId");
  const filterChannel = params.get("channel");
  const filterMerchant = params.get("merchant");

  type Row = {
    occurredAt: number;
    amountPaise: number;
    direction: string;
    categoryId: string | null;
    channel: string | null;
    merchant: string | null;
    merchantRaw: string | null;
  };
  const matchesFilters = (r: Row) => {
    if (filterCategory !== null && (r.categoryId ?? "__none__") !== filterCategory) return false;
    if (filterChannel !== null && (r.channel ?? "Other") !== filterChannel) return false;
    if (filterMerchant !== null && (r.merchant ?? r.merchantRaw ?? "unknown") !== filterMerchant) return false;
    return true;
  };

  // amountPaise is only nullable for keyed accounts, which never reach this
  // handler (guarded above) — coalesce to satisfy the shared column type.
  const allRows = (
    await db
      .select({
        occurredAt: transactions.occurredAt,
        amountPaise: transactions.amountPaise,
        direction: transactions.direction,
        categoryId: transactions.categoryId,
        channel: transactions.channel,
        merchant: transactions.merchantNormalized,
        merchantRaw: transactions.merchant,
      })
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
  const catById = new Map(cats.map((c) => [c.id, c]));

  const rows = allRows.filter(matchesFilters);
  const inRange = rows.filter((r) => r.occurredAt >= from && r.occurredAt <= to);

  // Previous period, same duration and same filters, for the trend badges on
  // the stat cards. Skipped for "all time" (from=0 has no meaningful "before").
  let previous: { debit: number; credit: number } | null = null;
  if (from > 0) {
    const duration = to - from;
    const prevFrom = Math.max(0, from - duration);
    const prevRows = (
      await db
        .select({
          occurredAt: transactions.occurredAt,
          amountPaise: transactions.amountPaise,
          direction: transactions.direction,
          categoryId: transactions.categoryId,
          channel: transactions.channel,
          merchant: transactions.merchantNormalized,
          merchantRaw: transactions.merchant,
        })
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
    let pDebit = 0;
    let pCredit = 0;
    for (const r of prevRows.filter(matchesFilters)) {
      if (r.direction === "debit") pDebit += r.amountPaise;
      else pCredit += r.amountPaise;
    }
    previous = { debit: pDebit, credit: pCredit };
  }

  let debit = 0;
  let credit = 0;
  const byCategory = new Map<string, number>();
  const byChannel = new Map<string, number>();
  const byMerchant = new Map<string, { key: string; label: string; total: number; count: number }>();
  const byDay = new Map<string, { debit: number; credit: number }>();

  for (const r of inRange) {
    if (r.direction === "debit") {
      debit += r.amountPaise;
      byCategory.set(r.categoryId ?? "__none__", (byCategory.get(r.categoryId ?? "__none__") ?? 0) + r.amountPaise);
      byChannel.set(r.channel ?? "Other", (byChannel.get(r.channel ?? "Other") ?? 0) + r.amountPaise);
      const mKey = r.merchant ?? r.merchantRaw ?? "unknown";
      const m = byMerchant.get(mKey) ?? { key: mKey, label: r.merchantRaw ?? mKey, total: 0, count: 0 };
      m.total += r.amountPaise;
      m.count += 1;
      byMerchant.set(mKey, m);
    } else {
      credit += r.amountPaise;
    }
    const day = istDateKey(r.occurredAt);
    const d = byDay.get(day) ?? { debit: 0, credit: 0 };
    d[r.direction as "debit" | "credit"] += r.amountPaise;
    byDay.set(day, d);
  }

  // 12-month trend over the trailing window regardless of the range filter.
  const byMonth = new Map<string, { debit: number; credit: number }>();
  for (const r of rows) {
    if (r.occurredAt < yearAgo) continue;
    const key = istMonthKey(r.occurredAt);
    const m = byMonth.get(key) ?? { debit: 0, credit: 0 };
    m[r.direction as "debit" | "credit"] += r.amountPaise;
    byMonth.set(key, m);
  }

  return NextResponse.json({
    totals: { debit, credit, count: inRange.length, net: credit - debit },
    previous,
    byCategory: Array.from(byCategory.entries())
      .map(([id, total]) => ({
        id,
        name: id === "__none__" ? "Uncategorized" : (catById.get(id)?.name ?? "Unknown"),
        color: id === "__none__" ? "#8e8e93" : (catById.get(id)?.color ?? "#8e8e93"),
        total,
      }))
      .sort((a, b) => b.total - a.total),
    byChannel: Array.from(byChannel.entries())
      .map(([channel, total]) => ({ channel, total }))
      .sort((a, b) => b.total - a.total),
    topMerchants: Array.from(byMerchant.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
    byDay: Array.from(byDay.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byMonth: Array.from(byMonth.entries())
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  });
}
