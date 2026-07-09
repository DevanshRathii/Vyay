import { NextResponse } from "next/server";
import { connectionsOldestFirst, SyncInProgressError, syncUser } from "@/lib/gmail/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Leave headroom under the 300s function budget for the in-flight sync to
// finish cleanly; any connections left over are picked up by tomorrow's run
// (or a manual "Sync now" in the meantime).
const CUTOFF_MS = 250_000;

/**
 * Daily cron sweep (see vercel.json). Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` automatically when the env var is
 * set — this route rejects anything else.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const conns = await connectionsOldestFirst();

  let synced = 0;
  let alreadySyncing = 0;
  let failed = 0;
  let cutoff = false;

  for (const conn of conns) {
    if (Date.now() - start > CUTOFF_MS) {
      cutoff = true;
      break;
    }
    try {
      await syncUser(conn.userId);
      synced++;
    } catch (err) {
      if (err instanceof SyncInProgressError) {
        alreadySyncing++;
      } else {
        failed++;
        console.error(`[vyay] cron sync failed for user ${conn.userId}:`, err);
      }
    }
  }

  const remaining = conns.length - synced - alreadySyncing - failed;
  return NextResponse.json({
    total: conns.length,
    synced,
    alreadySyncing,
    failed,
    remaining,
    cutoff,
    elapsedMs: Date.now() - start,
  });
}
