import type { Category, Contact, MerchantRule } from "@/lib/db/schema";
import { buildCategorizerContext, categorize } from "@/lib/categorize-context";
import { buildContactContext, matchContact } from "@/lib/contacts/context";
import type { TransactionEncPayload } from "@/lib/ingest";
import { resolveMerchant } from "@/lib/merchant";
import { parseEmail } from "@/lib/parsing/engine";
import { normalizeMerchant } from "@/lib/parsing/normalize";
import type { EmailMessage } from "@/lib/parsing/types";

/**
 * Client-side equivalent of reparseUserTransactions() (src/lib/reparse.ts)
 * for KEYED accounts — the server can never decrypt their sealed raw email
 * to do this itself, so this is the only place the work can happen. Fetches
 * everything it needs via the same endpoints the rest of the app already
 * uses, decrypts each transaction's raw email client-side, re-runs the
 * exact same pipeline (parse → contact match → merchant resolve →
 * categorize) as ingest/reparse, and re-seals + PATCHes only rows that
 * actually changed. Mirrors reparse.ts's protections exactly: category is
 * only filled when currently unset (never overwrites a manual pick);
 * amount/notes are never touched; upiId/referenceNumber/bank/cardLast4/
 * channel only update when the new parse actually found a value (never
 * erase a previously-known fact with "not found this time"); merchant/
 * merchantNormalized always reflect the current best guess, same as the
 * server path.
 *
 * Deliberately does NOT touch merchantSource/merchantConfidence/confidence/
 * occurredAt — those are separate plaintext columns on a keyed row, and
 * extending the plaintext PATCH surface for them wasn't worth it for what's
 * a confidence-score/cosmetic refinement, not the "wrong merchant/never
 * categorized" class of bug this exists to fix.
 */

interface RawPayload {
  from?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  internalDate?: number;
}

function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

interface KeyedRow {
  id: string;
  source: string;
  deletedAt: number | null;
  categoryId: string | null;
  encPayload: string | null;
}

interface ContactRow {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
}

export interface ParserSyncDeps {
  decrypt: <T>(blob: string) => T;
  seal: (obj: unknown) => string;
}

export async function runClientParserSync(deps: ParserSyncDeps): Promise<void> {
  const [txnsRes, catsRes, rulesRes, contactsRes] = await Promise.all([
    fetch("/api/transactions"),
    fetch("/api/categories"),
    fetch("/api/rules"),
    fetch("/api/contacts"),
  ]);
  if (!txnsRes.ok) return;

  const txnsBody: { rows: KeyedRow[] } = await txnsRes.json();
  const cats: Category[] = catsRes.ok ? (await catsRes.json()).rows : [];
  const userRules: MerchantRule[] = rulesRes.ok ? (await rulesRes.json()).rows : [];
  const contactRows: ContactRow[] = contactsRes.ok ? (await contactsRes.json()).rows : [];

  const ctx = buildCategorizerContext(cats, userRules);
  const contactCtx = buildContactContext(
    contactRows.map(
      (c) =>
        ({
          id: c.id,
          userId: "",
          name: c.name,
          nameNormalized: normalizeMerchant(c.name) ?? "",
          phones: JSON.stringify(c.phones),
          emails: JSON.stringify(c.emails),
          createdAt: 0,
        }) as Contact,
    ),
  );

  for (const row of txnsBody.rows) {
    if (row.source !== "gmail" || row.deletedAt != null || !row.encPayload) continue;

    let payload: TransactionEncPayload;
    try {
      payload = deps.decrypt<TransactionEncPayload>(row.encPayload);
    } catch {
      continue; // wrong/missing key, or not actually a sealed payload — skip, don't crash the pass
    }
    if (!payload.raw) continue;

    let raw: RawPayload;
    try {
      raw = JSON.parse(payload.raw);
    } catch {
      continue;
    }
    if (!raw.body || !raw.subject || raw.internalDate == null) continue;

    const email: EmailMessage = {
      id: row.id,
      internalDate: raw.internalDate,
      from: raw.from ?? "",
      subject: raw.subject,
      // Older stored bodies predate the whitespace-collapse fix — same
      // reasoning as reparse.ts.
      body: collapseWhitespace(raw.body),
      snippet: raw.snippet,
    };

    const parsed = parseEmail(email);
    if (!parsed) continue;

    const contact = matchContact(contactCtx, { merchant: parsed.merchant, upiId: parsed.upiId });
    const { merchant, merchantNormalized } = resolveMerchant(
      parsed.merchant,
      parsed.merchantSource,
      parsed.merchantConfidence,
      parsed.upiId,
      contact?.name ?? null,
    );

    let payloadChanged = false;
    const newPayload: TransactionEncPayload = { ...payload };
    if ((merchant ?? null) !== payload.merchant) {
      newPayload.merchant = merchant ?? null;
      payloadChanged = true;
    }
    if ((merchantNormalized ?? null) !== payload.merchantNormalized) {
      newPayload.merchantNormalized = merchantNormalized ?? null;
      payloadChanged = true;
    }
    if (parsed.upiId && parsed.upiId !== payload.upiId) {
      newPayload.upiId = parsed.upiId;
      payloadChanged = true;
    }
    if (parsed.referenceNumber && parsed.referenceNumber !== payload.referenceNumber) {
      newPayload.referenceNumber = parsed.referenceNumber;
      payloadChanged = true;
    }
    if (parsed.cardLast4 && parsed.cardLast4 !== payload.cardLast4) {
      newPayload.cardLast4 = parsed.cardLast4;
      payloadChanged = true;
    }
    if (parsed.bank && parsed.bank !== payload.bank) {
      newPayload.bank = parsed.bank;
      payloadChanged = true;
    }
    if (parsed.channel && parsed.channel !== payload.channel) {
      newPayload.channel = parsed.channel;
      payloadChanged = true;
    }

    const patchBody: Record<string, unknown> = {};
    if (payloadChanged) patchBody.encPayload = deps.seal(newPayload);

    if (!row.categoryId) {
      const category = categorize(ctx, {
        merchantNormalized,
        merchant,
        upiId: parsed.upiId,
        subject: payload.emailSubject,
      });
      if (category.categoryId) {
        patchBody.categoryId = category.categoryId;
        patchBody.categorySource = category.source;
      }
    }

    if (Object.keys(patchBody).length === 0) continue;
    await fetch(`/api/transactions/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    }).catch(() => {
      // Best-effort — one failed row must not abort the whole pass; it'll
      // just get retried the next time PARSER_VERSION bumps.
    });
  }
}
