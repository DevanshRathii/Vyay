import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getUserId, unauthorized } from "@/lib/session";
import { signState } from "@/lib/crypto";
import { GMAIL_SCOPE, gmailOauthConfigured, oauthClient } from "@/lib/gmail/client";

export const dynamic = "force-dynamic";

/** Start the Gmail OAuth flow (separate consent from login; readonly scope only). */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  if (!gmailOauthConfigured()) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured on the server." },
      { status: 501 },
    );
  }
  const state = signState(`${userId}:${randomUUID()}`);
  const url = oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_SCOPE],
    state,
  });
  return NextResponse.redirect(url);
}
