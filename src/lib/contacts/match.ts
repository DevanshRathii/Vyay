import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { buildContactContext, type ContactContext } from "@/lib/contacts/context";

// Pure contact-matching logic (matchContact(), normalizePhone(), etc.) lives
// in contacts/context.ts, which has no `db` import and is safe to bundle
// client-side (src/lib/parser-sync.ts). Re-exported here for backward
// compatibility — this file is only the DB-touching half.
export * from "@/lib/contacts/context";

export async function loadContactContext(userId: string): Promise<ContactContext> {
  const rows = await db.select().from(contacts).where(eq(contacts.userId, userId));
  return buildContactContext(rows);
}
