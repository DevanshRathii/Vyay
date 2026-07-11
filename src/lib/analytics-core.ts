import { istDateKey, istMonthKey } from "@/lib/utils";

export interface AnalyticsRow {
  occurredAt: number;
  amountPaise: number;
  direction: string;
  categoryId: string | null;
  channel: string | null;
  /** normalized merchant, used for slicing */
  merchant: string | null;
  /** display merchant, as stored */
  merchantRaw: string | null;
}

export interface CategoryLite {
  id: string;
  name: string;
  color: string;
}

export interface AnalyticsFilters {
  from: number;
  to: number;
  yearAgo: number;
  filterCategory: string | null;
  filterChannel: string | null;
  filterMerchant: string | null;
}

export interface AnalyticsResult {
  totals: { debit: number; credit: number; count: number; net: number };
  previous: { debit: number; credit: number } | null;
  byCategory: Array<{ id: string; name: string; color: string; total: number }>;
  byChannel: Array<{ channel: string; total: number }>;
  topMerchants: Array<{ key: string; label: string; total: number; count: number }>;
  byDay: Array<{ date: string; debit: number; credit: number }>;
  byMonth: Array<{ month: string; debit: number; credit: number }>;
}

function matchesSlice(r: AnalyticsRow, f: AnalyticsFilters): boolean {
  if (f.filterCategory !== null && (r.categoryId ?? "__none__") !== f.filterCategory) return false;
  if (f.filterChannel !== null && (r.channel ?? "Other") !== f.filterChannel) return false;
  if (f.filterMerchant !== null && (r.merchant ?? r.merchantRaw ?? "unknown") !== f.filterMerchant) return false;
  return true;
}

/**
 * Shared aggregation core for the dashboard — used by the server route
 * (non-keyed/demo accounts) and computed client-side from decrypted rows
 * (keyed accounts). `allRows` should already be scoped to the user, not
 * soft-deleted, and covering at least [min(from, yearAgo), to].
 */
export function computeAnalytics(
  allRows: AnalyticsRow[],
  categories: CategoryLite[],
  filters: AnalyticsFilters,
  /** Rows covering [from - duration, from], for the previous-period trend
   *  badges. Server callers fetch this as a second, narrower DB query for
   *  efficiency; client callers can pass their single full row set again —
   *  it's already unbounded, so filtering it here covers the same range. */
  previousRows: AnalyticsRow[] = allRows,
): AnalyticsResult {
  const { from, to, yearAgo } = filters;
  const catById = new Map(categories.map((c) => [c.id, c]));

  const rows = allRows.filter((r) => matchesSlice(r, filters));
  const inRange = rows.filter((r) => r.occurredAt >= from && r.occurredAt <= to);

  let previous: { debit: number; credit: number } | null = null;
  if (from > 0) {
    const duration = to - from;
    const prevFrom = Math.max(0, from - duration);
    let pDebit = 0;
    let pCredit = 0;
    for (const r of previousRows.filter((r) => matchesSlice(r, filters))) {
      if (r.occurredAt < prevFrom || r.occurredAt > from) continue;
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

  const byMonth = new Map<string, { debit: number; credit: number }>();
  for (const r of rows) {
    if (r.occurredAt < yearAgo) continue;
    const key = istMonthKey(r.occurredAt);
    const m = byMonth.get(key) ?? { debit: 0, credit: 0 };
    m[r.direction as "debit" | "credit"] += r.amountPaise;
    byMonth.set(key, m);
  }

  return {
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
  };
}
