import { extractChannel, extractMerchant, extractReference, extractUpiId, fromNarration } from "@/lib/parsing/engine";
import { TRACKING_BASELINE_MS } from "@/lib/utils";
import type { ColumnMapping } from "./columns";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const VPA_SEGMENT_RE = /^[a-z0-9][a-z0-9._]{1,60}@[a-z][a-z0-9]{1,20}$/i;

/** Bank statement narrations are "-"/"/"-segmented (`UPI-SWIGGY-swiggy@icici-
 *  512345678901`) but, unlike email narrations, don't reliably follow
 *  fromNarration()'s assumed field order (DR/CR marker, ref, merchant, bank
 *  code, VPA, remark) — statements often go merchant-then-VPA-then-ref with
 *  no DR/CR/bank-code segments at all, so that regex doesn't match. Splitting
 *  on the separator and requiring a WHOLE segment to look like a VPA (not a
 *  substring scan) sidesteps both fromNarration's rigid field order and
 *  extractUpiId()'s over-greedy local-part capture (which happily consumes
 *  the hyphens back through "UPI-SWIGGY-" as if they were VPA characters). */
function extractUpiIdFromSegments(narration: string): string | undefined {
  for (const segment of narration.split(/[-/]/)) {
    const trimmed = segment.trim();
    if (VPA_SEGMENT_RE.test(trimmed)) return trimmed.toLowerCase();
  }
  return undefined;
}

/** Indian bank statement dates are always day-first: DD/MM/YY(YY), DD-MM-YYYY,
 *  or "DD MMM YYYY". Returns statement-date-at-noon-IST (ms) — statements are
 *  date-precision only, and noon keeps the row inside the right IST day
 *  bucket for analytics/dedup regardless of exact server timezone math. */
export function parseStatementDate(raw: string): number | null {
  const s = raw.trim();
  const numeric = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(s);
  const named = /^(\d{1,2})[-\s]([a-z]{3,9})[-\s](\d{2,4})$/i.exec(s);
  let day: number, month: number, year: number;
  if (numeric) {
    day = parseInt(numeric[1], 10);
    month = parseInt(numeric[2], 10) - 1;
    year = parseInt(numeric[3], 10);
  } else if (named) {
    day = parseInt(named[1], 10);
    month = MONTHS[named[2].slice(0, 3).toLowerCase()] ?? -1;
    year = parseInt(named[3], 10);
  } else {
    return null;
  }
  if (year < 100) year += 2000;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return Date.UTC(year, month, day, 12, 0, 0) - IST_OFFSET_MS;
}

/** Indian grouping ("1,23,456.78"), Cr/Dr suffix, and parenthesized negatives
 *  ("(500.00)") all appear across different banks' exports. Returns the
 *  absolute paise value and, when the cell itself carries a sign/suffix, the
 *  direction it implies (undefined when the cell is direction-neutral and
 *  the caller must get direction from which column had a value, or a
 *  separate Cr/Dr column). */
export function parseStatementAmount(raw: string): { paise: number; direction?: "debit" | "credit" } | null {
  let s = raw.trim();
  if (!s) return null;
  let direction: "debit" | "credit" | undefined;
  const crMatch = /\bcr\.?\b/i.exec(s);
  const drMatch = /\bdr\.?\b/i.exec(s);
  if (crMatch) direction = "credit";
  else if (drMatch) direction = "debit";
  s = s.replace(/\bcr\.?\b|\bdr\.?\b/gi, "").trim();

  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1];
  } else if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  const cleaned = s.replace(/[,\s₹]/g, "").replace(/^Rs\.?/i, "");
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  if (negative && !direction) direction = "debit";
  return { paise: Math.round(value * 100), direction };
}

export interface StatementRow {
  occurredAt: number;
  amountPaise: number;
  direction: "debit" | "credit";
  narration: string;
  referenceNumber?: string;
  merchant?: string;
  merchantSource?: "narration" | "vpa-name" | "info-freetext" | "pattern" | "upi-id";
  merchantConfidence: number;
  upiId?: string;
  channel?: string;
  /** Row index in the original file — used to report skips against the raw data. */
  rowIndex: number;
  /** The original cells, for the "raw" JSON stored alongside the transaction. */
  cells: string[];
}

export type NormalizeResult =
  | { ok: true; row: StatementRow }
  | { ok: false; reason: "bad-date" | "bad-amount" | "before-baseline" | "no-direction"; rowIndex: number; cells: string[] };

export function normalizeStatementRow(cells: string[], mapping: ColumnMapping, rowIndex: number): NormalizeResult {
  const dateCell = cells[mapping.date] ?? "";
  const narration = (cells[mapping.narration] ?? "").trim();
  const occurredAt = parseStatementDate(dateCell);
  if (occurredAt === null) return { ok: false, reason: "bad-date", rowIndex, cells };
  if (occurredAt < TRACKING_BASELINE_MS) return { ok: false, reason: "before-baseline", rowIndex, cells };

  let amountPaise: number | null = null;
  let direction: "debit" | "credit" | undefined;

  if (mapping.debit !== undefined || mapping.credit !== undefined) {
    const debitParsed = mapping.debit !== undefined ? parseStatementAmount(cells[mapping.debit] ?? "") : null;
    const creditParsed = mapping.credit !== undefined ? parseStatementAmount(cells[mapping.credit] ?? "") : null;
    if (debitParsed && debitParsed.paise > 0) {
      amountPaise = debitParsed.paise;
      direction = "debit";
    } else if (creditParsed && creditParsed.paise > 0) {
      amountPaise = creditParsed.paise;
      direction = "credit";
    }
  } else if (mapping.amount !== undefined) {
    const parsed = parseStatementAmount(cells[mapping.amount] ?? "");
    if (parsed) {
      amountPaise = parsed.paise;
      direction = parsed.direction;
      if (!direction && mapping.crDr !== undefined) {
        const crDr = (cells[mapping.crDr] ?? "").trim().toLowerCase();
        if (crDr.startsWith("cr")) direction = "credit";
        else if (crDr.startsWith("dr")) direction = "debit";
      }
    }
  }

  if (amountPaise === null || amountPaise === 0) return { ok: false, reason: "bad-amount", rowIndex, cells };
  if (!direction) return { ok: false, reason: "no-direction", rowIndex, cells };

  // Reuse the email/SMS engine's narration extraction — bank statement
  // narrations use the same UPI-/NEFT-/IMPS- vocabulary, but not always the
  // same field order fromNarration() assumes, so the segment-based VPA
  // extractor goes first; fromNarration() and the raw scan are fallbacks.
  const structured = fromNarration(narration);
  const upiId = extractUpiIdFromSegments(narration) ?? structured.upiId ?? extractUpiId(narration);
  const merchantResult = extractMerchant(narration, upiId);
  // A dedicated ref/cheque-no column (when the header detector found one) is
  // more trustworthy than guessing from free-text narration — only fall
  // back to narration extraction when there's no such column, or it's blank
  // for this row.
  const refCell = mapping.ref !== undefined ? (cells[mapping.ref] ?? "").trim() : "";
  const referenceNumber = refCell || structured.ref || extractReference(narration);
  const channel = extractChannel(narration);

  return {
    ok: true,
    row: {
      occurredAt,
      amountPaise,
      direction,
      narration,
      referenceNumber,
      merchant: merchantResult?.merchant ?? upiId,
      merchantSource: merchantResult?.source ?? (upiId ? "upi-id" : undefined),
      merchantConfidence: merchantResult ? 0.7 : upiId ? 0.6 : 0,
      upiId,
      channel,
      rowIndex,
      cells,
    },
  };
}
