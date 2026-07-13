import type { Contact } from "@/lib/db/schema";
import { normalizeMerchant } from "@/lib/parsing/normalize";

/**
 * Pure contact-matching logic — deliberately has no `db` import, so this
 * whole module is safe to bundle client-side (src/lib/parser-sync.ts, for
 * keyed accounts). `contacts/match.ts` re-exports everything here for
 * backward compatibility and adds the DB-touching `loadContactContext`.
 */
export interface ContactContext {
  byPhone: Map<string, Contact>;
  byEmailLocalPart: Map<string, Contact>;
  byName: Map<string, Contact>;
  all: Contact[];
}

function localPart(addr: string): string {
  return addr.split("@")[0]?.toLowerCase() ?? "";
}

export function buildContactContext(rows: Contact[]): ContactContext {
  const byPhone = new Map<string, Contact>();
  const byEmailLocalPart = new Map<string, Contact>();
  const byName = new Map<string, Contact>();
  for (const c of rows) {
    byName.set(c.nameNormalized, c);
    let phones: string[] = [];
    let emails: string[] = [];
    try {
      phones = JSON.parse(c.phones);
    } catch {
      // ignore malformed rows rather than fail the whole match pass
    }
    try {
      emails = JSON.parse(c.emails);
    } catch {
      // same
    }
    for (const p of phones) byPhone.set(p, c);
    for (const e of emails) {
      const lp = localPart(e);
      if (lp) byEmailLocalPart.set(lp, c);
    }
  }
  return { byPhone, byEmailLocalPart, byName, all: rows };
}

/** Strip everything but digits and keep the last 10 — Indian mobile numbers
 * are 10 digits; this absorbs +91/91/0 country-or-trunk prefixes and any
 * punctuation, so "+91 99902 65771" and "099902-65771" normalize the same. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** Digits embedded in a UPI id's local part, e.g. "9990265771@ptsbi" or
 * "918368288775@wahdfcbank" (country-code-prefixed) both yield the same
 * 10-digit number a saved contact's phone would normalize to. */
