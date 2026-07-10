import { and, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, type Transaction } from "@/lib/db/schema";
import { categorize, type CategorizerContext } from "@/lib/categorize";
import { matchContact, type ContactContext } from "@/lib/contacts/match";
import { resolveMerchant } from "@/lib/merchant";
import { classifyEmail } from "@/lib/parsing/detect";
import { parseEmail } from "@/lib/parsing/engine";
import type { EmailMessage } from "@/lib/parsing/types";
import { tryResolvePendingShortcuts } from "@/lib/match";

export type IngestOutcome =
  | { status: "inserted"; transaction: Transaction }
  | { status: "duplicate-message" }
  | { status: "skipped"; reason: string };

/** Mark near-identical transactions (same amount/direction within 3 minutes). */
const DUPLICATE_WINDOW_MS = 3 * 60 * 1000;

async function flagPotentialDuplicate(txn: Transaction): Promise<void> {
  const twin = (
    await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, txn.userId),
          eq(transactions.amountPaise, txn.amountPaise),
          eq(transactions.direction, txn.direction),
          gte(transactions.occurredAt, txn.occurredAt - DUPLICATE_WINDOW_MS),
          lte(transactions.occurredAt, txn.occurredAt + DUPLICATE_WINDOW_MS),
          ne(transactions.id, txn.id),
          isNull(transactions.deletedAt),
          isNull(transactions.duplicateOfId),
        ),
      )
      .limit(1)
  )[0];
  if (twin) {
    await db.update(transactions).set({ duplicateOfId: twin.id }).where(eq(transactions.id, txn.id));
    txn.duplicateOfId = twin.id;
  }
}

/**
 * Process one Gmail message end to end. Idempotent: the unique index on
 * (userId, gmailMessageId) makes re-ingesting the same message a no-op.
 */
export async function ingestEmail(
  userId: string,
  email: EmailMessage,
  ctx: CategorizerContext,
  contactCtx: ContactContext,
): Promise<IngestOutcome> {
  const detection = classifyEmail(email);
  if (!detection.isTransaction) return { status: "skipped", reason: detection.reason };

  const parsed = parseEmail(email);
  if (!parsed) return { status: "skipped", reason: "unparseable" };

  // A saved contact is the golden source — it wins even over a name the
  // bank's own email already included.
  const contact = matchContact(contactCtx, { merchant: parsed.merchant, upiId: parsed.upiId });
  const { merchant, merchantSource, merchantConfidence, merchantNormalized } = resolveMerchant(
    parsed.merchant,
    parsed.merchantSource,
    parsed.merchantConfidence,
    parsed.upiId,
    contact?.name ?? null,
  );

  const category = categorize(ctx, {
    merchantNormalized,
    merchant,
    upiId: parsed.upiId,
    subject: email.subject,
  });

  const insertedRows = await db
    .insert(transactions)
    .values({
      userId,
      gmailMessageId: email.id,
      source: "gmail",
      occurredAt: parsed.occurredAt,
      amountPaise: parsed.amountPaise,
      currency: parsed.currency,
      direction: parsed.direction,
      merchant,
      merchantNormalized,
      merchantSource,
      merchantConfidence,
      channel: parsed.channel,
      bank: parsed.bank,
      referenceNumber: parsed.referenceNumber,
      upiId: parsed.upiId,
      cardLast4: parsed.cardLast4,
      emailSubject: email.subject.slice(0, 300),
      confidence: parsed.confidence,
      categoryId: category.categoryId,
      categorySource: category.source,
      raw: JSON.stringify({
        from: email.from,
        subject: email.subject,
        snippet: email.snippet,
        body: email.body.slice(0, 2000),
        provider: parsed.provider,
        internalDate: email.internalDate,
      }),
    })
    .onConflictDoNothing()
    .returning();
  const inserted = insertedRows[0];

  if (!inserted) return { status: "duplicate-message" };

  await flagPotentialDuplicate(inserted);
  await tryResolvePendingShortcuts(userId, inserted);
  return { status: "inserted", transaction: inserted };
}
