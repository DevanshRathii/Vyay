import type { DetectionResult, EmailMessage } from "./types";

/**
 * Hard negatives — these emails are never ingested, even if they mention an
 * amount and the word "debited" (e.g. "OTP for transaction of Rs 500").
 */
const HARD_NEGATIVE: Array<[RegExp, string]> = [
  // A bare "OTP" mention isn't enough — banks' standard safety disclaimers
  // ("Never share your Card Number, CVV, PIN, OTP...") appear on every
  // email, transactional or not. Require OTP to appear where an actual code
  // is being delivered or requested, not just listed as a thing not to share.
  [/\botp\b\s*(?:is|:|number)|(?:enter|use|verify(?:ing)?\s+(?:using|with))\s+(?:the\s+)?\botp\b|one[-\s]?time\s?(password|passcode|pin)|verification code|security code/i, "otp"],
  [/e-?statement|statement\s+(?:is|for|of|has been|generated|ready|attached)|combined statement/i, "statement"],
  [/payment\s+(?:is\s+)?due|due\s+(?:date|on|by)|min(?:imum)?\s+(?:amount\s+)?due|bill\s+(?:is\s+)?(?:generated|ready)/i, "reminder"],
  [/\breminder\b|overdue|last\s+date\s+to\s+pay/i, "reminder"],
  [/will\s+be\s+(?:debited|charged|deducted|processed)|is\s+due\s+on|upcoming\s+(?:payment|debit|charge)|scheduled\s+(?:payment|debit)/i, "future-debit"],
  // RBI mandates a pre-debit SMS/email at least 24h before every e-mandate/
  // autopay collection, across every bank — the shape is standardized by
  // regulation even though exact wording varies ("will be deducted on",
  // SBI's "is due on ... and will be processed"), so this is a genuine
  // negative class, not a per-bank guess.
  [/reward\s+points?\s+(?:credited|earned)/i, "reward-points"],
  [/limit\s+(?:modified|enhanced|changed|increased|decreased)|new\s+limit\s*[:.]?\s*(?:rs|inr|₹)/i, "limit-change"],
  [/has\s+requested|payment\s+request|collect\s+request|requesting\s+(?:₹|rs|inr|money)/i, "collect-request"],
  [/(?:transaction|payment|txn).{0,60}?(?:failed|declined|unsuccessful|could\s+not\s+be)/i, "failed"],
  [/(?:failed|declined|unsuccessful)\s+(?:transaction|payment|txn)/i, "failed"],
  [/e-?mandate\s+(?:has been\s+)?(?:created|registered|set|approved)|autopay\s+(?:is\s+)?(?:set|enabled|registered)/i, "mandate-setup"],
  [/newsletter|webinar|invit(?:e|ation)\s+(?:to|for)/i, "newsletter"],
  // "converting your transaction of Rs X...into Flexipay EMIs" — an EMI-
  // conversion marketing offer, not a transaction. The generic "transaction
  // of" STRONG_POSITIVE phrase below would otherwise let these through with
  // no merchant (real confirmed production gap: 31 of 538 flagged rows in
  // one inbox were this exact SBI Card offer template). Scoped to the
  // "convert...into EMI/Flexipay" phrasing specifically so a genuine EMI
  // *installment debit* confirmation ("Your EMI of Rs 5000 has been
  // debited") — which never uses "convert" — still passes through.
  // `.` doesn't match newline by default and real bank HTML-to-text emails
  // wrap mid-sentence, so [\s\S] (not .) for the gap — confirmed necessary
  // against the real fixture, whose actual line break lands exactly between
  // "done on" and the date, right in the middle of this phrase.
  [/convert(?:ing)?\s+your\s+transaction\b[\s\S]{0,80}?\b(?:emis?|flexipay)\b/i, "emi-conversion-offer"],
];

/**
 * Soft negatives — promotional signals. These reject the email unless a
 * strong transaction phrase is also present ("cashback of ₹15 credited" is a
 * real credit; "Get flat ₹100 cashback!" is not).
 */
