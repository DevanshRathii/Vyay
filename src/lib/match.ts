import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { shortcutEvents, transactions, type ShortcutEvent, type Transaction } from "@/lib/db/schema";
import { amountBidx } from "@/lib/blind-index";

/** How far a logged expense may be from the matching email, in hours. */
export const MATCH_WINDOW_HOURS = 72;

/**
 * Find Gmail transactions that could correspond to a Shortcut-logged expense:
 * exact amount, same direction, within the time window, not deleted. Matches
 * on the plaintext amount OR its blind index — a row only ever has one of
 * the two set, so this covers keyed and non-keyed rows in one query (and any
 * mixed state mid-backfill). Uncategorized transactions are preferred, then
 * closest in time.
 */
export async function findCandidates(
  userId: string,
  opts: {
    /** Plaintext amount, when the caller has it (e.g. a fresh Shortcut log). */
    amountPaise?: number | null;
    /** Precomputed blind index, when the caller only has a keyed row (e.g. an
     *  existing pending shortcut event, whose plaintext amount is sealed). */
    amountBidx?: string | null;
    direction: string;
    at: number;
    limit?: number;
  },
): Promise<Transaction[]> {
  const windowMs = MATCH_WINDOW_HOURS * 3600 * 1000;
  const amountConds = [];
  if (opts.amountPaise != null) amountConds.push(eq(transactions.amountPaise, opts.amountPaise));
  if (opts.amountBidx) amountConds.push(eq(transactions.amountBidx, opts.amountBidx));
  else if (opts.amountPaise != null) amountConds.push(eq(transactions.amountBidx, amountBidx(userId, opts.direction, opts.amountPaise)));
  if (amountConds.length === 0) return [];

  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        or(...amountConds),
        eq(transactions.direction, opts.direction),
        isNull(transactions.deletedAt),
        gte(transactions.occurredAt, opts.at - windowMs),
        lte(transactions.occurredAt, opts.at + windowMs),
      ),
    )
    .orderBy(asc(sql`${transactions.categoryId} IS NOT NULL`), asc(sql`abs(${transactions.occurredAt} - ${opts.at})`))
    .limit(opts.limit ?? 5);
}

/** Apply a shortcut event's category/notes to a transaction and close the event. */
export async function applyEventToTransaction(
  event: ShortcutEvent,
  transactionId: string,
  status: "matched" | "resolved",
): Promise<void> {
  await db
    .update(transactions)
    .set({
      categoryId: event.categoryId,
      // Keyed transactions carry notes inside encPayload, which the server
      // cannot decrypt/re-seal — leave them alone rather than clobbering
      // with a plaintext value. The shortcut event itself still keeps its
      // own encPayload with these notes, visible via client-side decrypt.
      ...(event.encPayload ? {} : { notes: event.notes ?? undefined }),
      updatedAt: Date.now(),
    })
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, event.userId)));
  await db
    .update(shortcutEvents)
    .set({ status, matchedTransactionId: transactionId })
    .where(eq(shortcutEvents.id, event.id));
}

/**
 * Called after a new transaction is ingested: if a pending Shortcut event is
 * waiting for exactly this amount/direction near this time, resolve it.
 * `amountPaise` is passed explicitly (rather than read off `txn`) because a
 * keyed transaction's own amountPaise column is null.
 */
export async function tryResolvePendingShortcuts(
  userId: string,
  txn: Transaction,
  amountPaise: number,
): Promise<void> {
  const windowMs = MATCH_WINDOW_HOURS * 3600 * 1000;
  const bidx = amountBidx(userId, txn.direction, amountPaise);
  const pending = await db
    .select()
    .from(shortcutEvents)
    .where(
      and(
        eq(shortcutEvents.userId, userId),
        eq(shortcutEvents.status, "pending"),
        or(eq(shortcutEvents.amountPaise, amountPaise), eq(shortcutEvents.amountBidx, bidx)),
        eq(shortcutEvents.direction, txn.direction),
        gte(shortcutEvents.createdAt, txn.occurredAt - windowMs),
        lte(shortcutEvents.createdAt, txn.occurredAt + windowMs),
      ),
    )
    .orderBy(asc(shortcutEvents.createdAt));
  if (pending.length === 0) return;
  // Resolve the oldest waiting event with this fresh transaction.
  await applyEventToTransaction(pending[0], txn.id, "matched");
}
