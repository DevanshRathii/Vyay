import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, merchantRules, type Category, type MerchantRule } from "@/lib/db/schema";

/** Default categories created for every new user (all editable/deletable). */
export const DEFAULT_CATEGORIES: Array<{ name: string; color: string }> = [
  { name: "Food", color: "#ff9500" },
  { name: "Groceries", color: "#34c759" },
  { name: "Shopping", color: "#af52de" },
  { name: "Transport", color: "#5ac8fa" },
  { name: "Travel", color: "#007aff" },
  { name: "Entertainment", color: "#ff2d55" },
  { name: "Bills", color: "#ff3b30" },
  { name: "Fuel", color: "#a2845e" },
  { name: "Healthcare", color: "#30d158" },
  { name: "Investment", color: "#64d2ff" },
  { name: "Salary", color: "#32d74b" },
  { name: "Subscriptions", color: "#bf5af2" },
  { name: "Utilities", color: "#ffd60a" },
  { name: "Insurance", color: "#0a84ff" },
  { name: "Rent", color: "#ff9f0a" },
  { name: "Transfer", color: "#8e8e93" },
  { name: "Education", color: "#5e5ce6" },
];

/**
 * Brand-name merchant knowledge: substring → default category name. The most
 * specific/precise tier — checked before GENERIC_RULES so e.g. "pizza hut"
 * doesn't get shadowed by the generic "pizza" keyword. User-defined rules
 * always take precedence over both tiers.
 */
