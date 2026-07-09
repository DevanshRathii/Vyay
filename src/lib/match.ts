import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { shortcutEvents, transactions, type ShortcutEvent, type Transaction } from "@/lib/db/schema";

/** How far a logged expense may be from the matching email, in hours. */
export const MATCH_WINDOW_HOURS = 72;

/**
 * Find Gmail transactions that could correspond to a Shortcut-logged expense:
 * exact amount, same direction, within the time window, not deleted.
 * Uncategorized transactions are preferred, then closest in time.
 */
export function findCandidates(
  userId: string,
  opts: { amountPaise: number; direction: string; at: number; limit?: number },
): Transaction[] {
  const windowMs = MATCH_WINDOW_HOURS * 3600 * 1000;
  const rows = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.amountPaise, opts.amountPaise),
        eq(transactions.direction, opts.direction),
        isNull(transactions.deletedAt),
        gte(transactions.occurredAt, opts.at - windowMs),
        lte(transactions.occurredAt, opts.at + windowMs),
      ),
    )
    .orderBy(asc(sql`${transactions.categoryId} IS NOT NULL`), asc(sql`abs(${transactions.occurredAt} - ${opts.at})`))
    .limit(opts.limit ?? 5)
    .all();
  return rows;
}

/** Apply a shortcut event's category/notes to a transaction and close the event. */
export function applyEventToTransaction(event: ShortcutEvent, transactionId: string, status: "matched" | "resolved") {
  db.update(transactions)
    .set({
      categoryId: event.categoryId,
      notes: event.notes ?? undefined,
      updatedAt: Date.now(),
    })
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, event.userId)))
    .run();
  db.update(shortcutEvents)
    .set({ status, matchedTransactionId: transactionId })
    .where(eq(shortcutEvents.id, event.id))
    .run();
}

/**
 * Called after a new transaction is ingested: if a pending Shortcut event is
 * waiting for exactly this amount/direction near this time, resolve it.
 */
export function tryResolvePendingShortcuts(userId: string, txn: Transaction): void {
  const windowMs = MATCH_WINDOW_HOURS * 3600 * 1000;
  const pending = db
    .select()
    .from(shortcutEvents)
    .where(
      and(
        eq(shortcutEvents.userId, userId),
        eq(shortcutEvents.status, "pending"),
        eq(shortcutEvents.amountPaise, txn.amountPaise),
        eq(shortcutEvents.direction, txn.direction),
        gte(shortcutEvents.createdAt, txn.occurredAt - windowMs),
        lte(shortcutEvents.createdAt, txn.occurredAt + windowMs),
      ),
    )
    .orderBy(asc(shortcutEvents.createdAt))
    .all();
  if (pending.length === 0) return;
  // Resolve the oldest waiting event with this fresh transaction.
  applyEventToTransaction(pending[0], txn.id, "matched");
}
