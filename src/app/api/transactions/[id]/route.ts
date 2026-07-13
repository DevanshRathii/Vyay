import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { badRequest, getUserId, notFound, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  categoryId: z.string().nullable().optional(),
  /** Only meaningful alongside categoryId — set together by parser-sync
   *  (src/lib/parser-sync.ts) when it fills in a category the parser found
   *  that a manual edit hadn't already set. Not something a normal client
   *  needs to send on its own. */
  categorySource: z.enum(["user", "brand", "generic"]).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  deleted: z.boolean().optional(),
  /** For keyed users only: the whole sensitive payload, re-sealed client-side
   *  after editing notes (or after parser-sync re-derives merchant/etc). The
   *  server never decrypts it — just stores it. */
  encPayload: z.string().optional(),
});

/** Edit category/notes, soft-delete, or restore a transaction. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);
  const { categoryId, categorySource, notes, deleted, encPayload } = parsed.data;

  const owned = (
    await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .limit(1)
  )[0];
  if (!owned) return notFound("Transaction not found.");

  if (categoryId) {
    const cat = (
      await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
        .limit(1)
    )[0];
    if (!cat) return badRequest("Unknown category.");
  }

  const update: Record<string, unknown> = { updatedAt: Date.now() };
  if (categoryId !== undefined) update.categoryId = categoryId;
  if (categorySource !== undefined) update.categorySource = categorySource;
  if (notes !== undefined) update.notes = notes;
  if (deleted !== undefined) update.deletedAt = deleted ? Date.now() : null;
  if (encPayload !== undefined) update.encPayload = encPayload;

  await db.update(transactions).set(update).where(eq(transactions.id, id));
  return NextResponse.json({ ok: true });
}

/** Soft delete (same as PATCH {deleted:true}; provided for convenience). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const updated = await db
    .update(transactions)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .returning({ id: transactions.id });
  if (updated.length === 0) return notFound("Transaction not found.");
  return NextResponse.json({ ok: true });
}
