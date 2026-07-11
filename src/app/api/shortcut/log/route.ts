import { and, count, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiTokens, categories, shortcutEvents, users } from "@/lib/db/schema";
import { amountBidx } from "@/lib/blind-index";
import { sha256 } from "@/lib/crypto";
import { sealForUser } from "@/lib/e2e-crypto";
import { applyEventToTransaction, findCandidates } from "@/lib/match";

export const dynamic = "force-dynamic";

// Generous enough for normal use (even a burst of catching up on several
// past expenses), tight enough to stop a runaway Shortcut loop or a leaked
// token from writing unbounded rows. Counts accepted events, not raw HTTP
// requests — no new infra, just a COUNT against shortcutEvents itself.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

// A cheap backstop against the same failure mode on the category
// auto-create path: an unbounded loop of never-repeating category names
// would otherwise create one category per call forever.
const MAX_CATEGORIES = 100;

const bodySchema = z.object({
  /** Rupees, e.g. 249.5 */
  amount: z.coerce.number().positive().max(10_000_000),
  category: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(500).optional(),
  direction: z.enum(["debit", "credit"]).default("debit"),
  /** Optional ISO timestamp of the expense; defaults to now. */
  timestamp: z.string().datetime({ offset: true }).optional(),
});

/**
 * Apple Shortcut endpoint. Authenticated with a Bearer token generated in
 * Settings. Logs an expense and pairs it with the matching Gmail transaction:
 *   - exactly one candidate → category/notes applied immediately
 *   - several candidates    → saved for manual resolution on /matches
 *   - none yet              → kept pending; auto-resolved when the email lands
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
      .from(shortcutEvents)
      .where(and(eq(shortcutEvents.userId, userId), gte(shortcutEvents.createdAt, Date.now() - RATE_LIMIT_WINDOW_MS)))
  )[0]?.n ?? 0;
  if (recent >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: `Too many logs — limit is ${RATE_LIMIT_MAX} per minute. Try again shortly.` },
      { status: 429 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { amount, category, notes, direction, timestamp } = parsed.data;
  const amountPaise = Math.round(amount * 100);
  const at = timestamp ? Date.parse(timestamp) : Date.now();

  // Resolve or create the category by name (case-insensitive).
  const cats = await db.select().from(categories).where(eq(categories.userId, userId));
  let cat = cats.find((c) => c.name.toLowerCase() === category.toLowerCase());
  if (!cat) {
    if (cats.length >= MAX_CATEGORIES) {
      return NextResponse.json(
        { error: `You have ${cats.length} categories already — pick an existing one instead of a new name.` },
        { status: 400 },
      );
    }
    cat = (await db.insert(categories).values({ userId, name: category }).returning())[0];
  }

  const user = (await db.select({ publicKey: users.publicKey }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const keyedValues = user?.publicKey
    ? {
        amountPaise: null,
        amountBidx: amountBidx(userId, direction, amountPaise),
        encPayload: sealForUser(user.publicKey, { amountPaise, notes: notes ?? null }),
        notes: null,
      }
    : { amountPaise, notes: notes ?? null };

  const event = (
    await db
      .insert(shortcutEvents)
      .values({
        userId,
        direction,
        categoryId: cat.id,
        categoryName: cat.name,
        ...keyedValues,
      })
      .returning()
  )[0];

  const candidates = await findCandidates(userId, { amountPaise, direction, at });

  if (candidates.length === 1) {
    await applyEventToTransaction(event, candidates[0].id, "matched");
    return NextResponse.json({
      status: "matched",
      message: `Categorized ${cat.name}: ${candidates[0].merchant ?? "transaction"}.`,
      transactionId: candidates[0].id,
    });
  }
  if (candidates.length > 1) {
    return NextResponse.json({
      status: "pending",
      message: `${candidates.length} possible transactions — resolve in Vyay → Matches.`,
      candidates: candidates.length,
    });
  }
  return NextResponse.json({
    status: "queued",
    message: "No matching transaction yet — will auto-match when the email arrives.",
  });
}
