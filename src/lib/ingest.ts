import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { parseHealthStats, transactions, type Transaction } from "@/lib/db/schema";
import { amountBidx, refBidx } from "@/lib/blind-index";
import { categorize, type CategorizerContext } from "@/lib/categorize";
import { matchContact, type ContactContext } from "@/lib/contacts/match";
import { sealForUser } from "@/lib/e2e-crypto";
import { resolveMerchant } from "@/lib/merchant";
import { classifyEmail } from "@/lib/parsing/detect";
import { parseEmail } from "@/lib/parsing/engine";
import type { EmailMessage, ParsedTransaction } from "@/lib/parsing/types";
import { tryResolvePendingShortcuts } from "@/lib/match";

export type IngestOutcome =
  | { status: "inserted"; transaction: Transaction }
  | { status: "duplicate-message" }
  | { status: "skipped"; reason: string };

/** Mark near-identical transactions (same amount/direction within 3 minutes)
 *  when both sides have a precise timestamp. Widened for imprecise ones —
 *  see flagPotentialDuplicate. */
const DUPLICATE_WINDOW_MS = 3 * 60 * 1000;
/** Same-source templates that only carry a bare date (no time-of-day) push
 *  occurredAt to a fallback estimate that can be many hours off a sibling
 *  message's precise timestamp for the exact same real-world transaction
 *  (confirmed: HDFC's "AutoPay Success" labeled receipt vs. its own generic
 *  card-spend SMS for the identical debit) — a 3-minute window would miss
 *  that pair entirely. A same-calendar-day-scale window still can't produce
 *  false positives that a tight window wouldn't also risk in principle
 *  (same amount+direction is already a real signal), it just tolerates the
 *  fallback-timestamp's imprecision. */
const IMPRECISE_DUPLICATE_WINDOW_MS = 20 * 60 * 60 * 1000;

/** A transaction reduced to its parsed, not-yet-resolved fields — the
 *  source-agnostic input to ingestParsedTransaction. Every real ingestion
 *  source (Gmail email today; SMS/Wallet below) produces this same shape;
 *  merchant resolution, categorization, sealing, dedup, and Shortcut
 *  matching then run identically regardless of where it came from. */
export type NormalizedTxn = Omit<ParsedTransaction, "provider"> & {
  /** The originating email's subject, truncated — set for Gmail only. */
  emailSubject?: string;
};

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

/**
 * Cross-source duplicate detection — the same payment can be seen by more
 * than one ingestion source (email + SMS + statement, once those exist),
 * so this looks for either signal:
 *   - Reference match (strong): a bank reference number (UPI RRN/UTR) is
 *     the same money moving once, regardless of how far apart the two rows
 *     landed in time — a statement backfilled weeks later still matches.
 *   - Amount+time match (weak, existing behavior): same amount/direction
 *     within a tight window, for sources with no reference number. Widened
 *     when either row's timestamp is a fallback guess rather than a real
 *     parsed time-of-day.
 * First-ingested row is canonical; the later one gets duplicateOfId.
 */
