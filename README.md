# Vyay

**Automatic expense tracking from your Gmail transaction emails — self-hosted, private, built for India.**

Every UPI payment, card swipe, and bank transfer in India generates an email. Vyay connects to your Gmail with read-only access, parses those alerts from 17+ Indian banks and payment apps, and turns your inbox into a clean, categorized, searchable ledger — with analytics, Excel export, and an Apple Shortcut for logging cash context on the go.

Your data never leaves your server. SQLite file, encrypted OAuth tokens, no third-party services.

## Features

- **Automatic ingestion** — parses transaction alerts from HDFC, ICICI, SBI, Axis, Kotak, IndusInd, Yes Bank, IDFC First, PNB, BoB, Canara, Union Bank, Federal Bank, AU, Google Pay, PhonePe, and Paytm. Extracts amount, direction, merchant, UPI VPA, reference number, card last-4, channel (UPI/Card/IMPS/NEFT/RTGS/ATM/…), and timestamp (IST-aware).
- **Noise filtering** — OTPs, statements, bill reminders, future autopay notices, collect requests, failed transactions, and promotional "cashback offer" mail are rejected by a layered classifier. Real cashback credits still get through.
- **Smart categorization** — 17 default categories, ~90 built-in merchant rules, plus your own "merchant contains X → category Y" rules that can retroactively apply to existing transactions.
- **Ledger** — search, filter (category/channel/direction/date), sort, edit, soft-delete/restore. Near-duplicate alerts (same amount within 3 minutes, e.g. bank + UPI app both emailing) are flagged automatically.
- **Analytics** — spend by category, channel, merchant, day, and a 12-month trend.
- **Excel export** — the classic ledger format: Date, Time, Payment Channel, Paid To/Paid By, Amount, Debit/Credit, Category, Notes.
- **Apple Shortcut endpoint** — log `{amount, category, notes}` from your phone in two taps. Vyay pairs the log with the matching bank email: one candidate applies instantly, several go to a Matches screen, none yet waits and auto-resolves when the email lands.
- **Incremental Gmail sync** — history-based delta sync every 15 minutes (configurable), with automatic fallback to query sync when the history window expires. Access tokens are encrypted (AES-256-GCM) at rest.
- **PWA** — installable on your phone's home screen, responsive down to small phones, dark mode.

## Architecture

```
Next.js 15 (App Router, React 19, TypeScript)
├── src/lib/parsing/      classifier + extraction engine + provider registry
├── src/lib/gmail/        OAuth client, MIME fetch, full/incremental sync
├── src/lib/ingest.ts     email → classified → parsed → categorized → stored
├── src/lib/match.ts      Apple Shortcut ↔ transaction pairing
├── src/lib/db/           Drizzle ORM + better-sqlite3 (single-file DB)
├── src/app/api/          REST routes (auth, transactions, analytics, export…)
├── src/app/(app)/        Overview, Ledger, Categories, Matches, Settings
└── src/instrumentation-node.ts   background sync loop
```

Design decisions worth knowing:

- **Amounts are integers (paise)** — no floating point money.
- **Idempotent ingestion** — a unique index on `(userId, gmailMessageId)` makes re-syncing safe.
- **The parsing engine is generic**; providers mostly contribute sender patterns. Adding a bank is a ~10-line entry in `src/lib/parsing/providers.ts`.
- **Auth.js v5 split config** — `auth.config.ts` stays edge-safe for middleware; bcrypt and DB access live in `auth.ts` (Node only).
- **Everything is IST-aware** — daily/monthly buckets use Asia/Kolkata regardless of server timezone.

## Getting started

Requires Node.js 20+.

```bash
git clone <your-fork> vyay && cd vyay
npm install
cp .env.example .env
# fill AUTH_SECRET and ENCRYPTION_KEY:
openssl rand -base64 32   # run twice, paste into .env
npm run dev
```

Open http://localhost:3000, create an account with email + password, and explore. To try it with demo data first:

```bash
npm run db:seed   # creates demo@vyay.app / demo1234 with 90 transactions
```

> **Native module note:** `better-sqlite3` compiles a native binding. If `npm install` fails trying to download Node headers (offline/proxied environments), point node-gyp at your local headers: `npm_config_nodedir=/usr npm install` (wherever `node_api.h` lives, e.g. `/usr/include/node` on Debian/Ubuntu with NodeSource).

