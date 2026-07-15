import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sha256 } from "@/lib/crypto";
import { loadCategorizerContext } from "@/lib/categorize";
import { loadContactContext } from "@/lib/contacts/match";
import { ingestParsedTransaction } from "@/lib/ingest";
import { badRequest, getUserId, unauthorized } from "@/lib/session";
import { TRACKING_BASELINE_MS } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Large enough for a full year's statement in one request; the client chunks
// bigger files across multiple requests rather than this endpoint accepting
// an unbounded batch.
const MAX_ROWS_PER_REQUEST = 2000;

const rowSchema = z.object({
  occurredAt: z.number().int().min(TRACKING_BASELINE_MS),
  amountPaise: z.number().int().positive(),
  direction: z.enum(["debit", "credit"]),
  merchant: z.string().max(200).optional(),
  merchantSource: z.enum(["narration", "vpa-name", "info-freetext", "pattern", "upi-id"]).optional(),
  merchantConfidence: z.number().min(0).max(1).optional(),
  upiId: z.string().max(100).optional(),
  channel: z.string().max(20).optional(),
  referenceNumber: z.string().max(60).optional(),
  narration: z.string().max(500),
  /** Original row cells, sealed as `raw` for keyed users like email raw is. */
  cells: z.array(z.string()).max(30),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(MAX_ROWS_PER_REQUEST),
});

/**
 * Bank statement import — session-authenticated (page context, not an API
 * token), unlike the SMS/Wallet/Shortcut endpoints. Rows are parsed and
 * dedup-checked entirely client-side (src/lib/statement/) by the time they
 * reach here; the tracking-baseline floor is still enforced authoritatively
 * (zod min() above) since a client check is only ever UX, never the source
 * of truth. Every row goes through the same ingestParsedTransaction +
 * cross-source-dedup pipeline as every other source — a genuine duplicate
 * still gets flagged (not silently skipped), consistent with how Gmail/SMS/
 * Wallet duplicates are handled, so nothing importing here ever disappears
 * without a trace.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const user = (await db.select({ publicKey: users.publicKey }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const publicKey = user?.publicKey ?? null;
  const ctx = await loadCategorizerContext(userId);
  const contactCtx = await loadContactContext(userId);

  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const row of parsed.data.rows) {
    const externalId = `stmt:${sha256(`${row.occurredAt}|${row.amountPaise}|${row.direction}|${row.narration.toLowerCase()}`)}`;
    const outcome = await ingestParsedTransaction(
      userId,
      {
        occurredAt: row.occurredAt,
        occurredAtPrecise: false, // statements are date-precision only
        amountPaise: row.amountPaise,
        currency: "INR",
        direction: row.direction,
        merchant: row.merchant,
        merchantSource: row.merchantSource,
        merchantConfidence: row.merchantConfidence ?? 0,
        upiId: row.upiId,
        channel: row.channel,
        referenceNumber: row.referenceNumber,
        confidence: 0.6,
      },
      { source: "statement", externalId, raw: JSON.stringify(row.cells), publicKey, ctx, contactCtx },
    );
    if (outcome.status === "inserted") {
      inserted++;
      if (outcome.transaction.duplicateOfId) duplicates++;
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ inserted, duplicates, skipped });
}
