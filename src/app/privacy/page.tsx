import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="10 July 2026">
      <p>
        Vyay (&ldquo;the app&rdquo;, &ldquo;we&rdquo;) turns the transaction-alert emails already sitting in your
        Gmail inbox into a categorized expense ledger. This page explains what Vyay accesses, what it stores, and
        how you can remove it.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">What Vyay accesses in your Gmail</h2>
      <p>
        Vyay requests Google&apos;s <code className="font-mono text-[13px]">gmail.readonly</code> scope only. This
        is a read-only permission: Vyay can never send, delete, modify, or forward any email, and it can never touch
        anything outside Gmail (calendar, contacts, drive, etc. are never requested). Within your inbox, Vyay only
        fetches messages that come from a recognized bank/payment-app sender or that look like a transaction alert —
        it does not scan or store your general correspondence.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">What Vyay stores</h2>
      <p>For each transaction-alert email that passes Vyay&apos;s classifier, Vyay stores:</p>
      <ul className="list-disc pl-5">
        <li>The extracted transaction fields — amount, direction, merchant, category, channel, bank, UPI id, card last-4, reference number, and timestamp.</li>
        <li>
          A truncated copy of the original email (subject, snippet, and up to the first 2,000 characters of the
          body) kept only so a transaction can be re-parsed if Vyay&apos;s extraction logic is later improved. This
          is never shown outside the app and is not used for anything beyond re-parsing.
        </li>
      </ul>
      <p>
        Your Gmail OAuth access and refresh tokens are encrypted at rest with AES-256-GCM before they are stored,
        and are only decrypted in memory for the moment Vyay calls the Gmail API on your behalf.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">Multi-tenant isolation</h2>
      <p>
        Every table in Vyay&apos;s database is scoped by your account id, and every query filters on it. One
        user&apos;s Gmail connection, tokens, and transactions are never visible to another user.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">Third parties</h2>
      <p>
        Vyay uses Google (for sign-in and Gmail access) and a Postgres database host (Supabase, in the hosted
        deployment) to operate. Your data is not sold, shared with advertisers, or sent to any other third party.
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">Deleting your data</h2>
      <p>
        Disconnecting Gmail from Settings immediately deletes your stored OAuth tokens — Vyay loses all further
        access to your inbox at that moment. Already-imported transactions are kept (soft-deletable individually
        from the Ledger) so disconnecting doesn&apos;t lose your existing ledger. To request full account and data
        erasure, open an issue on{" "}
        <a
          href="https://github.com/DevanshRathii/Vyay/issues"
          className="text-accent underline underline-offset-2"
          target="_blank"
          rel="noreferrer"
        >
          the project&apos;s GitHub repository
        </a>
        .
      </p>

      <h2 className="mt-2 text-[15px] font-semibold">Changes to this policy</h2>
      <p>
        If this policy changes materially, the &ldquo;Last updated&rdquo; date above will change accordingly.
      </p>
    </LegalPage>
  );
}
