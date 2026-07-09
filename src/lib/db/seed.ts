/**
 * Seed a demo account with realistic data:
 *   email: demo@vyay.app  password: demo1234
 *
 * Run with: npm run db:seed
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, transactions, users } from "@/lib/db/schema";
import { ensureDefaultCategories } from "@/lib/categorize";
import { normalizeMerchant } from "@/lib/parsing/normalize";

const DAY = 24 * 3600 * 1000;

interface SeedTxn {
  merchant: string;
  amount: number; // rupees
  category: string | null;
  channel: string;
  bank: string;
  direction?: "debit" | "credit";
  upiId?: string;
  cardLast4?: string;
  notes?: string;
}

const MERCHANTS: SeedTxn[] = [
  { merchant: "Swiggy", amount: 285, category: "Food & Dining", channel: "UPI", bank: "HDFC Bank", upiId: "swiggy@icici" },
  { merchant: "Zomato", amount: 342, category: "Food & Dining", channel: "UPI", bank: "HDFC Bank", upiId: "zomato@paytm" },
  { merchant: "Blinkit", amount: 456, category: "Groceries", channel: "UPI", bank: "ICICI Bank", upiId: "blinkit@ybl" },
  { merchant: "Zepto", amount: 389, category: "Groceries", channel: "UPI", bank: "ICICI Bank", upiId: "zepto@axl" },
  { merchant: "BigBasket", amount: 1240, category: "Groceries", channel: "Card", bank: "HDFC Bank", cardLast4: "4321" },
  { merchant: "Uber", amount: 189, category: "Transport", channel: "UPI", bank: "HDFC Bank", upiId: "uber@hdfcbank" },
  { merchant: "Rapido", amount: 74, category: "Transport", channel: "UPI", bank: "SBI", upiId: "rapido@ybl" },
  { merchant: "IRCTC", amount: 1560, category: "Travel", channel: "Card", bank: "SBI", cardLast4: "8890" },
  { merchant: "Amazon", amount: 1899, category: "Shopping", channel: "Card", bank: "ICICI Bank", cardLast4: "2201" },
  { merchant: "Flipkart", amount: 999, category: "Shopping", channel: "UPI", bank: "Axis Bank", upiId: "flipkart@axisb" },
  { merchant: "Myntra", amount: 1499, category: "Shopping", channel: "Card", bank: "HDFC Bank", cardLast4: "4321" },
  { merchant: "Netflix", amount: 649, category: "Entertainment", channel: "Card", bank: "HDFC Bank", cardLast4: "4321" },
  { merchant: "Spotify", amount: 119, category: "Entertainment", channel: "UPI", bank: "ICICI Bank", upiId: "spotify@hdfcbank" },
  { merchant: "BookMyShow", amount: 560, category: "Entertainment", channel: "UPI", bank: "HDFC Bank", upiId: "bookmyshow@icici" },
  { merchant: "Apollo Pharmacy", amount: 430, category: "Health", channel: "UPI", bank: "SBI", upiId: "apollopharmacy@ybl" },
  { merchant: "Cult Fit", amount: 1200, category: "Health", channel: "Card", bank: "ICICI Bank", cardLast4: "2201" },
  { merchant: "Airtel", amount: 599, category: "Bills & Utilities", channel: "UPI", bank: "HDFC Bank", upiId: "airtel@payu" },
  { merchant: "Tata Power", amount: 1830, category: "Bills & Utilities", channel: "NetBanking", bank: "HDFC Bank" },
  { merchant: "Jio", amount: 299, category: "Bills & Utilities", channel: "UPI", bank: "SBI", upiId: "jio@sbi" },
  { merchant: "Ramesh Kirana Store", amount: 260, category: null, channel: "UPI", bank: "HDFC Bank", upiId: "rameshkirana@okhdfcbank" },
  { merchant: "Sharma Chai Wala", amount: 40, category: null, channel: "UPI", bank: "HDFC Bank", upiId: "sharmachai@paytm" },
  { merchant: "Petrol Pump HP", amount: 1500, category: "Transport", channel: "Card", bank: "Axis Bank", cardLast4: "7788" },
];

function jitter(base: number, pct = 0.35): number {
  return Math.round(base * (1 - pct + Math.random() * pct * 2));
}

async function main() {
  const email = "demo@vyay.app";
  const existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (existing) {
    console.log("Demo user already exists — deleting and re-seeding.");
    await db.delete(users).where(eq(users.id, existing.id));
  }

  const passwordHash = await bcrypt.hash("demo1234", 12);
  const user = (
    await db.insert(users).values({ email, name: "Demo User", passwordHash }).returning()
  )[0];

  await ensureDefaultCategories(user.id);
  const cats = await db.select().from(categories).where(eq(categories.userId, user.id));
  const catId = (name: string | null) =>
    name ? (cats.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? null) : null;

  const now = Date.now();
  let count = 0;

  // ~85 debits spread over 90 days.
  for (let i = 0; i < 85; i++) {
    const spec = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
    const daysAgo = Math.random() * 90;
    const occurredAt =
      now - daysAgo * DAY - Math.floor(Math.random() * 12) * 3600 * 1000;
    const amountPaise = jitter(spec.amount) * 100;
    await db.insert(transactions).values({
      userId: user.id,
      source: "seed",
      occurredAt: Math.floor(occurredAt),
      amountPaise,
      currency: "INR",
      direction: spec.direction ?? "debit",
      merchant: spec.merchant,
      merchantNormalized: normalizeMerchant(spec.merchant),
      channel: spec.channel,
      bank: spec.bank,
      upiId: spec.upiId ?? null,
      cardLast4: spec.cardLast4 ?? null,
      referenceNumber: String(400000000000 + Math.floor(Math.random() * 99999999999)),
      emailSubject: `You have done a ${spec.channel} txn of Rs ${(amountPaise / 100).toFixed(2)}`,
      confidence: 0.9,
      categoryId: catId(spec.category),
    });
    count++;
  }

  // Monthly salary credits.
  for (const monthsAgo of [0, 1, 2]) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - monthsAgo, 1);
    d.setHours(10, 12, 0, 0);
    await db.insert(transactions).values({
      userId: user.id,
      source: "seed",
      occurredAt: d.getTime(),
      amountPaise: 8_500_000,
      currency: "INR",
      direction: "credit",
      merchant: "Acme Technologies Salary",
      merchantNormalized: normalizeMerchant("Acme Technologies Salary"),
      channel: "NEFT",
      bank: "HDFC Bank",
      referenceNumber: `N${Math.floor(Math.random() * 1e12)}`,
      emailSubject: "Credit alert: NEFT received in your account",
      confidence: 0.95,
      categoryId: catId("Income"),
    });
    count++;
  }

  // A flagged duplicate pair (same amount, 90 seconds apart).
  const dupAt = now - 1 * DAY; // within the 72h Shortcut match window
  const base = (
    await db
      .insert(transactions)
      .values({
        userId: user.id,
        source: "seed",
        occurredAt: dupAt,
        amountPaise: 49900,
        currency: "INR",
        direction: "debit",
        merchant: "Swiggy",
        merchantNormalized: normalizeMerchant("Swiggy"),
        channel: "UPI",
        bank: "HDFC Bank",
        upiId: "swiggy@icici",
        referenceNumber: "412345678901",
        emailSubject: "You have done a UPI txn of Rs 499.00",
        confidence: 0.9,
        categoryId: catId("Food & Dining"),
      })
      .returning()
  )[0];
  await db.insert(transactions).values({
    userId: user.id,
    source: "seed",
    occurredAt: dupAt + 90 * 1000,
    amountPaise: 49900,
    currency: "INR",
    direction: "debit",
    merchant: "Swiggy",
    merchantNormalized: normalizeMerchant("Swiggy"),
    channel: "UPI",
    bank: "HDFC Bank",
    upiId: "swiggy@icici",
    referenceNumber: "412345678902",
    emailSubject: "UPI transaction alert",
    confidence: 0.85,
    categoryId: catId("Food & Dining"),
    duplicateOfId: base.id,
  });
  count += 2;

  console.log(`Seeded ${count} transactions for ${email} (password: demo1234).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
