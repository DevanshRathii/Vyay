import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { backfillRemaining } from "@/lib/e2e-setup";
import { getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const user = (
    await db
      .select({ publicKey: users.publicKey, keyCheck: users.keyCheck })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];

  if (!user?.publicKey) {
    return NextResponse.json({ hasKey: false, publicKey: null, keyCheck: null, backfillRemaining: 0 });
  }

  return NextResponse.json({
    hasKey: true,
    publicKey: user.publicKey,
    // Safe to expose — this is ciphertext the server sealed with the public
    // key, not the private key itself. The locked screen needs it to verify
    // a pasted/loaded personal key before trusting it.
    keyCheck: user.keyCheck,
    backfillRemaining: await backfillRemaining(userId),
  });
}
