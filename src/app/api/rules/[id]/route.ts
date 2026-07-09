import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { merchantRules } from "@/lib/db/schema";
import { getUserId, notFound, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const res = db
    .delete(merchantRules)
    .where(and(eq(merchantRules.id, id), eq(merchantRules.userId, userId)))
    .run();
  if (res.changes === 0) return notFound("Rule not found.");
  return NextResponse.json({ ok: true });
}
