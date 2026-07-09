import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { categories, merchantRules, transactions } from "@/lib/db/schema";
import { badRequest, getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const rows = db
    .select({
      id: merchantRules.id,
      pattern: merchantRules.pattern,
      categoryId: merchantRules.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(merchantRules)
    .innerJoin(categories, eq(merchantRules.categoryId, categories.id))
    .where(eq(merchantRules.userId, userId))
    .orderBy(desc(merchantRules.createdAt))
    .all();
  return NextResponse.json({ rows });
}

const createSchema = z.object({
  pattern: z.string().trim().min(2).max(60),
  categoryId: z.string().min(1),
  /** Optionally apply the new rule to existing uncategorized transactions. */
  applyToExisting: z.boolean().optional(),
});

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);
  const { pattern, categoryId, applyToExisting } = parsed.data;

  const cat = db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .get();
  if (!cat) return badRequest("Unknown category.");

  const row = db
    .insert(merchantRules)
    .values({ userId, pattern: pattern.toLowerCase(), categoryId })
    .returning()
    .get();

  let applied = 0;
  if (applyToExisting) {
    const needle = pattern.toLowerCase();
    const candidates = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId)))
      .all()
      .filter(
        (t) =>
          !t.categoryId &&
          !t.deletedAt &&
          `${t.merchant ?? ""} ${t.merchantNormalized ?? ""} ${t.upiId ?? ""} ${t.emailSubject ?? ""}`
            .toLowerCase()
            .includes(needle),
      );
    for (const t of candidates) {
      db.update(transactions)
        .set({ categoryId, updatedAt: Date.now() })
        .where(eq(transactions.id, t.id))
        .run();
      applied++;
    }
  }

  return NextResponse.json({ row, applied });
}
