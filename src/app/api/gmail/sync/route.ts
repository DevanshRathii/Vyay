import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gmailConnections } from "@/lib/db/schema";
import { getUserId, unauthorized } from "@/lib/session";
import { syncUser } from "@/lib/gmail/sync";

export const dynamic = "force-dynamic";

/** Manual "Sync now". Starts a sync and returns immediately; the UI polls status. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const conn = db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId)).get();
  if (!conn) return NextResponse.json({ error: "Gmail is not connected." }, { status: 400 });

  const full = new URL(req.url).searchParams.get("full") === "1";
  syncUser(userId, { full }).catch((err) => console.error("[vyay] manual sync failed:", err));
  return NextResponse.json({ started: true });
}
