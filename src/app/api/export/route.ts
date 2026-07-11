import { and, desc, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { buildLedgerWorkbook, exportFilename } from "@/lib/export-core";
import { getUserId, getUserPublicKey, unauthorized } from "@/lib/session";
import { buildTransactionFilters } from "@/lib/transactions";

export const dynamic = "force-dynamic";

/** Excel export of the ledger — honours the same filters as the ledger view. */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  if (await getUserPublicKey(userId)) {
    return NextResponse.json(
      { error: "Export for zero-access-encrypted accounts is built client-side." },
      { status: 410 },
    );
  }

  const params = new URL(req.url).searchParams;
  const conds = buildTransactionFilters(userId, params);

  const rows = await db
    .select({
      occurredAt: transactions.occurredAt,
      channel: transactions.channel,
      merchant: transactions.merchant,
      upiId: transactions.upiId,
      amountPaise: transactions.amountPaise,
      direction: transactions.direction,
      categoryName: categories.name,
      notes: transactions.notes,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(...conds))
    .orderBy(desc(transactions.occurredAt));

  const wb = buildLedgerWorkbook(
    ExcelJS,
    rows.map((r) => ({ ...r, amountPaise: r.amountPaise ?? 0 })),
  );
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${exportFilename()}"`,
    },
  });
}
