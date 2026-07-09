import { classifyEmail } from "./detect";
import { matchProvider } from "./providers";
import type { Direction, EmailMessage, ParsedTransaction } from "./types";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_SCAN = 6000;

// ── Amount ──────────────────────────────────────────────────────────────────

interface AmountHit {
  paise: number;
  index: number;
}

const AMOUNT_GLOBAL = /(?:₹|(?:rs|inr)\.?\s?)\s*([\d,]+(?:\.\d{1,2})?)/gi;
/** Words that mark an amount as a balance/limit rather than the transaction. */
const BALANCE_CONTEXT = /(?:avl|available|avail\.?|net|total|closing|opening)\s*(?:bal(?:ance)?|limit)|bal(?:ance)?\s*(?:is|:|-)|limit\s*(?:is|:|-)|reward|points|outstanding/i;

function findAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = [];
  let m: RegExpExecArray | null;
  AMOUNT_GLOBAL.lastIndex = 0;
  while ((m = AMOUNT_GLOBAL.exec(text)) !== null) {
    const value = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (BALANCE_CONTEXT.test(before)) continue; // "Avl bal: Rs 1,20,000"
    hits.push({ paise: Math.round(value * 100), index: m.index });
  }
  return hits;
}

// ── Direction ───────────────────────────────────────────────────────────────

const DEBIT_PATTERNS: RegExp[] = [
  /(?:has\s+been|is|was|stands?)\s+debited/i,
  /debited\s+(?:from|by|for|with)/i,
  /you\s+(?:have\s+)?(?:paid|sent)\b/i,
  /(?:money|amount|payment)\s+sent/i,
  /payment\s+(?:of|to|made)/i,
  /(?:purchase|spent?)\s+(?:of|at|worth|using|on)/i,
  /\bwithdrawn\b/i,
  /successful(?:ly)?\s+(?:paid|sent|transferred)/i,
  /(?:card|account|a\/c)[^.\n]{0,40}?has\s+been\s+used\s+(?:for|at|on)/i,
  /\bdebit(?:ed)?\b(?!\s+card\b)/i,
];

const CREDIT_PATTERNS: RegExp[] = [
  /(?:has\s+been|is|was|stands?)\s+credited/i,
  /credited\s+(?:to|with|in|by)/i,
  /you\s+(?:have\s+)?received\b/i,
  /(?:money|amount|payment)\s+received/i,
  /(?:refund|reversal)\s+(?:of|for|processed|credited)/i,
  /deposited/i,
  /\bcredit(?:ed)?\b(?!\s+(?:card|limit|score)\b)/i,
];

function firstMatchIndex(text: string, patterns: RegExp[]): number {
  let best = -1;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/**
 * Determine debit vs credit. Refunds are always credits. When both words
 * appear ("debited from your a/c and credited to X"), the phrase that appears
 * first — i.e. the one describing the account holder — wins.
 */
export function extractDirection(text: string): { direction: Direction | null; index: number } {
  if (/\brefund(?:ed)?\b|\breversal\b|\breversed\b/i.test(text)) {
    return { direction: "credit", index: firstMatchIndex(text, CREDIT_PATTERNS) };
  }
  const d = firstMatchIndex(text, DEBIT_PATTERNS);
  const c = firstMatchIndex(text, CREDIT_PATTERNS);
  if (d === -1 && c === -1) return { direction: null, index: -1 };
  if (d === -1) return { direction: "credit", index: c };
  if (c === -1) return { direction: "debit", index: d };
  return d <= c ? { direction: "debit", index: d } : { direction: "credit", index: c };
}

/** Pick the amount closest to the direction phrase (skips balances). */
export function extractAmount(text: string, anchorIndex: number): number | null {
  const hits = findAmounts(text);
  if (hits.length === 0) return null;
  if (anchorIndex < 0) return hits[0].paise;
  let best = hits[0];
  for (const h of hits) {
    if (Math.abs(h.index - anchorIndex) < Math.abs(best.index - anchorIndex)) best = h;
  }
  return best.paise;
}

// ── UPI / VPA ───────────────────────────────────────────────────────────────

const VPA_RE = /\b([a-z0-9][a-z0-9._-]{1,60}@[a-z][a-z0-9]{1,20})\b/gi;
const EMAIL_DOMAINS = new Set(["gmail", "yahoo", "outlook", "hotmail", "rediffmail", "icloud", "live", "protonmail"]);

export function extractUpiId(text: string): string | undefined {
  let m: RegExpExecArray | null;
  VPA_RE.lastIndex = 0;
  while ((m = VPA_RE.exec(text)) !== null) {
    const handle = m[1].toLowerCase();
    const domain = handle.split("@")[1];
    if (domain.includes(".")) continue; // real email address, not a VPA
    if (EMAIL_DOMAINS.has(domain)) continue;
    return handle;
  }
  return undefined;
}

// ── Reference number ────────────────────────────────────────────────────────

const REF_CONNECT = String.raw`\.?\s*(?:is|was)?\s*[:\-]?\s*`;
const REF_PATTERNS: RegExp[] = [
  new RegExp(String.raw`UPI\s*(?:transaction\s*)?(?:ref(?:erence)?\b)?\s*(?:no\b|number\b|id\b)?${REF_CONNECT}(\d{9,18})`, "i"),
  new RegExp(String.raw`ref(?:erence)?\b\s*(?:no\b|number\b|id\b|#)?${REF_CONNECT}([A-Z0-9]{6,25})\b`, "i"),
  new RegExp(String.raw`(?:transaction|txn)\s*(?:id\b|no\b|number\b|ref(?:erence)?\b)\s*(?:no\b|number\b|id\b)?${REF_CONNECT}([A-Z0-9]{6,30})\b`, "i"),
  new RegExp(String.raw`(?:IMPS|NEFT|RTGS)\s*(?:ref\b)?\s*(?:no\b)?${REF_CONNECT}([A-Z0-9]{6,25})\b`, "i"),
];

export function extractReference(text: string): string | undefined {
  for (const re of REF_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const ref = m[1];
      // Avoid capturing dates/amounts that slip through.
      if (/^\d{1,2}[-/]\d{1,2}/.test(ref)) continue;
      return ref;
    }
  }
  return undefined;
}

