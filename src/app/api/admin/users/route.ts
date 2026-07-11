import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { gmailConnections, users } from "@/lib/db/schema";
import { getIsAdmin, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Every signed-up user, for the admin-only Gmail-access panel. */
export async function GET() {
  if (!(await getIsAdmin())) return unauthorized();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      gmailAccessGranted: users.gmailAccessGranted,
      hasGmailConnection: gmailConnections.id,
    })
    .from(users)
    .leftJoin(gmailConnections, eq(gmailConnections.userId, users.id))
    .orderBy(desc(users.createdAt));
  return NextResponse.json({
    rows: rows.map((r) => ({ ...r, hasGmailConnection: r.hasGmailConnection !== null })),
  });
}
