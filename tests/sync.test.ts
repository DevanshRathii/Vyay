import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) — same harness as the other DB-backed tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { unseenIds } from "@/lib/gmail/sync";

let userA: string;
let userB: string;

beforeEach(async () => {
  await db.delete(transactions);
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
