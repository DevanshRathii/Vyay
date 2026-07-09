import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gmailConnections } from "@/lib/db/schema";
import { getUserId, unauthorized } from "@/lib/session";
import { gmailOauthConfigured } from "@/lib/gmail/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const conn = (
    await db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId)).limit(1)
  )[0];
  const hasProgress = conn?.syncStatus === "syncing" && conn.syncProgressPhase != null;
  return NextResponse.json({
    oauthConfigured: gmailOauthConfigured(),
    connected: Boolean(conn),
    emailAddress: conn?.emailAddress ?? null,
    syncStatus: conn?.syncStatus ?? null,
    syncError: conn?.syncError ?? null,
    lastSyncAt: conn?.lastSyncAt ?? null,
    initialSyncDone: Boolean(conn?.initialSyncDone),
    totalSynced: conn?.totalSynced ?? 0,
    syncProgress: hasProgress
      ? {
          phase: conn!.syncProgressPhase as "listing" | "ingesting",
          processed: conn!.syncProgressDone ?? 0,
          total: conn!.syncProgressTotal ?? 0,
        }
      : null,
  });
}
