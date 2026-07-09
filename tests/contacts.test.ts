import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory DB for contacts tests.
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
import { contacts, users } from "@/lib/db/schema";
import { importContactsFromVCard } from "@/lib/contacts/import";
import { loadContactContext, matchContact, normalizePhone, phoneFromUpiId } from "@/lib/contacts/match";
import { eq } from "drizzle-orm";

let userId: string;

beforeEach(() => {
  db.delete(contacts).run();
  db.delete(users).run();
  userId = db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning().get().id;
});

describe("normalizePhone / phoneFromUpiId", () => {
  it("normalizes to the last 10 digits regardless of formatting or country code", () => {
    expect(normalizePhone("+91 99902 65771")).toBe("9990265771");
    expect(normalizePhone("099902-65771")).toBe("9990265771");
    expect(normalizePhone("919990265771")).toBe("9990265771");
  });

  it("returns null for anything shorter than 10 digits", () => {
    expect(normalizePhone("1669")).toBeNull();
  });

  it("extracts a phone from a UPI id's local part, even with a trailing bank-code suffix", () => {
    expect(phoneFromUpiId("9990265771@ptsbi")).toBe("9990265771");
    expect(phoneFromUpiId("8335926261hdfc@ybl")).toBe("8335926261");
    expect(phoneFromUpiId("918368288775@wahdfcbank")).toBe("8368288775");
    expect(phoneFromUpiId("meenakshi1669@okaxis")).toBeNull();
  });
});

describe("importContactsFromVCard", () => {
  it("imports new contacts and merges phones into an existing one on re-import", () => {
    const vcf1 = ["BEGIN:VCARD", "FN:Vansh Wadhwa", "TEL:9990265771", "END:VCARD"].join("\n");
    const s1 = importContactsFromVCard(userId, vcf1);
    expect(s1).toEqual({ parsed: 1, imported: 1, updated: 0, skipped: 0 });

    // Re-import with an additional phone for the same person.
    const vcf2 = ["BEGIN:VCARD", "FN:Vansh Wadhwa", "TEL:9990265771", "TEL:8000000000", "END:VCARD"].join("\n");
    const s2 = importContactsFromVCard(userId, vcf2);
    expect(s2).toEqual({ parsed: 1, imported: 0, updated: 1, skipped: 0 });

    const row = db.select().from(contacts).where(eq(contacts.userId, userId)).get()!;
    expect(JSON.parse(row.phones)).toEqual(["9990265771", "8000000000"]);
  });
});

