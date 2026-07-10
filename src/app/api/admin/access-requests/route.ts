import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getIsAdmin, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Pending (unapproved) sign-ups, for the admin-only Settings panel. */
export async function GET() {
  if (!(await getIsAdmin())) return unauthorized();
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.approved, false))
    .orderBy(asc(users.createdAt));
  return NextResponse.json({ rows });
}
