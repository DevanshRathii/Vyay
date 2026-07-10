/**
 * Static demo dataset for the public /demo tour (see DemoShell). Derived
 * from the same merchant/category templates as src/lib/db/seed.ts's
 * MERCHANTS table and DEFAULT_CATEGORIES, but generated deterministically
 * (no Math.random()) so the demo looks the same on every visit — real
 * screenshots, real tour narration, no surprises.
 *
 * Nothing here touches the network or the database. demoFetcher() below is
 * the only thing DemoShell wires into SWR; every /api/* read the real
 * components make resolves from these in-memory arrays instead.
 */

const DAY = 24 * 3600 * 1000;
const NOW = Date.now();

// ── Categories (mirrors DEFAULT_CATEGORIES in src/lib/categorize.ts) ────────

export interface DemoCategory {
  id: string;
  name: string;
  color: string;
}

export const DEMO_CATEGORIES: DemoCategory[] = [
  { id: "cat-food", name: "Food", color: "#ff9500" },
  { id: "cat-groceries", name: "Groceries", color: "#34c759" },
  { id: "cat-shopping", name: "Shopping", color: "#af52de" },
  { id: "cat-transport", name: "Transport", color: "#5ac8fa" },
  { id: "cat-travel", name: "Travel", color: "#007aff" },
  { id: "cat-entertainment", name: "Entertainment", color: "#ff2d55" },
  { id: "cat-bills", name: "Bills", color: "#ff3b30" },
  { id: "cat-fuel", name: "Fuel", color: "#a2845e" },
  { id: "cat-healthcare", name: "Healthcare", color: "#30d158" },
  { id: "cat-investment", name: "Investment", color: "#64d2ff" },
  { id: "cat-salary", name: "Salary", color: "#32d74b" },
  { id: "cat-subscriptions", name: "Subscriptions", color: "#bf5af2" },
  { id: "cat-utilities", name: "Utilities", color: "#ffd60a" },
];

function catByName(name: string | null): DemoCategory | null {
  if (!name) return null;
  return DEMO_CATEGORIES.find((c) => c.name === name) ?? null;
}

// ── Transactions ─────────────────────────────────────────────────────────

export interface DemoTxn {
  id: string;
  occurredAt: number;
  amountPaise: number;
  direction: "debit" | "credit";
  merchant: string | null;
  merchantNormalized: string | null;
  channel: string | null;
  bank: string | null;
  upiId: string | null;
  referenceNumber: string | null;
  cardLast4: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categorySource: string | null;
  notes: string | null;
  confidence: number | null;
  merchantConfidence: number | null;
  duplicateOfId: string | null;
  deletedAt: number | null;
  emailSubject: string | null;
  source: string;
}

interface Template {
  merchant: string;
  amount: number; // rupees
  category: string | null;
  channel: string;
  bank: string;
  upiId?: string;
  cardLast4?: string;
  /** Days ago for each occurrence — deterministic, not random. */
  daysAgo: number[];
  /** Showcase the merchant-confidence marker / auto-category badge. */
  merchantSource?: string;
  merchantConfidence?: number;
  categorySource?: string;
}

