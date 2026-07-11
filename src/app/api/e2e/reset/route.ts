import { eq } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { gmailConnections, shortcutEvents, transactions, users } from "@/lib/db/schema";
import { SyncInProgressError, syncUser } from "@/lib/gmail/sync";
import { badRequest, getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  publicKey: z.string().min(1),
  keyCheck: z.string().min(1),
});

/**
 * Lost-key recovery: generate a fresh keypair client-side, then call this to
 * wipe the ciphertext a lost key can never open and rebuild from Gmail (the
 * source of truth). Notes/edits/shortcut history don't survive — the
 * confirm-dialog copy must say so plainly before this is ever called.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);
  const { publicKey, keyCheck } = parsed.data;
  if (!keyCheck.startsWith("v1.")) return badRequest("Malformed key check.");

  const existing = (
    await db.select({ publicKey: users.publicKey }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (!existing?.publicKey) return badRequest("No existing key to reset — use setup instead.");

  // Ciphertext under the lost key is unreadable garbage forever — deleting
  // it is the honest move, not a data-loss bug.
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(shortcutEvents).where(eq(shortcutEvents.userId, userId));
  await db.update(users).set({ publicKey, keyCheck, keyCreatedAt: Date.now() }).where(eq(users.id, userId));
  await db
    .update(gmailConnections)
    .set({ historyId: null, initialSyncDone: false })
    .where(eq(gmailConnections.userId, userId));

  waitUntil(
    syncUser(userId, { full: true }).catch((err) => {
      if (!(err instanceof SyncInProgressError)) console.error(`[vyay] post-reset resync failed for user ${userId}:`, err);
    }),
  );

  return NextResponse.json({ ok: true });
}
