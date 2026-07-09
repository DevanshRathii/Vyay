import { NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/session";
import { reparseUserTransactions } from "@/lib/reparse";

export const dynamic = "force-dynamic";

/** Re-run the parser against already-imported transactions using their stored raw email. */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const summary = await reparseUserTransactions(userId);
  return NextResponse.json(summary);
}