const TEMPLATES: Template[] = [
  { merchant: "Swiggy", amount: 285, category: "Food", channel: "UPI", bank: "HDFC Bank", upiId: "swiggy@icici", daysAgo: [1, 6, 14, 22, 31, 47] },
  { merchant: "Zomato", amount: 342, category: "Food", channel: "UPI", bank: "HDFC Bank", upiId: "zomato@paytm", daysAgo: [3, 11, 25, 40] },
  { merchant: "Blinkit", amount: 456, category: "Groceries", channel: "UPI", bank: "ICICI Bank", upiId: "blinkit@ybl", daysAgo: [2, 9, 17, 29, 44] },
  { merchant: "Zepto", amount: 389, category: "Groceries", channel: "UPI", bank: "ICICI Bank", upiId: "zepto@axl", daysAgo: [5, 19, 34] },
  { merchant: "BigBasket", amount: 1240, category: "Groceries", channel: "Card", bank: "HDFC Bank", cardLast4: "4321", daysAgo: [8, 36] },
  { merchant: "Uber", amount: 189, category: "Transport", channel: "UPI", bank: "HDFC Bank", upiId: "uber@hdfcbank", daysAgo: [1, 4, 13, 20, 33, 49] },
  { merchant: "Rapido", amount: 74, category: "Transport", channel: "UPI", bank: "SBI", upiId: "rapido@ybl", daysAgo: [6, 21] },
  { merchant: "IRCTC", amount: 1560, category: "Travel", channel: "Card", bank: "SBI", cardLast4: "8890", daysAgo: [27] },
  { merchant: "Amazon", amount: 1899, category: "Shopping", channel: "Card", bank: "ICICI Bank", cardLast4: "2201", daysAgo: [7, 38] },
  { merchant: "Flipkart", amount: 999, category: "Shopping", channel: "UPI", bank: "Axis Bank", upiId: "flipkart@axisb", daysAgo: [15, 42] },
  { merchant: "Myntra", amount: 1499, category: "Shopping", channel: "Card", bank: "HDFC Bank", cardLast4: "4321", daysAgo: [24] },
  { merchant: "Netflix", amount: 649, category: "Entertainment", channel: "Card", bank: "HDFC Bank", cardLast4: "4321", daysAgo: [3, 33] },
  { merchant: "Spotify", amount: 119, category: "Entertainment", channel: "UPI", bank: "ICICI Bank", upiId: "spotify@hdfcbank", daysAgo: [10, 40] },
  { merchant: "BookMyShow", amount: 560, category: "Entertainment", channel: "UPI", bank: "HDFC Bank", upiId: "bookmyshow@icici", daysAgo: [18] },
  { merchant: "Apollo Pharmacy", amount: 430, category: "Healthcare", channel: "UPI", bank: "SBI", upiId: "apollopharmacy@ybl", daysAgo: [12, 45] },
  { merchant: "Cult Fit", amount: 1200, category: "Healthcare", channel: "Card", bank: "ICICI Bank", cardLast4: "2201", daysAgo: [2, 30] },
  { merchant: "Airtel", amount: 599, category: "Utilities", channel: "UPI", bank: "HDFC Bank", upiId: "airtel@payu", daysAgo: [5, 35] },
  { merchant: "Tata Power", amount: 1830, category: "Utilities", channel: "NetBanking", bank: "HDFC Bank", daysAgo: [9, 39] },
  { merchant: "Jio", amount: 299, category: "Utilities", channel: "UPI", bank: "SBI", upiId: "jio@sbi", daysAgo: [4, 34] },
  {
    merchant: "Ramesh Kirana Store",
    amount: 260,
    category: null,
    channel: "UPI",
    bank: "HDFC Bank",
    upiId: "rameshkirana@okhdfcbank",
    daysAgo: [2, 16, 28],
    // Showcase: a real UPI-fallback merchant, low confidence, worth verifying.
    merchantSource: "upi-id",
    merchantConfidence: 0.6,
  },
  {
    merchant: "sharmachai",
    amount: 40,
    category: null,
    channel: "UPI",
    bank: "HDFC Bank",
    upiId: "sharmachai@paytm",
    daysAgo: [1, 8, 23, 37],
    // Showcase: a mangled free-text capture — the low-confidence marker.
    merchantSource: "info-freetext",
    merchantConfidence: 0.45,
  },
  { merchant: "Petrol Pump HP", amount: 1500, category: "Fuel", channel: "Card", bank: "Axis Bank", cardLast4: "7788", daysAgo: [6, 26], categorySource: "generic" },
  { merchant: "La Pinoz Pizza", amount: 610, category: "Food", channel: "UPI", bank: "ICICI Bank", upiId: "lapinoz@icici", daysAgo: [14], categorySource: "generic" },
];

