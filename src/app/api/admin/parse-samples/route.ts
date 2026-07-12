import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseSamples, users } from "@/lib/db/schema";
import { getIsAdmin, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Unresolved user-donated parse samples, oldest first (work queue order). */
export async function GET() {
  if (!(await getIsAdmin())) return unauthorized();
  const rows = await db
    .select({
      id: parseSamples.id,
      kind: parseSamples.kind,
      text: parseSamples.text,
      note: parseSamples.note,
      resolved: parseSamples.resolved,
      createdAt: parseSamples.createdAt,
      reporterEmail: users.email,
    })
    .from(parseSamples)
    .leftJoin(users, eq(users.id, parseSamples.userId))
    .where(eq(parseSamples.resolved, false))
    .orderBy(asc(parseSamples.createdAt));
  return NextResponse.json({ rows });
}
