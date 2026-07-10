import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
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
