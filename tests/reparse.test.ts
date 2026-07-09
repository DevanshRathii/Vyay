import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory DB for reparse tests.
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
import { categories, contacts, transactions, users } from "@/lib/db/schema";
import { reparseUserTransactions } from "@/lib/reparse";
import { importContactsFromVCard } from "@/lib/contacts/import";
import { parseEmail } from "@/lib/parsing/engine";
import { eq } from "drizzle-orm";

const AT = Date.parse("2026-07-01T00:00:00+05:30"); // midnight IST — the old bug's signature
const ARRIVAL = Date.parse("2026-07-01T14:47:03+05:30"); // real arrival time-of-day

let userId: string;

function rawFor(subject: string, body: string, internalDate: number) {
  return JSON.stringify({
    from: "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
    subject,
    snippet: "",
    body,
    provider: "hdfc",
    internalDate,
  });
}

beforeEach(() => {
  db.delete(transactions).run();
  db.delete(categories).run();
  db.delete(contacts).run();
  db.delete(users).run();
  userId = db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning().get().id;
});

describe("reparseUserTransactions", () => {
  it("fixes merchant (was the VPA) and occurredAt (was midnight) from the stored raw email", async () => {
    const txn = db
      .insert(transactions)
      .values({
        userId,
        gmailMessageId: "m1",
        source: "gmail",
        occurredAt: AT, // old bug: midnight, no time in body
        amountPaise: 1000000,
        direction: "debit",
        merchant: "VPA meenakshi1669@okaxis", // old bug: VPA text leaked into merchant
        upiId: "meenakshi1669@okaxis",
        emailSubject: "You have done a UPI txn. Check details!",
        raw: rawFor(
          "You have done a UPI txn. Check details!",
          "Rs.10000.00 is debited from your account ending 0954 towards VPA meenakshi1669@okaxis (MEENAKSHI RATHI) on 01-07-26.\nUPI transaction reference no.: 125567531975.",
          ARRIVAL,
        ),
      })
      .returning()
      .get();

    const summary = await reparseUserTransactions(userId);
    expect(summary).toEqual({ scanned: 1, updated: 1 });
    const after = db.select().from(transactions).where(eq(transactions.id, txn.id)).get();
    expect(after!.merchant).toBe("MEENAKSHI RATHI");
    expect(after!.upiId).toBe("meenakshi1669@okaxis");
    expect(after!.occurredAt).toBe(ARRIVAL);
  });

  it("never overwrites an already-set category", async () => {
    const cat = db.insert(categories).values({ userId, name: "Rent" }).returning().get();
    const txn = db
      .insert(transactions)
      .values({
        userId,
        gmailMessageId: "m2",
        source: "gmail",
        occurredAt: AT,
        amountPaise: 1000000,
        direction: "debit",
        merchant: "VPA meenakshi1669@okaxis",
        categoryId: cat.id, // manually corrected by the user
        emailSubject: "You have done a UPI txn. Check details!",
        raw: rawFor(
          "You have done a UPI txn. Check details!",
          "Rs.10000.00 is debited from your account ending 0954 towards VPA meenakshi1669@okaxis (MEENAKSHI RATHI) on 01-07-26.\nUPI transaction reference no.: 125567531975.",
          ARRIVAL,
        ),
      })
      .returning()
      .get();

    await reparseUserTransactions(userId);
    const after = db.select().from(transactions).where(eq(transactions.id, txn.id)).get();
    expect(after!.categoryId).toBe(cat.id);
    expect(after!.merchant).toBe("MEENAKSHI RATHI"); // still fixed
  });

  it("is a no-op when the parsed result already matches", async () => {
    const subject = "You have done a UPI txn. Check details!";
    const body =
      "Rs.10000.00 is debited from your account ending 0954 towards VPA meenakshi1669@okaxis (MEENAKSHI RATHI) on 01-07-26.\nUPI transaction reference no.: 125567531975.";
    // Derive the row from parseEmail itself, so this doesn't hardcode (and
    // drift from) the confidence formula or any other derived field.
    const parsed = parseEmail({
      id: "m3",
      internalDate: ARRIVAL,
      from: "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
      subject,
      body,
    })!;

    db.insert(transactions)
      .values({
        userId,
        gmailMessageId: "m3",
        source: "gmail",
        occurredAt: parsed.occurredAt,
        amountPaise: parsed.amountPaise,
        direction: parsed.direction,
        merchant: parsed.merchant,
        merchantNormalized: "meenakshi rathi",
        upiId: parsed.upiId,
        channel: parsed.channel,
        bank: parsed.bank,
        referenceNumber: parsed.referenceNumber,
        confidence: parsed.confidence,
        emailSubject: subject,
        raw: rawFor(subject, body, ARRIVAL),
      })
      .run();

    const summary = await reparseUserTransactions(userId);
    expect(summary).toEqual({ scanned: 1, updated: 0 });
  });

  it("uses a matching contact's name even though the parser already found a name", async () => {
    // Contacts are the golden source — they win even over a name the bank's
    // own email already included.
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Meenakshi (Sister)", "TEL:9990265771", "END:VCARD"].join("\n"));

    const txn = db
      .insert(transactions)
      .values({
        userId,
        gmailMessageId: "m4",
        source: "gmail",
        occurredAt: AT,
        amountPaise: 1000000,
        direction: "debit",
        merchant: "VPA meenakshi1669@okaxis",
        emailSubject: "You have done a UPI txn. Check details!",
        raw: rawFor(
          "You have done a UPI txn. Check details!",
          // Body's VPA local part (9990265771) is the contact's phone —
          // even though the body also names "MEENAKSHI RATHI".
          "Rs.10000.00 is debited from your account ending 0954 towards VPA 9990265771@okaxis (MEENAKSHI RATHI) on 01-07-26.\nUPI transaction reference no.: 125567531975.",
          ARRIVAL,
        ),
      })
      .returning()
      .get();

    await reparseUserTransactions(userId);
    const after = db.select().from(transactions).where(eq(transactions.id, txn.id)).get();
    expect(after!.merchant).toBe("Meenakshi (Sister)");
  });

  it("uses a matching contact's name when the parser found none at all", async () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Vansh Wadhwa", "TEL:9990265771", "END:VCARD"].join("\n"));

    const txn = db
      .insert(transactions)
      .values({
        userId,
        gmailMessageId: "m5",
        source: "gmail",
        occurredAt: AT,
        amountPaise: 1000000,
        direction: "debit",
        merchant: "9990265771@ptsbi",
        emailSubject: "You have done a UPI txn. Check details!",
        raw: rawFor(
          "You have done a UPI txn. Check details!",
          // No parenthetical name anywhere — the parser can only fall back
          // to the bare UPI id.
          "Rs.10000.00 is debited from your account ending 0954 towards VPA 9990265771@ptsbi on 01-07-26.\nUPI transaction reference no.: 125567531975.",
          ARRIVAL,
        ),
      })
      .returning()
      .get();

    await reparseUserTransactions(userId);
    const after = db.select().from(transactions).where(eq(transactions.id, txn.id)).get();
    expect(after!.merchant).toBe("Vansh Wadhwa");
  });
});