async function flagPotentialDuplicate(
  txn: Transaction,
  amountPaise: number,
  referenceNumber: string | null,
): Promise<void> {
  const baseConds = [
    eq(transactions.userId, txn.userId),
    ne(transactions.id, txn.id),
    isNull(transactions.deletedAt),
    isNull(transactions.duplicateOfId),
  ];

  // Reference match first (strong signal, any time distance) — a bank
  // reference number (UPI RRN/UTR) is the same money moving once, so this
  // catches e.g. a statement backfilled weeks after the original email.
  if (referenceNumber) {
    const refIndex = refBidx(txn.userId, referenceNumber);
    const refTwin = (
      await db
        .select()
        .from(transactions)
        .where(
          and(
            ...baseConds,
            refIndex
              ? or(eq(transactions.referenceNumber, referenceNumber), eq(transactions.refBidx, refIndex))
              : eq(transactions.referenceNumber, referenceNumber),
          ),
        )
        .limit(1)
    )[0];
    if (refTwin) {
      await db.update(transactions).set({ duplicateOfId: refTwin.id }).where(eq(transactions.id, txn.id));
      txn.duplicateOfId = refTwin.id;
      return;
    }
  }

  // Fall back to amount+time (weak signal) — for sources with no reference
  // number, or when the reference didn't match anything yet. Match on either
  // the plaintext value or its blind index — a row is only ever missing one
  // of the two (never both), and matching both lets a freshly-keyed user's
  // dedup window still catch a twin from just before their backfill
  // completed. See src/lib/blind-index.ts.
  // The tight window always applies; the wide one additionally covers the
  // case where *either* side of the comparison is a fallback estimate — the
  // new row (its own occurredAtPrecise), or an already-stored candidate
  // (checked via the column) — since a fixed 3-minute window is meaningless
  // against a guessed timestamp on either end.
  const bidx = amountBidx(txn.userId, txn.direction, amountPaise);
  const timeMatch = txn.occurredAtPrecise
    ? or(
        and(
          gte(transactions.occurredAt, txn.occurredAt - DUPLICATE_WINDOW_MS),
          lte(transactions.occurredAt, txn.occurredAt + DUPLICATE_WINDOW_MS),
        ),
        and(
          eq(transactions.occurredAtPrecise, false),
          gte(transactions.occurredAt, txn.occurredAt - IMPRECISE_DUPLICATE_WINDOW_MS),
          lte(transactions.occurredAt, txn.occurredAt + IMPRECISE_DUPLICATE_WINDOW_MS),
        ),
      )
    : and(
        gte(transactions.occurredAt, txn.occurredAt - IMPRECISE_DUPLICATE_WINDOW_MS),
        lte(transactions.occurredAt, txn.occurredAt + IMPRECISE_DUPLICATE_WINDOW_MS),
      );
  const twin = (
    await db
      .select()
      .from(transactions)
      .where(
        and(
          ...baseConds,
          or(eq(transactions.amountPaise, amountPaise), eq(transactions.amountBidx, bidx)),
          eq(transactions.direction, txn.direction),
          timeMatch,
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
 * Resolve merchant/category, seal-or-store plaintext, insert, and run
 * cross-source dedup + Shortcut matching — the common tail of every
 * ingestion source once it has produced a NormalizedTxn. Idempotent via the
 * unique (userId, gmailMessageId) index, keyed by `opts.externalId` (source-
 * prefixed for non-Gmail rows: "sms:<hash>", "wallet:<hash>").
 */
export async function ingestParsedTransaction(
  userId: string,
  parsed: NormalizedTxn,
  opts: {
    source: "gmail" | "sms" | "wallet";
    externalId: string;
    raw: string | null;
    publicKey: string | null;
    ctx: CategorizerContext;
    contactCtx: ContactContext;
    /** For parse-health telemetry only — omit for sources with no provider
     *  registry concept (e.g. Wallet, which has no sender/body to classify). */
    provider?: string;
  },
): Promise<IngestOutcome> {
  // A saved contact is the golden source — it wins even over a name the
  // source itself already included.
  const contact = matchContact(opts.contactCtx, { merchant: parsed.merchant, upiId: parsed.upiId });
  const { merchant, merchantSource, merchantConfidence, merchantNormalized } = resolveMerchant(
    parsed.merchant,
    parsed.merchantSource,
    parsed.merchantConfidence,
    parsed.upiId,
    contact?.name ?? null,
  );

  const category = categorize(opts.ctx, {
    merchantNormalized,
    merchant,
    upiId: parsed.upiId,
    subject: parsed.emailSubject ?? "",
  });

  const base = {
    userId,
    gmailMessageId: opts.externalId,
    source: opts.source,
    occurredAt: parsed.occurredAt,
    occurredAtPrecise: parsed.occurredAtPrecise,
    currency: parsed.currency,
    direction: parsed.direction,
    categoryId: category.categoryId,
    categorySource: category.source,
    merchantSource,
    merchantConfidence,
    confidence: parsed.confidence,
  };

  const values = opts.publicKey
    ? {
        ...base,
        amountPaise: null,
        amountBidx: amountBidx(userId, parsed.direction, parsed.amountPaise),
        refBidx: parsed.referenceNumber ? refBidx(userId, parsed.referenceNumber) : null,
        encPayload: sealForUser(opts.publicKey, {
          amountPaise: parsed.amountPaise,
          merchant: merchant ?? null,
          merchantNormalized: merchantNormalized ?? null,
          notes: null,
          upiId: parsed.upiId ?? null,
          referenceNumber: parsed.referenceNumber ?? null,
          emailSubject: parsed.emailSubject ?? null,
          bank: parsed.bank ?? null,
          cardLast4: parsed.cardLast4 ?? null,
          channel: parsed.channel ?? null,
          raw: opts.raw,
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
        emailSubject: parsed.emailSubject,
        raw: opts.raw,
      };

  const insertedRows = await db.insert(transactions).values(values).onConflictDoNothing().returning();
  const inserted = insertedRows[0];

  if (!inserted) return { status: "duplicate-message" };

  if (opts.provider) {
    await recordParseHealth(opts.provider, {
      merchant: Boolean(merchant),
      upiId: Boolean(parsed.upiId),
      ref: Boolean(parsed.referenceNumber),
      categorized: Boolean(category.categoryId),
    });
  }
  await flagPotentialDuplicate(inserted, parsed.amountPaise, parsed.referenceNumber ?? null);
  await tryResolvePendingShortcuts(userId, inserted, parsed.amountPaise);
  return { status: "inserted", transaction: inserted };
}

/**
 * Process one Gmail message end to end: classify + parse, then hand off to
 * the source-agnostic ingestParsedTransaction. Idempotent: the unique index
 * on (userId, gmailMessageId) makes re-ingesting the same message a no-op.
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

  const emailSubject = email.subject.slice(0, 300);
  const raw = JSON.stringify({
    from: email.from,
    subject: email.subject,
    snippet: email.snippet,
    body: email.body.slice(0, 2000),
    provider: parsed.provider,
    internalDate: email.internalDate,
  });

  return ingestParsedTransaction(
    userId,
    { ...parsed, emailSubject },
    { source: "gmail", externalId: email.id, raw, publicKey, ctx, contactCtx, provider: parsed.provider },
  );
}
