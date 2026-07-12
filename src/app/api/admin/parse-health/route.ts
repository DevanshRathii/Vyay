import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseHealthStats } from "@/lib/db/schema";
import { getIsAdmin, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Per-provider extraction-quality counters — operational telemetry, no PII. */
export async function GET() {
  if (!(await getIsAdmin())) return unauthorized();
  const rows = await db.select().from(parseHealthStats).orderBy(desc(parseHealthStats.totalCount));
  return NextResponse.json({ rows });
}
