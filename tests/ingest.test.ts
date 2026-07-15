import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) — same harness as the other DB-backed tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { parseHealthStats, transactions, users } from "@/lib/db/schema";
import { amountBidx, refBidx } from "@/lib/blind-index";
import { loadCategorizerContext, ensureDefaultCategories } from "@/lib/categorize";
import { loadContactContext } from "@/lib/contacts/match";
import { generateKeypair, openWithKey } from "@/lib/e2e-crypto";
import { ingestEmail, type TransactionEncPayload } from "@/lib/ingest";
import type { EmailMessage } from "@/lib/parsing/types";

const AT = Date.parse("2026-07-05T10:30:00+05:30");

function hdfcUpiDebit(id: string): EmailMessage {
  return {
    id,
    internalDate: AT,
    from: "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
    subject: "You have done a UPI txn. Check details!",
    body: "Dear Customer, Rs.285.00 has been debited from account **7712 to VPA swiggy@icici SWIGGY on 05-07-26. Your UPI transaction reference number is 512345678901.",
    snippet: "Rs.285.00 debited",
  };
}

let userId: string;

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(parseHealthStats);
  await db.delete(users);
  const rows = await db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning();
  userId = rows[0].id;
  await ensureDefaultCategories(userId);
});

async function ingest(email: EmailMessage, publicKey: string | null = null) {
  const ctx = await loadCategorizerContext(userId);
  const contactCtx = await loadContactContext(userId);
  return ingestEmail(userId, email, ctx, contactCtx, publicKey);
}

describe("ingestEmail — non-keyed (regression: byte-identical to pre-encryption behavior)", () => {
  it("stores the transaction fully in plaintext, with no ciphertext/bidx columns set", async () => {
    const outcome = await ingest(hdfcUpiDebit("m1"));
    expect(outcome.status).toBe("inserted");
    if (outcome.status !== "inserted") throw new Error("unreachable");

    const row = outcome.transaction;
    expect(row.amountPaise).toBe(28500);
    expect(row.direction).toBe("debit");
    expect(row.upiId).toBe("swiggy@icici");
    expect(row.merchant).toBe("Swiggy");
    expect(row.referenceNumber).toBe("512345678901");
    expect(row.raw).toBeTruthy();
    expect(row.encPayload).toBeNull();
    expect(row.amountBidx).toBeNull();
  });

  it("is idempotent on re-ingest of the same message id", async () => {
    await ingest(hdfcUpiDebit("m1"));
    const second = await ingest(hdfcUpiDebit("m1"));
    expect(second.status).toBe("duplicate-message");
  });
});

describe("ingestEmail — keyed", () => {
  it("seals sensitive fields, nulls their plaintext columns, and sets a blind index", async () => {
    const { privateKey, publicKey } = generateKeypair();
    const outcome = await ingest(hdfcUpiDebit("m1"), publicKey);
    expect(outcome.status).toBe("inserted");
    if (outcome.status !== "inserted") throw new Error("unreachable");

    const row = outcome.transaction;
    expect(row.amountPaise).toBeNull();
    expect(row.merchant).toBeNull();
    expect(row.upiId).toBeNull();
    expect(row.raw).toBeNull();
    expect(row.encPayload).toBeTruthy();
    expect(row.amountBidx).toBeTruthy();

    const opened = openWithKey<TransactionEncPayload>(privateKey, row.encPayload!);
    expect(opened.amountPaise).toBe(28500);
    expect(opened.merchant).toBe("Swiggy");
    expect(opened.upiId).toBe("swiggy@icici");
    expect(opened.raw).toBeTruthy();

    // Plaintext columns that stay load-bearing server-side are unaffected.
    expect(row.direction).toBe("debit");
    expect(row.occurredAt).toBeTruthy();
  });

  it("flags a duplicate alert via the blind index, not a plaintext amount match", async () => {
    const { publicKey } = generateKeypair();
    const first = await ingest(hdfcUpiDebit("m1"), publicKey);
    if (first.status !== "inserted") throw new Error("unreachable");

    // Same amount/direction, different message id, within the 3-minute
    // dedup window (both fixtures share the same internalDate).
    const second = await ingest(
      { ...hdfcUpiDebit("m2"), body: hdfcUpiDebit("m2").body.replace("512345678901", "512345678902") },
      publicKey,
    );
    if (second.status !== "inserted") throw new Error("unreachable");
    expect(second.transaction.duplicateOfId).toBe(first.transaction.id);
  });

  it("is idempotent on re-ingest of the same message id", async () => {
    const { publicKey } = generateKeypair();
    await ingest(hdfcUpiDebit("m1"), publicKey);
    const second = await ingest(hdfcUpiDebit("m1"), publicKey);
    expect(second.status).toBe("duplicate-message");
  });
});