function buildTransactions(): DemoTxn[] {
  const rows: DemoTxn[] = [];
  let n = 0;
  for (const t of TEMPLATES) {
    const cat = catByName(t.category);
    t.daysAgo.forEach((days, i) => {
      n++;
      // Small deterministic variation so occurrences aren't all identical.
      const factor = 1 + ((i % 3) - 1) * 0.07;
      const amountPaise = Math.round(t.amount * factor * 100);
      const occurredAt = NOW - days * DAY - (n % 12) * 3600 * 1000;
      rows.push({
        id: `demo-txn-${n}`,
        occurredAt,
        amountPaise,
        direction: "debit",
        merchant: t.merchant,
        merchantNormalized: t.merchant.toLowerCase(),
        channel: t.channel,
        bank: t.bank,
        upiId: t.upiId ?? null,
        referenceNumber: String(500000000000 + n * 137),
        cardLast4: t.cardLast4 ?? null,
        categoryId: cat?.id ?? null,
        categoryName: cat?.name ?? null,
        categoryColor: cat?.color ?? null,
        categorySource: cat ? (t.categorySource ?? "brand") : null,
        notes: null,
        confidence: 0.92,
        merchantConfidence: t.merchantConfidence ?? 0.85,
        duplicateOfId: null,
        deletedAt: null,
        emailSubject: `You have done a ${t.channel} txn of Rs ${(amountPaise / 100).toFixed(2)}`,
        source: "gmail",
      });
    });
  }

  // Monthly salary credits — this month and last.
  const salaryCat = catByName("Salary");
  for (const monthsAgo of [0, 1]) {
    n++;
    rows.push({
      id: `demo-txn-${n}`,
      occurredAt: NOW - monthsAgo * 30 * DAY - 4 * DAY,
      amountPaise: 8_500_000,
      direction: "credit",
      merchant: "Acme Technologies",
      merchantNormalized: "acme technologies",
      channel: "NEFT",
      bank: "HDFC Bank",
      upiId: null,
      referenceNumber: `N${900000000000 + n}`,
      cardLast4: null,
      categoryId: salaryCat?.id ?? null,
      categoryName: salaryCat?.name ?? null,
      categoryColor: salaryCat?.color ?? null,
      categorySource: "brand",
      notes: null,
      confidence: 0.95,
      merchantConfidence: 0.9,
      duplicateOfId: null,
      deletedAt: null,
      emailSubject: "Credit alert: NEFT received in your account",
      source: "gmail",
    });
  }

  // A flagged duplicate pair, like the real seed script — same amount 90s apart.
  const foodCat = catByName("Food");
  const dupAt = NOW - 2 * DAY;
  const base: DemoTxn = {
    id: "demo-txn-dup-1",
    occurredAt: dupAt,
    amountPaise: 49900,
    direction: "debit",
    merchant: "Swiggy",
    merchantNormalized: "swiggy",
    channel: "UPI",
    bank: "HDFC Bank",
    upiId: "swiggy@icici",
    referenceNumber: "412345678901",
    cardLast4: null,
    categoryId: foodCat?.id ?? null,
    categoryName: foodCat?.name ?? null,
    categoryColor: foodCat?.color ?? null,
    categorySource: "brand",
    notes: null,
    confidence: 0.9,
    merchantConfidence: 0.85,
    duplicateOfId: null,
    deletedAt: null,
    emailSubject: "You have done a UPI txn of Rs 499.00",
    source: "gmail",
  };
  rows.push(base, {
    ...base,
    id: "demo-txn-dup-2",
    occurredAt: dupAt + 90 * 1000,
    referenceNumber: "412345678902",
    emailSubject: "UPI transaction alert",
    confidence: 0.85,
    duplicateOfId: base.id,
  });

  return rows.sort((a, b) => b.occurredAt - a.occurredAt);
}

export const DEMO_TRANSACTIONS: DemoTxn[] = buildTransactions();

// ── Merchant rules (demo-only illustration) ─────────────────────────────

