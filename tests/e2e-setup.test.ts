import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) — same harness as the other DB-backed tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shortcutEvents, transactions, users } from "@/lib/db/schema";
import { generateKeypair, openWithKey } from "@/lib/e2e-crypto";
import { backfillRemaining, backfillUser } from "@/lib/e2e-setup";
import type { TransactionEncPayload } from "@/lib/ingest";

let userId: string;

beforeEach(async () => {
  await db.delete(shortcutEvents);
  await db.delete(transactions);
  await db.delete(users);
  const rows = await db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning();
  userId = rows[0].id;
});

describe("backfillUser", () => {
  it("seals pre-existing plaintext rows and nulls their sensitive columns", async () => {
    const { privateKey, publicKey } = generateKeypair();
    const [txn] = await db
      .insert(transactions)
      .values({
        userId,
        source: "gmail",
        occurredAt: Date.now(),
        amountPaise: 50000,
        direction: "debit",
        merchant: "Amazon",
        upiId: "amazon@icici",
        raw: JSON.stringify({ subject: "test" }),
      })
      .returning();
    const [event] = await db
      .insert(shortcutEvents)
      .values({ userId, amountPaise: 12300, direction: "debit", categoryName: "Food", notes: "lunch" })
      .returning();

    expect(await backfillRemaining(userId)).toBe(2);
    await backfillUser(userId, publicKey);
    expect(await backfillRemaining(userId)).toBe(0);

    const afterTxn = (await db.select().from(transactions).where(eq(transactions.id, txn.id)))[0];
    expect(afterTxn.amountPaise).toBeNull();
    expect(afterTxn.merchant).toBeNull();
    expect(afterTxn.upiId).toBeNull();
    expect(afterTxn.raw).toBeNull();
    expect(afterTxn.encPayload).toBeTruthy();
    expect(afterTxn.amountBidx).toBeTruthy();
    const openedTxn = openWithKey<TransactionEncPayload>(privateKey, afterTxn.encPayload!);
    expect(openedTxn.amountPaise).toBe(50000);
    expect(openedTxn.merchant).toBe("Amazon");

    const afterEvent = (await db.select().from(shortcutEvents).where(eq(shortcutEvents.id, event.id)))[0];
    expect(afterEvent.amountPaise).toBeNull();
    expect(afterEvent.notes).toBeNull();
    expect(afterEvent.encPayload).toBeTruthy();
    const openedEvent = openWithKey<{ amountPaise: number; notes: string | null }>(
      privateKey,
      afterEvent.encPayload!,
    );
    expect(openedEvent.amountPaise).toBe(12300);
    expect(openedEvent.notes).toBe("lunch");
  });

  it("is idempotent — re-running after a full backfill is a no-op", async () => {
    const { publicKey } = generateKeypair();
    await db.insert(transactions).values({
      userId,
      source: "gmail",
      occurredAt: Date.now(),
      amountPaise: 100,
      direction: "debit",
    });
    await backfillUser(userId, publicKey);
    const rowsBefore = await db.select().from(transactions);
    await backfillUser(userId, publicKey);
    const rowsAfter = await db.select().from(transactions);
    expect(rowsAfter).toEqual(rowsBefore);
  });
});
