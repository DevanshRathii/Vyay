import { NextResponse } from "next/server";
import { badRequest, getUserId, unauthorized } from "@/lib/session";
import { importContactsFromVCard } from "@/lib/contacts/import";

export const dynamic = "force-dynamic";

/** Import contacts from an uploaded .vcf file (raw vCard text body). */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const text = await req.text();
  if (!text.trim()) return badRequest("Empty file.");

  const summary = await importContactsFromVCard(userId, text);
  if (summary.parsed === 0) return badRequest("No contacts found — is this a valid .vcf file?");
  return NextResponse.json(summary);
}
