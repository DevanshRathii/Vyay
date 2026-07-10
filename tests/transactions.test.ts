import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) for filter-building tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { and } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { buildTransactionFilters } from "@/lib/transactions";

let userId: string;

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(users);
  const rows = await db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning();
  userId = rows[0].id;

  await db.insert(transactions).values([
    {
      userId,
      source: "gmail",
      occurredAt: Date.now(),
      amountPaise: 28500,
      direction: "debit",
      merchant: "Swiggy",
      merchantNormalized: "swiggy",
      upiId: "swiggy@icici",
      emailSubject: "You have done a UPI txn",
    },
    {
      userId,
      source: "gmail",
      occurredAt: Date.now(),
      amountPaise: 64900,
      direction: "debit",
      merchant: "Netflix",
      merchantNormalized: "netflix",
      notes: "monthly subscription",
    },
    {
      userId,
      source: "gmail",
      occurredAt: Date.now(),
      amountPaise: 26000,
      direction: "debit",
      merchant: "rameshkirana@okhdfcbank",
      merchantNormalized: "rameshkirana",
      merchantSource: "upi-id",
      merchantConfidence: 0.45,
    },
    {
      userId,
      source: "gmail",
      occurredAt: Date.now(),
      amountPaise: 61000,
      direction: "debit",
      merchant: "La Pinoz Pizza",
      merchantNormalized: "la pinoz pizza",
      categorySource: "generic",
    },
  ]);
});

describe("buildTransactionFilters — search (q)", () => {
  it("matches a merchant substring case-insensitively", async () => {
    const params = new URLSearchParams({ q: "swig" });
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...buildTransactionFilters(userId, params)));
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe("Swiggy");
  });

  it("matches uppercase input against a lowercase merchant", async () => {
    const params = new URLSearchParams({ q: "NETFLIX" });
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...buildTransactionFilters(userId, params)));
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe("Netflix");
  });

  it("matches against notes", async () => {
    const params = new URLSearchParams({ q: "subscription" });
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...buildTransactionFilters(userId, params)));
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe("Netflix");
  });

  it("returns nothing for a non-matching term", async () => {
    const params = new URLSearchParams({ q: "zzzz-no-match" });
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...buildTransactionFilters(userId, params)));
    expect(rows).toHaveLength(0);
  });

  it("returns everything (for the user) when q is blank", async () => {
    const params = new URLSearchParams({ q: "" });
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...buildTransactionFilters(userId, params)));
    expect(rows).toHaveLength(4);
  });
});

describe("buildTransactionFilters — lowConfidence / categorySource", () => {
  it("lowConfidence=1 returns only rows with merchantConfidence < 0.6", async () => {
    const params = new URLSearchParams({ lowConfidence: "1" });
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...buildTransactionFilters(userId, params)));
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe("rameshkirana@okhdfcbank");
  });

  it("categorySource=generic returns only generic-sourced rows", async () => {
    const params = new URLSearchParams({ categorySource: "generic" });
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...buildTransactionFilters(userId, params)));
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe("La Pinoz Pizza");
  });
});
