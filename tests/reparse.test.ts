import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) for reparse tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

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

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(categories);
  await db.delete(contacts);
  await db.delete(users);
  const rows = await db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning();
  userId = rows[0].id;
});

describe("reparseUserTransactions", () => {
  it("fixes merchant (was the VPA) and occurredAt (was midnight) from the stored raw email", async () => {
    const txn = (
      await db
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
    )[0];

    const summary = await reparseUserTransactions(userId);
    expect(summary).toEqual({ scanned: 1, updated: 1 });
    const after = (await db.select().from(transactions).where(eq(transactions.id, txn.id)))[0];
    expect(after!.merchant).toBe("MEENAKSHI RATHI");
    expect(after!.upiId).toBe("meenakshi1669@okaxis");
    expect(after!.occurredAt).toBe(ARRIVAL);
  });

  it("never overwrites an already-set category", async () => {
    const cat = (await db.insert(categories).values({ userId, name: "Rent" }).returning())[0];
    const txn = (
      await db
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
    )[0];

    await reparseUserTransactions(userId);
    const after = (await db.select().from(transactions).where(eq(transactions.id, txn.id)))[0];
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

    await db.insert(transactions).values({
      userId,
      gmailMessageId: "m3",
      source: "gmail",
      occurredAt: parsed.occurredAt,
      amountPaise: parsed.amountPaise,
      direction: parsed.direction,
      merchant: parsed.merchant,
      merchantNormalized: "meenakshi rathi",
      merchantSource: parsed.merchantSource ?? null,
      merchantConfidence: parsed.merchantConfidence,
      upiId: parsed.upiId,
      channel: parsed.channel,
      bank: parsed.bank,
      referenceNumber: parsed.referenceNumber,
      confidence: parsed.confidence,
      emailSubject: subject,
      raw: rawFor(subject, body, ARRIVAL),
    });

    const summary = await reparseUserTransactions(userId);
    expect(summary).toEqual({ scanned: 1, updated: 0 });
  });

  it("uses a matching contact's name even though the parser already found a name", async () => {
    // Contacts are the golden source — they win even over a name the bank's
    // own email already included.
    await importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Meenakshi (Sister)", "TEL:9990265771", "END:VCARD"].join("\n"));

    const txn = (
      await db
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
    )[0];

    await reparseUserTransactions(userId);
    const after = (await db.select().from(transactions).where(eq(transactions.id, txn.id)))[0];
    expect(after!.merchant).toBe("Meenakshi (Sister)");
  });

  it("uses a matching contact's name when the parser found none at all", async () => {
    await importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Vansh Wadhwa", "TEL:9990265771", "END:VCARD"].join("\n"));

    const txn = (
      await db
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
    )[0];

    await reparseUserTransactions(userId);
    const after = (await db.select().from(transactions).where(eq(transactions.id, txn.id)))[0];
    expect(after!.merchant).toBe("Vansh Wadhwa");
  });

  it("sets merchantSource/merchantConfidence from the parse result", async () => {
    // A P2P name, not a KNOWN_MERCHANTS brand — isolates the plain vpa-name
    // confidence (0.85) from the known-merchant-alias confidence bump (0.95).
    const txn = (
      await db
        .insert(transactions)
        .values({
          userId,
          gmailMessageId: "m6",
          source: "gmail",
          occurredAt: AT,
          amountPaise: 1000000,
          direction: "debit",
          emailSubject: "You have done a UPI txn. Check details!",
          raw: rawFor(
            "You have done a UPI txn. Check details!",
            "Rs.10000.00 is debited from your account ending 0954 towards VPA meenakshi1669@okaxis (MEENAKSHI RATHI) on 01-07-26.\nUPI transaction reference no.: 125567531975.",
            ARRIVAL,
          ),
        })
        .returning()
    )[0];

    await reparseUserTransactions(userId);
    const after = (await db.select().from(transactions).where(eq(transactions.id, txn.id)))[0];
    expect(after!.merchantSource).toBe("vpa-name");
    expect(after!.merchantConfidence).toBe(0.85);
  });

  it("strips a corporate suffix and canonicalizes to Title Case via the known-merchant alias map", async () => {
    const txn = (
      await db
        .insert(transactions)
        .values({
          userId,
          gmailMessageId: "m7",
          source: "gmail",
          occurredAt: AT,
          amountPaise: 28500,
          direction: "debit",
          merchant: "VPA swiggy@ybl",
          emailSubject: "You have done a UPI txn. Check details!",
          raw: rawFor(
            "You have done a UPI txn. Check details!",
            "Rs.285.00 has been debited from your account ending 7712 towards VPA swiggy@ybl (SWIGGY LIMITED) on 05-07-26.\nUPI transaction reference no.: 512345678901.",
            ARRIVAL,
          ),
        })
        .returning()
    )[0];

    await reparseUserTransactions(userId);
    const after = (await db.select().from(transactions).where(eq(transactions.id, txn.id)))[0];
    // "SWIGGY LIMITED" is vpa-name sourced (0.85); normalizeMerchant() already
    // strips "Limited" via NOISE_WORDS, so merchantNormalized -> "swiggy" ->
    // KNOWN_MERCHANTS canonicalizes the display name and bumps confidence.
    expect(after!.merchant).toBe("Swiggy");
    expect(after!.merchantSource).toBe("vpa-name");
    expect(after!.merchantConfidence).toBe(0.95);
    expect(after!.merchantNormalized).toBe("swiggy");
  });
});
