import { eq, gte, isNull, isNotNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import { transactions } from "@/lib/db/schema";

/** Translate ledger query params into Drizzle WHERE conditions (shared by list + export). */
export function buildTransactionFilters(userId: string, params: URLSearchParams): SQL[] {
  const conds: SQL[] = [eq(transactions.userId, userId) as SQL];

  if (params.get("onlyDeleted") === "1") conds.push(isNotNull(transactions.deletedAt) as SQL);
  else if (params.get("includeDeleted") !== "1") conds.push(isNull(transactions.deletedAt) as SQL);

  const q = params.get("q")?.trim().toLowerCase();
  if (q) {
    const pat = `%${q}%`;
    conds.push(
      or(
        like(sql`lower(${transactions.merchant})`, pat),
        like(sql`lower(${transactions.merchantNormalized})`, pat),
        like(sql`lower(${transactions.notes})`, pat),
        like(sql`lower(${transactions.upiId})`, pat),
        like(sql`lower(${transactions.emailSubject})`, pat),
        like(sql`lower(${transactions.referenceNumber})`, pat),
      ) as SQL,
    );
  }

  const category = params.get("category");
  if (category === "uncategorized") conds.push(isNull(transactions.categoryId) as SQL);
  else if (category) conds.push(eq(transactions.categoryId, category) as SQL);

  const channel = params.get("channel");
  if (channel) conds.push(eq(transactions.channel, channel) as SQL);

  const direction = params.get("direction");
  if (direction === "debit" || direction === "credit")
    conds.push(eq(transactions.direction, direction) as SQL);

  const from = Number(params.get("from"));
  if (from) conds.push(gte(transactions.occurredAt, from) as SQL);
  const to = Number(params.get("to"));
  if (to) conds.push(lte(transactions.occurredAt, to) as SQL);

  return conds;
}
