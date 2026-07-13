import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { badRequest, getIsAdmin, unauthorized } from "@/lib/session";
import { isEmailConfigured, sendBulkEmail } from "@/lib/notify";
import { buildNewsletterHtml, buildNewsletterText } from "@/lib/newsletter-template";

export const dynamic = "force-dynamic";

/** Test users who've actually connected Gmail and are using the app — the
 *  right audience for "here's a new feature, go try it", not just anyone
 *  who's ever visited the sign-in page. Excludes the admin's own account
 *  (they don't need to be notified of their own release). */
async function recipients(): Promise<Array<{ email: string; name: string | null }>> {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const rows = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.gmailAccessGranted, true));
  return adminEmail ? rows.filter((r) => r.email.toLowerCase() !== adminEmail) : rows;
}

/** Recipient count/preview for the admin panel — never sends anything. */
export async function GET() {
  if (!(await getIsAdmin())) return unauthorized();
  const rows = await recipients();
  return NextResponse.json({ count: rows.length, emails: rows.map((r) => r.email) });
}

const bodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  paragraphs: z.array(z.string().trim().min(1).max(1000)).min(1).max(6),
  ctaLabel: z.string().trim().min(1).max(40),
  ctaUrl: z.string().url(),
  footerNote: z.string().trim().max(300).optional(),
});

/** Sends the newsletter — one real outbound email per recipient (never a
 *  single email with everyone in bcc), via the existing Gmail SMTP
 *  transporter also used for admin notifications. Explicitly triggered by
 *  the admin clicking Send in /admin; nothing here runs automatically. */
export async function POST(req: Request) {
  if (!(await getIsAdmin())) return unauthorized();
  if (!isEmailConfigured()) {
    return badRequest("ADMIN_EMAIL / ADMIN_GMAIL_APP_PASSWORD aren't configured — nothing to send from.");
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);
  const { title, paragraphs, ctaLabel, ctaUrl, footerNote } = parsed.data;

  const rows = await recipients();
  if (rows.length === 0) return NextResponse.json({ sent: 0, failed: 0, failedEmails: [] });

  const html = buildNewsletterHtml({ title, paragraphs, ctaLabel, ctaUrl, footerNote });
  const text = buildNewsletterText({ title, paragraphs, ctaLabel, ctaUrl, footerNote });
  const { sent, failed } = await sendBulkEmail(
    rows.map((r) => r.email),
    `Vyay — ${title}`,
    html,
    text,
  );

  return NextResponse.json({ sent: sent.length, failed: failed.length, failedEmails: failed.map((f) => f.email) });
}
