/**
 * Best-effort push to whatever the app owner has wired up — a Slack incoming
 * webhook, a Discord webhook, ntfy.sh, Zapier/Make, etc. Sends a body shaped
 * like Slack's `{ text }` payload (also includes `content` for Discord-style
 * webhooks) since that's the lowest common denominator most of these accept;
 * point ADMIN_NOTIFY_WEBHOOK_URL at an intermediary if something else is
 * needed. Never throws — a missing/unreachable webhook must not block sign-in
 * or a feedback submission.
 */
export async function notifyAdmin(message: string): Promise<void> {
  const url = process.env.ADMIN_NOTIFY_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, content: message }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("notifyAdmin: webhook call failed", err);
  }
}
