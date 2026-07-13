import type { Provider } from "./types";

/**
 * Registry of supported senders. Adding a provider here automatically:
 *  1. includes its domains in the Gmail sync search query, and
 *  2. tags parsed transactions with the right bank/channel.
 */
export const PROVIDERS: Provider[] = [
  {
    id: "hdfc",
    name: "HDFC Bank",
    bank: "HDFC Bank",
    senders: [/hdfcbank\.(net|com|bank\.in)/i],
    queryDomains: ["hdfcbank.net", "hdfcbank.com", "hdfcbank.bank.in"],
  },
  {
    id: "icici",
    name: "ICICI Bank",
    bank: "ICICI Bank",
    senders: [/icicibank\.com/i],
    queryDomains: ["icicibank.com"],
  },
  {
    id: "axis",
    name: "Axis Bank",
    bank: "Axis Bank",
    senders: [/axisbank\.com/i],
    queryDomains: ["axisbank.com"],
  },
  {
    id: "sbi",
    name: "State Bank of India",
    bank: "SBI",
    senders: [/sbi\.co\.in|onlinesbi\.com|sbicard\.com/i],
    queryDomains: ["sbi.co.in", "onlinesbi.com", "sbicard.com"],
  },
  {
    id: "kotak",
    name: "Kotak Mahindra Bank",
    bank: "Kotak",
    senders: [/kotak\.com/i],
    queryDomains: ["kotak.com"],
  },
  {
    id: "idfc",
    name: "IDFC FIRST Bank",
    bank: "IDFC FIRST",
    senders: [/idfcfirstbank\.com/i],
    queryDomains: ["idfcfirstbank.com"],
  },
  {
    id: "indusind",
    name: "IndusInd Bank",
    bank: "IndusInd",
    senders: [/indusind\.com/i],
    queryDomains: ["indusind.com"],
  },
  {
    id: "federal",
    name: "Federal Bank",
    bank: "Federal Bank",
    senders: [/federalbank\.co\.in/i],
    queryDomains: ["federalbank.co.in"],
  },
  {
    id: "au",
    name: "AU Small Finance Bank",
    bank: "AU Bank",
    senders: [/aubank\.in/i],
    queryDomains: ["aubank.in"],
  },
  {
    id: "yesbank",
    name: "Yes Bank",
    bank: "Yes Bank",
    senders: [/yesbank\.in/i],
    queryDomains: ["yesbank.in"],
  },
  {
    id: "pnb",
    name: "Punjab National Bank",
    bank: "PNB",
    senders: [/pnbindia\.in/i],
    queryDomains: ["pnbindia.in"],
  },
  {
    id: "bob",
    name: "Bank of Baroda",
    bank: "Bank of Baroda",
    senders: [/bankofbaroda\.(co\.in|in)/i],
    queryDomains: ["bankofbaroda.co.in", "bankofbaroda.in"],
  },
  {
    id: "canara",
    name: "Canara Bank",
    bank: "Canara Bank",
    senders: [/canarabank\.com/i],
    queryDomains: ["canarabank.com"],
  },
  {
    id: "unionbank",
    name: "Union Bank of India",
    bank: "Union Bank",
    senders: [/unionbankofindia\.co\.in/i],
    queryDomains: ["unionbankofindia.co.in"],
  },
  {
    id: "amex",
    name: "American Express",
    bank: "American Express",
    channelHint: "Card",
    senders: [/americanexpress\.com|aexp\.com/i],
    queryDomains: ["americanexpress.com"],
  },
  {
    id: "phonepe",
    name: "PhonePe",
    channelHint: "UPI",
    senders: [/phonepe\.com/i],
    queryDomains: ["phonepe.com"],
  },
  {
    id: "gpay",
    name: "Google Pay",
    channelHint: "UPI",
    senders: [/payments-noreply@google\.com|googlepay/i],
    queryDomains: ["payments-noreply@google.com"],
  },
  {
    id: "paytm",
    name: "Paytm",
    channelHint: "Wallet",
    senders: [/paytm\.com|paytmbank\.com/i],
    queryDomains: ["paytm.com", "paytmbank.com"],
  },
  {
    id: "bhim",
    name: "BHIM",
    channelHint: "UPI",
    senders: [/npci\.org\.in|bhimupi/i],
    queryDomains: ["npci.org.in"],
  },
  {
    id: "cred",
    name: "CRED",
    senders: [/cred\.club/i],
    queryDomains: ["cred.club"],
  },
  {
    id: "amazonpay",
    name: "Amazon Pay",
    channelHint: "Wallet",
    // `senders` stays broad (any amazon.in/.com sender) for tagging already-
    // fetched messages, but `queryDomains` scopes the *sync* query to the
    // actual payments sender — "amazon.in" alone pulls every order/shipping/
    // marketing email into the full-fetch set for the entire lookback
    // window, only for classifyEmail() to reject nearly all of them after an
    // expensive full-body fetch.
    senders: [/amazonpay|payments.*amazon\.(in|com)|amazon\.(in|com)/i],
    queryDomains: ["payments@amazon.in", "payments@amazon.com"],
  },
];

export function matchProvider(from: string): Provider | undefined {
  return PROVIDERS.find((p) => p.senders.some((re) => re.test(from)));
}

/**
 * Gmail search fragment restricting sync to known transaction senders.
 * `providerIds`, when given, further narrows to just those providers (the
 * connection's `selectedProviders`); an empty selection is treated the same
 * as no selection — falls back to all providers rather than emitting a
 * query that would match nothing.
 */
export function senderQuery(providerIds?: string[] | null): string {
  const active = providerIds && providerIds.length > 0 ? PROVIDERS.filter((p) => providerIds.includes(p.id)) : PROVIDERS;
  const domains = Array.from(new Set(active.flatMap((p) => p.queryDomains)));
  return "(" + domains.map((d) => `from:(${d})`).join(" OR ") + ")";
}

/**
 * Quick check used by incremental sync before fetching a full message.
 *
 * Sender match only — no subject-keyword fallback. classifyEmail()/parseEmail()
 * have no sender-awareness at all, so this is the only gate standing between
 * "some email with transaction-shaped words in the subject" and a row in the
 * ledger. A self-forwarded bank alert ("Fwd: UPI Transaction Alert") has
 * exactly that subject shape but comes from the user's own address, not a
 * bank — it must be rejected here, the same way fullSync's sender-scoped
 * query already rejects it.
 */
export function looksRelevant(from: string): boolean {
  return matchProvider(from) !== undefined;
}
