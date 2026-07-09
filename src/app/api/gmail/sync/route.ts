import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { gmailConnections } from "@/lib/db/schema";
import { getUserId, unauthorized } from "@/lib/session";
import { SyncInProgressError, syncUser } from "@/lib/gmail/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Manual "Sync now". Starts a sync and returns immediately; the UI polls status. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const conn = (
    await db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId)).limit(1)
  )[0];
  if (!conn) return NextResponse.json({ error: "Gmail is not connected." }, { status: 400 });

  const full = new URL(req.url).searchParams.get("full") === "1";
  waitUntil(
    syncUser(userId, { full }).catch((err) => {
      // Already-syncing is expected on a double-click; the UI is already polling status.
      if (!(err instanceof SyncInProgressError)) console.error("[vyay] manual sync failed:", err);
    }),
  );
  return NextResponse.json({ started: true });
}
