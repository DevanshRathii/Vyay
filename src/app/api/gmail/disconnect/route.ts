import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gmailConnections } from "@/lib/db/schema";
import { getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Remove the stored Gmail connection. Transactions are kept. */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  await db.delete(gmailConnections).where(eq(gmailConnections.userId, userId));
  return NextResponse.json({ ok: true });
}
