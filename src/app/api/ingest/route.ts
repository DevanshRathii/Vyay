import { and, count, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiTokens, transactions, users } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { loadCategorizerContext } from "@/lib/categorize";
import { loadContactContext } from "@/lib/contacts/match";
import { ingestParsedTransaction } from "@/lib/ingest";
import { classifyEmail } from "@/lib/parsing/detect";
import { extractCardLast4, parseEmail } from "@/lib/parsing/engine";

export const dynamic = "force-dynamic";

// SMS can burst (several bank alerts landing within the same minute is
// normal, e.g. a UPI debit + the merchant's own confirmation) — higher than
// the Shortcut-log endpoint's 20/min, same shape.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

const smsSchema = z.object({
  type: z.literal("sms"),
  /** Optional — the iOS "Message Contains" automation can't reliably surface
   *  the sender for DLT alphanumeric ids, so the classifier must work on
   *  body evidence alone when this is empty. */
  sender: z.string().max(200).optional().default(""),
  body: z.string().min(1).max(6000),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

const walletSchema = z.object({
  type: z.literal("wallet"),
  merchant: z.string().trim().min(1).max(120),
  /** Rupees, e.g. 249.5 */
  amount: z.coerce.number().positive().max(10_000_000),
  card: z.string().max(60).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

const bodySchema = z.discriminatedUnion("type", [smsSchema, walletSchema]);

/**
 * SMS + Apple Wallet ingest endpoint. Same Bearer-token trust model as the
 * Shortcut log endpoint (src/app/api/shortcut/log/route.ts) — no new auth
 * surface. Always responds 2xx on a classifier reject (`status: "skipped"`):
 * the SMS automation fires on every matching message content-wise (OTPs,
 * promos, and future-dated e-mandate notices included), and a non-2xx here
 * would make Shortcuts nag the user on every single one.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing Authorization: Bearer token." }, { status: 401 });
  }
  const tokenRow = (
    await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, sha256(token))).limit(1)
  )[0];
  if (!tokenRow) {
    return NextResponse.json({ error: "Invalid token." }, { status: 401 });
  }
  await db.update(apiTokens).set({ lastUsedAt: Date.now() }).where(eq(apiTokens.id, tokenRow.id));
  const userId = tokenRow.userId;

  const recent = (
    await db
      .select({ n: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), gte(transactions.createdAt, Date.now() - RATE_LIMIT_WINDOW_MS)))
  )[0]?.n ?? 0;
  if (recent >= RATE_LIMIT_MAX) {
    return NextResponse.json({ error: `Too many requests — limit is ${RATE_LIMIT_MAX} per minute.` }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const user = (await db.select({ publicKey: users.publicKey }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const publicKey = user?.publicKey ?? null;
  const ctx = await loadCategorizerContext(userId);
  const contactCtx = await loadContactContext(userId);

  if (parsed.data.type === "sms") {
    const { sender, body, timestamp } = parsed.data;
    const internalDate = timestamp ? Date.parse(timestamp) : Date.now();
    const email = { id: "sms", internalDate, from: sender, subject: "", body };

    const detection = classifyEmail(email);
    if (!detection.isTransaction) {
      return NextResponse.json({ status: "skipped", reason: detection.reason });
    }
    const txn = parseEmail(email);
    if (!txn) {
      return NextResponse.json({ status: "skipped", reason: "unparseable" });
    }

    const { provider, ...normalized } = txn;
    const externalId = `sms:${sha256(`${sender}|${body}|${Math.floor(internalDate / 60_000)}`)}`;
    const outcome = await ingestParsedTransaction(userId, normalized, {
      source: "sms",
      externalId,
      raw: null,
      publicKey,
      ctx,
      contactCtx,
      provider,
    });
    return NextResponse.json({ status: outcome.status });
  }

  // Wallet: the payload IS the transaction — no classify/parse step. Apple's
  // Transaction automation only fires on an actual Apple Pay payment, so
  // direction is always debit; there's no credit case for this trigger.
  const { merchant, amount, card, timestamp } = parsed.data;
  const occurredAt = timestamp ? Date.parse(timestamp) : Date.now();
  const amountPaise = Math.round(amount * 100);
  const externalId = `wallet:${sha256(`${merchant}|${amountPaise}|${Math.floor(occurredAt / 60_000)}`)}`;
  const outcome = await ingestParsedTransaction(
    userId,
    {
      occurredAt,
      occurredAtPrecise: true,
      amountPaise,
      currency: "INR",
      direction: "debit",
      merchant,
      merchantSource: "pattern",
      merchantConfidence: 0.9,
      channel: "Card",
      cardLast4: card ? extractCardLast4(card) : undefined,
      confidence: 0.95,
    },
    { source: "wallet", externalId, raw: null, publicKey, ctx, contactCtx },
  );
  return NextResponse.json({ status: outcome.status });
}
