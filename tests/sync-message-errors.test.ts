import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) — same harness as the other DB-backed tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

const AT = Date.parse("2026-07-05T10:30:00+05:30");

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

/** A minimal but real HDFC UPI debit body — reused from tests/parsers.test.ts
 * so the "successfully fetched" message actually classifies and parses,
 * not just round-trips a fake payload. */
const HDFC_BODY =
  "Dear Customer, Rs.285.00 has been debited from account **7712 to VPA swiggy@icici SWIGGY on 05-07-26. Your UPI transaction reference number is 512345678901.";

function gmailMessage(id: string) {
  return {
    id,
    threadId: id,
    internalDate: String(AT),
    snippet: "Rs.285.00 debited",
    payload: {
      headers: [
        { name: "From", value: "HDFC Bank InstaAlerts <alerts@hdfcbank.net>" },
        { name: "Subject", value: "You have done a UPI txn. Check details!" },
      ],
      mimeType: "text/plain",
      body: { data: b64url(HDFC_BODY) },
    },
  };
}

/** Gaxios-shaped 404, matching what the real Gmail client library throws for
 * "Requested entity was not found." */
class FakeGmail404 extends Error {
  code = 404;
  constructor() {
    super("Requested entity was not found.");
  }
}

// Fake gmail_v1.Gmail client — only the surface sync.ts actually calls.
function fakeGmailClient(opts: { listedIds: string[]; missingIds: Set<string> }) {
  return {
    users: {
      getProfile: vi.fn().mockResolvedValue({ data: { historyId: "999" } }),
      messages: {
        list: vi.fn().mockResolvedValue({ data: { messages: opts.listedIds.map((id) => ({ id })) } }),
        get: vi.fn(async ({ id }: { id: string }) => {
          if (opts.missingIds.has(id)) throw new FakeGmail404();
          return { data: gmailMessage(id) };
        }),
      },
    },
  };
}

vi.mock("@/lib/gmail/client", () => ({
  gmailFor: vi.fn(),
}));

import { db } from "@/lib/db";
import { gmailConnections, transactions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { gmailFor } from "@/lib/gmail/client";
import { syncUser } from "@/lib/gmail/sync";

let userId: string;

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(gmailConnections);
  await db.delete(users);
  const rows = await db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning();
  userId = rows[0].id;
  await db.insert(gmailConnections).values({
    userId,
    emailAddress: "demo@example.com",
    accessToken: "enc",
    refreshToken: "enc",
  });
});

describe("syncUser — a single vanished/inaccessible Gmail message shouldn't abort the whole sync", () => {
  it("skips a 404'd message and still completes with the other message inserted", async () => {
    vi.mocked(gmailFor).mockReturnValue(
      fakeGmailClient({
        listedIds: ["good-1", "gone-1"],
        missingIds: new Set(["gone-1"]),
      }) as never,
    );

    const summary = await syncUser(userId, { full: true });

    expect(summary.inserted).toBe(1);
    expect(summary.skipped).toBe(1);

    const conn = (await db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId)))[0];
    expect(conn.syncStatus).toBe("idle");
    expect(conn.syncError).toBeNull();
    expect(conn.initialSyncDone).toBe(true);

    const txns = await db.select().from(transactions).where(eq(transactions.userId, userId));
    expect(txns).toHaveLength(1);
    expect(txns[0].gmailMessageId).toBe("good-1");
  });

  it("still fails the sync for a non-404 error on a message fetch (not silently swallowed)", async () => {
    // 400, not one of withRetry's retryable statuses (429/500/503/403) or
    // 404 — fails immediately, verifying only 404 is treated as skip-worthy.
    const client = fakeGmailClient({ listedIds: ["good-1", "broken-1"], missingIds: new Set() });
    client.users.messages.get = vi.fn(async ({ id }: { id: string }) => {
      if (id === "broken-1") {
        const err = new Error("Bad request.") as Error & { code: number };
        err.code = 400;
        throw err;
      }
      return { data: gmailMessage(id) };
    });
    vi.mocked(gmailFor).mockReturnValue(client as never);

    await expect(syncUser(userId, { full: true })).rejects.toThrow();

    const conn = (await db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId)))[0];
    expect(conn.syncStatus).toBe("error");
  });
});