export const BRAND_RULES: Array<{ pattern: string; category: string; exclude?: string }> = [
  // Food
  { pattern: "swiggy", category: "Food" },
  { pattern: "zomato", category: "Food" },
  { pattern: "dominos", category: "Food" },
  { pattern: "domino s", category: "Food" },
  { pattern: "mcdonald", category: "Food" },
  { pattern: "kfc", category: "Food" },
  { pattern: "pizza hut", category: "Food" },
  { pattern: "burger king", category: "Food" },
  { pattern: "eatclub", category: "Food" },
  { pattern: "starbucks", category: "Food" },
  // Groceries
  { pattern: "blinkit", category: "Groceries" },
  { pattern: "zepto", category: "Groceries" },
  { pattern: "bigbasket", category: "Groceries" },
  { pattern: "instamart", category: "Groceries" },
  { pattern: "dmart", category: "Groceries" },
  { pattern: "jiomart", category: "Groceries" },
  { pattern: "reliance fresh", category: "Groceries" },
  { pattern: "more supermarket", category: "Groceries" },
  // Shopping
  // Amazon Pay is a wallet, not a purchase from Amazon itself — it funds
  // bill payments, recharges, gift cards, and payments to other merchants,
  // so a UPI id or merchant containing "amazon" isn't reliably Shopping if
  // it's actually "amazonpay@..." / "Amazon Pay ...".
  { pattern: "amazon", category: "Shopping", exclude: "amazonpay" },
  { pattern: "flipkart", category: "Shopping" },
  { pattern: "myntra", category: "Shopping" },
  { pattern: "ajio", category: "Shopping" },
  { pattern: "meesho", category: "Shopping" },
  { pattern: "nykaa", category: "Shopping" },
  { pattern: "tata cliq", category: "Shopping" },
  { pattern: "decathlon", category: "Shopping" },
  { pattern: "croma", category: "Shopping" },
  { pattern: "ikea", category: "Shopping" },
  // Transport
  { pattern: "uber", category: "Transport" },
  { pattern: "ola", category: "Transport" },
  { pattern: "rapido", category: "Transport" },
  { pattern: "blusmart", category: "Transport" },
  { pattern: "metro", category: "Transport" },
  { pattern: "fastag", category: "Transport" },
  // Travel
  { pattern: "irctc", category: "Travel" },
  { pattern: "redbus", category: "Travel" },
  { pattern: "makemytrip", category: "Travel" },
  { pattern: "goibibo", category: "Travel" },
  { pattern: "cleartrip", category: "Travel" },
  { pattern: "ixigo", category: "Travel" },
  { pattern: "indigo", category: "Travel" },
  { pattern: "air india", category: "Travel" },
  { pattern: "vistara", category: "Travel" },
  { pattern: "oyo", category: "Travel" },
  { pattern: "airbnb", category: "Travel" },
  // Entertainment
  { pattern: "bookmyshow", category: "Entertainment" },
  { pattern: "pvr", category: "Entertainment" },
  { pattern: "inox", category: "Entertainment" },
  { pattern: "steam", category: "Entertainment" },
  // Subscriptions
  { pattern: "netflix", category: "Subscriptions" },
  { pattern: "spotify", category: "Subscriptions" },
  { pattern: "hotstar", category: "Subscriptions" },
  { pattern: "prime video", category: "Subscriptions" },
  { pattern: "youtube premium", category: "Subscriptions" },
  { pattern: "youtube", category: "Subscriptions" },
  { pattern: "apple.com/bill", category: "Subscriptions" },
  { pattern: "apple services", category: "Subscriptions" },
  // Apple's real billing descriptor is "APPLE MEDIA SERVICES", which
  // doesn't contain "apple services" as a substring — confirmed production
  // gap (16 uncategorized rows in one inbox).
  { pattern: "apple media services", category: "Subscriptions" },
  { pattern: "google one", category: "Subscriptions" },
  // Utilities / Bills
  { pattern: "jio", category: "Utilities" },
  { pattern: "airtel", category: "Utilities" },
  { pattern: "vi recharge", category: "Utilities" },
  { pattern: "bsnl", category: "Utilities" },
  { pattern: "tata power", category: "Utilities" },
  { pattern: "adani electricity", category: "Utilities" },
  { pattern: "bescom", category: "Utilities" },
  { pattern: "mahadiscom", category: "Utilities" },
  { pattern: "electricity", category: "Utilities" },
  { pattern: "broadband", category: "Utilities" },
  { pattern: "cred club", category: "Bills" },
  // Fuel
  { pattern: "hpcl", category: "Fuel" },
  { pattern: "iocl", category: "Fuel" },
  { pattern: "bpcl", category: "Fuel" },
  { pattern: "indian oil", category: "Fuel" },
  { pattern: "indianoil", category: "Fuel" },
  { pattern: "bharat petroleum", category: "Fuel" },
  { pattern: "hindustan petroleum", category: "Fuel" },
  { pattern: "shell", category: "Fuel" },
  { pattern: "petrol", category: "Fuel" },
  // Healthcare
  { pattern: "apollo", category: "Healthcare" },
  { pattern: "pharmeasy", category: "Healthcare" },
  { pattern: "1mg", category: "Healthcare" },
  { pattern: "netmeds", category: "Healthcare" },
  { pattern: "practo", category: "Healthcare" },
  { pattern: "pharmacy", category: "Healthcare" },
  // Investment
  { pattern: "zerodha", category: "Investment" },
  { pattern: "groww", category: "Investment" },
  { pattern: "upstox", category: "Investment" },
  { pattern: "kuvera", category: "Investment" },
  { pattern: "indian clearing corp", category: "Investment" },
  { pattern: "bse limited", category: "Investment" },
  { pattern: "nsdl", category: "Investment" },
  { pattern: "mutual fund", category: "Investment" },
  // Insurance
  { pattern: "lic of india", category: "Insurance" },
  { pattern: "policybazaar", category: "Insurance" },
  { pattern: "hdfc ergo", category: "Insurance" },
  { pattern: "star health", category: "Insurance" },
  { pattern: "acko", category: "Insurance" },
  { pattern: "insurance", category: "Insurance" },
];

/**
 * Generic category keywords — a broader, lower-precision net for merchants
 * that don't match a specific brand (e.g. "La Pinoz Pizza" doesn't match the
 * brand-only "pizza hut" entry). Checked only against merchant/UPI id — never
 * the email subject, unlike BRAND_RULES — so boilerplate subject text like
 * "...your HDFC Bank Credit Card" can't false-positive against a keyword like
 * a brand pattern could. Lower confidence; surfaced in the UI as "auto".
 */
