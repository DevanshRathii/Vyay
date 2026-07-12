import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { parseHealthStats, transactions, type Transaction } from "@/lib/db/schema";
import { amountBidx } from "@/lib/blind-index";
import { categorize, type CategorizerContext } from "@/lib/categorize";
import { matchContact, type ContactContext } from "@/lib/contacts/match";
import { sealForUser } from "@/lib/e2e-crypto";
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

/** JSON shape sealed into transactions.encPayload for keyed users. */
export interface TransactionEncPayload {
  amountPaise: number;
  merchant: string | null;
  merchantNormalized: string | null;
  notes: string | null;
  upiId: string | null;
  referenceNumber: string | null;
  emailSubject: string | null;
  bank: string | null;
  cardLast4: string | null;
  channel: string | null;
  raw: string | null;
}

/**
 * Operational telemetry, not user data — see parseHealthStats' schema
 * comment. Best-effort: a failure here must never break ingest.
 */
async function recordParseHealth(
  provider: string,
  hits: { merchant: boolean; upiId: boolean; ref: boolean; categorized: boolean },
): Promise<void> {
  try {
    await db
      .insert(parseHealthStats)
      .values({
        provider,
        totalCount: 1,
        merchantHits: hits.merchant ? 1 : 0,
        upiHits: hits.upiId ? 1 : 0,
        refHits: hits.ref ? 1 : 0,
        categorizedHits: hits.categorized ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: parseHealthStats.provider,
        set: {
          totalCount: sql`${parseHealthStats.totalCount} + 1`,
          merchantHits: sql`${parseHealthStats.merchantHits} + ${hits.merchant ? 1 : 0}`,
          upiHits: sql`${parseHealthStats.upiHits} + ${hits.upiId ? 1 : 0}`,
          refHits: sql`${parseHealthStats.refHits} + ${hits.ref ? 1 : 0}`,
          categorizedHits: sql`${parseHealthStats.categorizedHits} + ${hits.categorized ? 1 : 0}`,
          updatedAt: Date.now(),
        },
      });
  } catch (err) {
    console.error(`[vyay] parse-health record failed for provider ${provider}:`, err);
  }
}

async function flagPotentialDuplicate(txn: Transaction, amountPaise: number): Promise<void> {
  // Match on either the plaintext amount or its blind index — a row is only
  // ever missing one of the two (never both), and matching both lets a
  // freshly-keyed user's dedup window still catch a twin from just before
  // their backfill completed. See src/lib/blind-index.ts.
  const bidx = amountBidx(txn.userId, txn.direction, amountPaise);
  const twin = (
    await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, txn.userId),
          or(eq(transactions.amountPaise, amountPaise), eq(transactions.amountBidx, bidx)),
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
  publicKey: string | null = null,
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

  const emailSubject = email.subject.slice(0, 300);
  const raw = JSON.stringify({
    from: email.from,
    subject: email.subject,
    snippet: email.snippet,
    body: email.body.slice(0, 2000),
    provider: parsed.provider,
    internalDate: email.internalDate,
  });

  // Plaintext regardless of key state — documented visible metadata, not
  // sensitive enough to seal (see CLAUDE.md's "Zero-access encryption"
  // section for the full list).
  const base = {
    userId,
    gmailMessageId: email.id,
    source: "gmail",
    occurredAt: parsed.occurredAt,
    currency: parsed.currency,
    direction: parsed.direction,
    categoryId: category.categoryId,
    categorySource: category.source,
    merchantSource,
    merchantConfidence,
    confidence: parsed.confidence,
  };

  const values = publicKey
    ? {
        ...base,
        amountPaise: null,
        amountBidx: amountBidx(userId, parsed.direction, parsed.amountPaise),
        encPayload: sealForUser(publicKey, {
          amountPaise: parsed.amountPaise,
          merchant: merchant ?? null,
          merchantNormalized: merchantNormalized ?? null,
          notes: null,
          upiId: parsed.upiId ?? null,
          referenceNumber: parsed.referenceNumber ?? null,
          emailSubject,
          bank: parsed.bank ?? null,
          cardLast4: parsed.cardLast4 ?? null,
          channel: parsed.channel ?? null,
          raw,
        } satisfies TransactionEncPayload),
      }
    : {
        ...base,
        amountPaise: parsed.amountPaise,
        merchant,
        merchantNormalized,
        channel: parsed.channel,
        bank: parsed.bank,
        referenceNumber: parsed.referenceNumber,
        upiId: parsed.upiId,
        cardLast4: parsed.cardLast4,
        emailSubject,
        raw,
      };

  const insertedRows = await db.insert(transactions).values(values).onConflictDoNothing().returning();
  const inserted = insertedRows[0];

  if (!inserted) return { status: "duplicate-message" };

  await recordParseHealth(parsed.provider, {
    merchant: Boolean(merchant),
    upiId: Boolean(parsed.upiId),
    ref: Boolean(parsed.referenceNumber),
    categorized: Boolean(category.categoryId),
  });
  await flagPotentialDuplicate(inserted, parsed.amountPaise);
  await tryResolvePendingShortcuts(userId, inserted, parsed.amountPaise);
  return { status: "inserted", transaction: inserted };
}
