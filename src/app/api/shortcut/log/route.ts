import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiTokens, categories, shortcutEvents } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { applyEventToTransaction, findCandidates } from "@/lib/match";

export const dynamic = "force-dynamic";

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
  const tokenRow = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, sha256(token))).get();
  if (!tokenRow) {
    return NextResponse.json({ error: "Invalid token." }, { status: 401 });
  }
  db.update(apiTokens).set({ lastUsedAt: Date.now() }).where(eq(apiTokens.id, tokenRow.id)).run();
  const userId = tokenRow.userId;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { amount, category, notes, direction, timestamp } = parsed.data;
  const amountPaise = Math.round(amount * 100);
  const at = timestamp ? Date.parse(timestamp) : Date.now();

  // Resolve or create the category by name (case-insensitive).
  let cat = db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .all()
    .find((c) => c.name.toLowerCase() === category.toLowerCase());
  if (!cat) {
    cat = db.insert(categories).values({ userId, name: category }).returning().get();
  }

  const event = db
    .insert(shortcutEvents)
    .values({
      userId,
      amountPaise,
      direction,
      categoryId: cat.id,
      categoryName: cat.name,
      notes: notes ?? null,
    })
    .returning()
    .get();

  const candidates = findCandidates(userId, { amountPaise, direction, at });

  if (candidates.length === 1) {
    applyEventToTransaction(event, candidates[0].id, "matched");
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
