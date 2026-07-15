/**
 * Feature-announcement newsletter — HTML (+ plain-text fallback) for
 * emailing test users when a major feature ships. Pure/testable, no `db`
 * import: sent from src/app/api/admin/newsletter/route.ts via the existing
 * ADMIN_GMAIL_APP_PASSWORD SMTP transporter (src/lib/notify.ts).
 *
 * Email clients don't support external stylesheets, CSS variables, or most
 * modern layout CSS — this is deliberately table-based with everything
 * inlined, not a re-use of the app's own Tailwind/CSS-variable system.
 */
export interface NewsletterInput {
  /** e.g. "New: import bank statements" — becomes both the subject and the hero heading. */
  title: string;
  /** Plain paragraphs, no markdown — one string per paragraph. Kept short by design (this is a nudge to go try it, not a changelog). */
  paragraphs: string[];
  /** e.g. "Try it now" */
  ctaLabel: string;
  ctaUrl: string;
  /** Shown small, under the CTA — e.g. "Reply to this email to tell us what broke." */
  footerNote?: string;
  recipientName?: string;
}

const COLORS = {
  canvas: "#f4f5f8",
  card: "#ffffff",
  fg: "#1d1d1f",
  muted: "#6e6e73",
  accent: "#0052cc",
  line: "#e5e5ea",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildNewsletterHtml(input: NewsletterInput): string {
  const greeting = input.recipientName ? `Hi ${escapeHtml(input.recipientName)},` : "Hi,";
  const paragraphsHtml = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.fg};">${escapeHtml(p)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${COLORS.canvas};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.canvas};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-bottom:20px;">
                <span style="font-size:15px;font-weight:600;color:${COLORS.fg};letter-spacing:-0.01em;">Vyay</span>
              </td>
            </tr>
            <tr>
              <td style="background:${COLORS.card};border:1px solid ${COLORS.line};border-radius:20px;padding:32px;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:${COLORS.accent};text-transform:uppercase;letter-spacing:0.04em;">New in Vyay</p>
                <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:${COLORS.fg};font-weight:700;letter-spacing:-0.02em;">
                  ${escapeHtml(input.title)}
                </h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.fg};">${greeting}</p>
                ${paragraphsHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
                  <tr>
                    <td style="border-radius:999px;background:${COLORS.accent};">
                      <a href="${input.ctaUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">
                        ${escapeHtml(input.ctaLabel)}
                      </a>
                    </td>
                  </tr>
                </table>
                ${
                  input.footerNote
                    ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:${COLORS.muted};">${escapeHtml(input.footerNote)}</p>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding-top:20px;text-align:center;">
                <p style="margin:0;font-size:12px;color:${COLORS.muted};">
                  You're getting this because you're testing Vyay. Reply anytime with feedback.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildNewsletterText(input: NewsletterInput): string {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hi,";
  const lines = [
    input.title,
    "",
    greeting,
    "",
    ...input.paragraphs,
    "",
    `${input.ctaLabel}: ${input.ctaUrl}`,
  ];
  if (input.footerNote) lines.push("", input.footerNote);
  lines.push("", "You're getting this because you're testing Vyay. Reply anytime with feedback.");
  return lines.join("\n");
}
