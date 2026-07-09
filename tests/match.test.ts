import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory DB for match logic tests.
vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const Database = (await import("better-sqlite3")).default;
  const schema = await import("@/lib/db/schema");
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const fs = await import("fs");
  const path = await import("path");
  const dir = path.join(process.cwd(), "drizzle");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const migration = fs.readFileSync(path.join(dir, file), "utf8");
    for (const stmt of migration.split("--> statement-breakpoint")) {
      sqlite.exec(stmt);
    }
  }
  return { db: drizzle(sqlite, { schema }), schema };
});

import { db } from "@/lib/db";
import { shortcutEvents, transactions, users } from "@/lib/db/schema";
import { findCandidates, tryResolvePendingShortcuts, MATCH_WINDOW_HOURS } from "@/lib/match";
import { eq } from "drizzle-orm";

const NOW = Date.now();
let userId: string;

function insertTxn(over: Partial<typeof transactions.$inferInsert> = {}) {
  return db
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
    .returning()
    .get();
}

beforeEach(() => {
  db.delete(shortcutEvents).run();
  db.delete(transactions).run();
  db.delete(users).run();
  userId = db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning().get().id;
});

describe("findCandidates", () => {
  it("matches exact amount + direction within the window", () => {
    const t = insertTxn();
    insertTxn({ amountPaise: 10000 }); // different amount
    insertTxn({ direction: "credit" }); // different direction
    insertTxn({ occurredAt: NOW - (MATCH_WINDOW_HOURS + 2) * 3600 * 1000 }); // outside window
    const c = findCandidates(userId, { amountPaise: 28500, direction: "debit", at: NOW });
    expect(c.map((x) => x.id)).toEqual([t.id]);
  });

  it("prefers uncategorized, then closest in time", () => {
    const far = insertTxn({ occurredAt: NOW - 3600 * 1000 });
    const near = insertTxn({ occurredAt: NOW - 60 * 1000 });
    const categorized = insertTxn({ occurredAt: NOW, categoryId: null });
    // give one a category
    db.update(transactions).set({ categoryId: null }).where(eq(transactions.id, categorized.id)).run();
    const c = findCandidates(userId, { amountPaise: 28500, direction: "debit", at: NOW });
    expect(c[0].id).toBe(categorized.id); // closest uncategorized first
    expect(c.map((x) => x.id)).toContain(far.id);
    expect(c.map((x) => x.id)).toContain(near.id);
  });

  it("ignores soft-deleted transactions", () => {
    insertTxn({ deletedAt: NOW });
    const c = findCandidates(userId, { amountPaise: 28500, direction: "debit", at: NOW });
    expect(c).toHaveLength(0);
  });
});

describe("tryResolvePendingShortcuts", () => {
  it("resolves the oldest pending event when a matching txn arrives", () => {
    const ev = db
      .insert(shortcutEvents)
      .values({
        userId,
        amountPaise: 28500,
        direction: "debit",
        categoryName: "Food",
        status: "pending",
      })
      .returning()
      .get();
    const t = insertTxn();
    tryResolvePendingShortcuts(userId, t);
    const after = db.select().from(shortcutEvents).where(eq(shortcutEvents.id, ev.id)).get();
    expect(after!.status).toBe("matched");
    expect(after!.matchedTransactionId).toBe(t.id);
  });

  it("does nothing when amounts differ", () => {
    const ev = db
      .insert(shortcutEvents)
      .values({ userId, amountPaise: 11100, direction: "debit", categoryName: "Food", status: "pending" })
      .returning()
      .get();
    const t = insertTxn();
    tryResolvePendingShortcuts(userId, t);
    const after = db.select().from(shortcutEvents).where(eq(shortcutEvents.id, ev.id)).get();
    expect(after!.status).toBe("pending");
  });
});
