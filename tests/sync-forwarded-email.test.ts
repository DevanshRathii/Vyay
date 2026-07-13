import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) — same harness as the other DB-backed tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

const AT = Date.parse("2026-07-05T10:30:00+05:30");

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

const CANARA_FORWARD_BODY =
  "---------- Forwarded message ---------\n" +
  "From: Canara Bank <alerts@canarabank.com>\n" +
  "Dear Customer, Rs.500.00 has been debited from your account for UPI transaction. " +
  "Your UPI reference number is 512345678999.";

/** A self-forward of a genuine bank alert: real transaction-shaped subject
 * and body, but the actual sender is the user's own address, not a bank. */
function forwardedMessage(id: string) {
  return {
    id,
    threadId: id,
    internalDate: String(AT),
    snippet: "Fwd: Rs.500.00 debited",
    payload: {
      headers: [
        { name: "From", value: "Devansh Rathi <devanshr13@gmail.com>" },
        { name: "Subject", value: "Fwd: UPI Transaction Alert" },
      ],
      mimeType: "text/plain",
      body: { data: b64url(CANARA_FORWARD_BODY) },
    },
  };
}

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
  // historyId + initialSyncDone set so syncUser() takes the incremental path.
  await db.insert(gmailConnections).values({
    userId,
    emailAddress: "demo@example.com",
    accessToken: "enc",
    refreshToken: "enc",
    historyId: "100",
    initialSyncDone: true,
  });
});

describe("incremental sync — a self-forwarded bank alert must not be ingested as a real transaction", () => {
  it("skips a message whose sender isn't a known provider, even with a transaction-shaped subject", async () => {
    const listedIds = ["hdfc-1", "fwd-1"];
    const fakeClient = {
      users: {
        getProfile: vi.fn().mockResolvedValue({ data: { historyId: "999" } }),
        history: {
          list: vi.fn().mockResolvedValue({
            data: {
              historyId: "999",
              history: listedIds.map((id) => ({ messagesAdded: [{ message: { id } }] })),
            },
          }),
        },
        messages: {
          get: vi.fn(async ({ id, format }: { id: string; format?: string }) => {
            const data = id === "fwd-1" ? forwardedMessage(id) : gmailMessage(id);
            if (format === "metadata") {
              return { data: { ...data, payload: { headers: data.payload.headers } } };
            }
            return { data };
          }),
        },
      },
    };
    vi.mocked(gmailFor).mockReturnValue(fakeClient as never);

    const summary = await syncUser(userId, { full: false });

    expect(summary.mode).toBe("incremental");
    expect(summary.inserted).toBe(1);

    const txns = await db.select().from(transactions).where(eq(transactions.userId, userId));
    expect(txns).toHaveLength(1);
    expect(txns[0].gmailMessageId).toBe("hdfc-1");

    // The forwarded message was never even fetched at "full" format — it was
    // filtered out by looksRelevant() before the expensive full-body fetch.
    const fullFetchIds = fakeClient.users.messages.get.mock.calls
      .filter(([arg]: [{ format?: string }]) => arg.format === "full")
      .map(([arg]: [{ id: string }]) => arg.id);
    expect(fullFetchIds).toEqual(["hdfc-1"]);
  });
});
