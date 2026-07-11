import { and, eq, gte, isNull, isNotNull, like, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { transactions } from "@/lib/db/schema";

/** Below this, the Ledger flags a merchant name as a guess worth verifying. */
export const LOW_MERCHANT_CONFIDENCE = 0.6;

/** Translate ledger query params into Drizzle WHERE conditions (shared by list + export). */
export function buildTransactionFilters(userId: string, params: URLSearchParams): SQL[] {
  const conds: SQL[] = [eq(transactions.userId, userId) as SQL];

  if (params.get("onlyDeleted") === "1") conds.push(isNotNull(transactions.deletedAt) as SQL);
  else if (params.get("includeDeleted") !== "1") conds.push(isNull(transactions.deletedAt) as SQL);

  const q = params.get("q")?.trim().toLowerCase();
  if (q) {
    const pat = `%${q}%`;
    conds.push(
      or(
        like(sql`lower(${transactions.merchant})`, pat),
        like(sql`lower(${transactions.merchantNormalized})`, pat),
        like(sql`lower(${transactions.notes})`, pat),
        like(sql`lower(${transactions.upiId})`, pat),
        like(sql`lower(${transactions.emailSubject})`, pat),
        like(sql`lower(${transactions.referenceNumber})`, pat),
      ) as SQL,
    );
  }

  const category = params.get("category");
  if (category === "uncategorized") conds.push(isNull(transactions.categoryId) as SQL);
  else if (category) conds.push(eq(transactions.categoryId, category) as SQL);

  if (params.get("lowConfidence") === "1") {
    conds.push(
      and(
        isNotNull(transactions.merchantConfidence),
        lt(transactions.merchantConfidence, LOW_MERCHANT_CONFIDENCE),
      ) as SQL,
    );
  }

  if (params.get("categorySource") === "generic") {
    conds.push(eq(transactions.categorySource, "generic") as SQL);
  }

  const channel = params.get("channel");
  if (channel) conds.push(eq(transactions.channel, channel) as SQL);

  const direction = params.get("direction");
  if (direction === "debit" || direction === "credit")
    conds.push(eq(transactions.direction, direction) as SQL);

  const from = Number(params.get("from"));
  if (from) conds.push(gte(transactions.occurredAt, from) as SQL);
  const to = Number(params.get("to"));
  if (to) conds.push(lte(transactions.occurredAt, to) as SQL);

  return conds;
}

/** Row shape the client-side ledger predicate operates on — a subset of
 *  DecryptedTxn (src/lib/use-transactions.ts), kept dependency-free here so
 *  this file stays safe to import from the client bundle. */
export interface LedgerFilterRow {
  merchant: string | null;
  merchantNormalized: string | null;
  notes: string | null;
  upiId: string | null;
  emailSubject: string | null;
  referenceNumber: string | null;
  categoryId: string | null;
  merchantConfidence: number | null;
  categorySource: string | null;
  channel: string | null;
  direction: string;
  occurredAt: number;
  deletedAt: number | null;
}

export interface LedgerFilters {
  q?: string;
  category?: string;
  channel?: string;
  direction?: string;
  onlyDeleted?: boolean;
  includeDeleted?: boolean;
  lowConfidence?: boolean;
  categorySource?: string;
  from?: number;
  to?: number;
}

/**
 * Client-side port of buildTransactionFilters, for the keyed ledger's
 * useMemo predicates (server-side filtering isn't possible once the rows
 * are ciphertext). Semantics — including lowercase substring matching —
 * are kept identical to the SQL version above.
 */
export function matchesLedgerFilters(t: LedgerFilterRow, f: LedgerFilters): boolean {
  if (f.onlyDeleted) {
    if (t.deletedAt == null) return false;
  } else if (!f.includeDeleted) {
    if (t.deletedAt != null) return false;
  }

  const q = f.q?.trim().toLowerCase();
  if (q) {
    const hay = [t.merchant, t.merchantNormalized, t.notes, t.upiId, t.emailSubject, t.referenceNumber]
      .filter((v): v is string => v != null)
      .map((v) => v.toLowerCase());
    if (!hay.some((v) => v.includes(q))) return false;
  }

  if (f.category === "uncategorized") {
    if (t.categoryId != null) return false;
  } else if (f.category) {
    if (t.categoryId !== f.category) return false;
  }

  if (f.lowConfidence) {
    if (t.merchantConfidence == null || t.merchantConfidence >= LOW_MERCHANT_CONFIDENCE) return false;
  }

  if (f.categorySource === "generic" && t.categorySource !== "generic") return false;
  if (f.channel && t.channel !== f.channel) return false;
  if ((f.direction === "debit" || f.direction === "credit") && t.direction !== f.direction) return false;
  if (f.from && t.occurredAt < f.from) return false;
  if (f.to && t.occurredAt > f.to) return false;

  return true;
}
