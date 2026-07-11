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
