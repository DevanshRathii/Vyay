/** Which spreadsheet column each required field lives in. Debit/credit are
 *  either two separate columns (the common Indian-bank convention) or a
 *  single signed `amount` column (direction then read from its sign or a
 *  separate Cr/Dr indicator column). */
export interface ColumnMapping {
  date: number;
  narration: number;
  debit?: number;
  credit?: number;
  amount?: number;
  crDr?: number;
  ref?: number;
}

const HEADER_SYNONYMS: Record<keyof ColumnMapping, RegExp> = {
  date: /\b(txn|transaction|value)?\s*date\b/i,
  narration: /narration|description|particulars|remarks|details/i,
  debit: /debit|withdrawal/i,
  credit: /credit|deposit/i,
  amount: /^amount$|transaction\s*amount/i,
  crDr: /^(cr\/dr|dr\/cr|type)$/i,
  ref: /ref(erence)?\s*(no\.?|number)?|cheque\s*no|utr/i,
};

/** Bank statements bury the real header under an address block/disclaimer —
 *  scan the first N rows for the one where enough cells match known column
 *  names. This heuristic is the make-or-break piece for "any bank's export
 *  just works"; the generic column-mapper UI is the fallback when it can't
 *  find a confident match. */
const HEADER_SCAN_ROWS = 25;
/** Minimum distinct required fields (date, narration, and an amount signal)
 *  that must match for a row to count as the header — 3 is deliberately low
 *  since not every bank's header row has extra recognizable columns (some
 *  have exactly date/narration/debit/credit and nothing else guessable). */
const MIN_HEADER_MATCHES = 3;

export function detectHeaderRow(rows: string[][]): { headerRowIndex: number; mapping: ColumnMapping } | null {
  const scanLimit = Math.min(HEADER_SCAN_ROWS, rows.length);
  for (let r = 0; r < scanLimit; r++) {
    const cells = rows[r];
    const found: Partial<Record<keyof ColumnMapping, number>> = {};
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c].trim();
      if (!cell) continue;
      for (const [key, re] of Object.entries(HEADER_SYNONYMS) as [keyof ColumnMapping, RegExp][]) {
        if (key in found) continue;
        if (re.test(cell)) found[key] = c;
      }
    }
    const hasAmount = found.debit !== undefined || found.credit !== undefined || found.amount !== undefined;
    const matchCount = Object.keys(found).length;
    if (found.date !== undefined && found.narration !== undefined && hasAmount && matchCount >= MIN_HEADER_MATCHES) {
      return {
        headerRowIndex: r,
        mapping: {
          date: found.date,
          narration: found.narration,
          debit: found.debit,
          credit: found.credit,
          amount: found.amount,
          crDr: found.crDr,
          ref: found.ref,
        },
      };
    }
  }
  return null;
}

/** Required fields for a mapping to be usable (from the fallback UI, all
 *  four of date/narration/an-amount-signal must be set by the user). */
export function isMappingComplete(mapping: Partial<ColumnMapping>): mapping is ColumnMapping {
  const hasAmount = mapping.debit !== undefined || mapping.credit !== undefined || mapping.amount !== undefined;
  return mapping.date !== undefined && mapping.narration !== undefined && hasAmount;
}
