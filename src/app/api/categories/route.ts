import { asc, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { badRequest, getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const rows = db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      txnCount: count(transactions.id),
    })
    .from(categories)
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .where(eq(categories.userId, userId))
    .groupBy(categories.id)
    .orderBy(asc(categories.name))
    .all();
  return NextResponse.json({ rows });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const exists = db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .all()
    .some((c) => c.name.toLowerCase() === parsed.data.name.toLowerCase());
  if (exists) return badRequest("A category with this name already exists.");

  const row = db
    .insert(categories)
    .values({ userId, name: parsed.data.name, color: parsed.data.color ?? "#8e8e93" })
    .returning()
    .get();
  return NextResponse.json({ row });
}
