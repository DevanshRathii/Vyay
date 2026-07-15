import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) — same harness as the other DB-backed tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { ensureDefaultCategories, loadCategorizerContext } from "@/lib/categorize";
import { loadContactContext } from "@/lib/contacts/match";
import { ingestParsedTransaction } from "@/lib/ingest";
import { classifyEmail } from "@/lib/parsing/detect";
import { parseEmail } from "@/lib/parsing/engine";
import type { EmailMessage } from "@/lib/parsing/types";

let userId: string;

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(users);
  const rows = await db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning();
  userId = rows[0].id;
  await ensureDefaultCategories(userId);
});

/** Mirrors POST /api/ingest's sms branch: classify, parse (rejecting exactly
 *  like the endpoint does), then hand off to the source-agnostic pipeline. */
async function ingestSms(body: string, internalDate: number, externalId: string) {
  const email: EmailMessage = { id: "sms", internalDate, from: "", subject: "", body };
  const detection = classifyEmail(email);
  if (!detection.isTransaction) return { status: "skipped" as const, reason: detection.reason };
  const txn = parseEmail(email);
  if (!txn) return { status: "skipped" as const, reason: "unparseable" };
  const { provider, ...normalized } = txn;
  const ctx = await loadCategorizerContext(userId);
  const contactCtx = await loadContactContext(userId);
  return ingestParsedTransaction(userId, normalized, {
    source: "sms",
    externalId,
    raw: null,
    publicKey: null,
    ctx,
    contactCtx,
    provider,
  });
}

describe("SMS ingest — end to end via the source-agnostic pipeline", () => {
  it("inserts a real SMS transaction with source:'sms' and a real merchant/amount", async () => {
    const outcome = await ingestSms(
      "Sent Rs.214.00\nFrom HDFC Bank A/C *0954\nTo Wave cinema Kaushambi\nOn 28/06/26\nRef 617933214682",
      Date.parse("2026-06-28T14:00:00+05:30"),
      "sms:test1",
    );
    expect(outcome.status).toBe("inserted");
    if (outcome.status !== "inserted") throw new Error("unreachable");
    expect(outcome.transaction.source).toBe("sms");
    expect(outcome.transaction.amountPaise).toBe(21400);
    expect(outcome.transaction.direction).toBe("debit");
    expect(outcome.transaction.referenceNumber).toBe("617933214682");
  });

  it("rejects a future-dated e-mandate pre-notice as skipped, not inserted", async () => {
    const outcome = await ingestSms(
      "E-Mandate!\nRs.749.00 will be deducted on 12/07/26, 00:00:00\nFor APPLE MEDIA SERVICES mandate",
      Date.parse("2026-07-05T09:00:00+05:30"),
      "sms:test2",
    );
    expect(outcome.status).toBe("skipped");
  });

  it("is idempotent on re-ingest of the same externalId hash", async () => {
    const body = "Sent Rs.100.00\nFrom HDFC Bank A/C *0954\nTo Test Merchant\nOn 01/07/26\nRef 100000000099";
    const at = Date.parse("2026-07-01T10:00:00+05:30");
    await ingestSms(body, at, "sms:dup");
    const second = await ingestSms(body, at, "sms:dup");
    expect(second.status).toBe("duplicate-message");
  });

  it("widened same-day window catches a duplicate the old 3-minute window would miss, because one side has no time-of-day in the body", async () => {
    // Real HDFC pair: an "AutoPay Success" labeled receipt (only a bare date,
    // "Dt:11/07/2026" — no clock time, so occurredAt falls back to arrival
    // time) and HDFC's own generic card-spend confirmation for the exact
    // same debit, which does carry a precise in-body timestamp. In
    // production these can arrive hours apart even though they're the same
    // ₹649 Netflix charge.
    const autopaySuccess = await ingestSms(
      "AutoPay (E-mandate) Success!\nFor NETFLIX\nTxn Amt:INR649.00\nDt:11/07/2026\nVia:HDFC Bank CC 5323\nSI Hub ID: XpPjbm4fLT",
      Date.parse("2026-07-11T20:15:00+05:30"), // arrival used as the fallback estimate
      "sms:autopay-success",
    );
    expect(autopaySuccess.status).toBe("inserted");
    if (autopaySuccess.status !== "inserted") throw new Error("unreachable");
    expect(autopaySuccess.transaction.occurredAtPrecise).toBe(false);

    const cardConfirmation = await ingestSms(
      "Rs.649 without OTP/PIN HDFC Bank Card x5323 At NETFLIX On 2026-07-11:07:56:18.Not U? Block&Reissue",
      Date.parse("2026-07-11T07:57:00+05:30"),
      "sms:autopay-card-dup",
    );
    expect(cardConfirmation.status).toBe("inserted");
    if (cardConfirmation.status !== "inserted") throw new Error("unreachable");
    expect(cardConfirmation.transaction.occurredAtPrecise).toBe(true);

    // ~12 hours apart (20:15 fallback vs 07:56:18 precise) — outside the old
    // fixed 3-minute window, caught by the widened one since the first row
    // isn't precise.
    expect(cardConfirmation.transaction.duplicateOfId).toBe(autopaySuccess.transaction.id);
  });
});