describe("ingestEmail — parse-health telemetry", () => {
  it("records a hit for a fully-extracted transaction, keyed and non-keyed alike", async () => {
    await ingest(hdfcUpiDebit("m1"));
    const [stat] = await db.select().from(parseHealthStats).where(eq(parseHealthStats.provider, "hdfc"));
    expect(stat.totalCount).toBe(1);
    expect(stat.merchantHits).toBe(1);
    expect(stat.upiHits).toBe(1);
    expect(stat.refHits).toBe(1);
    expect(stat.categorizedHits).toBe(1);

    const { publicKey } = generateKeypair();
    await ingest(hdfcUpiDebit("m2"), publicKey);
    const [stat2] = await db.select().from(parseHealthStats).where(eq(parseHealthStats.provider, "hdfc"));
    expect(stat2.totalCount).toBe(2);
    expect(stat2.merchantHits).toBe(2);
  });

  it("does not record a second hit for a duplicate-message re-ingest", async () => {
    await ingest(hdfcUpiDebit("m1"));
    await ingest(hdfcUpiDebit("m1"));
    const [stat] = await db.select().from(parseHealthStats).where(eq(parseHealthStats.provider, "hdfc"));
    expect(stat.totalCount).toBe(1);
  });
});

describe("ingestEmail — cross-source duplicate detection via reference number", () => {
  it("flags a same-reference row as a duplicate even far outside the amount+time window", async () => {
    // Simulate a row already ingested by another source (e.g. a statement
    // imported weeks later) — same reference number, same amount, but well
    // outside the 3-minute amount+time window this email would otherwise need.
    const [existing] = await db
      .insert(transactions)
      .values({
        userId,
        source: "statement",
        occurredAt: AT - 30 * 24 * 3600 * 1000,
        amountPaise: 28500,
        direction: "debit",
        referenceNumber: "512345678901",
      })
      .returning();

    const outcome = await ingest(hdfcUpiDebit("m1"));
    if (outcome.status !== "inserted") throw new Error("unreachable");
    expect(outcome.transaction.duplicateOfId).toBe(existing.id);
  });

  it("does not flag a different reference number as a duplicate", async () => {
    await db.insert(transactions).values({
      userId,
      source: "statement",
      occurredAt: AT - 30 * 24 * 3600 * 1000,
      amountPaise: 28500,
      direction: "debit",
      referenceNumber: "999999999999",
    });

    const outcome = await ingest(hdfcUpiDebit("m1"));
    if (outcome.status !== "inserted") throw new Error("unreachable");
    expect(outcome.transaction.duplicateOfId).toBeNull();
  });

  it("matches a same-reference row by blind index for a keyed user (plaintext reference is null)", async () => {
    const { publicKey } = generateKeypair();
    const bidx = amountBidx(userId, "debit", 28500);
    const [existing] = await db
      .insert(transactions)
      .values({
        userId,
        source: "statement",
        occurredAt: AT - 30 * 24 * 3600 * 1000,
        amountPaise: null,
        amountBidx: bidx,
        refBidx: refBidx(userId, "512345678901"),
        direction: "debit",
        encPayload: "v1.fake",
      })
      .returning();

    const outcome = await ingest(hdfcUpiDebit("m1"), publicKey);
    if (outcome.status !== "inserted") throw new Error("unreachable");
    expect(outcome.transaction.duplicateOfId).toBe(existing.id);
  });
});