export const GENERIC_RULES: Array<{ pattern: string; category: string }> = [
  // Food
  { pattern: "pizza", category: "Food" },
  { pattern: "biryani", category: "Food" },
  { pattern: "cafe", category: "Food" },
  { pattern: "coffee", category: "Food" },
  { pattern: "restaurant", category: "Food" },
  { pattern: "dhaba", category: "Food" },
  { pattern: "kitchen", category: "Food" },
  { pattern: "bakery", category: "Food" },
  { pattern: "sweets", category: "Food" },
  { pattern: "chai", category: "Food" },
  { pattern: "juice", category: "Food" },
  { pattern: "eatery", category: "Food" },
  { pattern: "tiffin", category: "Food" },
  { pattern: "dosa", category: "Food" },
  { pattern: "idli", category: "Food" },
  { pattern: "momos", category: "Food" },
  { pattern: "shawarma", category: "Food" },
  { pattern: "food", category: "Food" },
  // Groceries
  { pattern: "kirana", category: "Groceries" },
  { pattern: "mart", category: "Groceries" },
  { pattern: "supermarket", category: "Groceries" },
  { pattern: "grocery", category: "Groceries" },
  { pattern: "provision", category: "Groceries" },
  { pattern: "fresh", category: "Groceries" },
  // Transport
  { pattern: "cab", category: "Transport" },
  { pattern: "taxi", category: "Transport" },
  { pattern: "parking", category: "Transport" },
  { pattern: "toll", category: "Transport" },
  { pattern: "rickshaw", category: "Transport" },
  // Fuel
  { pattern: "fuel", category: "Fuel" },
  { pattern: "petroleum", category: "Fuel" },
  { pattern: "filling station", category: "Fuel" },
  // Healthcare
  { pattern: "hospital", category: "Healthcare" },
  { pattern: "healthcare", category: "Healthcare" },
  { pattern: "health", category: "Healthcare" },
  { pattern: "clinic", category: "Healthcare" },
  { pattern: "diagnostic", category: "Healthcare" },
  { pattern: "lab", category: "Healthcare" },
  { pattern: "medical", category: "Healthcare" },
  { pattern: "chemist", category: "Healthcare" },
  { pattern: "dental", category: "Healthcare" },
  { pattern: "physio", category: "Healthcare" },
  { pattern: "gym", category: "Healthcare" },
  { pattern: "fitness", category: "Healthcare" },
  { pattern: "yoga", category: "Healthcare" },
  // Travel — "hotel" defaults here: lodging is the common case, and a "Hotel
  // X" restaurant miscategorized this way is one user rule away from fixed.
  { pattern: "airlines", category: "Travel" },
  { pattern: "resort", category: "Travel" },
  { pattern: "travels", category: "Travel" },
  { pattern: "tours", category: "Travel" },
  { pattern: "lodge", category: "Travel" },
  { pattern: "hotel", category: "Travel" },
  // Utilities
  { pattern: "recharge", category: "Utilities" },
  { pattern: "dth", category: "Utilities" },
  { pattern: "gas", category: "Utilities" },
  { pattern: "water bill", category: "Utilities" },
  // Education
  { pattern: "school", category: "Education" },
  { pattern: "college", category: "Education" },
  { pattern: "academy", category: "Education" },
  { pattern: "institute", category: "Education" },
  { pattern: "coaching", category: "Education" },
  { pattern: "tuition", category: "Education" },
  { pattern: "classes", category: "Education" },
  // Insurance
  { pattern: "premium", category: "Insurance" },
  { pattern: "policy", category: "Insurance" },
  // Investment
  { pattern: "sip", category: "Investment" },
  { pattern: "securities", category: "Investment" },
  { pattern: "broking", category: "Investment" },
  { pattern: "demat", category: "Investment" },
  // Rent
  { pattern: "rent", category: "Rent" },
  // Entertainment
  { pattern: "cinema", category: "Entertainment" },
  { pattern: "movies", category: "Entertainment" },
  { pattern: "gaming", category: "Entertainment" },
  { pattern: "club", category: "Entertainment" },
];

/**
 * A curated alias map for well-known brands: normalized merchant text →
 * clean display name. Checked at ingest/reparse time (see ingest.ts) against
 * `merchantNormalized`, overriding a mangled or corporate-suffixed extraction
 * ("Uber India Systems" → "Uber") with a confidence bump to 0.95. Not used by
 * categorize() itself — this is purely a display/confidence concern.
 */
