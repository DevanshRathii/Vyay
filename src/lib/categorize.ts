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
 * Built-in merchant knowledge: substring → default category name.
 * User-defined rules always take precedence over these.
 */
export const BUILTIN_RULES: Array<{ pattern: string; category: string; exclude?: string }> = [
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
  { pattern: "apple.com/bill", category: "Subscriptions" },
  { pattern: "apple services", category: "Subscriptions" },
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
  { pattern: "cred", category: "Bills" },
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

/**
 * Pick a category for a transaction. User rules win over built-ins; both
 * match a lowercase substring against merchant, UPI id and subject.
 */
export function categorize(
  ctx: CategorizerContext,
  fields: { merchantNormalized?: string | null; merchant?: string | null; upiId?: string | null; subject?: string | null },
): string | null {
  const haystack = [fields.merchantNormalized, fields.merchant, fields.upiId, fields.subject]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
  if (!haystack) return null;
  // Space-collapsed so an exclude like "amazonpay" catches both a squashed
  // VPA local-part ("amazonpay@apl") and spaced-out merchant text ("Amazon Pay").
  const haystackNoSpace = haystack.replace(/\s+/g, "");

  for (const rule of ctx.userRules) {
    if (haystack.includes(rule.pattern.toLowerCase()) && ctx.categoriesById.has(rule.categoryId)) {
      return rule.categoryId;
    }
  }
  for (const rule of BUILTIN_RULES) {
    if (!haystack.includes(rule.pattern)) continue;
    if (rule.exclude && haystackNoSpace.includes(rule.exclude)) continue;
    const id = ctx.categoryIdByLowerName.get(rule.category.toLowerCase());
    if (id) return id;
  }
  return null;
}

export async function findCategoryByName(userId: string, name: string): Promise<Category | undefined> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId)));
  return rows.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
}
