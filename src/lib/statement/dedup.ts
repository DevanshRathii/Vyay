import type { StatementRow } from "./normalize";

export interface ExistingTxnLite {
  id: string;
  occurredAt: number;
  amountPaise: number | null;
  direction: string;
  referenceNumber: string | null;
}

/** Statements are backfill — importing a row that duplicates an existing
 *  transaction should be skipped, not imported-and-flagged (that's just
 *  noise for a source whose whole point is catching up on history). Two
 *  signals, same priority as the real-time cross-source dedup:
 *    - reference match (normalized, exact) — any time distance.
 *    - amount+direction within ±1 day — statements are date-precision only.
 *  One-to-one: each existing transaction can absorb at most one imported
 *  row per batch, so two identical ₹450 coffees on the same day don't both
 *  collapse onto the same existing row. Greedy by closest date. */
export function findDuplicates(rows: StatementRow[], existing: ExistingTxnLite[]): Map<number, string> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const consumed = new Set<string>();
  const result = new Map<number, string>();

  function normalizeRef(ref: string): string {
    return ref.replace(/[^a-z0-9]/gi, "").toLowerCase();
  }

  // Pass 1: reference match, strong signal regardless of time distance.
  for (const row of rows) {
    if (!row.referenceNumber) continue;
    const normalized = normalizeRef(row.referenceNumber);
    if (normalized.length < 6) continue;
    const twin = existing.find(
      (t) => !consumed.has(t.id) && t.referenceNumber && normalizeRef(t.referenceNumber) === normalized,
    );
    if (twin) {
      result.set(row.rowIndex, twin.id);
      consumed.add(twin.id);
    }
  }

  // Pass 2: amount+direction within ±1 day, closest-date-first so a batch
  // with several same-amount rows doesn't grab candidates out of order.
  const remaining = rows.filter((r) => !result.has(r.rowIndex));
  const withCandidates = remaining
    .map((row) => {
      const candidates = existing.filter(
        (t) =>
          !consumed.has(t.id) &&
          t.direction === row.direction &&
          t.amountPaise === row.amountPaise &&
          Math.abs(t.occurredAt - row.occurredAt) <= DAY_MS,
      );
      return { row, candidates };
    })
    .filter((x) => x.candidates.length > 0);

  withCandidates.sort((a, b) => {
    const aBest = Math.min(...a.candidates.map((c) => Math.abs(c.occurredAt - a.row.occurredAt)));
    const bBest = Math.min(...b.candidates.map((c) => Math.abs(c.occurredAt - b.row.occurredAt)));
    return aBest - bBest;
  });

  for (const { row } of withCandidates) {
    const stillAvailable = existing.filter(
      (t) =>
        !consumed.has(t.id) &&
        t.direction === row.direction &&
        t.amountPaise === row.amountPaise &&
        Math.abs(t.occurredAt - row.occurredAt) <= DAY_MS,
    );
    if (stillAvailable.length === 0) continue;
    stillAvailable.sort((a, b) => Math.abs(a.occurredAt - row.occurredAt) - Math.abs(b.occurredAt - row.occurredAt));
    const chosen = stillAvailable[0];
    result.set(row.rowIndex, chosen.id);
    consumed.add(chosen.id);
  }

  return result;
}