export const KNOWN_MERCHANTS: Record<string, string> = {
  swiggy: "Swiggy",
  zomato: "Zomato",
  dominos: "Domino's",
  mcdonald: "McDonald's",
  kfc: "KFC",
  starbucks: "Starbucks",
  blinkit: "Blinkit",
  zepto: "Zepto",
  bigbasket: "BigBasket",
  instamart: "Swiggy Instamart",
  dmart: "DMart",
  jiomart: "JioMart",
  amazon: "Amazon",
  flipkart: "Flipkart",
  myntra: "Myntra",
  ajio: "Ajio",
  meesho: "Meesho",
  nykaa: "Nykaa",
  decathlon: "Decathlon",
  croma: "Croma",
  ikea: "IKEA",
  uber: "Uber",
  ola: "Ola",
  rapido: "Rapido",
  blusmart: "BluSmart",
  irctc: "IRCTC",
  redbus: "redBus",
  makemytrip: "MakeMyTrip",
  goibibo: "Goibibo",
  cleartrip: "Cleartrip",
  ixigo: "ixigo",
  indigo: "IndiGo",
  vistara: "Vistara",
  oyo: "OYO",
  airbnb: "Airbnb",
  bookmyshow: "BookMyShow",
  netflix: "Netflix",
  spotify: "Spotify",
  hotstar: "Disney+ Hotstar",
  zerodha: "Zerodha",
  groww: "Groww",
  upstox: "Upstox",
  apollo: "Apollo Pharmacy",
  pharmeasy: "PharmEasy",
  netmeds: "Netmeds",
  practo: "Practo",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompiledRule {
  re: RegExp;
  category: string;
  exclude?: string;
}

/** Word-boundary regex per pattern, longest-pattern-first so e.g. "pizza hut"
 * (brand) is tried before a shorter overlapping pattern would ever matter. */
function compileRules(rules: Array<{ pattern: string; category: string; exclude?: string }>): CompiledRule[] {
  return [...rules]
    .sort((a, b) => b.pattern.length - a.pattern.length)
    .map((r) => ({
      re: new RegExp(String.raw`\b${escapeRegExp(r.pattern)}\b`, "i"),
      category: r.category,
      exclude: r.exclude,
    }));
}

const COMPILED_BRAND_RULES = compileRules(BRAND_RULES);
const COMPILED_GENERIC_RULES = compileRules(GENERIC_RULES);

export async function ensureDefaultCategories(userId: string): Promise<void> {
  const existing = await db.select().from(categories).where(eq(categories.userId, userId));
  if (existing.length > 0) return;
  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c) => ({ userId, name: c.name, color: c.color })));
}

export interface CategorizerContext {
  userRules: MerchantRule[];
  categoriesById: Map<string, Category>;
  categoryIdByLowerName: Map<string, string>;
}

export async function loadCategorizerContext(userId: string): Promise<CategorizerContext> {
  const userRules = await db.select().from(merchantRules).where(eq(merchantRules.userId, userId));
  const cats = await db.select().from(categories).where(eq(categories.userId, userId));
  return {
    userRules,
    categoriesById: new Map(cats.map((c) => [c.id, c])),
    categoryIdByLowerName: new Map(cats.map((c) => [c.name.toLowerCase(), c.id])),
  };
}

export type CategorySource = "user" | "brand" | "generic";

export interface CategorizeResult {
  categoryId: string | null;
  source: CategorySource | null;
}

/**
 * Pick a category for a transaction. Resolution order: user rules → brand
 * rules → generic keywords. User and brand rules match word-boundary
 * substrings against merchant, UPI id, *and subject*; generic keywords match
 * only merchant/UPI id — never the subject, so boilerplate subject text can't
 * false-positive against a broad keyword the way it could against `subject`.
 */
export function categorize(
  ctx: CategorizerContext,
  fields: { merchantNormalized?: string | null; merchant?: string | null; upiId?: string | null; subject?: string | null },
): CategorizeResult {
  const brandHaystack = [fields.merchantNormalized, fields.merchant, fields.upiId, fields.subject]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
  if (!brandHaystack) return { categoryId: null, source: null };
  // Space-collapsed so an exclude like "amazonpay" catches both a squashed
  // VPA local-part ("amazonpay@apl") and spaced-out merchant text ("Amazon Pay").
  const brandHaystackNoSpace = brandHaystack.replace(/\s+/g, "");
  const genericHaystack = [fields.merchantNormalized, fields.merchant, fields.upiId]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();

  for (const rule of ctx.userRules) {
    if (brandHaystack.includes(rule.pattern.toLowerCase()) && ctx.categoriesById.has(rule.categoryId)) {
      return { categoryId: rule.categoryId, source: "user" };
    }
  }
  for (const rule of COMPILED_BRAND_RULES) {
    if (!rule.re.test(brandHaystack)) continue;
    if (rule.exclude && brandHaystackNoSpace.includes(rule.exclude)) continue;
    const id = ctx.categoryIdByLowerName.get(rule.category.toLowerCase());
    if (id) return { categoryId: id, source: "brand" };
  }
  for (const rule of COMPILED_GENERIC_RULES) {
    if (!rule.re.test(genericHaystack)) continue;
    const id = ctx.categoryIdByLowerName.get(rule.category.toLowerCase());
    if (id) return { categoryId: id, source: "generic" };
  }
  return { categoryId: null, source: null };
}

export async function findCategoryByName(userId: string, name: string): Promise<Category | undefined> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId)));
  return rows.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
}
