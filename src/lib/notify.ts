import nodemailer from "nodemailer";

let transporter: ReturnType<typeof nodemailer.createTransport> | null | undefined;

/** Memoized across warm invocations; null if Gmail SMTP isn't configured. */
function getTransporter() {
  if (transporter !== undefined) return transporter;
  const user = process.env.ADMIN_EMAIL;
  const pass = process.env.ADMIN_GMAIL_APP_PASSWORD;
  transporter = user && pass ? nodemailer.createTransport({ service: "gmail", auth: { user, pass } }) : null;
  return transporter;
}

async function notifyEmail(subject: string, body: string): Promise<void> {
  const t = getTransporter();
  const to = process.env.ADMIN_EMAIL;
  if (!t || !to) return;
  try {
    await t.sendMail({ from: to, to, subject: `Vyay — ${subject}`, text: body });
  } catch (err) {
    console.error("notifyAdmin: email send failed", err);
  }
}

async function notifyWebhook(subject: string, body: string): Promise<void> {
  const url = process.env.ADMIN_NOTIFY_WEBHOOK_URL;
  if (!url) return;
  const message = `${subject}\n${body}`;
  try {
    // Shaped like Slack's `{ text }` payload (also includes `content` for
    // Discord-style webhooks) — the lowest common denominator most incoming
    // webhooks accept. Point this at an intermediary if something else is
    // needed.
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

/**
 * Best-effort push to the app owner via whichever channel(s) are configured:
 * an email sent through Gmail SMTP (ADMIN_EMAIL + ADMIN_GMAIL_APP_PASSWORD,
 * sent from and to the same address) and/or a generic webhook
 * (ADMIN_NOTIFY_WEBHOOK_URL — Slack/Discord/ntfy/etc). Both are optional and
 * independent; neither ever throws — a missing/unreachable channel must not
 * block sign-in or a feedback submission.
 */
export async function notifyAdmin(subject: string, body: string): Promise<void> {
  await Promise.allSettled([notifyEmail(subject, body), notifyWebhook(subject, body)]);
}

/** True when Gmail SMTP is actually configured — the newsletter admin route
 *  uses this to fail fast with a clear error instead of silently no-op'ing
 *  the way the best-effort notifyAdmin() above deliberately does. */
export function isEmailConfigured(): boolean {
  return getTransporter() !== null;
}

/**
 * One outbound email per recipient (never one email with everyone in `to`/
 * `bcc` — a real send, not a bulk blast, and recipients never see each
 * other's addresses). Used by the admin "Send newsletter" feature
 * (src/app/api/admin/newsletter/route.ts). Sent from ADMIN_EMAIL via the
 * same SMTP transporter notifyAdmin() uses. Returns per-recipient results
 * rather than throwing on the first failure, so one bad address doesn't
 * abort the whole batch.
 */
export async function sendBulkEmail(
  recipients: string[],
  subject: string,
  html: string,
  text: string,
): Promise<{ sent: string[]; failed: Array<{ email: string; error: string }> }> {
  const t = getTransporter();
  const from = process.env.ADMIN_EMAIL;
  if (!t || !from) throw new Error("Gmail SMTP isn't configured (ADMIN_EMAIL / ADMIN_GMAIL_APP_PASSWORD).");

  const sent: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];
  for (const email of recipients) {
    try {
      await t.sendMail({ from, to: email, subject, html, text });
      sent.push(email);
    } catch (err) {
      failed.push({ email, error: err instanceof Error ? err.message : "send failed" });
    }
  }
  return { sent, failed };
}
