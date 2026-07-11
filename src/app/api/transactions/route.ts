import { and, asc, count, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { getUserId, getUserPublicKey, unauthorized } from "@/lib/session";
import { buildTransactionFilters } from "@/lib/transactions";

export const dynamic = "force-dynamic";

/** Rows above this are never returned even to a keyed user's "load everything" list. */
const KEYED_ROW_CAP = 10_000;

const SORTABLE = {
  occurredAt: transactions.occurredAt,
  amountPaise: transactions.amountPaise,
  merchant: transactions.merchant,
} as const;

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const publicKey = await getUserPublicKey(userId);
  if (publicKey) {
    // Keyed users: search/sort/filter/pagination all move client-side (the
    // server can't evaluate a substring search against ciphertext). Return
    // everything up to the cap, decryption happens in the browser.
    const rows = await db
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
        categorySource: transactions.categorySource,
        categoryName: categories.name,
        categoryColor: categories.color,
        notes: transactions.notes,
        confidence: transactions.confidence,
        merchantSource: transactions.merchantSource,
        merchantConfidence: transactions.merchantConfidence,
        duplicateOfId: transactions.duplicateOfId,
        deletedAt: transactions.deletedAt,
        source: transactions.source,
        emailSubject: transactions.emailSubject,
        encPayload: transactions.encPayload,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.occurredAt))
      .limit(KEYED_ROW_CAP);
    return NextResponse.json({ encrypted: true, publicKey, rows, total: rows.length });
  }

  const params = new URL(req.url).searchParams;
  const conds = buildTransactionFilters(userId, params);

  const sortKey = (params.get("sort") ?? "occurredAt") as keyof typeof SORTABLE;
  const sortCol = SORTABLE[sortKey] ?? transactions.occurredAt;
  const sortDir = params.get("dir") === "asc" ? asc : desc;

  const page = Math.max(1, Number(params.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(params.get("pageSize") ?? 50)));

  const where = and(...conds);
  const rows = await db
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
      categorySource: transactions.categorySource,
      categoryName: categories.name,
      categoryColor: categories.color,
      notes: transactions.notes,
      confidence: transactions.confidence,
      merchantSource: transactions.merchantSource,
      merchantConfidence: transactions.merchantConfidence,
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
    .offset((page - 1) * pageSize);

  const total = (await db.select({ n: count() }).from(transactions).where(where))[0]?.n ?? 0;

  return NextResponse.json({ rows, total, page, pageSize });
}
