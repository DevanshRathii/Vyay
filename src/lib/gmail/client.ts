import { auth, gmail, type gmail_v1 } from "@googleapis/gmail";

type OAuth2Client = InstanceType<typeof auth.OAuth2>;
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gmailConnections, type GmailConnection } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function gmailOauthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function oauthClient(): OAuth2Client {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return new auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${appUrl}/api/gmail/callback`,
  );
}

/**
 * Build an authenticated Gmail client for a stored connection. Refreshed
 * access tokens are re-encrypted and persisted automatically.
 */
export function gmailFor(conn: GmailConnection): gmail_v1.Gmail {
  const client = oauthClient();
  client.setCredentials({
    access_token: decrypt(conn.accessToken),
    refresh_token: decrypt(conn.refreshToken),
    expiry_date: conn.expiryDate ?? undefined,
  });
  client.on("tokens", (tokens) => {
    const update: Partial<typeof gmailConnections.$inferInsert> = {};
    if (tokens.access_token) update.accessToken = encrypt(tokens.access_token);
    if (tokens.refresh_token) update.refreshToken = encrypt(tokens.refresh_token);
    if (tokens.expiry_date) update.expiryDate = tokens.expiry_date;
    if (Object.keys(update).length > 0) {
      // Event handler can't await — fire and forget, but never swallow silently.
      db.update(gmailConnections)
        .set(update)
        .where(eq(gmailConnections.id, conn.id))
        .catch((err: unknown) => console.error("[vyay] failed to persist refreshed Gmail tokens:", err));
    }
  });
  return gmail({ version: "v1", auth: client });
}
