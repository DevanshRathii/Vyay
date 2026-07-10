import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { badRequest, getIsAdmin, notFound, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["approve", "deny"]) });

/** Approve grants access; deny deletes the pending account (cascades — a
 *  not-yet-approved user has no real data beyond their default categories). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getIsAdmin())) return unauthorized();
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const row = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!row) return notFound("Access request not found.");

  if (parsed.data.action === "approve") {
    await db.update(users).set({ approved: true }).where(eq(users.id, id));
  } else {
    await db.delete(users).where(eq(users.id, id));
  }
  return NextResponse.json({ ok: true });
}
