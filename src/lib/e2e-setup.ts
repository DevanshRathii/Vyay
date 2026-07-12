import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { shortcutEvents, transactions } from "@/lib/db/schema";
import { amountBidx, refBidx } from "@/lib/blind-index";
import { sealForUser } from "@/lib/e2e-crypto";
import type { TransactionEncPayload } from "@/lib/ingest";

const BACKFILL_BATCH_SIZE = 200;

/**
 * Seal every not-yet-sealed row for a newly-keyed user. Idempotent and safe
 * to re-run (each batch only ever selects rows still missing encPayload) —
 * a serverless timeout mid-backfill just means the next call picks up where
 * the last one left off.
 */
export async function backfillUser(userId: string, publicKey: string): Promise<void> {
  for (;;) {
    const batch = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.encPayload)))
      .limit(BACKFILL_BATCH_SIZE);
    if (batch.length === 0) break;

    for (const row of batch) {
      const payload: TransactionEncPayload = {
        amountPaise: row.amountPaise ?? 0,
        merchant: row.merchant,
        merchantNormalized: row.merchantNormalized,
        notes: row.notes,
        upiId: row.upiId,
        referenceNumber: row.referenceNumber,
        emailSubject: row.emailSubject,
        bank: row.bank,
        cardLast4: row.cardLast4,
        channel: row.channel,
        raw: row.raw,
      };
      await db
        .update(transactions)
        .set({
          encPayload: sealForUser(publicKey, payload),
          amountBidx: amountBidx(userId, row.direction, row.amountPaise ?? 0),
          refBidx: row.referenceNumber ? refBidx(userId, row.referenceNumber) : null,
          amountPaise: null,
          merchant: null,
          merchantNormalized: null,
          notes: null,
          upiId: null,
          referenceNumber: null,
          emailSubject: null,
          bank: null,
          cardLast4: null,
          channel: null,
          raw: null,
        })
        .where(eq(transactions.id, row.id));
    }
  }

  for (;;) {
    const batch = await db
      .select()
      .from(shortcutEvents)
      .where(and(eq(shortcutEvents.userId, userId), isNull(shortcutEvents.encPayload)))
      .limit(BACKFILL_BATCH_SIZE);
    if (batch.length === 0) break;

    for (const row of batch) {
      await db
        .update(shortcutEvents)
        .set({
          encPayload: sealForUser(publicKey, { amountPaise: row.amountPaise ?? 0, notes: row.notes }),
          amountBidx: amountBidx(userId, row.direction, row.amountPaise ?? 0),
          amountPaise: null,
          notes: null,
        })
        .where(eq(shortcutEvents.id, row.id));
    }
  }
}

/** Rows still awaiting backfill — drives the setup screen's progress bar. */
export async function backfillRemaining(userId: string): Promise<number> {
  const [txns, events] = await Promise.all([
    db
      .select({ n: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.encPayload))),
    db
      .select({ n: count() })
      .from(shortcutEvents)
      .where(and(eq(shortcutEvents.userId, userId), isNull(shortcutEvents.encPayload))),
  ]);
  return (txns[0]?.n ?? 0) + (events[0]?.n ?? 0);
}
