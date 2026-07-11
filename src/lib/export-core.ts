import type ExcelJS from "exceljs";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export interface ExportRow {
  occurredAt: number;
  channel: string | null;
  merchant: string | null;
  upiId: string | null;
  amountPaise: number;
  direction: string;
  categoryName: string | null;
  notes: string | null;
}

/** Builds the ledger worksheet — shared by the server export route
 *  (non-keyed/demo) and the client-side export (keyed accounts, where the
 *  server never sees plaintext amounts to build this itself). */
export function buildLedgerWorkbook(ExcelJSLib: typeof ExcelJS, rows: ExportRow[]): ExcelJS.Workbook {
  const wb = new ExcelJSLib.Workbook();
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

  return wb;
}

export function exportFilename(): string {
  return `vyay-ledger-${new Date().toISOString().slice(0, 10)}.xlsx`;
}