describe("matchContact", () => {
  it("matches via the phone number embedded in a UPI id", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Vansh Wadhwa", "TEL:9990265771", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "9990265771@ptsbi", upiId: "9990265771@ptsbi" });
    expect(match?.name).toBe("Vansh Wadhwa");
  });

  it("matches via the extracted merchant name when no phone matches", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Tanya Rathi", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "TANYA RATHI", upiId: "tanya1999rathi@okaxis" });
    expect(match?.name).toBe("Tanya Rathi");
  });

  it("returns undefined when nothing matches", () => {
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "Unknown Person", upiId: "someone@okaxis" });
    expect(match).toBeUndefined();
  });

  it("fuzzy-matches a partial name saved as just a first name", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Vansh", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "VANSH WADHWA", upiId: "vansh@okaxis" });
    expect(match?.name).toBe("Vansh");
  });

  it("fuzzy-matches a name with a minor typo", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Vansh Wadwha", "TEL:1112223333", "END:VCARD"].join("\n")); // transposed letters
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "VANSH WADHWA", upiId: "vansh@okaxis" });
    expect(match?.name).toBe("Vansh Wadwha");
  });

  it("does not fuzzy-match unrelated names that merely share one word", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Meenakshi Sharma", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "MEENAKSHI RATHI", upiId: "meenakshi@okaxis" });
    expect(match).toBeUndefined();
  });

  it("fuzzy-matches a reordered name (last name first)", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Vansh Wadhwa", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "WADHWA VANSH", upiId: "vansh@okaxis" });
    expect(match?.name).toBe("Vansh Wadhwa");
  });

  it("fuzzy-matches an initial standing in for a full first name", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Vansh Wadhwa", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "V WADHWA", upiId: "vwadhwa@okaxis" });
    expect(match?.name).toBe("Vansh Wadhwa");
  });

  it("does not match a bare initial against an unrelated single-token name with no other word to corroborate it", () => {
    // Reported bug: "BAJAJ A" matched a contact named "Anshika" — the lone
    // trailing "A" happened to be Anshika's first letter, with nothing else
    // in either name to back it up.
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Anshika", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "BAJAJ A", upiId: "bajajabhinav2002-1@okhdfcbank" });
    expect(match).toBeUndefined();
  });

  it("still matches an initial when a full word elsewhere corroborates it", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:A Sharma", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "AMIT SHARMA", upiId: "amitsharma@okaxis" });
    expect(match?.name).toBe("A Sharma");
  });

  it("matches a contact whose name is embedded in the UPI id, even when the parsed merchant name was truncated", () => {
    // The exact follow-up scenario: "BAJAJ A" (truncated by extraction) is a
    // dead end, but the raw UPI id "bajajabhinav2002-1" literally contains
    // "abhinav" — the same person "Abhinav" is saved as a contact.
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Abhinav", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "BAJAJ A", upiId: "bajajabhinav2002-1@okhdfcbank" });
    expect(match?.name).toBe("Abhinav");
  });

  it("does not match a short name that merely appears as a coincidental substring of an unrelated UPI id", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Ram", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "ABHIRAM KUMAR", upiId: "abhiramkumar99@okaxis" });
    expect(match).toBeUndefined();
  });

  it("does not match a UPI id that's nothing but a bare first name, over a differently-surnamed contact", () => {
    // "meenakshi@okaxis" is just the first name alone — too weak to override
    // the bank's own extraction of a *different* full name (Rathi, not Sharma).
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Meenakshi Sharma", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "MEENAKSHI RATHI", upiId: "meenakshi@okaxis" });
    expect(match).toBeUndefined();
  });

  it("does not match on a shared surname alone when the first name doesn't correspond — same family, different person", () => {
    // Reported bug: "Sandeep Rathi"'s UPI id embeds his surname (shared with
    // the user's own contact "Devansh Rathi"), but the real Sandeep is saved
    // under a nickname ("Chachu") with no other identifying info yet. The
    // shared surname alone must not resolve to the wrong Rathi.
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Devansh Rathi", "TEL:1112223333", "END:VCARD"].join("\n"));
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Chachu", "TEL:4445556666", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "SANDEEP RATHI", upiId: "sandeeprathi99@okaxis" });
    expect(match).toBeUndefined();
  });

  it("still matches a multi-word contact name when every word is embedded in the UPI id", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Devansh Rathi", "TEL:1112223333", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "D RATHI", upiId: "devanshrathi99@okaxis" });
    expect(match?.name).toBe("Devansh Rathi");
  });

  it("matches via a saved email's local part, even though the merchant name would otherwise match a different contact", () => {
    // The exact reported scenario: "Didi"'s real gmail shares its local part
    // with the UPI id, even though the bank alert's sender name resolves to
    // a *different* contact by name — the email match must win.
    importContactsFromVCard(
      userId,
      ["BEGIN:VCARD", "FN:Didi", "EMAIL:tanya1999rathi@gmail.com", "END:VCARD"].join("\n"),
    );
    importContactsFromVCard(
      userId,
      ["BEGIN:VCARD", "FN:Tanya Rathi", "TEL:5556667777", "END:VCARD"].join("\n"),
    );
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "Tanya Rathi", upiId: "tanya1999rathi@okaxis" });
    expect(match?.name).toBe("Didi");
  });

  it("matches a UPI id that's the same email local part plus a disambiguating suffix", () => {
    // Reported: "tanya1999rathi-2@okaxis" didn't match "Didi" even though
    // her saved email is "tanya1999rathi@gmail.com" — UPI apps commonly
    // append "-2" to hand out a second id to the same person.
    importContactsFromVCard(
      userId,
      ["BEGIN:VCARD", "FN:Didi", "EMAIL:tanya1999rathi@gmail.com", "END:VCARD"].join("\n"),
    );
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "Tanya Rathi", upiId: "tanya1999rathi-2@okaxis" });
    expect(match?.name).toBe("Didi");
  });

  it("does not match a short email local part that's merely a coincidental prefix of an unrelated UPI id", () => {
    importContactsFromVCard(userId, ["BEGIN:VCARD", "FN:Raj", "EMAIL:raj12@gmail.com", "END:VCARD"].join("\n"));
    const ctx = loadContactContext(userId);
    const match = matchContact(ctx, { merchant: "Rajesh Kumar", upiId: "raj12345different@okaxis" });
    expect(match).toBeUndefined();
  });
});