export const DEMO_RULES = [
  { id: "demo-rule-1", pattern: "swiggy", categoryId: "cat-food", categoryName: "Food", categoryColor: "#ff9500" },
  { id: "demo-rule-2", pattern: "petrol", categoryId: "cat-fuel", categoryName: "Fuel", categoryColor: "#a2845e" },
];

// ── Pending Apple Shortcut match ─────────────────────────────────────────

export const DEMO_MATCHES = [
  {
    id: "demo-match-1",
    createdAt: NOW - 3600 * 1000,
    amountPaise: 45000,
    direction: "debit",
    categoryName: "Food",
    notes: "lunch with the team",
    candidates: [
      {
        id: "demo-txn-candidate-1",
        occurredAt: NOW - 3500 * 1000,
        merchant: "Third Wave Coffee",
        channel: "UPI",
        bank: "HDFC Bank",
        amountPaise: 45000,
        categoryId: null,
      },
      {
        id: "demo-txn-candidate-2",
        occurredAt: NOW - 7200 * 1000,
        merchant: "Cafe Coffee Day",
        channel: "UPI",
        bank: "ICICI Bank",
        amountPaise: 45000,
        categoryId: null,
      },
    ],
  },
];

// ── Gmail / tokens (Settings tour step — disconnected state) ────────────

export const DEMO_GMAIL_STATUS = {
  oauthConfigured: true,
  connected: false,
  emailAddress: null,
  syncStatus: null,
  syncError: null,
  lastSyncAt: null,
  initialSyncDone: false,
  totalSynced: 0,
  syncProgress: null,
};

export const DEMO_TOKENS = [{ id: "demo-token-1", label: "iPhone Shortcut", lastUsedAt: NOW - 2 * DAY, createdAt: NOW - 60 * DAY }];

// ── Analytics (aggregated from DEMO_TRANSACTIONS, never hand-duplicated) ─

function istDateKey(ms: number): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function istMonthKey(ms: number): string {
  return istDateKey(ms).slice(0, 7);
}

