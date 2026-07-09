# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Vyay — a self-hosted Next.js app that turns Gmail transaction-alert emails (17+ Indian banks/payment apps) into a categorized expense ledger. Single Node process, single SQLite file, no third-party services. Full product context, env vars, and OAuth setup are in `README.md` — read it for anything not covered here.

## Commands

```bash
npm run dev          # development server
npm run build         # production build
npm run start         # production server
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run test          # vitest run (all tests, once)
npm run test:watch    # vitest watch mode
npm run format         # prettier --write .
npm run db:generate    # regenerate Drizzle migrations after schema.ts changes
npm run db:seed        # demo@vyay.app / demo1234 with 90 sample transactions
```

Run a single test file: `npx vitest run tests/parsers.test.ts`. Run one test by name: `npx vitest run -t "HDFC UPI debit"`. Tests live in `tests/*.test.ts` (vitest.config.ts), aliasing `@/` to `src/`.

`better-sqlite3` compiles a native binding; if `npm install` fails offline, see the native module note in README.md.

Migrations are applied automatically at DB init (`src/lib/db/index.ts` calls `migrate()` on startup) — there is normally no separate migrate step to run in dev, but `db:generate` must be run after any `src/lib/db/schema.ts` change to produce the migration file under `drizzle/`.

## Architecture

```
src/lib/parsing/      classifier (detect.ts) + extraction engine (engine.ts) + provider registry (providers.ts)
src/lib/gmail/        OAuth client, MIME fetch, full/incremental sync
src/lib/ingest.ts     email → classified → parsed → categorized → stored (one function, idempotent)
src/lib/match.ts      Apple Shortcut ↔ transaction pairing
src/lib/db/           Drizzle ORM schema + better-sqlite3 connection (schema.ts, index.ts)
src/app/api/          REST routes (auth, transactions, analytics, export, gmail, rules, matches, shortcut…)
src/app/(app)/        Overview, Ledger, Categories, Matches, Settings pages
src/instrumentation-node.ts   background sync loop (setInterval, guarded against HMR double-registration)
```

### Email → transaction pipeline

`ingestEmail()` in `src/lib/ingest.ts` is the single entry point for turning one Gmail message into a stored transaction, run per-message during sync:

1. `classifyEmail()` (`src/lib/parsing/detect.ts`) — a layered regex classifier that rejects OTPs, statements, due-date reminders, future/scheduled debits, collect requests, failed transactions, and promotional mail, while still requiring an amount + a strong "money moved" phrase to accept. Promotional wording is a soft negative overridden by an explicit debit/credit phrase (real cashback credits still get through).
2. `parseEmail()` (`src/lib/parsing/engine.ts`) — generic field extraction (amount, direction, merchant, channel, bank, UPI id, card last-4, reference number, IST-aware occurred-at). Providers (`providers.ts`) mostly just contribute `senders` regexes for tagging + `queryDomains` for the Gmail search query; the engine does the actual extraction, so adding a bank is normally a ~10-line provider entry, not new parsing logic.
3. `normalizeMerchant()` + `categorize()` (`src/lib/categorize.ts`) — user-defined `merchantRules` take precedence over ~90 built-in substring rules (`BUILTIN_RULES`); both match against merchant/UPI id/subject lowercased.
4. Insert with `onConflictDoNothing()` against the unique `(userId, gmailMessageId)` index — re-ingesting the same message is a safe no-op, which is what makes repeated/incremental syncs safe to retry.
5. `flagPotentialDuplicate()` — marks likely duplicate alerts (same user/amount/direction within a 3-minute window, e.g. bank + UPI app both emailing) by setting `duplicateOfId`, without deleting either row.
6. `tryResolvePendingShortcuts()` (`src/lib/match.ts`) — resolves any pending Apple Shortcut expense log waiting for this amount/direction within `MATCH_WINDOW_HOURS` (72h).

When adding a bank/payment app, add a fixture to `tests/parsers.test.ts` with a real (redacted) email body — that's how parsing regressions are caught.

### Auth (Auth.js v5, split config)

- `src/auth.config.ts` — edge-safe: no DB imports, no bcrypt. Used by `src/middleware.ts` directly for route protection (checks `req.auth`, redirects to `/login`). Conditionally includes the Google provider only if `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set (`googleLoginEnabled`).
- `src/auth.ts` — full config, Node-only: adds the Credentials provider (bcrypt password check) and a `jwt` callback that upserts a DB user + calls `ensureDefaultCategories()` on first Google sign-in.
- Do not add database or bcrypt imports to `auth.config.ts` — it must stay importable from the edge middleware.
- `src/lib/session.ts` provides `getUserId()` / `unauthorized()` / `badRequest()` / `notFound()` helpers used by API routes for their own auth checks (middleware protects pages, not `/api/*`).

### Data model conventions (`src/lib/db/schema.ts`)

- **Amounts are integer paise** (`amountPaise`), never floats — this convention must be preserved in any new money-related field.
- Soft delete via `deletedAt` timestamp on `transactions`, not row deletion.
- OAuth tokens (`gmailConnections.accessToken`/`refreshToken`) are AES-256-GCM encrypted at rest (`src/lib/crypto.ts`); API tokens (`apiTokens.tokenHash`) are stored as SHA-256 hashes, plaintext shown once.
- `transactions.raw` stores the original email (subject/snippet/body truncated to 2000 chars) as JSON, kept for parse debugging/re-parsing — not surfaced to normal queries.
- Everything IST-aware: daily/monthly analytics buckets use Asia/Kolkata regardless of server timezone (see `src/lib/parsing/normalize.ts` / analytics route).

### Gmail sync

- `src/lib/gmail/sync.ts` — `syncAllUsers()` drives per-connection full or incremental (history-based) sync, with automatic fallback to query sync when Gmail's history window has expired.
- Background loop lives in `src/instrumentation-node.ts`, controlled by `SYNC_INTERVAL_MINUTES` (0 disables it — required for serverless deployments, which should instead hit `POST /api/gmail/sync` from an external cron).
- Manual/on-demand sync goes through the same `syncAllUsers`/per-connection sync path via `src/app/api/gmail/sync/route.ts`.

## Code style

- Prettier: double quotes, semicolons, 100-char width, trailing commas (`.prettierrc`) — run `npm run format` rather than hand-matching style.
- No test framework beyond vitest; fixtures for the parsing engine belong in `tests/parsers.test.ts`, classifier cases in `tests/detect.test.ts`, matching logic in `tests/match.test.ts`.
