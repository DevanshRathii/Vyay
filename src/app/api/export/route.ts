import { and, desc, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { getUserId, unauthorized } from "@/lib/session";
import { buildTransactionFilters } from "@/lib/transactions";

export const dynamic = "force-dynamic";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** Excel export of the ledger — honours the same filters as the ledger view. */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

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

  const wb = new ExcelJS.Workbook();
  wb.creator = "Vyay";
  const ws = wb.addWorksheet("Ledger");
  ws.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Time", key: "time", width: 10 },
    { header: "Payment Channel", key: "channel", width: 16 },
    { header: "Paid To / Paid By", key: "party", width: 32 },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: "#,##0.00" } },
    { header: "Debit/Credit", key: "direction", width: 12 },
    { header: "Category", key: "category", width: 16 },
    { header: "Notes", key: "notes", width: 40 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    const ist = new Date(r.occurredAt + IST_OFFSET_MS);
    ws.addRow({
      date: ist.toISOString().slice(0, 10),
      time: ist.toISOString().slice(11, 19),
      channel: r.channel ?? "",
      party: r.merchant ?? r.upiId ?? "",
      amount: r.amountPaise / 100,
      direction: r.direction === "debit" ? "Debit" : "Credit",
      category: r.categoryName ?? "",
      notes: r.notes ?? "",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `vyay-ledger-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