export function phoneFromUpiId(upiId: string): string | null {
  const localPart = upiId.split("@")[0] ?? "";
  return normalizePhone(localPart);
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/** Minimum length of the shorter local part before a prefix relationship is
 * trusted — short local parts risk one being a coincidental prefix of an
 * unrelated, longer one. */
const MIN_EMAIL_PREFIX_LEN = 6;

/** True if the two local parts are equal, or one is the other plus a short
 * suffix — UPI apps commonly disambiguate a second handle for the same
 * person by appending "-2", "2", etc. ("tanya1999rathi" / "tanya1999rathi-2"). */
function localPartsRelated(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= MIN_EMAIL_PREFIX_LEN && longer.startsWith(shorter);
}

/** The saved contact with an email whose local part is equal to, or a
 * suffixed variant of, the UPI id's local part. Longest (most specific)
 * shared prefix wins if more than one contact happens to relate. */
function matchByRelatedEmailLocalPart(all: Contact[], upiLocal: string): Contact | undefined {
  let best: { contact: Contact; len: number } | undefined;
  for (const c of all) {
    let emails: string[] = [];
    try {
      emails = JSON.parse(c.emails);
    } catch {
      continue;
    }
    for (const e of emails) {
      const el = localPart(e);
      if (el && localPartsRelated(upiLocal, el)) {
        const len = Math.min(upiLocal.length, el.length);
        if (!best || len > best.len) best = { contact: c, len };
      }
    }
  }
  return best?.contact;
}

// ── Fuzzy name matching ──────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Two name tokens are the same person-word if they're equal, or one is a
 * bare initial that's the other's first letter — "v" ~ "vansh". */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

/**
 * True if every word of the shorter name has a corresponding word in the
 * longer one (order-independent, initials allowed) — "vansh" ⊂ "vansh
 * wadhwa", "v wadhwa" ⊂ "vansh wadhwa", "wadhwa vansh" ⊂ "vansh wadhwa".
 *
 * At least one of those correspondences must be an exact word match, not
 * just an initial — a bare initial with nothing else to corroborate it is
 * too weak on its own ("a" would otherwise match literally any name
 * starting with "a", e.g. "BAJAJ A" ~ "Anshika").
 */
function isTokenSubset(a: string, b: string): boolean {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Array(big.length).fill(false);
  let hasExactMatch = false;
  for (const t of small) {
    let i = big.findIndex((bt, idx) => !used[idx] && t === bt);
    if (i !== -1) hasExactMatch = true;
    else i = big.findIndex((bt, idx) => !used[idx] && tokensMatch(t, bt));
    if (i === -1) return false;
    used[i] = true;
  }
  return hasExactMatch;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[b.length];
}

/** 0..1, higher is closer — 1 for identical strings, 0 for completely different. */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Minimum similarity to accept a fuzzy (non-exact, non-subset) name match. Deliberately
 * conservative — contacts are a golden source, so a wrong match is worse than no match. */
const FUZZY_THRESHOLD = 0.78;

/** A whole-word subset match (including initials) is a strong, unambiguous signal; a bare similarity score is softer. */
function nameScore(a: string, b: string): number {
  if (a === b) return 1;
  if (isTokenSubset(a, b)) return 0.95;
  return similarity(a, b);
}

// ── Name embedded directly in the UPI id ─────────────────────────────────

/** Below this length a name word risks matching by coincidence inside an
 * unrelated id ("ram" inside "abhiram") — the same class of false positive
 * bare initials caused, just one size up. Indian UPI handles very commonly
 * concatenate surname+firstname(+year) with no separator (e.g.
 * "bajajabhinav2002"), so this only fires on whole words of real length. */
const MIN_EMBEDDED_NAME_LEN = 5;

/**
 * The saved contact whose name appears literally embedded in the UPI id's
 * local part (letters only) — most-specific match wins if more than one
 * contact's name happens to appear.
 *
 * For a single-word contact name, requires the id to have *more* letters
 * than the matched word alone: a name concatenated with other text
 * ("abhinav" inside "bajajabhinav2002") is a deliberate compound handle, but
 * an id that's nothing but a bare first name ("meenakshi") is too weak a
 * signal on its own — plenty of people share a first name, and here it would
 * override the bank's own, more specific extracted name.
 *
 * For a multi-word contact name ("Devansh Rathi"), requires *every* word to
 * be found, not just the longest — a shared surname alone is common within a
 * family and isn't enough to tell siblings/cousins apart ("rathi" inside
 * "sandeeprathi" must not match "Devansh Rathi" just because they share a
 * surname; "devansh" itself is nowhere in that id).
 */
function matchByNameEmbeddedInUpiId(all: Contact[], upiLocalPart: string): Contact | undefined {
  const letters = upiLocalPart.replace(/[^a-z]/g, "");
  let best: { contact: Contact; len: number } | undefined;
  for (const c of all) {
    const words = tokenize(c.nameNormalized);
    if (words.length === 0 || words.some((w) => w.length < MIN_EMBEDDED_NAME_LEN)) continue;

    if (words.length === 1) {
      const w = words[0];
      if (letters.length > w.length && letters.includes(w)) {
        if (!best || w.length > best.len) best = { contact: c, len: w.length };
      }
    } else if (words.every((w) => letters.includes(w))) {
      const totalLen = words.reduce((sum, w) => sum + w.length, 0);
      if (!best || totalLen > best.len) best = { contact: c, len: totalLen };
    }
  }
  return best?.contact;
}

/**
 * A contact is the golden source: if the UPI id's embedded phone number, the
 * UPI id's local part relating to a saved email's local part, a contact's
 * name appearing literally inside the UPI id, or the parser's extracted
 * merchant name matches a saved contact, that contact's name wins — even
 * over a name the bank's own email included. Checked in that order,
 * strongest identifier first:
 *   1. phone embedded in the UPI id
 *   2. UPI id local-part == (or a suffixed variant of) a saved email's
 *      local-part — people often reuse the same handle for their real email
 *      and their UPI id, and UPI apps commonly append "-2"/"2" to
 *      disambiguate a second handle for the same person
 *   3. a contact's name word literally embedded in the UPI id ("abhinav" in
 *      "bajajabhinav2002") — catches cases the parsed merchant name lost to
 *      truncation ("BAJAJ A"), since it reads the id directly instead
 *   4. exact normalized name
 *   5. fuzzy name — partial ("Vansh" for "Vansh Wadhwa"), reordered or
 *      initialed ("V Wadhwa"), or a minor typo — picking whichever saved
 *      contact scores highest, as long as it clears the threshold.
 */
export function matchContact(
  ctx: ContactContext,
  fields: { merchant?: string | null; upiId?: string | null },
): Contact | undefined {
  if (fields.upiId) {
    const phone = phoneFromUpiId(fields.upiId);
    if (phone) {
      const byPhone = ctx.byPhone.get(phone);
      if (byPhone) return byPhone;
    }

    const lp = localPart(fields.upiId);
    if (lp) {
      const byEmail = ctx.byEmailLocalPart.get(lp);
      if (byEmail) return byEmail;

      const byRelatedEmail = matchByRelatedEmailLocalPart(ctx.all, lp);
      if (byRelatedEmail) return byRelatedEmail;

      const byEmbeddedName = matchByNameEmbeddedInUpiId(ctx.all, lp);
      if (byEmbeddedName) return byEmbeddedName;
    }
  }
  if (fields.merchant) {
    const normalized = normalizeMerchant(fields.merchant);
    if (normalized) {
      const exact = ctx.byName.get(normalized);
      if (exact) return exact;

      let best: { contact: Contact; score: number } | undefined;
      for (const c of ctx.all) {
        const score = nameScore(normalized, c.nameNormalized);
        if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) {
          best = { contact: c, score };
        }
      }
      if (best) return best.contact;
    }
  }
  return undefined;
}
