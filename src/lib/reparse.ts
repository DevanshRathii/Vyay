import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { categorize, loadCategorizerContext } from "@/lib/categorize";
import { loadContactContext, matchContact } from "@/lib/contacts/match";
import { collapseWhitespace } from "@/lib/gmail/fetch";
import { parseEmail } from "@/lib/parsing/engine";
import { normalizeMerchant } from "@/lib/parsing/normalize";
import type { EmailMessage } from "@/lib/parsing/types";
import { sleep } from "@/lib/utils";

export interface ReparseSummary {
  scanned: number;
  updated: number;
}

interface RawPayload {
  from?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  internalDate?: number;
}

/**
 * Re-run the parsing engine (and contact matching) against already-imported
 * transactions using their stored raw email (kept at ingest time for exactly
 * this purpose). Only parsing-derived fields are touched — amount/direction/
 * currency are left alone (no known bug there, and the stored body is
 * truncated to 2000 chars vs. the 6000 the live parse saw, so re-deriving
 * them from less context would be a regression risk for no benefit).
 * Category is only set when currently blank, so manual corrections are never
 * overwritten. Also re-applies contact matching, so newly-imported contacts
 * retroactively fix merchant names on transactions synced before they existed.
 */
export async function reparseUserTransactions(userId: string): Promise<ReparseSummary> {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.source, "gmail"),
        isNotNull(transactions.raw),
        isNull(transactions.deletedAt),
      ),
    );

  const ctx = await loadCategorizerContext(userId);
  const contactCtx = await loadContactContext(userId);
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const txn = rows[i];
    let raw: RawPayload;
    try {
      raw = JSON.parse(txn.raw!);
    } catch {
      continue;
    }
    if (!raw.body || !raw.subject || raw.internalDate == null) continue;

    const email: EmailMessage = {
      id: txn.gmailMessageId ?? txn.id,
      internalDate: raw.internalDate,
      from: raw.from ?? "",
      subject: raw.subject,
      // Older stored bodies predate the whitespace-collapse fix — apply it
      // here too, or a pathologically padded old body can still hang the
      // reference-number regexes.
      body: collapseWhitespace(raw.body),
      snippet: raw.snippet,
    };

    const parsed = parseEmail(email);
    if (parsed) {
      // A saved contact is the golden source — wins even over a name the
      // bank's own email included, and applies here too so importing a
      // contact retroactively fixes transactions synced before it existed.
      const contact = matchContact(contactCtx, { merchant: parsed.merchant, upiId: parsed.upiId });
      const merchant = contact ? contact.name : parsed.merchant;
      const merchantNormalized = normalizeMerchant(merchant ?? parsed.upiId);
      const updates: Partial<typeof transactions.$inferInsert> = {};

      if ((merchant ?? null) !== txn.merchant) updates.merchant = merchant ?? null;
      if (merchantNormalized !== txn.merchantNormalized) updates.merchantNormalized = merchantNormalized;
      if (parsed.upiId && parsed.upiId !== txn.upiId) updates.upiId = parsed.upiId;
      if (parsed.channel && parsed.channel !== txn.channel) updates.channel = parsed.channel;
      if (parsed.referenceNumber && parsed.referenceNumber !== txn.referenceNumber) {
        updates.referenceNumber = parsed.referenceNumber;
      }
      if (parsed.cardLast4 && parsed.cardLast4 !== txn.cardLast4) updates.cardLast4 = parsed.cardLast4;
      if (parsed.bank && parsed.bank !== txn.bank) updates.bank = parsed.bank;
      if (parsed.occurredAt !== txn.occurredAt) updates.occurredAt = parsed.occurredAt;
      if (parsed.confidence !== txn.confidence) updates.confidence = parsed.confidence;

      if (!txn.categoryId) {
        const categoryId = categorize(ctx, {
          merchantNormalized,
          merchant,
          upiId: parsed.upiId,
          subject: txn.emailSubject,
        });
        if (categoryId) updates.categoryId = categoryId;
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = Date.now();
        await db.update(transactions).set(updates).where(eq(transactions.id, txn.id));
        updated++;
      }
    }

    // Yield periodically — bulk CPU-bound work would otherwise starve the
    // HTTP server for the whole duration, same class of bug as the sync fix.
    if (i % 25 === 24) await sleep(0);
  }

  return { scanned: rows.length, updated };
}
