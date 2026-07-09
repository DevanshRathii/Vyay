import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const rows = db.select().from(contacts).where(eq(contacts.userId, userId)).orderBy(asc(contacts.name)).all();
  return NextResponse.json({
    rows: rows.map((c) => ({
      id: c.id,
      name: c.name,
      phones: JSON.parse(c.phones || "[]") as string[],
      emails: JSON.parse(c.emails || "[]") as string[],
    })),
  });
}
