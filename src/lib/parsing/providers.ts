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
    senders: [/amazonpay|payments.*amazon\.(in|com)|amazon\.(in|com)/i],
    queryDomains: ["amazon.in"],
  },
];

export function matchProvider(from: string): Provider | undefined {
  return PROVIDERS.find((p) => p.senders.some((re) => re.test(from)));
}

/** Gmail search fragment restricting sync to known transaction senders. */
export function senderQuery(): string {
  const domains = Array.from(new Set(PROVIDERS.flatMap((p) => p.queryDomains)));
  return "(" + domains.map((d) => `from:(${d})`).join(" OR ") + ")";
}

/** Quick check used by incremental sync before fetching a full message. */
export function looksRelevant(from: string, subject: string): boolean {
  if (matchProvider(from)) return true;
  return /debit|credit|transaction|txn|payment|paid|received|spent|upi|withdrawn/i.test(subject);
}
