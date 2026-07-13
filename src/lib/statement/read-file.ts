import { parseCsv } from "./parse-csv";

/** Reads an uploaded statement file into rows of string cells. Files never
 *  leave the browser — only the rows a user chooses to import cross the
 *  network (to /api/statement/import). XLSX parsing dynamically imports
 *  exceljs (a sizable dependency, already used the same way by the export
 *  card) so it never lands in the main bundle for users who never import a
 *  statement. */
export async function readStatementFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = await file.text();
    return parseCsv(text);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheet = wb.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // exceljs rows are 1-indexed and sparse — walk by cellCount so gaps
      // between populated cells still produce empty-string placeholders,
      // keeping column indices aligned with the header row.
      for (let c = 1; c <= row.cellCount; c++) {
        const cell = row.getCell(c);
        const v = cell.value;
        if (v == null) cells.push("");
        else if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
        else if (typeof v === "object" && "text" in v) cells.push(String((v as { text: unknown }).text ?? ""));
        else if (typeof v === "object" && "result" in v) cells.push(String((v as { result: unknown }).result ?? ""));
        else cells.push(String(v));
      }
      rows.push(cells);
    });
    return rows;
  }
  throw new Error("Unsupported file type — upload a .csv, .xls, or .xlsx export from your bank.");
}
