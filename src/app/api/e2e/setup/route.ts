import { and, eq, isNull } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { backfillUser } from "@/lib/e2e-setup";
import { badRequest, getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  publicKey: z.string().min(1),
  keyCheck: z.string().min(1),
});

/**
 * Onboard a user onto zero-access encryption, or resume a previously
 * interrupted backfill. Re-POSTing the SAME publicKey is treated as a
 * resume (harmless — the backfill only ever touches rows still missing
 * encPayload); a DIFFERENT publicKey on an already-keyed account is
 * rejected — that's what /api/e2e/reset is for.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);
  const { publicKey, keyCheck } = parsed.data;

  // sealForUser's own output can't be verified without the private key, but
  // a key_check that this same publicKey can't decrypt would be nonsensical
  // — cheap sanity check the client didn't mismatch a keypair.
  if (!keyCheck.startsWith("v1.")) return badRequest("Malformed key check.");

  const existing = (
    await db.select({ publicKey: users.publicKey }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];

  if (existing?.publicKey && existing.publicKey !== publicKey) {
    return NextResponse.json(
      { error: "This account already has a different encryption key set. Use key reset instead." },
      { status: 409 },
    );
  }

  if (!existing?.publicKey) {
    await db
      .update(users)
      .set({ publicKey, keyCheck, keyCreatedAt: Date.now() })
      .where(and(eq(users.id, userId), isNull(users.publicKey)));
  }

  waitUntil(
    backfillUser(userId, publicKey).catch((err) => {
      console.error(`[vyay] e2e backfill failed for user ${userId}:`, err);
    }),
  );

  return NextResponse.json({ ok: true });
}
