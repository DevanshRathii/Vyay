import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, merchantRules, type Category } from "@/lib/db/schema";
import { buildCategorizerContext, DEFAULT_CATEGORIES, type CategorizerContext } from "@/lib/categorize-context";

// Pure categorization logic (rules, categorize(), etc.) lives in
// categorize-context.ts, which has no `db` import and is safe to bundle
// client-side (src/lib/parser-sync.ts). Re-exported here for backward
// compatibility — this file is only the DB-touching half.
export * from "@/lib/categorize-context";

export async function ensureDefaultCategories(userId: string): Promise<void> {
  const existing = await db.select().from(categories).where(eq(categories.userId, userId));
  if (existing.length > 0) return;
  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c) => ({ userId, name: c.name, color: c.color })));
}

export async function loadCategorizerContext(userId: string): Promise<CategorizerContext> {
  const userRules = await db.select().from(merchantRules).where(eq(merchantRules.userId, userId));
  const cats = await db.select().from(categories).where(eq(categories.userId, userId));
  return buildCategorizerContext(cats, userRules);
}

export async function findCategoryByName(userId: string, name: string): Promise<Category | undefined> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId)));
  return rows.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
}
