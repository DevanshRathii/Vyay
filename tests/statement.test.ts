import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/statement/parse-csv";
import { detectHeaderRow, isMappingComplete } from "@/lib/statement/columns";
import { normalizeStatementRow, parseStatementAmount, parseStatementDate } from "@/lib/statement/normalize";
import { findDuplicates, type ExistingTxnLite } from "@/lib/statement/dedup";
import type { StatementRow } from "@/lib/statement/normalize";
import { TRACKING_BASELINE_MS } from "@/lib/utils";

describe("parseCsv", () => {
  it("splits plain comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas and escaped quotes", () => {
    const csv = 'Date,Narration,Amount\n01/07/26,"UPI-SWIGGY, ""BLR""-swiggy@icici",285.00';
    expect(parseCsv(csv)).toEqual([
      ["Date", "Narration", "Amount"],
      ["01/07/26", 'UPI-SWIGGY, "BLR"-swiggy@icici', "285.00"],
    ]);
  });

  it("handles CRLF line endings and a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("detectHeaderRow — buried under an address block, like a real bank export", () => {
  it("finds the header row past boilerplate lines and maps debit/credit columns", () => {
    const rows = parseCsv(
      [
        "HDFC BANK LTD",
        "Statement of Account",
        "Account Holder: TEST PERSON",
        "Period: 01-06-2026 to 30-06-2026",
        "",
        "Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt,Deposit Amt,Closing Balance",
        "01/06/26,UPI-SWIGGY-swiggy@icici-512345678901,512345678901,01/06/26,285.00,,15240.50",
        "05/06/26,NEFT CR-SALARY-ACME CORP,IN00012345,05/06/26,,50000.00,65240.50",
      ].join("\n"),
    );
    const result = detectHeaderRow(rows);
    expect(result).not.toBeNull();
    // parseCsv drops the blank separator line, so the header lands at index
    // 4 (5 boilerplate lines minus the dropped blank one).
    expect(result!.headerRowIndex).toBe(4);
    expect(isMappingComplete(result!.mapping)).toBe(true);
    expect(rows[result!.headerRowIndex][result!.mapping.debit!]).toBe("Withdrawal Amt");
    expect(rows[result!.headerRowIndex][result!.mapping.credit!]).toBe("Deposit Amt");
  });

  it("returns null when no row looks like a header (all boilerplate)", () => {
    const rows = parseCsv("Just some text\nMore text\nNothing here");
    expect(detectHeaderRow(rows)).toBeNull();
  });
});

describe("parseStatementDate — day-first Indian formats", () => {
  it("parses DD/MM/YY", () => {
    const ms = parseStatementDate("01/06/26");
    expect(ms).not.toBeNull();
    const d = new Date(ms! + 5.5 * 60 * 60 * 1000);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(5); // June
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(12); // noon IST
  });

  it("parses DD-MMM-YYYY", () => {
    const ms = parseStatementDate("05-Jul-2026");
    const d = new Date(ms! + 5.5 * 60 * 60 * 1000);
    expect(d.getUTCMonth()).toBe(6); // July
    expect(d.getUTCDate()).toBe(5);
  });

  it("rejects garbage", () => {
    expect(parseStatementDate("not a date")).toBeNull();
  });
});

describe("parseStatementAmount — Indian grouping, Cr/Dr suffix, parenthesized negatives", () => {
  it("strips Indian-style comma grouping", () => {
    expect(parseStatementAmount("1,23,456.78")).toEqual({ paise: 12345678, direction: undefined });
  });

  it("reads a Cr suffix as credit", () => {
    expect(parseStatementAmount("500.00 Cr")).toEqual({ paise: 50000, direction: "credit" });
  });

  it("reads a Dr suffix as debit", () => {
    expect(parseStatementAmount("500.00 Dr")).toEqual({ paise: 50000, direction: "debit" });
  });

  it("reads a parenthesized amount as a negative (debit)", () => {
    expect(parseStatementAmount("(500.00)")).toEqual({ paise: 50000, direction: "debit" });
  });

  it("rejects an empty cell", () => {
    expect(parseStatementAmount("")).toBeNull();
  });
});

describe("normalizeStatementRow", () => {
  const mapping = {
    date: 0,
    narration: 1,
    ref: 2,
    debit: 4,
    credit: 5,
  };

  it("extracts a debit row from separate debit/credit columns, with merchant from narration and ref from its own column", () => {
    const cells = ["01/06/26", "UPI-SWIGGY-swiggy@icici-512345678901", "512345678901", "01/06/26", "285.00", "", "15240.50"];
    const result = normalizeStatementRow(cells, mapping, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.row.amountPaise).toBe(28500);
    expect(result.row.direction).toBe("debit");
    expect(result.row.upiId).toBe("swiggy@icici");
    expect(result.row.referenceNumber).toBe("512345678901");
  });

  it("extracts a credit row", () => {
    const cells = ["05/06/26", "NEFT CR-SALARY-ACME CORP", "IN00012345", "05/06/26", "", "50000.00", "65240.50"];
    const result = normalizeStatementRow(cells, mapping, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.row.amountPaise).toBe(5000000);
    expect(result.row.direction).toBe("credit");
  });

  it("rejects a row dated before the 1-Jan-2026 tracking baseline", () => {
    const cells = ["15/12/25", "OLD TXN", "", "", "100.00", "", ""];
    const result = normalizeStatementRow(cells, mapping, 2);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("before-baseline");
  });

  it("rejects a row with an unparseable date", () => {
    const cells = ["garbage", "TXN", "", "", "100.00", "", ""];
    const result = normalizeStatementRow(cells, mapping, 3);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("bad-date");
  });

  it("rejects a row with neither debit nor credit populated", () => {
    const cells = ["01/06/26", "TXN", "", "", "", "", ""];
    const result = normalizeStatementRow(cells, mapping, 4);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("bad-amount");
  });
});

describe("findDuplicates — one-to-one assignment against existing history", () => {
  function row(rowIndex: number, occurredAt: number, amountPaise: number, direction: "debit" | "credit", ref?: string): StatementRow {
    return {
      occurredAt,
      amountPaise,
      direction,
      narration: "test",
      referenceNumber: ref,
      merchantConfidence: 0,
      rowIndex,
      cells: [],
    };
  }

  it("matches by reference number regardless of time distance", () => {
    const existing: ExistingTxnLite[] = [
      { id: "t1", occurredAt: TRACKING_BASELINE_MS, amountPaise: 28500, direction: "debit", referenceNumber: "512345678901" },
    ];
    const rows = [row(0, TRACKING_BASELINE_MS + 30 * 24 * 3600 * 1000, 28500, "debit", "512345678901")];
    const dupes = findDuplicates(rows, existing);
    expect(dupes.get(0)).toBe("t1");
  });

  it("matches by amount+direction within a day when no reference is present", () => {
    const day = TRACKING_BASELINE_MS;
    const existing: ExistingTxnLite[] = [{ id: "t1", occurredAt: day + 3600_000, amountPaise: 50000, direction: "credit", referenceNumber: null }];
    const rows = [row(0, day + 12 * 3600_000, 50000, "credit")]; // noon vs 1am same day
    const dupes = findDuplicates(rows, existing);
    expect(dupes.get(0)).toBe("t1");
  });

  it("does not match a different amount or direction", () => {
    const day = TRACKING_BASELINE_MS;
    const existing: ExistingTxnLite[] = [{ id: "t1", occurredAt: day, amountPaise: 50000, direction: "credit", referenceNumber: null }];
    const rows = [row(0, day, 50000, "debit")];
    expect(findDuplicates(rows, existing).size).toBe(0);
  });

  it("one-to-one: two same-amount rows on the same day don't both claim the same existing transaction", () => {
    const day = TRACKING_BASELINE_MS;
    const existing: ExistingTxnLite[] = [{ id: "t1", occurredAt: day, amountPaise: 45000, direction: "debit", referenceNumber: null }];
    const rows = [row(0, day, 45000, "debit"), row(1, day, 45000, "debit")];
    const dupes = findDuplicates(rows, existing);
    // Exactly one of the two claims t1; the other is genuinely new.
    expect(dupes.size).toBe(1);
    expect([...dupes.values()]).toEqual(["t1"]);
  });
});
