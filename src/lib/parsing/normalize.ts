/**
 * Normalise merchant strings so "SWIGGY LIMITED", "Swiggy*Order" and
 * "swiggy@ybl" all map to the same key for categorisation and analytics.
 */
const NOISE_WORDS =
  /\b(?:pvt|private|ltd|limited|india|ind|payments?|pay|technologies|technology|tech|solutions?|services?|retail|online|internet|ecommerce|e-commerce)\b/gi;

export function normalizeMerchant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.toLowerCase().trim();
  // VPAs: keep the handle part — "swiggy@ybl" → "swiggy"
  if (/^[a-z0-9._-]+@[a-z0-9]+$/.test(s)) s = s.split("@")[0];
  s = s
    .replace(/[*_]/g, " ")
    .replace(/[^a-z0-9@ .&-]/g, " ")
    .replace(NOISE_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Strip trailing store numbers: "dmart 4421" → "dmart"
  s = s.replace(/\s+\d{2,}$/, "").trim();
  return s || null;
}
