import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseSamples } from "@/lib/db/schema";
import { getIsAdmin, notFound, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Mark a donated sample resolved (fixture written / fix shipped). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getIsAdmin())) return unauthorized();
  const { id } = await params;
  const updated = await db
    .update(parseSamples)
    .set({ resolved: true })
    .where(eq(parseSamples.id, id))
    .returning({ id: parseSamples.id });
  if (updated.length === 0) return notFound("Sample not found.");
  return NextResponse.json({ ok: true });
}
