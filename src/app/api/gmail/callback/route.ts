import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { gmailConnections } from "@/lib/db/schema";
import { getUserId } from "@/lib/session";
import { encrypt, verifyState } from "@/lib/crypto";
import { oauthClient } from "@/lib/gmail/client";
import { SyncInProgressError, syncUser } from "@/lib/gmail/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appUrl = process.env.APP_URL ?? url.origin;
  const fail = (reason: string) =>
    NextResponse.redirect(`${appUrl}/settings?gmail_error=${encodeURIComponent(reason)}`);

  const userId = await getUserId();
  if (!userId) return NextResponse.redirect(`${appUrl}/login`);

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error")!);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("Missing authorization code.");

  const verified = verifyState(state);
  if (!verified || verified.split(":")[0] !== userId) return fail("State verification failed.");

  // Provider selection travels through the OAuth round-trip inside `state`
  // (see connect/route.ts) since Google doesn't preserve arbitrary params.
  const providersSegment = verified.split(":")[2];
  const selectedProviders =
    !providersSegment || providersSegment === "all"
      ? null
      : JSON.stringify(
          Buffer.from(providersSegment, "base64url")
            .toString("utf8")
            .split(",")
            .filter(Boolean),
        );

  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    return fail(
      "Google did not return a refresh token. Remove the app's access in your Google account settings and try again.",
    );
  }

  // Fetch the Gmail address for display.
  client.setCredentials(tokens);
  const { gmail } = await import("@googleapis/gmail");
  const g = gmail({ version: "v1", auth: client });
  const profile = await g.users.getProfile({ userId: "me" });
  const emailAddress = profile.data.emailAddress ?? "unknown";

  const values = {
    userId,
    emailAddress,
    accessToken: encrypt(tokens.access_token),
    refreshToken: encrypt(tokens.refresh_token),
    expiryDate: tokens.expiry_date ?? null,
    historyId: null,
    initialSyncDone: false,
    syncStatus: "idle",
    syncError: null,
    selectedProviders,
  };
  await db
    .insert(gmailConnections)
    .values(values)
    .onConflictDoUpdate({ target: gmailConnections.userId, set: values });

  // Kick off the initial sync without blocking the redirect.
  waitUntil(
    syncUser(userId).catch((err) => {
      if (!(err instanceof SyncInProgressError)) console.error("[vyay] initial sync failed:", err);
    }),
  );

  return NextResponse.redirect(`${appUrl}/settings?gmail_connected=1`);
}
