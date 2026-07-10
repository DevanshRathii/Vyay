import { KNOWN_MERCHANTS } from "@/lib/categorize";
import { stripDisplaySuffixes } from "@/lib/parsing/engine";
import { normalizeMerchant } from "@/lib/parsing/normalize";

export interface ResolvedMerchant {
  merchant: string | null;
  merchantSource: string | null;
  merchantConfidence: number;
  merchantNormalized: string | null;
}

/**
 * Resolve the final display merchant, its source, and merchant-extraction
 * confidence. Shared by ingestEmail() and reparseUserTransactions() so the
 * two paths can never drift.
 *
 * A contact match is golden — it skips the suffix-strip and known-merchant
 * alias, both of which are algorithmic and would only ever downgrade a
 * human-curated name. Otherwise pattern/narration-sourced merchants get
 * corporate suffixes stripped ("Uber India Systems" → "Uber"), then a
 * known-brand alias (if any) canonicalizes the display name and bumps
 * confidence to at least 0.95.
 */
export function resolveMerchant(
  parsedMerchant: string | undefined,
  parsedSource: string | undefined,
  parsedConfidence: number,
  parsedUpiId: string | undefined,
  contactName: string | null,
): ResolvedMerchant {
  if (contactName) {
    return {
      merchant: contactName,
      merchantSource: "contact",
      merchantConfidence: 1.0,
      merchantNormalized: normalizeMerchant(contactName),
    };
  }

  let merchant = parsedMerchant ?? null;
  const merchantSource = parsedSource ?? null;
  let merchantConfidence = parsedConfidence;

  if (merchant && (merchantSource === "pattern" || merchantSource === "narration")) {
    merchant = stripDisplaySuffixes(merchant);
  }

  let merchantNormalized = normalizeMerchant(merchant ?? parsedUpiId);
  if (merchantNormalized && KNOWN_MERCHANTS[merchantNormalized]) {
    merchant = KNOWN_MERCHANTS[merchantNormalized];
    merchantConfidence = Math.max(merchantConfidence, 0.95);
    merchantNormalized = normalizeMerchant(merchant);
  }

  return { merchant, merchantSource, merchantConfidence, merchantNormalized };
}