// ── Card ────────────────────────────────────────────────────────────────────

const CARD_PATTERNS: RegExp[] = [
  /(?:credit|debit)?\s*card\s*(?:no\.?|number)?\s*(?:ending|ending\s+in|ending\s+with)?\s*(?:in|with)?\s*[xX*]*(\d{4})\b/i,
  /card\s+[xX*]{2,}\s*(\d{4})\b/i,
  /\bXX(\d{4})\b/,
];

export function extractCardLast4(text: string): string | undefined {
  for (const re of CARD_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

// ── Channel ─────────────────────────────────────────────────────────────────

export function extractChannel(text: string, hint?: string): string | undefined {
  // A real extracted VPA, or the literal word "VPA", is structural evidence
  // of UPI — check that (and card detection) before the bare word "upi",
  // which shows up in unrelated boilerplate present on nearly every bank
  // alert regardless of transaction type ("Or SMS 'BLOCK UPI' to ...").
  if (extractUpiId(text) || /\bvpa\b/i.test(text)) return "UPI";
  if (/\bcard\b/i.test(text) && extractCardLast4(text)) return "Card";
  if (/\bupi\b/i.test(text)) return "UPI";
  if (/\bIMPS\b/i.test(text)) return "IMPS";
  if (/\bNEFT\b/i.test(text)) return "NEFT";
  if (/\bRTGS\b/i.test(text)) return "RTGS";
  if (/\bATM\b|cash\s+withdrawal/i.test(text)) return "ATM";
  if (/\bwallet\b/i.test(text)) return "Wallet";
  if (/net\s?banking/i.test(text)) return "NetBanking";
  return hint;
}

// ── Merchant ────────────────────────────────────────────────────────────────

const MERCHANT_STOP = /\s+(?:on|at|via|using|vide|towards|with|for|ref|upi|dated|is|was|has)\b|[.,;\n\r(]|$/i;

function cleanMerchant(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw
    .replace(/\s+/g, " ")
    .replace(/^[\s:\-–—]+|[\s:\-–—.]+$/g, "")
    .replace(/^(?:m\/s|mr|mrs|ms)\.?\s+/i, "")
    // Card networks prefix the real merchant with an aggregator code —
    // "CAS*Swiggy", "SQ *Coffee Shop" — strip it to get the actual name.
    .replace(/^[A-Z0-9]{2,10}\s*\*\s*/, "")
    .trim();
  if (!s) return undefined;
  // No letters at all (pure digits/punctuation), or opens with a run of
  // digits long enough to be a phone number — a generic pattern like "at X"
  // can otherwise latch onto a customer-care line in boilerplate footer
  // text ("...call us at 1800 258 6161...") instead of the real merchant.
  if (!/[a-zA-Z]/.test(s)) return undefined;
  if (/^\d[\d\s-]{6,}/.test(s)) return undefined;
  if (s.length > 60) s = s.slice(0, 60).trim();
  if (s.length < 2) return undefined;
  return s;
}

/**
 * Parse bank UPI narrations like:
 *   "UPI/DR/453212345678/SWIGGY LIMITED/YESB/swiggy@ybl/Payment"
 */
function fromNarration(text: string): { merchant?: string; upiId?: string; ref?: string } {
  const m = /UPI[/-](?:DR|CR|P2M|P2A)?[/-]?(\d{9,15})?[/-]([^/\n]{2,40})[/-]([A-Z]{3,6})?[/-]?([a-z0-9._-]+@[a-z0-9]+)?/i.exec(text);
  if (!m) return {};
  return {
    ref: m[1] || undefined,
    merchant: cleanMerchant(m[2]),
    upiId: m[4]?.toLowerCase(),
  };
}

const MERCHANT_PATTERNS: Array<{ re: RegExp; group: number }> = [
  { re: /(?:Info|Remarks?|Narration|Description)\s*[:\-]\s*(?:UPI[/-][A-Z]{2}[/-]\d+[/-])?([^\n\r]{2,60})/i, group: 1 },
  { re: /\bat\s+([A-Z0-9][\w &.'*@-]{1,50}?)(?=\s+on\s|\s+using\s|\s+via\s|\s+vide\s|[.,;\n]|$)/, group: 1 },
  { re: /(?:paid|sent|payment)\s+(?:of\s+(?:₹|rs\.?|inr)\s?[\d,.]+\s+)?to\s+(?!VPA\b)([^\n\r]{2,50}?)(?=\s+(?:on|at|via|using|for|is|was|has)\b|[.,;\n(]|$)/i, group: 1 },
  { re: /(?:transferred?|remitted)\s+to\s+(?!VPA\b)([^\n\r]{2,50}?)(?=\s+(?:on|at|via|using)\b|[.,;\n(]|$)/i, group: 1 },
  { re: /(?:received|credited)\s+from\s+(?!VPA\b)([^\n\r]{2,50}?)(?=\s+(?:on|at|via|using|to)\b|[.,;\n(]|$)/i, group: 1 },
  { re: /\btowards\s+(?!VPA\b)([^\n\r]{2,50}?)(?=\s+(?:on|at|via)\b|[.,;\n(]|$)/i, group: 1 },
];

/**
 * Beneficiary names sit right next to the UPI id, but banks disagree on which
 * side and how: "VPA x@y (NAME)", "VPA x@y NAME", "NAME (VPA: x@y)", "Sender:
 * NAME (VPA x@y)"... rather than chase every bank's exact phrasing, anchor on
 * the *actual* UPI id we've already resolved and look immediately before and
 * after its real occurrence in the text for a name — generalizes across
 * templates instead of matching one connector phrase at a time.
 */
function extractVpaBeneficiary(text: string, upiId: string | undefined): string | undefined {
  if (!upiId) return undefined;
  const esc = upiId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Name after: "VPA x@y (NAME)" or "VPA x@y NAME" — optional "VPA" label,
  // then this exact id, then either a parenthetical or a bare capitalised name.
  const after = new RegExp(
    String.raw`(?:VPA[:\s]*)?${esc}\s*(?:\(([^)]{2,50})\)|\s+([A-Z][\w\s.&-]{2,40}?)(?=\s+on\b|[.,;\n]|$))`,
    "i",
  ).exec(text);
  if (after) {
    const name = cleanMerchant(after[1] ?? after[2]);
    if (name) return name;
  }

  // Name before: "NAME (VPA: x@y)" or "NAME (VPA x@y)" — capitalised name
  // immediately preceding a parenthetical that wraps this exact id.
  const before = new RegExp(String.raw`([A-Z][\w .&'-]{2,40}?)\s*\(\s*VPA[:\s]*${esc}\s*\)`, "i").exec(text);
  if (before) {
    const name = cleanMerchant(before[1]);
    if (name) return name;
  }

  return undefined;
}

export function extractMerchant(text: string, upiId?: string): string | undefined {
  const narration = fromNarration(text);
  if (narration.merchant) return narration.merchant;
  const vpaBeneficiary = extractVpaBeneficiary(text, upiId);
  if (vpaBeneficiary) return vpaBeneficiary;
  for (const { re, group } of MERCHANT_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const candidate = cleanMerchant(m[group] ?? m[group + 1]);
      if (candidate) {
        // A bare VPA as merchant is fine — normalisation handles it.
        const trimmed = candidate.replace(MERCHANT_STOP, (s) => (s.startsWith(" ") ? "" : s));
        const final = cleanMerchant(trimmed);
        if (final) return final;
      }
    }
  }
  return undefined;
}

// ── Date & time ─────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const DATE_RE =
  /\bon\s+(\d{1,2})[-/ ]([a-z]{3,9}|\d{1,2})[-/ ](\d{2,4})(?:[\s,]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i;
const TIME_RE = /\bat\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/**
 * Parse "on 05-07-26 at 14:32" style timestamps. Indian banks write
 * dd-mm-yyyy and times in IST; the result is converted to UTC ms.
 * Falls back to the email's arrival time when parsing fails or the parsed
 * value is implausibly far from it.
 */
export function extractOccurredAt(text: string, internalDate: number): { ms: number; parsed: boolean } {
  const m = DATE_RE.exec(text);
  if (!m) return { ms: internalDate, parsed: false };
  const day = parseInt(m[1], 10);
  let month: number;
  if (/^\d+$/.test(m[2])) month = parseInt(m[2], 10) - 1;
  else month = MONTHS[m[2].slice(0, 3).toLowerCase()] ?? -1;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 0 || month > 11 || day < 1 || day > 31) return { ms: internalDate, parsed: false };

  // Default to the email's own arrival time-of-day (IST) when the body doesn't
  // spell out a clock time — these are near-real-time bank alerts, so that's a
  // far better estimate than assuming midnight.
  const arrivalIst = new Date(internalDate + IST_OFFSET_MS);
  let hh = arrivalIst.getUTCHours();
  let mm = arrivalIst.getUTCMinutes();
  let ss = arrivalIst.getUTCSeconds();
  const timeMatch = m[4] ? { h: m[4], m: m[5], s: m[6], ap: m[7] } : (() => {
    const tm = TIME_RE.exec(text);
    return tm ? { h: tm[1], m: tm[2], s: tm[3], ap: tm[4] } : null;
  })();
  if (timeMatch) {
    hh = parseInt(timeMatch.h, 10);
    mm = parseInt(timeMatch.m, 10);
    ss = timeMatch.s ? parseInt(timeMatch.s, 10) : 0;
    const ap = timeMatch.ap?.toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
  }

  const ms = Date.UTC(year, month, day, hh, mm, ss) - IST_OFFSET_MS;
  // Sanity: within 400 days of arrival, otherwise trust the email timestamp.
  if (Math.abs(ms - internalDate) > 400 * 24 * 3600 * 1000) {
    return { ms: internalDate, parsed: false };
  }
  return { ms, parsed: true };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Full pipeline for one email: detect → extract → score.
 * Returns null when the email is not a genuine transaction or an amount and
 * direction cannot be established. Fields are only set when actually found —
 * nothing is guessed.
 */
export function parseEmail(email: EmailMessage): ParsedTransaction | null {
  const detection = classifyEmail(email);
  if (!detection.isTransaction) return null;

  const text = `${email.subject}\n${email.body}`.slice(0, MAX_SCAN);
  const provider = matchProvider(email.from);

  const { direction, index: dirIndex } = extractDirection(text);
  if (!direction) return null;

  const amountPaise = extractAmount(text, dirIndex);
  if (!amountPaise) return null;

  const narration = fromNarration(text);
  const upiId = narration.upiId ?? extractUpiId(text);
  const merchant = extractMerchant(text, upiId) ?? (upiId ? upiId : undefined);
  const referenceNumber = narration.ref ?? extractReference(text);
  const cardLast4 = extractCardLast4(text);
  const channel = extractChannel(text, provider?.channelHint);
  const { ms: occurredAt, parsed: dateParsed } = extractOccurredAt(text, email.internalDate);

  let confidence = 0.4;
  if (provider) confidence += 0.25;
  if (merchant) confidence += 0.12;
  if (referenceNumber) confidence += 0.1;
  if (channel) confidence += 0.05;
  if (dateParsed) confidence += 0.05;
  confidence = Math.min(confidence, 0.97);

  return {
    amountPaise,
    currency: "INR",
    direction,
    merchant,
    channel,
    bank: provider?.bank,
    referenceNumber,
    upiId,
    cardLast4,
    occurredAt,
    confidence: Math.round(confidence * 100) / 100,
    provider: provider?.id ?? "generic",
  };
}