const SOFT_NEGATIVE: Array<[RegExp, string]> = [
  [/(?:win|get|avail|earn|grab|enjoy|unlock|save)\s+(?:flat\s+|upto\s+|up\s+to\s+)?(?:₹|rs\.?|inr)?\s*[\d,]+\s*(?:%)?\s*(?:off|cashback|discount|reward|bonus)/i, "promo"],
  [/(?:flat|upto|up\s+to)\s+\d+%\s*(?:off|cashback|discount)/i, "promo"],
  [/exclusive\s+offer|limited\s+(?:time|period)\s+offer|offers?\s+(?:just\s+)?for\s+you|special\s+offer/i, "promo"],
  [/apply\s+now|shop\s+now|buy\s+now|order\s+now|explore\s+now|click\s+here\s+to\s+(?:avail|shop|buy)/i, "promo"],
  [/refer\s+(?:&|and)\s+earn|invite\s+friends/i, "promo"],
];

/** Strong signals that money actually moved. */
const STRONG_POSITIVE: RegExp[] = [
  /(?:has\s+been|is|was|stands?|a\/c\s+\S*|account\s+\S*)\s+(?:debited|credited)/i,
  /\b(?:debited|credited)\s+(?:from|to|with|by|for|in)\b/i,
  /you\s+(?:have\s+)?(?:paid|sent|received)\b/i,
  /(?:money|amount|payment)\s+(?:sent|received|transferred)/i,
  /payment\s+(?:of|to|for)\b.{0,80}?(?:successful|completed|received|made|done|processed)/i,
  /successful(?:ly)?\s+(?:paid|sent|transferred|made)/i,
  /\bwithdrawn\b/i,
  /(?:purchase|spent?)\s+(?:of|at|worth|using|on)/i,
  /(?:refund|reversal)\s+(?:of|for|processed|credited)/i,
  /transaction\s+(?:of|alert|for)\b/i,
  /\btxn\b.{0,40}?(?:₹|rs\.?|inr)/i,
  /\bdeposited\b/i,
  // SMS's terser phrasing drops the "you" that email's STRONG_POSITIVE
  // patterns above assume ("Sent Rs.214.00 From...", "Spent Rs.6802.61 On...",
  // not "you sent"/"you have paid") — a leading verb immediately followed by
  // a currency-marked amount, with nothing in between, unlike the "spent...of/
  // at/worth/using/on" pattern above which requires a preposition right after
  // the verb and misses "Spent Rs.X On" (amount sits between verb and
  // preposition in real SMS).
  /\b(?:sent|spent|paid|received)\s+(?:₹|rs\.?|inr)\s?[\d,]/i,
  // Card-present SMS confirmations often carry no verb at all ("Rs.649
  // without OTP/PIN HDFC Bank Card x5323 At NETFLIX") — the amount directly
  // followed by this exact disclaimer phrase is itself the transaction signal.
  /(?:₹|rs\.?|inr)\s?[\d,]+(?:\.\d{1,2})?\s+without\s+otp\s*\/?\s*pin/i,
  // Labeled-field mandate/autopay confirmations ("Txn Amt:INR649.00") have no
  // narrative verb at all — the label itself is the signal.
  /\btxn\s*amt\s*[:.]?\s*(?:₹|rs\.?|inr)/i,
];

const AMOUNT_RE = /(?:₹|(?:rs|inr)\.?\s?)\s*[\d,]+(?:\.\d{1,2})?/i;

const MAX_SCAN = 6000;

/**
 * Decide whether an email describes a genuine, completed money movement.
 * Runs against subject + body (truncated for very long promotional emails).
 */
export function classifyEmail(email: Pick<EmailMessage, "subject" | "body">): DetectionResult {
  const text = `${email.subject}\n${email.body}`.slice(0, MAX_SCAN);

  for (const [re, reason] of HARD_NEGATIVE) {
    if (re.test(text)) return { isTransaction: false, reason };
  }

  if (!AMOUNT_RE.test(text)) return { isTransaction: false, reason: "no-amount" };

  const strong = STRONG_POSITIVE.some((re) => re.test(text));
  if (!strong) return { isTransaction: false, reason: "no-transaction-phrase" };

  for (const [re, reason] of SOFT_NEGATIVE) {
    if (re.test(text)) {
      // Promo wording present (often a bundled upsell blurb on an otherwise
      // real transaction email) — require a definitive completed-transaction
      // phrase, not just any STRONG_POSITIVE hit (some of those, like "txn
      // alert", can appear in marketing subject lines too).
      const definitive =
        /(?:has\s+been|is|was)\s+(?:debited|credited)|debited\s+(?:from|by)|credited\s+(?:to|with)|(?:purchase|spent?)\s+(?:of|at|worth|using|on)\b/i;
      if (!definitive.test(text)) return { isTransaction: false, reason };
    }
  }

  return { isTransaction: true, reason: "ok" };
}
