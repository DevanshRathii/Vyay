import { NextResponse } from "next/server";
import { getUserId, getUserPublicKey, unauthorized } from "@/lib/session";
import { reparseUserTransactions } from "@/lib/reparse";

export const dynamic = "force-dynamic";

/** Re-run the parser against already-imported transactions using their stored raw email. */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  if (await getUserPublicKey(userId)) {
    return NextResponse.json(
      { error: "Re-parse is retired for zero-access-encrypted accounts — use Full resync instead." },
      { status: 410 },
    );
  }

  const summary = await reparseUserTransactions(userId);
  return NextResponse.json(summary);
}
