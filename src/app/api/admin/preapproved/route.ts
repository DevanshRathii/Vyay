import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { preapprovedEmails } from "@/lib/db/schema";
import { badRequest, getIsAdmin, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Emails pre-approved for Gmail access before they've ever signed in. */
export async function GET() {
  if (!(await getIsAdmin())) return unauthorized();
  const rows = await db.select().from(preapprovedEmails).orderBy(desc(preapprovedEmails.createdAt));
  return NextResponse.json({ rows });
}

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email() });

/** Pre-approve an email — when they sign up, gmailAccessGranted is set true
 *  immediately and this row is consumed. Meant to be paired with also adding
 *  them to Google's Test users list in Cloud Console, so the whole thing
 *  "just works" for them with no further action on either side. */
export async function POST(req: Request) {
  if (!(await getIsAdmin())) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const row = (
    await db.insert(preapprovedEmails).values({ email: parsed.data.email }).onConflictDoNothing().returning()
  )[0];
  return NextResponse.json({ row: row ?? null });
}
