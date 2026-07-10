import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="10 July 2026">
      <p>
        These terms cover your use of Vyay, an automatic expense tracker that builds a ledger from transaction
        alert emails in your Gmail inbox. By signing in and connecting Gmail, you agree to them.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">The service</h2>
      <p>
        Vyay reads transaction-alert emails from your connected Gmail account, extracts structured transaction
        data from them, and presents it to you as a ledger with categorization, analytics, and export. It is a
        personal finance tool, not a bank, payment processor, or financial advisor — nothing in the app constitutes
        financial advice.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">Accuracy</h2>
      <p>
        Transaction extraction is done by pattern-matching against email content and is best-effort. Amounts,
        merchants, categories, and dates may occasionally be parsed incorrectly — always verify important figures
        against your bank&apos;s own statements before relying on them. Vyay is provided &ldquo;as is&rdquo;, without
        warranty of any kind, to the extent permitted by law.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">Your account</h2>
      <p>
        Sign-in is Google-only. You&apos;re responsible for keeping access to your Google account secure — anyone
        who can sign in to your Google account can sign in to Vyay under your identity. Don&apos;t share your API
        tokens (used for the Apple Shortcut integration); anyone with a token can log expenses to your account
        until you revoke it from Settings.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">Acceptable use</h2>
      <p>
        Don&apos;t attempt to access another user&apos;s data, abuse the API endpoints beyond normal personal use,
        or use the service for any unlawful purpose.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">Termination</h2>
      <p>
        You can disconnect Gmail and stop using Vyay at any time. See the{" "}
        <a href="/privacy" className="text-accent underline underline-offset-2">
          Privacy Policy
        </a>{" "}
        for how to request full data deletion.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">Changes to these terms</h2>
      <p>
        If these terms change materially, the &ldquo;Last updated&rdquo; date above will change accordingly.
      </p>
    </LegalPage>
  );
}