## Connecting Gmail

Vyay needs its own Google OAuth credentials (a few minutes, free):

1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a project (e.g. "Vyay").
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen** → External → fill the app name and your email. Add yourself as a **test user** (personal use never needs verification).
4. Add the scope `https://www.googleapis.com/auth/gmail.readonly`. If you also want "Sign in with Google", the default openid/email/profile scopes are included automatically.
5. **Credentials → Create credentials → OAuth client ID → Web application**, and add **both** redirect URIs:
   - `{APP_URL}/api/auth/callback/google` — Google login
   - `{APP_URL}/api/gmail/callback` — Gmail connection
   (for local dev: `http://localhost:3000/api/auth/callback/google` and `http://localhost:3000/api/gmail/callback`)
6. Put the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart.

Then in Vyay: **Settings → Connect Gmail** → approve read-only access. The first sync scans the last `SYNC_LOOKBACK_MONTHS` (default 6) of alert emails; after that, incremental syncs run every `SYNC_INTERVAL_MINUTES` in the background and on demand via **Sync now**.

Vyay requests `gmail.readonly` only — it can never send, modify, or delete mail. Tokens are AES-256-GCM encrypted with your `ENCRYPTION_KEY`.

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
| `matched` | exactly one transaction (same amount + direction, ±72 h) — category and notes applied |
| `pending` | several candidates — pick one on the **Matches** page |
| `queued` | the email hasn't arrived yet — auto-resolves on the next sync |

Optional fields: `direction` (`debit`/`credit`, default debit) and `timestamp` (ISO 8601, for logging past expenses).

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `APP_URL` | yes | `http://localhost:3000` | Public URL, used in OAuth redirects |
| `AUTH_SECRET` | yes | — | Session signing key (`openssl rand -base64 32`) |
| `ENCRYPTION_KEY` | yes | — | 32-byte base64 key for token encryption |
| `DATABASE_PATH` | no | `./data/vyay.db` | SQLite file location |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Gmail | — | OAuth credentials (see above) |
| `SYNC_LOOKBACK_MONTHS` | no | — (since 1-Jan-2026) | Initial sync window as a rolling number of months back; unset uses the fixed 1-Jan-2026 anchor instead |
| `SYNC_INTERVAL_MINUTES` | no | `15` | Background sync cadence (`0` disables) |
| `SYNC_MAX_INITIAL_MESSAGES` | no | `3000` | Initial sync safety cap |
| `EXTRA_GMAIL_QUERY` | no | — | Extra Gmail search terms, e.g. `from:(mybank.com)` |

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

Vyay is a single Node process with a SQLite file — a small VPS, home server, or Raspberry Pi is plenty.

```bash
npm run build
SYNC_INTERVAL_MINUTES=15 npm run start   # behind Caddy/nginx for TLS
```

- Set `APP_URL` to your public HTTPS URL and add both redirect URIs (with that host) in Google Cloud.
- Back up `data/vyay.db` (that's everything).
- Serverless platforms: disable the in-process loop (`SYNC_INTERVAL_MINUTES=0`) and hit `POST /api/gmail/sync` from a cron. Note SQLite needs a persistent disk — a container/VM is a better fit than lambda-style hosting.

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
- **`better-sqlite3` build errors** — see the native module note under Getting started.

## Privacy & security

- Gmail scope is read-only; nothing is ever written to your mailbox.
- OAuth tokens are AES-256-GCM encrypted at rest; API tokens are stored as SHA-256 hashes and shown once.
- Passwords use bcrypt (cost 12). Sessions are JWT-signed HTTP-only cookies.
- Raw email storage is truncated to the first 2,000 characters of body text, kept only for parse debugging.
- Everything lives in one SQLite file you control.

## Roadmap ideas

Budgets and alerts, multi-account households, SMS ingestion (via the Shortcut endpoint), CSV import for backfilling pre-email history, category budgets in analytics, and webhook push (Gmail Pub/Sub) instead of polling.

---

MIT licensed. Built with Next.js, Drizzle, and better-sqlite3. *Vyay* (व्यय) is Hindi for "expense".
