import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { badRequest, getUserId, notFound, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  categoryId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  deleted: z.boolean().optional(),
});

/** Edit category/notes, soft-delete, or restore a transaction. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);
  const { categoryId, notes, deleted } = parsed.data;

  const owned = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .get();
  if (!owned) return notFound("Transaction not found.");

  if (categoryId) {
    const cat = db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .get();
    if (!cat) return badRequest("Unknown category.");
  }

  const update: Record<string, unknown> = { updatedAt: Date.now() };
  if (categoryId !== undefined) update.categoryId = categoryId;
  if (notes !== undefined) update.notes = notes;
  if (deleted !== undefined) update.deletedAt = deleted ? Date.now() : null;

  db.update(transactions).set(update).where(eq(transactions.id, id)).run();
  return NextResponse.json({ ok: true });
}

/** Soft delete (same as PATCH {deleted:true}; provided for convenience). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const res = db
    .update(transactions)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .run();
  if (res.changes === 0) return notFound("Transaction not found.");
  return NextResponse.json({ ok: true });
}
