/**
 * Bump this integer in the SAME PR as any change to ingestion, parsing
 * (src/lib/parsing/*), merchant resolution (src/lib/merchant.ts), or
 * categorization (src/lib/categorize.ts) — anything that changes what a
 * transaction's merchant/category/extracted fields *should* be for
 * already-imported emails, not just newly-arriving ones.
 *
 * Every user's `users.parserVersionApplied` is compared against this value
 * (src/app/api/parser-sync/*) to decide whether their existing ledger needs
 * to be silently reprocessed with the improved logic — this is what makes a
 * fix like "Canara Bank extracted zero merchants" actually reach an already-
 * affected user without them doing anything, instead of only helping new
 * imports from that point on.
 *
 * Do NOT bump for changes that only affect brand-new data going forward with
 * no correctness difference for already-stored rows (e.g. adding a new bank
 * provider whose emails were never ingested before, tightening the OTP
 * classifier for spam that was already being rejected).
 */
// v2: SMS/statement work added real classifier+engine fixes that also apply
// to already-imported email — "deposited" as a recognized credit verb, bare
// leading-verb phrasing ("Sent Rs.X", "Spent Rs.X On"), ISO-format
// "YYYY-MM-DD:HH:MM:SS" timestamps, and the segment-based VPA extractor
// (fixes over-greedy hyphen narrations like "UPI-SWIGGY-swiggy@icici-...").
// A user whose salary-deposit or hyphen-narration emails silently failed to
// parse before this needs their existing rows reprocessed, not just new mail.
export const PARSER_VERSION = 2;