function buildAnalytics(rows: DemoTxn[]) {
  const debitRows = rows.filter((r) => r.direction === "debit");
  const creditRows = rows.filter((r) => r.direction === "credit");
  const debit = debitRows.reduce((s, r) => s + r.amountPaise, 0);
  const credit = creditRows.reduce((s, r) => s + r.amountPaise, 0);

  const byCategoryMap = new Map<string, { id: string; name: string; color: string; total: number }>();
  for (const r of debitRows) {
    if (!r.categoryId || !r.categoryName || !r.categoryColor) continue;
    const cur = byCategoryMap.get(r.categoryId) ?? { id: r.categoryId, name: r.categoryName, color: r.categoryColor, total: 0 };
    cur.total += r.amountPaise;
    byCategoryMap.set(r.categoryId, cur);
  }
  const byCategory = Array.from(byCategoryMap.values()).sort((a, b) => b.total - a.total);

  const byChannelMap = new Map<string, number>();
  for (const r of debitRows) {
    if (!r.channel) continue;
    byChannelMap.set(r.channel, (byChannelMap.get(r.channel) ?? 0) + r.amountPaise);
  }
  const byChannel = Array.from(byChannelMap.entries())
    .map(([channel, total]) => ({ channel, total }))
    .sort((a, b) => b.total - a.total);

  const byMerchantMap = new Map<string, { total: number; count: number }>();
  for (const r of debitRows) {
    const label = (r.merchantNormalized ?? r.merchant ?? "unknown").toLowerCase();
    const cur = byMerchantMap.get(label) ?? { total: 0, count: 0 };
    cur.total += r.amountPaise;
    cur.count += 1;
    byMerchantMap.set(label, cur);
  }
  const topMerchants = Array.from(byMerchantMap.entries())
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const byDayMap = new Map<string, { debit: number; credit: number }>();
  for (const r of rows) {
    const key = istDateKey(r.occurredAt);
    const cur = byDayMap.get(key) ?? { debit: 0, credit: 0 };
    if (r.direction === "debit") cur.debit += r.amountPaise;
    else cur.credit += r.amountPaise;
    byDayMap.set(key, cur);
  }
  const byDay = Array.from(byDayMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byMonthMap = new Map<string, { debit: number; credit: number }>();
  for (const r of rows) {
    const key = istMonthKey(r.occurredAt);
    const cur = byMonthMap.get(key) ?? { debit: 0, credit: 0 };
    if (r.direction === "debit") cur.debit += r.amountPaise;
    else cur.credit += r.amountPaise;
    byMonthMap.set(key, cur);
  }
  const byMonth = Array.from(byMonthMap.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    totals: { debit, credit, count: rows.length, net: credit - debit },
    byCategory,
    byChannel,
    topMerchants,
    byDay,
    byMonth,
  };
}

export const DEMO_ANALYTICS = buildAnalytics(DEMO_TRANSACTIONS);

// ── Fetcher ──────────────────────────────────────────────────────────────

function matchesQuery(t: DemoTxn, q: string): boolean {
  const needle = q.toLowerCase();
  return [t.merchant, t.merchantNormalized, t.notes, t.upiId, t.emailSubject, t.referenceNumber]
    .filter(Boolean)
    .some((f) => f!.toLowerCase().includes(needle));
}

function filterTransactions(params: URLSearchParams) {
  let rows = DEMO_TRANSACTIONS.filter((t) => (params.get("onlyDeleted") === "1" ? t.deletedAt : !t.deletedAt));

  const q = params.get("q")?.trim();
  if (q) rows = rows.filter((t) => matchesQuery(t, q));

  const category = params.get("category");
  if (category === "uncategorized") rows = rows.filter((t) => !t.categoryId);
  else if (category) rows = rows.filter((t) => t.categoryId === category);

  if (params.get("lowConfidence") === "1") {
    rows = rows.filter((t) => t.merchantConfidence != null && t.merchantConfidence < 0.6);
  }
  if (params.get("categorySource") === "generic") {
    rows = rows.filter((t) => t.categorySource === "generic");
  }

  const channel = params.get("channel");
  if (channel) rows = rows.filter((t) => t.channel === channel);

  const direction = params.get("direction");
  if (direction === "debit" || direction === "credit") rows = rows.filter((t) => t.direction === direction);

  const sortKey = params.get("sort") ?? "occurredAt";
  const dir = params.get("dir") === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    if (sortKey === "amountPaise") return (a.amountPaise - b.amountPaise) * dir;
    if (sortKey === "merchant") return (a.merchant ?? "").localeCompare(b.merchant ?? "") * dir;
    return (a.occurredAt - b.occurredAt) * dir;
  });

  const page = Math.max(1, Number(params.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(params.get("pageSize") ?? 50)));
  const total = rows.length;
  const paged = rows.slice((page - 1) * pageSize, page * pageSize);
  return { rows: paged, total, pageSize };
}

/**
 * SWR fetcher for /demo: serves every read from the static data above,
 * mirroring the shape (and, for transactions, the filtering) of the real
 * API routes. Never touches the network.
 */
export async function demoFetcher(key: string): Promise<unknown> {
  const [path, search] = key.split("?");
  const params = new URLSearchParams(search ?? "");

  if (path === "/api/transactions") return filterTransactions(params);
  if (path === "/api/categories") {
    return { rows: DEMO_CATEGORIES.map((c) => ({ ...c, txnCount: DEMO_TRANSACTIONS.filter((t) => t.categoryId === c.id).length })) };
  }
  if (path === "/api/rules") return { rows: DEMO_RULES };
  if (path === "/api/matches") return { rows: DEMO_MATCHES };
  if (path === "/api/gmail/status") return DEMO_GMAIL_STATUS;
  if (path === "/api/tokens") return { rows: DEMO_TOKENS };
  if (path === "/api/analytics") return DEMO_ANALYTICS;
  if (path === "/api/contacts") return { rows: [] };

  return {};
}
