import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { shortcutEvents, transactions, type ShortcutEvent, type Transaction } from "@/lib/db/schema";
import { amountBidx } from "@/lib/blind-index";

/** How far a logged expense may be from the matching email, in hours —
 *  the manual/candidate-listing window shown on the Matches page. */
export const MATCH_WINDOW_HOURS = 72;

/** Tight window for *auto*-applying a match with no manual review — see
 *  pickAutoMatch. Both sides of the comparison carry actual transaction
 *  time (parsed email time, or the Shortcut's `timestamp` field), not
 *  arrival time, so 30 minutes is safe without becoming trigger-happy on a
 *  day with two same-amount purchases. */
export const MATCH_AUTO_WINDOW_MS = 30 * 60 * 1000;

/**
 * Find Gmail transactions that could correspond to a Shortcut-logged expense:
 * exact amount, same direction, within the time window, not deleted. Matches
 * on the plaintext amount OR its blind index — a row only ever has one of
 * the two set, so this covers keyed and non-keyed rows in one query (and any
 * mixed state mid-backfill). Ordered closest-in-time first, since that's
 * what deciding an auto-match cares about — categorization state is a
 * secondary tiebreaker.
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
    .orderBy(asc(sql`abs(${transactions.occurredAt} - ${opts.at})`), asc(sql`${transactions.categoryId} IS NOT NULL`))
    .limit(opts.limit ?? 5);
}

/**
 * Tiered auto-match decision, shared by both match directions (a fresh
 * Shortcut log searching for a transaction, and a fresh transaction
 * searching pending Shortcut logs):
 *   - zero candidates: nothing to do.
 *   - exactly one candidate anywhere in the wide window: unambiguous,
 *     auto-apply it (this is the common case — most logged expenses have
 *     exactly one plausible transaction).
 *   - multiple candidates: only auto-apply if exactly one falls inside the
 *     tight 30-minute window — e.g. two ₹450 coffees on the same day stay
 *     ambiguous and go to the Matches page instead of pairing with
 *     whichever happened to be logged/ingested first.
 */
export function pickAutoMatch<T extends { occurredAt: number }>(candidates: T[], targetAt: number): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const within = candidates.filter((c) => Math.abs(c.occurredAt - targetAt) <= MATCH_AUTO_WINDOW_MS);
  return within.length === 1 ? within[0] : null;
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
 * waiting for exactly this amount/direction near this time, resolve it via
 * the same tiered auto-match rule as the log route (pickAutoMatch) —
 * unambiguous if there's exactly one candidate, or exactly one within 30
 * minutes when there are several same-amount logs. `amountPaise` is passed
 * explicitly (rather than read off `txn`) because a keyed transaction's own
 * amountPaise column is null. The window filter and tiebreak both use each
 * event's *logged* time (occurredAt, from the Shortcut's `timestamp` field)
 * falling back to createdAt (arrival time) for events logged before that
 * field existed.
 */
export async function tryResolvePendingShortcuts(
  userId: string,
  txn: Transaction,
  amountPaise: number,
): Promise<void> {
  const windowMs = MATCH_WINDOW_HOURS * 3600 * 1000;
  const bidx = amountBidx(userId, txn.direction, amountPaise);
  const effectiveTime = sql<number>`coalesce(${shortcutEvents.occurredAt}, ${shortcutEvents.createdAt})`;
  const pending = await db
    .select()
    .from(shortcutEvents)
    .where(
      and(
        eq(shortcutEvents.userId, userId),
        eq(shortcutEvents.status, "pending"),
        or(eq(shortcutEvents.amountPaise, amountPaise), eq(shortcutEvents.amountBidx, bidx)),
        eq(shortcutEvents.direction, txn.direction),
        gte(effectiveTime, txn.occurredAt - windowMs),
        lte(effectiveTime, txn.occurredAt + windowMs),
      ),
    )
    .orderBy(asc(sql`abs(${effectiveTime} - ${txn.occurredAt})`));
  const chosen = pickAutoMatch(
    pending.map((e) => ({ ...e, occurredAt: e.occurredAt ?? e.createdAt })),
    txn.occurredAt,
  );
  if (!chosen) return;
  await applyEventToTransaction(chosen, txn.id, "matched");
}
