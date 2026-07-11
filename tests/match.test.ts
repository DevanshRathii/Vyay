import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) for match logic tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { db } from "@/lib/db";
import { shortcutEvents, transactions, users } from "@/lib/db/schema";
import { amountBidx } from "@/lib/blind-index";
import { findCandidates, tryResolvePendingShortcuts, MATCH_WINDOW_HOURS } from "@/lib/match";
import { eq } from "drizzle-orm";

const NOW = Date.now();
let userId: string;

async function insertTxn(over: Partial<typeof transactions.$inferInsert> = {}) {
  const rows = await db
    .insert(transactions)
    .values({
      userId,
      source: "test",
      occurredAt: NOW,
      amountPaise: 28500,
      currency: "INR",
      direction: "debit",
      merchant: "Swiggy",
      ...over,
    })
    .returning();
  return rows[0];
}

beforeEach(async () => {
  await db.delete(shortcutEvents);
  await db.delete(transactions);
  await db.delete(users);
  const rows = await db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning();
  userId = rows[0].id;
});

describe("findCandidates", () => {
  it("matches exact amount + direction within the window", async () => {
    const t = await insertTxn();
    await insertTxn({ amountPaise: 10000 }); // different amount
    await insertTxn({ direction: "credit" }); // different direction
    await insertTxn({ occurredAt: NOW - (MATCH_WINDOW_HOURS + 2) * 3600 * 1000 }); // outside window
    const c = await findCandidates(userId, { amountPaise: 28500, direction: "debit", at: NOW });
    expect(c.map((x) => x.id)).toEqual([t.id]);
  });

  it("prefers uncategorized, then closest in time", async () => {
    const far = await insertTxn({ occurredAt: NOW - 3600 * 1000 });
    const near = await insertTxn({ occurredAt: NOW - 60 * 1000 });
    const categorized = await insertTxn({ occurredAt: NOW, categoryId: null });
    // give one a category
    await db.update(transactions).set({ categoryId: null }).where(eq(transactions.id, categorized.id));
    const c = await findCandidates(userId, { amountPaise: 28500, direction: "debit", at: NOW });
    expect(c[0].id).toBe(categorized.id); // closest uncategorized first
    expect(c.map((x) => x.id)).toContain(far.id);
    expect(c.map((x) => x.id)).toContain(near.id);
  });

  it("ignores soft-deleted transactions", async () => {
    await insertTxn({ deletedAt: NOW });
    const c = await findCandidates(userId, { amountPaise: 28500, direction: "debit", at: NOW });
    expect(c).toHaveLength(0);
  });
});

describe("tryResolvePendingShortcuts", () => {
  it("resolves the oldest pending event when a matching txn arrives", async () => {
    const evRows = await db
      .insert(shortcutEvents)
      .values({
        userId,
        amountPaise: 28500,
        direction: "debit",
        categoryName: "Food",
        status: "pending",
      })
      .returning();
    const ev = evRows[0];
    const t = await insertTxn();
    await tryResolvePendingShortcuts(userId, t, t.amountPaise!);
    const after = (await db.select().from(shortcutEvents).where(eq(shortcutEvents.id, ev.id)))[0];
    expect(after!.status).toBe("matched");
    expect(after!.matchedTransactionId).toBe(t.id);
  });

  it("does nothing when amounts differ", async () => {
    const evRows = await db
      .insert(shortcutEvents)
      .values({ userId, amountPaise: 11100, direction: "debit", categoryName: "Food", status: "pending" })
      .returning();
    const ev = evRows[0];
    const t = await insertTxn();
    await tryResolvePendingShortcuts(userId, t, t.amountPaise!);
    const after = (await db.select().from(shortcutEvents).where(eq(shortcutEvents.id, ev.id)))[0];
    expect(after!.status).toBe("pending");
  });
});

describe("keyed matching — blind index equality", () => {
  it("findCandidates matches a keyed transaction (null amountPaise) via bidx", async () => {
    const bidx = amountBidx(userId, "debit", 28500);
    const t = await insertTxn({ amountPaise: null, amountBidx: bidx, merchant: null, encPayload: "v1.fake" });
    const c = await findCandidates(userId, { amountPaise: 28500, direction: "debit", at: NOW });
    expect(c.map((x) => x.id)).toEqual([t.id]);
  });

  it("tryResolvePendingShortcuts matches a keyed pending event via bidx", async () => {
    const bidx = amountBidx(userId, "debit", 28500);
    const evRows = await db
      .insert(shortcutEvents)
      .values({
        userId,
        amountPaise: null,
        amountBidx: bidx,
        direction: "debit",
        categoryName: "Food",
        encPayload: "v1.fake",
        status: "pending",
      })
      .returning();
    const ev = evRows[0];
    const t = await insertTxn();
    await tryResolvePendingShortcuts(userId, t, t.amountPaise!);
    const after = (await db.select().from(shortcutEvents).where(eq(shortcutEvents.id, ev.id)))[0];
    expect(after!.status).toBe("matched");
    expect(after!.matchedTransactionId).toBe(t.id);
  });

  it("applyEventToTransaction does not clobber notes on a keyed transaction", async () => {
    const { applyEventToTransaction } = await import("@/lib/match");
    const t = await insertTxn({ notes: null });
    const evRows = await db
      .insert(shortcutEvents)
      .values({
        userId,
        amountPaise: null,
        amountBidx: amountBidx(userId, "debit", 28500),
        direction: "debit",
        categoryName: "Food",
        encPayload: "v1.fake",
        notes: null,
        status: "pending",
      })
      .returning();
    await applyEventToTransaction(evRows[0], t.id, "matched");
    const after = (await db.select().from(transactions).where(eq(transactions.id, t.id)))[0];
    expect(after.notes).toBeNull();
    expect(after.categoryId).toBe(evRows[0].categoryId);
  });
});
