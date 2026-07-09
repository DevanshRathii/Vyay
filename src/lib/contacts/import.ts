import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { normalizeMerchant } from "@/lib/parsing/normalize";
import { parseVCard } from "./vcard";
import { normalizeEmail, normalizePhone } from "./match";

export interface ImportSummary {
  parsed: number;
  imported: number;
  updated: number;
  skipped: number;
}

/** Import (or merge into existing) contacts from a .vcf file's raw text. */
export function importContactsFromVCard(userId: string, vcfText: string): ImportSummary {
  const cards = parseVCard(vcfText);
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const card of cards) {
    const nameNormalized = normalizeMerchant(card.name);
    if (!nameNormalized) {
      skipped++;
      continue;
    }
    const phones = Array.from(new Set(card.phones.map(normalizePhone).filter((p): p is string => p !== null)));
    const emails = Array.from(new Set(card.emails.map(normalizeEmail).filter((e): e is string => e !== null)));

    const existing = db
      .select()
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.nameNormalized, nameNormalized)))
      .get();

    if (existing) {
      const existingPhones: string[] = JSON.parse(existing.phones || "[]");
      const existingEmails: string[] = JSON.parse(existing.emails || "[]");
      const mergedPhones = Array.from(new Set([...existingPhones, ...phones]));
      const mergedEmails = Array.from(new Set([...existingEmails, ...emails]));
      if (mergedPhones.length !== existingPhones.length || mergedEmails.length !== existingEmails.length) {
        db.update(contacts)
          .set({ phones: JSON.stringify(mergedPhones), emails: JSON.stringify(mergedEmails) })
          .where(eq(contacts.id, existing.id))
          .run();
        updated++;
      } else {
        skipped++;
      }
    } else {
      db.insert(contacts)
        .values({ userId, name: card.name, nameNormalized, phones: JSON.stringify(phones), emails: JSON.stringify(emails) })
        .run();
      imported++;
    }
  }

  return { parsed: cards.length, imported, updated, skipped };
}
