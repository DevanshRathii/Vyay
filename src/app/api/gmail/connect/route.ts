import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getUserId, unauthorized } from "@/lib/session";
import { signState } from "@/lib/crypto";
import { GMAIL_SCOPE, gmailOauthConfigured, oauthClient } from "@/lib/gmail/client";

export const dynamic = "force-dynamic";

/**
 * Start the Gmail OAuth flow (separate consent from login; readonly scope
 * only). `?providers=id1,id2` narrows the sync query to just those provider
 * ids (see providers.ts); omitted means all providers. The selection can't
 * survive the Google redirect round-trip as its own param, so it's carried
 * inside the signed `state` value and decoded in the callback.
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  if (!gmailOauthConfigured()) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured on the server." },
      { status: 501 },
    );
  }
  // Redundant with Google's own Test users gate on the gmail.readonly scope
  // (the real, unavoidable restriction) — this just gives a friendlier,
  // branded message instead of a raw Google 403 for someone the admin hasn't
  // granted yet, and matches whatever they were already shown in Settings.
  const dbUser = (await db.select({ granted: users.gmailAccessGranted }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!dbUser?.granted) {
    return NextResponse.redirect(new URL("/settings?gmail_error=Ask+the+app+owner+to+grant+Gmail+access+first.", req.url));
  }
  const providersParam = new URL(req.url).searchParams.get("providers");
  const providersSegment = providersParam ? Buffer.from(providersParam).toString("base64url") : "all";
  const state = signState(`${userId}:${randomUUID()}:${providersSegment}`);
  const url = oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_SCOPE],
    state,
  });
  return NextResponse.redirect(url);
}
