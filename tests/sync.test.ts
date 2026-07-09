import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) — same harness as the other DB-backed tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { db } from "@/lib/db";
import { gmailConnections, transactions, users } from "@/lib/db/schema";
import { SyncInProgressError, syncUser, unseenIds } from "@/lib/gmail/sync";

let userA: string;
let userB: string;

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(gmailConnections);
  await db.delete(users);
  const rows = await db
    .insert(users)
    .values([{ email: `a${Math.random()}@t.io` }, { email: `b${Math.random()}@t.io` }])
    .returning();
  userA = rows[0].id;
  userB = rows[1].id;
});

describe("unseenIds (tenant isolation regression)", () => {
  it("does not treat another user's stored message id as already seen", async () => {
    // User A already has a transaction for "msg1" (e.g. their bank + UPI app
    // both emailed about it and Gmail happened to reuse a message id space
    // that collides with something User B's mailbox also has).
    await db.insert(transactions).values({
      userId: userA,
      gmailMessageId: "msg1",
      source: "gmail",
      occurredAt: Date.now(),
      amountPaise: 10000,
      direction: "debit",
    });

    // User B has never seen "msg1" — it must come back as unseen for them,
    // not get silently skipped because User A already stored it.
    const unseenForB = await unseenIds(userB, ["msg1", "msg2"]);
    expect(unseenForB.sort()).toEqual(["msg1", "msg2"]);

    // User A, on the other hand, has genuinely already stored "msg1".
    const unseenForA = await unseenIds(userA, ["msg1", "msg2"]);
    expect(unseenForA).toEqual(["msg2"]);
  });
});

describe("syncUser (DB-backed lock, replacing the old in-memory Map)", () => {
  async function connect(userId: string, overrides: Partial<typeof gmailConnections.$inferInsert> = {}) {
    await db.insert(gmailConnections).values({
      userId,
      emailAddress: "demo@example.com",
      accessToken: "not-a-real-token",
      refreshToken: "not-a-real-token",
      ...overrides,
    });
  }

  it("refuses a second sync while a fresh lock is held (cross-instance safe, unlike the old Map)", async () => {
    await connect(userA, { syncStatus: "syncing", syncStartedAt: Date.now() });
    await expect(syncUser(userA)).rejects.toThrow(SyncInProgressError);
  });

  it("reclaims a lock abandoned by a crashed invocation (older than the staleness window)", async () => {
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    await connect(userA, { syncStatus: "syncing", syncStartedAt: elevenMinutesAgo });
    // Past the lock guard, syncUser proceeds to real Gmail work and fails
    // for unrelated reasons (fake tokens) — the point is it does NOT
    // reject with SyncInProgressError, proving the stale lock was reclaimed.
    await expect(syncUser(userA)).rejects.not.toThrow(SyncInProgressError);
  });

  it("does not let one user's lock block another user's sync", async () => {
    await connect(userA, { syncStatus: "syncing", syncStartedAt: Date.now() });
    await connect(userB, { syncStatus: "idle" });
    await expect(syncUser(userB)).rejects.not.toThrow(SyncInProgressError);
  });
});
