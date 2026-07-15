# Vyay

**Automatic expense tracking from your Gmail transaction emails — private, multi-tenant, built for India.**

Every UPI payment, card swipe, and bank transfer in India generates an email. Vyay connects to your Gmail with read-only access, parses those alerts from 17+ Indian banks and payment apps, and turns your inbox into a clean, categorized, searchable ledger — with analytics, Excel export, and an Apple Shortcut for logging cash context on the go.

Vyay runs as a hosted app (Vercel + Supabase Postgres) with Google-only sign-in — each user's Gmail connection, tokens, and transactions are isolated to their own account (every query is scoped by `userId`). It can also run self-hosted against any Postgres database. Gmail OAuth tokens are AES-256-GCM encrypted at rest either way; no third-party services beyond Google (for auth/Gmail) and your Postgres host.

**[Try the interactive demo](https://vyay-five.vercel.app/demo)** — a guided tour with sample data, no sign-in required.

## Features

- **Automatic ingestion** — parses transaction alerts from HDFC, ICICI, SBI, Axis, Kotak, IndusInd, Yes Bank, IDFC First, PNB, BoB, Canara, Union Bank, Federal Bank, AU, Google Pay, PhonePe, and Paytm. Extracts amount, direction, merchant, UPI VPA, reference number, card last-4, channel (UPI/Card/IMPS/NEFT/RTGS/ATM/…), and timestamp (IST-aware).
- **Noise filtering** — OTPs, statements, bill reminders, future autopay notices, collect requests, failed transactions, and promotional "cashback offer" mail are rejected by a layered classifier. Real cashback credits still get through.
- **Smart categorization** — 17 default categories, ~90 built-in merchant rules, plus your own "merchant contains X → category Y" rules that can retroactively apply to existing transactions.
- **Ledger** — search, filter (category/channel/direction/date), sort, edit, soft-delete/restore. Duplicate alerts are flagged automatically — either a shared bank reference number (any time distance apart) or same amount/direction within 3 minutes (e.g. bank + UPI app both emailing) — and excluded from totals/export while staying visible with a "Not a duplicate" undo.
- **Analytics** — spend by category, channel, merchant, day, and a 12-month trend.
- **Excel export** — the classic ledger format: Date, Time, Payment Channel, Paid To/Paid By, Amount, Debit/Credit, Category, Notes.
- **Apple Shortcut endpoint** — log `{amount, category, notes}` from your phone in two taps. Vyay pairs the log with the matching bank email: one candidate applies instantly, several go to a Matches screen, none yet waits and auto-resolves when the email lands.
- **Incremental Gmail sync** — history-based delta sync every 15 minutes when self-hosted (configurable), or via a daily Vercel Cron job when deployed serverlessly, with automatic fallback to query sync when the history window expires. Access tokens are encrypted (AES-256-GCM) at rest.
- **PWA** — installable on your phone's home screen, responsive down to small phones, dark mode.

## Architecture

```
Next.js 15 (App Router, React 19, TypeScript)
├── src/lib/parsing/      classifier + extraction engine + provider registry
├── src/lib/gmail/        OAuth client, MIME fetch, full/incremental sync
├── src/lib/ingest.ts     email → classified → parsed → categorized → stored
├── src/lib/match.ts      Apple Shortcut ↔ transaction pairing
├── src/lib/db/           Drizzle ORM + postgres.js (Postgres, e.g. Supabase)
├── src/app/api/          REST routes (auth, transactions, analytics, export…)
├── src/app/api/cron/sync/  daily sync sweep (Vercel Cron, CRON_SECRET-protected)
├── src/app/(app)/        Overview, Ledger, Categories, Matches, Settings
└── src/instrumentation-node.ts   self-host-only background sync loop
```

Design decisions worth knowing:

- **Amounts are integers (paise)** — no floating point money. Timestamps are epoch-milliseconds (`bigint`), not native Postgres timestamps — deliberate, for exact IST-aware bucketing without timezone-conversion surprises.
- **Idempotent ingestion** — a unique index on `(userId, gmailMessageId)` makes re-syncing safe.
- **Multi-tenant by construction** — every table is scoped by `userId`; every query filters on it (or on an id already verified as user-owned). One user's Gmail sync can never see or touch another user's data.
- **The parsing engine is generic**; providers mostly contribute sender patterns. Adding a bank is a ~10-line entry in `src/lib/parsing/providers.ts`.
- **Auth.js v5, split config, Google-only** — `auth.config.ts` stays edge-safe for middleware; the Google user-upsert lives in `auth.ts` (Node only). There is no password login.
- **Serverless-safe sync** — the Gmail sync lock and live progress are DB columns on `gmail_connections`, not in-memory state, so they hold correctly across separate Vercel function invocations. A lock older than 10 minutes (crashed invocation) is automatically reclaimed.
- **Everything is IST-aware** — daily/monthly buckets use Asia/Kolkata regardless of server timezone.

## Getting started

Requires Node.js 20.12+ (for `process.loadEnvFile`) and a Postgres database — the free tier of [Supabase](https://supabase.com) works well, or any local/self-hosted Postgres.

```bash
git clone <your-fork> vyay && cd vyay
npm install
cp .env.example .env
# fill AUTH_SECRET and ENCRYPTION_KEY:
openssl rand -base64 32   # run twice, paste into .env
# fill DATABASE_URL (and MIGRATE_DATABASE_URL) with your Postgres connection string(s) —
# see "Environment variables" below for the Supabase pooler/direct-connection distinction
npx tsx migrate.ts   # applies the schema
npm run dev
```

Sign-in is Google-only (see "Connecting Gmail" below for OAuth setup — the same credentials cover login and Gmail access). Open http://localhost:3000 and sign in. To try it with demo data first:

```bash
npm run db:seed   # creates demo@vyay.app with 90 transactions — sign in with Google using that address
```

## Connecting Gmail

Google OAuth credentials are required — they cover both sign-in and Gmail access (a few minutes, free):

1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a project (e.g. "Vyay").
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen** → External → fill the app name and your email. Add every account that should be able to **connect Gmail** as a **test user** (up to 100 while the app is unverified — see Troubleshooting for what that means for token lifetime). This does **not** restrict who can sign in to Vyay itself — see "Access control" below.
4. Add the scope `https://www.googleapis.com/auth/gmail.readonly`. The default openid/email/profile scopes (used for sign-in) are included automatically.
5. **Credentials → Create credentials → OAuth client ID → Web application**, and add **both** redirect URIs:
   - `{APP_URL}/api/auth/callback/google` — Google login
   - `{APP_URL}/api/gmail/callback` — Gmail connection
   (for local dev: `http://localhost:3000/api/auth/callback/google` and `http://localhost:3000/api/gmail/callback`)
6. Put the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart.

Then in Vyay: **Settings → Connect Gmail** → approve read-only access. The first sync scans the last `SYNC_LOOKBACK_MONTHS` (default 6) of alert emails; after that, incremental syncs run every `SYNC_INTERVAL_MINUTES` in the background and on demand via **Sync now**.

Vyay requests `gmail.readonly` only — it can never send, modify, or delete mail. Tokens are AES-256-GCM encrypted with your `ENCRYPTION_KEY`.

## Access control

There are two, independent gates, easy to conflate:

1. **Signing in with Google** — always open to any Google account. Google never restricts non-sensitive scopes (basic profile/email), regardless of this app's verification status. Anyone who signs in gets a Vyay account, but it's inert without Gmail — no bank data, an empty ledger, default categories only.
2. **Connecting Gmail** (the sensitive `gmail.readonly` scope) — restricted twice over:
   - **Google's own gate**: while unverified, only accounts on the OAuth consent screen's **Test users** list (Google Cloud Console → Google Auth Platform → Audience) can complete this flow at all. There's no API for managing this list — it's a manual, per-account step in Cloud Console, every time.
   - **Vyay's own gate**: a signed-in user can't even reach that Google consent screen until an admin grants them `gmailAccessGranted` from **`/admin`** (visible only to `ADMIN_EMAIL`). This exists so a new sign-up doesn't hit a confusing raw Google error — Settings tells them plainly to wait for the app owner instead.

So approving someone end-to-end is two manual steps, both on you: add them as a Google test user (Cloud Console) **and** grant them Gmail access (`/admin`) — either alone isn't enough. `/admin` links directly to the Cloud Console Audience page as a reminder.

Two ways to do both steps in one sitting, before they even sign up:

- **Pre-approve** their email on `/admin` (paired with adding them as a Google test user) — the moment they sign in for the first time, `gmailAccessGranted` is set automatically and the pre-approval is consumed. Nothing left to grant afterwards; it "just works" for them.
- Otherwise, `/admin` lists them after they sign up and you grant access there manually.

Set `ADMIN_EMAIL` + `ADMIN_GMAIL_APP_PASSWORD` to get emailed (via Gmail SMTP, from and to that same address) the moment someone new signs up, instead of finding out secondhand — or `ADMIN_NOTIFY_WEBHOOK_URL` for a Slack/Discord/ntfy-shaped webhook instead (or in addition).

`/admin` also shows two things for keeping parsing healthy across banks: a **parse health** table (per-provider extraction quality — % of transactions that got a merchant, UPI id, reference number, and category; operational counters only, no per-user content) and **donated parse samples** (users can "Report a bad parse" from the Ledger, which sends one raw email's text — reviewed and editable before submitting — for writing a fixture from). This is the acquisition path once zero-access encryption is on: the operator can no longer read a keyed user's stored raw emails, so a bad parser for some bank only gets fixed from what users choose to donate.

## Apple Shortcut

Log expenses (especially cash context: *what* a UPI payment was for) from your phone:

1. **Settings → API tokens → Create**, copy the `vyay_…` token (shown once).
2. In the Shortcuts app: **Ask for Input** (Number) → optionally **Choose from Menu** for category → **Get Contents of URL**:
   - URL: `https://your-host/api/shortcut/log`, Method **POST**
   - Header: `Authorization: Bearer vyay_…`
   - JSON body: `{ "amount": 249.5, "category": "Food", "notes": "lunch" }`
3. Optionally add **Show Result** to see what happened.

The endpoint answers with one of:

| status | meaning |
| --- | --- |
| `matched` | unambiguous match — category and notes applied. Either the sole candidate anywhere in the ±72h window, or (when several same-amount transactions exist) the one within 30 minutes of `timestamp` |
| `pending` | still ambiguous — multiple same-amount candidates within 30 minutes of each other, or several candidates and no `timestamp` to disambiguate with. Pick one on the **Matches** page |
| `queued` | no matching transaction yet — auto-resolves the same way when the email arrives |

Optional fields: `direction` (`debit`/`credit`, default debit) and `timestamp` (ISO 8601). **Pass `timestamp`** (the Shortcuts magic variable `Current Date`) if you might log the same amount more than once in a day — without it, two same-amount purchases can't be told apart and both stay pending for manual resolution.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `APP_URL` | yes | `http://localhost:3000` | Public URL, used in OAuth redirects |
| `AUTH_SECRET` | yes | — | Session signing key (`openssl rand -base64 32`) |
| `ENCRYPTION_KEY` | yes | — | 32-byte base64 key for token encryption |
| `DATABASE_URL` | yes | — | Postgres connection string used by the app at runtime. On Supabase, use the **transaction pooler** (port 6543) |
| `MIGRATE_DATABASE_URL` | yes | — | Postgres connection string used only by `npx tsx migrate.ts`. On Supabase, use the **session pooler** or **direct connection** (port 5432) — never the transaction pooler. On Vercel specifically, the direct connection is IPv6-only and unreachable from build containers, so use the session pooler there |
| `CRON_SECRET` | for Vercel Cron | — | Bearer token Vercel sends to `/api/cron/sync`; set it and Vercel supplies the header automatically |
| `BLIND_INDEX_KEY` | yes | — | 32-byte base64 key (`openssl rand -base64 32`) used to derive blind-index HMACs for zero-access-encrypted accounts — preserves duplicate detection and Apple Shortcut amount matching without ever storing a plaintext amount. Server-only, never sent to the browser |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | — | OAuth credentials (see above) — required for sign-in, not just Gmail |
| `SYNC_LOOKBACK_MONTHS` | no | — (since 1-Jan-2026) | Initial sync window as a rolling number of months back; unset uses the fixed 1-Jan-2026 anchor instead |
| `SYNC_INTERVAL_MINUTES` | no | `15` | Self-host background sync cadence (`0` disables — required on Vercel, which uses Cron instead) |
| `SYNC_MAX_INITIAL_MESSAGES` | no | `3000` | Initial sync safety cap |
| `EXTRA_GMAIL_QUERY` | no | — | Extra Gmail search terms, e.g. `from:(mybank.com)` |
| `ADMIN_EMAIL` | no | — | Who `/admin` is restricted to; skips the "new user" notification for your own first sign-in. Plain sign-in is always open to any Google account — see "Access control" above for what this actually gates |
| `ADMIN_GMAIL_APP_PASSWORD` | no | — | A Gmail App Password for `ADMIN_EMAIL` (generate at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), needs 2-Step Verification on) — sends a real email on a new sign-up or "urgent feedback" submission, via Gmail SMTP, from and to `ADMIN_EMAIL` |
| `ADMIN_NOTIFY_WEBHOOK_URL` | no | — | POSTed a Slack/Discord-shaped JSON body (`{ text, content }`) on the same two events — point it at an incoming webhook, ntfy.sh topic, etc. Independent of the email above; set either, both, or neither |
| `NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT` | no | — | Your Google Cloud project id/number — makes `/admin`'s "Add to Google Test users" link go straight to your project instead of the generic console entry point |
| `NEXT_PUBLIC_VYAY_SHORTCUT_URL` | no | — | iCloud share link for the "Vyay: Log Transaction" action shortcut (see Settings' SMS & Apple Wallet card) — shows an "Add to Shortcuts" button when set |

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # production server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest (parser fixtures, classifier, matching)
npm run db:generate  # regenerate Drizzle migrations after schema changes
npm run db:seed      # demo account with sample data
```

## Deployment

### Vercel + Supabase (recommended)

1. Create a Supabase project, then set `DATABASE_URL` (transaction pooler) and `MIGRATE_DATABASE_URL` (session pooler — see the env var table above for why) as Vercel **Production** environment variables: `vercel env add DATABASE_URL production` (paste the connection string when prompted, or pipe it in so it never lands in shell history).
2. Set the rest of the production env vars the same way: `AUTH_SECRET`, `ENCRYPTION_KEY`, `BLIND_INDEX_KEY`, `CRON_SECRET` (generate fresh values for production — don't reuse local dev secrets — e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | vercel env add ENCRYPTION_KEY production`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` (your Vercel production URL), `SYNC_INTERVAL_MINUTES=0`.
3. `package.json`'s `build` script runs `tsx migrate.ts && next build`, so every deploy applies pending migrations before building — no separate migrate step.
4. `vercel deploy --prod`. `vercel.json` schedules a daily Vercel Cron hitting `/api/cron/sync` (`CRON_SECRET`-protected), which syncs every connected account oldest-first, stopping cleanly under the 300s function budget — any leftovers pick up on the next day's run or a manual "Sync now".
5. In Google Cloud Console, add the production redirect URIs (`{APP_URL}/api/auth/callback/google` and `{APP_URL}/api/gmail/callback`) and add test users on the OAuth consent screen (up to 100 while unverified — see Troubleshooting).

### Self-hosted (VPS, home server, Raspberry Pi)

```bash
npm run build          # runs migrations, then builds
SYNC_INTERVAL_MINUTES=15 npm run start   # behind Caddy/nginx for TLS
```

- Set `APP_URL` to your public HTTPS URL and add both redirect URIs (with that host) in Google Cloud.
- Any reachable Postgres works — a small VPS-local instance, a managed service, or Supabase.
- The in-process sync loop (`SYNC_INTERVAL_MINUTES`) replaces the Vercel Cron in this mode; it's automatically disabled when `process.env.VERCEL` is set, so the two never double-run against the same deployment.

## Adding a bank or payment app

Open `src/lib/parsing/providers.ts` and append an entry:

```ts
{
  id: "mybank",
  name: "My Bank",
  bank: "My Bank",
  senders: [/mybank\.co\.in/i],
  queryDomains: ["mybank.co.in"],
}
```

`queryDomains` feeds the Gmail search; `senders` tags matching messages. The generic engine handles extraction. Add a fixture in `tests/parsers.test.ts` with a real (redacted) email body to lock the behavior in.

## Troubleshooting

- **"Google did not return a refresh token"** — you had previously granted access. Remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and reconnect (Vyay always requests `prompt=consent`, so this is rare).
- **Sync says error 403/429** — Gmail API quota; the sync retries with backoff automatically. If it persists, verify the Gmail API is enabled in your Cloud project.
- **Transactions missing** — check the email is from a supported sender domain (`providers.ts`), isn't classified as noise (forward one to yourself and inspect with a unit test), and falls inside `SYNC_LOOKBACK_MONTHS`. Use **Full resync** in Settings after changing lookback.
- **A parse is wrong** — every transaction stores the raw subject/body snippet (open a transaction in the Ledger to see the details and parse confidence). Fixtures + a fix in `src/lib/parsing/engine.ts` are welcome.
- **A test user's Gmail connection stops working after ~7 days** — while the Google Cloud project's OAuth consent screen is in **Testing** mode (the default, and fine up to 100 users), Google expires refresh tokens for external test apps after 7 days of inactivity from Google's own review process, independent of anything Vyay does. Reconnecting Gmail in Settings fixes it. To avoid this entirely, either move the consent screen to **In production** (no formal verification needed at this user count for a `gmail.readonly`-only app, though Google may still show an "unverified app" warning to users) or accept the periodic reconnect.
- **Vercel build fails with `ENETUNREACH` on the migration step** — `MIGRATE_DATABASE_URL` is pointed at Supabase's direct connection host, which is IPv6-only; Vercel's build containers have no outbound IPv6. Switch to the session pooler connection string (see the env var table above).

## Zero-access encryption

Vyay can seal your transaction data with a key only you hold, so that a database leak — or the operator browsing the database directly — cannot expose your financial data. This is honestly called **zero-access encryption**, not "end-to-end": the server legitimately sees plaintext transiently while parsing your Gmail (sync runs unattended via cron), then seals it and goes blind.

**How it works:** each account holds an X25519 keypair. The **public key** is stored server-side; ingest uses it to *encrypt* (seal) transaction data as soon as it's parsed. The **private key** — your "personal key" — is generated in your browser, shown to you once, and stored only in that browser's `localStorage`. It is never sent to or stored by the server. Reads decrypt entirely client-side: search, sorting, the dashboard, and export all run in your browser over the decrypted rows.

**Setup:** the first time you sign in after this feature ships, you'll see a one-time setup screen. Save the personal key it shows you (copy it, download the `.txt` file, or let your password manager offer to store it) — Vyay cannot recover it if lost. Existing data is sealed in the background (a one-time backfill); new mail is sealed as it's ingested from then on.

**Lost key:** self-serve reset from Settings → "Your encryption key". This generates a new keypair, wipes the ciphertext under the lost key (unrecoverable anyway), and triggers a full Gmail resync to rebuild the ledger. Manual notes, category edits, and Apple Shortcut history don't survive a reset — only what re-imports from Gmail does, since Gmail remains the source of truth.

**What's protected:** database dumps or leaks, Supabase dashboard/table-editor browsing, direct DBA access, stolen backups, and the PostgREST/Data-API surface (migration 0008 also enables Postgres RLS and revokes `anon`/`authenticated` grants on every table, closing Supabase's auto-generated REST API).

**What's NOT protected** (never claimed otherwise): a compromised or malicious server at the moment of ingest — plaintext exists transiently in server memory while an email is being parsed — and Gmail itself, which always sees the original email.

**Metadata that stays visible** even for a keyed account (documented, not a bug): timestamps, debit/credit direction, category assignment and category names, transaction counts, the Gmail message id, sync state, saved contact names, and your account email/name. Sealed fields: amount, merchant name, notes, UPI id, reference number, email subject, bank, card last-4, channel, and the original raw email body.

**Scope (v1):** transactions and Apple Shortcut events. Contacts, categories, and feedback messages stay plaintext — a v2 candidate. Duplicate-alert detection and Shortcut amount matching keep working on encrypted rows via a server-side blind index (`BLIND_INDEX_KEY` — an HMAC of the amount, never the amount itself) instead of a plaintext equality check.

## Privacy & security

- Gmail scope is read-only; nothing is ever written to your mailbox.
- OAuth tokens are AES-256-GCM encrypted at rest, decrypted only in memory at the moment of a Gmail API call; API tokens are stored as SHA-256 hashes and shown once.
- Sign-in is Google-only. Sessions are JWT-signed HTTP-only cookies.
- Every table is scoped by `userId` — one user's Gmail sync, transactions, categories, contacts, and API tokens are never visible to another user, whether self-hosted or on the hosted multi-tenant deployment.
- Raw email storage is truncated to the first 2,000 characters of body text, kept only for parse debugging — sealed along with the rest of the sensitive fields for a keyed account (see "Zero-access encryption" above).
- Optionally, seal your transaction data with zero-access encryption (above) so even a database leak or direct DB access can't expose it.
- Your data lives in whichever Postgres database you point Vyay at — a database you control, whether that's Supabase, another managed host, or your own server.

## Roadmap ideas

Budgets and alerts, multi-account households, SMS ingestion (via the Shortcut endpoint), CSV import for backfilling pre-email history, category budgets in analytics, and webhook push (Gmail Pub/Sub) instead of polling.

---

MIT licensed. Built with Next.js, Drizzle, and Postgres. *Vyay* (व्यय) is Hindi for "expense".
