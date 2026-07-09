import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { categories, merchantRules, transactions } from "@/lib/db/schema";
import { badRequest, getUserId, notFound, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const updated = await db
    .update(categories)
    .set(parsed.data)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    .returning({ id: categories.id });
  if (updated.length === 0) return notFound("Category not found.");
  return NextResponse.json({ ok: true });
}

/** Delete a category. Its transactions become uncategorized; its rules are removed. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const owned = (
    await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, userId)))
      .limit(1)
  )[0];
  if (!owned) return notFound("Category not found.");

  await db.update(transactions).set({ categoryId: null }).where(eq(transactions.categoryId, id));
  await db.delete(merchantRules).where(eq(merchantRules.categoryId, id));
  await db.delete(categories).where(eq(categories.id, id));
  return NextResponse.json({ ok: true });
}
