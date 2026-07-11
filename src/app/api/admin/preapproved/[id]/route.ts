import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { preapprovedEmails } from "@/lib/db/schema";
import { getIsAdmin, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Cancel a pending pre-approval (they haven't signed up yet). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getIsAdmin())) return unauthorized();
  const { id } = await params;
  await db.delete(preapprovedEmails).where(eq(preapprovedEmails.id, id));
  return NextResponse.json({ ok: true });
}
