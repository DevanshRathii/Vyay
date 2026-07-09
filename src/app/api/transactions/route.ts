import { and, asc, count, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { getUserId, unauthorized } from "@/lib/session";
import { buildTransactionFilters } from "@/lib/transactions";

export const dynamic = "force-dynamic";

const SORTABLE = {
  occurredAt: transactions.occurredAt,
  amountPaise: transactions.amountPaise,
  merchant: transactions.merchant,
} as const;

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const params = new URL(req.url).searchParams;
  const conds = buildTransactionFilters(userId, params);

  const sortKey = (params.get("sort") ?? "occurredAt") as keyof typeof SORTABLE;
  const sortCol = SORTABLE[sortKey] ?? transactions.occurredAt;
  const sortDir = params.get("dir") === "asc" ? asc : desc;

  const page = Math.max(1, Number(params.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(params.get("pageSize") ?? 50)));

  const where = and(...conds);
  const rows = db
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      amountPaise: transactions.amountPaise,
      direction: transactions.direction,
      merchant: transactions.merchant,
      merchantNormalized: transactions.merchantNormalized,
      channel: transactions.channel,
      bank: transactions.bank,
      referenceNumber: transactions.referenceNumber,
      upiId: transactions.upiId,
      cardLast4: transactions.cardLast4,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      notes: transactions.notes,
      confidence: transactions.confidence,
      duplicateOfId: transactions.duplicateOfId,
      deletedAt: transactions.deletedAt,
      source: transactions.source,
      emailSubject: transactions.emailSubject,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .orderBy(sortDir(sortCol), desc(transactions.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const total = db.select({ n: count() }).from(transactions).where(where).get()?.n ?? 0;

  return NextResponse.json({ rows, total, page, pageSize });
}
