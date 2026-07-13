# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Vyay — a Next.js app that turns Gmail transaction-alert emails (17+ Indian banks/payment apps) into a categorized expense ledger. Multi-tenant: every user signs in with Google, connects their own Gmail account, and every table/query is scoped by `userId` so one user's data is never visible to another. Runs on Vercel + Supabase Postgres in production (https://vyay-five.vercel.app), or self-hosted against any Postgres database. Full product context, env vars, and OAuth setup are in `README.md` — read it for anything not covered here. `MIGRATION_STATUS.md` has the detailed history of the SQLite → Postgres/multi-tenant/Vercel migration, including gotchas found along the way (e.g. the Supabase direct-connection/IPv6 build failure on Vercel).

## Commands

```bash
npm run dev          # development server
npm run build         # tsx migrate.ts && next build — runs pending migrations, then builds
npm run start         # production server
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run test          # vitest run (all tests, once)
npm run test:watch    # vitest watch mode
npm run format         # prettier --write .
npm run db:generate    # regenerate Drizzle migrations after schema.ts changes
npm run db:seed        # demo@vyay.app with 90 sample transactions — sign in with Google using that address (no password; auth is Google-only)
npx tsx migrate.ts     # apply pending migrations directly, without a full build
```

Run a single test file: `npx vitest run tests/parsers.test.ts`. Run one test by name: `npx vitest run -t "HDFC UPI debit"`. Tests live in `tests/*.test.ts` (vitest.config.ts), aliasing `@/` to `src/`. DB-backed tests mock `@/lib/db` with `tests/helpers/pglite.ts` (`@electric-sql/pglite`, an in-process Postgres that replays the real generated migration SQL) — there is no in-memory SQLite fallback anymore.

Migrations do **not** run automatically at DB init or dev-server startup — `src/lib/db/index.ts` is just the postgres.js connection, nothing more. `npm run build` runs `tsx migrate.ts` first; in dev, run `npx tsx migrate.ts` by hand after pulling schema changes. `db:generate` must be run after any `src/lib/db/schema.ts` change to produce the migration file under `drizzle/`.

`MIGRATE_DATABASE_URL` must not be Supabase's transaction pooler (port 6543 — breaks migrations' need for session-scoped statements) and, specifically on Vercel, must not be the direct connection host either (IPv6-only, unreachable from Vercel's build containers — fails with `ENETUNREACH`). Use the session pooler (also port 5432) there. See README's env var table.

## Architecture

```
src/lib/parsing/         classifier (detect.ts) + extraction engine (engine.ts) + provider registry (providers.ts)
src/lib/gmail/           OAuth client, MIME fetch, full/incremental sync
src/lib/ingest.ts        source-agnostic ingest: classified → parsed → categorized → stored (idempotent)
src/lib/match.ts         Apple Shortcut ↔ transaction pairing
src/lib/db/              Drizzle ORM (pg-core) schema + postgres.js connection (schema.ts, index.ts)
src/app/api/             REST routes (auth, transactions, analytics, export, gmail, rules, matches, shortcut, ingest…)
src/app/api/cron/sync/   daily Vercel Cron sweep (CRON_SECRET-protected, see vercel.json)
src/app/(app)/           Overview, Ledger, Categories, Matches, Settings pages
src/instrumentation-node.ts   self-host-only background sync loop (setInterval; disabled when process.env.VERCEL is set)
migrate.ts               standalone migration runner (tsx migrate.ts), used by npm run build and locally
```

All DB access is async (postgres.js is an async driver — there's no synchronous `.get()/.all()/.run()` anywhere in `src/`, unlike the old better-sqlite3 codebase).

### Transaction pipeline (source-agnostic: Gmail, SMS, Apple Wallet)

`ingestParsedTransaction()` in `src/lib/ingest.ts` is the single entry point for turning a parsed transaction (`NormalizedTxn`) into a stored row, regardless of where it came from. `ingestEmail()` is a thin wrapper around it for Gmail (classify + parse, then hand off); `POST /api/ingest` (`src/app/api/ingest/route.ts`) is the equivalent entry point for SMS and Apple Wallet, same Bearer-token trust model as the Shortcut log endpoint. Steps, run for every source:

1. **Classify + parse (Gmail/SMS only — Wallet's payload IS the transaction, no classify/parse step)**: `classifyEmail()` (`src/lib/parsing/detect.ts`) is a layered regex classifier that rejects OTPs, statements, due-date reminders, future/scheduled debits (including the RBI-mandated e-mandate/autopay pre-notice every bank sends ~24h before a recurring debit — "will be deducted/debited/processed on..."), collect requests, failed transactions, reward-points/limit-change noise, and promotional mail, while still requiring an amount + a strong "money moved" phrase to accept. `parseEmail()` (`src/lib/parsing/engine.ts`) does generic field extraction (amount, direction, merchant, channel, bank, UPI id, card last-4, reference number, IST-aware occurred-at). Both functions take `{from, subject, body}` and are fed SMS bodies directly as `{from: sender ?? "", subject: "", body}` — SMS's terser phrasing (bare leading verbs like "Sent Rs.X"/"Spent Rs.X On", card-present confirmations with no verb at all, labeled `Txn Amt:` mandate-receipt templates) needed dedicated pattern additions in both files; don't assume email-style phrasing is sufficient when extending either. Providers (`providers.ts`) mostly just contribute `senders` regexes for tagging + `queryDomains` for the Gmail search query; adding a bank is normally a ~10-line provider entry, not new parsing logic.
2. `resolveMerchant()` (`src/lib/merchant.ts`, shared with reparse) — a saved contact wins outright; otherwise a corporate-suffix strip and a curated `KNOWN_MERCHANTS` alias map clean up the display name and set `merchantConfidence`/`merchantSource`. `normalizeMerchant()` + `categorize()` (`src/lib/categorize-context.ts`) — user-defined `merchantRules` win, then word-boundary `BRAND_RULES` (matches merchant/UPI id/subject), then broader `GENERIC_RULES` keywords (merchant/UPI id only, never subject); `categorySource` records which tier matched. `categorize-context.ts` (and `contacts/context.ts` for `matchContact()`) deliberately have **no `db` import** — they're the pure halves of `categorize.ts`/`contacts/match.ts`, safe to bundle client-side for `src/lib/parser-sync.ts` (see below). Don't reintroduce a `db` import into either file.
3. Insert with `onConflictDoNothing()` against the unique `(userId, gmailMessageId)` index — reused as a generic source-prefixed idempotency key for non-Gmail rows (`sms:<hash of sender+body+minute>`, `wallet:<hash of merchant+amount+minute>`), not renamed, to avoid an unnecessary migration.
4. `flagPotentialDuplicate()` — marks duplicate alerts by setting `duplicateOfId` (never deleting either row), checking two signals: a matching bank reference number (`referenceNumber`/`refBidx` — strong, any time distance, catches e.g. bank + UPI app both emailing, or a second source seeing the same payment) first, then falling back to same user/amount/direction within a 3-minute window (weak, for rows with no reference number) — **widened to ~20h when either row's `occurredAtPrecise` is false** (set by `extractOccurredAt` whenever it falls back to arrival time or a bare date with no clock time, rather than reading a real time-of-day from the body). This isn't hypothetical: a real HDFC pair — an "AutoPay Success" labeled receipt with only `Dt:DD/MM/YYYY` (no time) and HDFC's own generic card-spend confirmation with a precise timestamp, for the identical debit — can land hours apart, which the old fixed 3-minute window would have silently double-counted. Flagged rows are excluded from `/api/analytics` and export but stay visible in the Ledger; PATCH `duplicateOfId: null` un-flags a false positive.
5. `tryResolvePendingShortcuts()` (`src/lib/match.ts`) — resolves a pending Apple Shortcut expense log via `pickAutoMatch()`: a sole candidate anywhere in `MATCH_WINDOW_HOURS` (72h) auto-applies; with several same-amount candidates, only the one inside `MATCH_AUTO_WINDOW_MS` (30 min) of the transaction's `occurredAt` does — otherwise it's left pending for `/matches`. The Shortcut log route (`src/app/api/shortcut/log/route.ts`) applies the same tiered rule in the other direction (log arrives after the transaction).
6. `recordParseHealth()` — increments per-provider extraction-quality counters (`parseHealthStats`, a global operational table with no `userId`/content) on every successful insert **when a provider is known** (Gmail/SMS only — Wallet has no sender/body to classify, so `opts.provider` is omitted and this step is skipped); viewable at `/admin`. Catches a whole bank silently extracting nothing (a real bug this caught: Canara had zero test fixtures and zero categorized transactions for a live user) before a user has to notice and complain.

When adding a bank/payment app, add a fixture to `tests/parsers.test.ts` (email) or `tests/sms.test.ts` (SMS) with a real (redacted) body — that's how parsing regressions are caught. Users can also donate a bad-parse sample via "Report a bad parse" in the Ledger (`parseSamples` table, reviewed by the user client-side before submitting) — the acquisition path once an account is keyed, since the operator can no longer read a keyed user's stored raw emails.

### Bank statement import (`src/lib/statement/`, `POST /api/statement/import`)

The historical-backfill counterpart to real-time SMS/Wallet capture — CSV/XLS/XLSX only (PDF explicitly deferred). Entirely client-side until the user confirms: `readStatementFile()` parses the upload (hand-rolled RFC-4180-lite CSV, or `exceljs` dynamically imported for XLS/XLSX — never in the main bundle), `detectHeaderRow()` scans the first 25 rows for one that fuzzy-matches enough known column names (date/narration/debit/credit/amount/ref), falling back to a manual column-mapper UI when it can't find a confident match. `normalizeStatementRow()` then extracts each row via the *same* narration-extraction functions the email/SMS engine uses (`extractMerchant`, `extractChannel`, `fromNarration`) — bank statement narrations use the same UPI-/NEFT-/IMPS- vocabulary, but not always email's field order, which is why a dedicated segment-based VPA extractor (`extractUpiIdFromSegments`) exists: splitting on `-`/`/` and requiring a whole segment to look like a VPA sidesteps both `fromNarration`'s rigid ordering and the standalone `extractUpiId`'s tendency to over-capture hyphens as if they were VPA characters (confirmed against real HDFC narrations like `UPI-SWIGGY-swiggy@icici-512345678901`).

For keyed users, `findDuplicates()` runs client-side against `useTransactions()`'s already-decrypted history (ref match, then amount+direction within ±1 day, one-to-one — two same-amount rows never both claim the same existing transaction) and the Review table shows New/Duplicate/Skipped chips before anything is sent. Non-keyed accounts skip the client-side dedup preview (no decrypted history to check against) and rely on the same server-side `flagPotentialDuplicate()` every other source uses — a real duplicate still gets flagged, never silently discarded, keeping one dedup mental model across every source rather than a bespoke "skip" path for statements alone. Every row is capped at the `TRACKING_BASELINE_MS` floor (`src/lib/utils.ts`, shared with Gmail's initial-sync anchor) both client-side (UX) and server-side (authoritative, via zod).

### Auto-reprocessing existing data on parsing/categorization fixes

A fix to ingestion, parsing, merchant resolution, or categorization only helps *newly-arriving* emails unless existing rows are also reprocessed — otherwise a user stays affected by a bug like "Canara Bank extracted zero merchants" forever, even after the fix ships. **`src/lib/parser-version.ts`'s `PARSER_VERSION` must be bumped in the same PR as any such change** — see that file's doc comment for exactly what counts.

Every account has `users.parserVersionApplied`, compared against `PARSER_VERSION`. `ParserSyncRunner` (mounted in `(app)/layout.tsx`, invisible, no UI) checks `GET /api/parser-sync/status` once per session and, if stale, reprocesses automatically — with **zero user-facing distinction** between account types:
- Non-keyed accounts (server can read stored `raw`): `POST /api/parser-sync/run` runs the existing `reparseUserTransactions()` server-side.
- Keyed accounts (server can never decrypt sealed `raw`): `src/lib/parser-sync.ts`'s `runClientParserSync()` does the whole pipeline client-side — decrypt → `parseEmail()` → `matchContact()` → `resolveMerchant()` → `categorize()` → re-seal → `PATCH`. This is *why* `categorize-context.ts`/`contacts/context.ts` exist as pure, `db`-free modules — the same categorization/matching logic has to run in the browser here.

In practice, every real signed-in session is keyed by the time it ever reaches app content at all (`KeyProvider` blocks on setup before rendering `children`) — the non-keyed server path only matters for self-host edge cases and tests, not real usage. `/demo` never mounts `KeyProvider` or `ParserSyncRunner` and is unaffected either way.

### Auth (Auth.js v5, split config, Google-only)

- `src/auth.config.ts` — edge-safe: no DB imports. Used by `src/middleware.ts` directly for route protection (checks `req.auth`, redirects to `/login`). Includes the Google provider only if `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set (`googleLoginEnabled`) — if they're missing, the app still boots but the login page shows a "not configured" message instead of a broken button, same pattern as the Gmail-connect card's `oauthConfigured` check.
- `src/auth.ts` — full config, Node-only: a `jwt` callback that upserts a DB user (by email) and calls `ensureDefaultCategories()` on first Google sign-in, then pins `token.uid`.
- There is no password/credentials login — it was removed along with `/register` and `/api/register` when the app went multi-tenant (Google is the only identity path, and every user needs a Google account for Gmail access anyway).
- Do not add database imports to `auth.config.ts` — it must stay importable from the edge middleware.
- `src/lib/session.ts` provides `getUserId()` / `unauthorized()` / `badRequest()` / `notFound()` helpers used by API routes for their own auth checks (middleware protects pages, not `/api/*`).

### Data model conventions (`src/lib/db/schema.ts`)

- **Amounts are integer paise** (`amountPaise`), never floats — this convention must be preserved in any new money-related field.
- **Timestamps are epoch-milliseconds** (`bigint`, `mode: "number"`), deliberately not native Postgres `timestamp` columns — this was an explicit decision during the Postgres migration, not an oversight; keep new time fields consistent with it.
- Soft delete via `deletedAt` timestamp on `transactions`, not row deletion.
- OAuth tokens (`gmailConnections.accessToken`/`refreshToken`) are AES-256-GCM encrypted at rest (`src/lib/crypto.ts`), decrypted only in-memory at Gmail API call time (`gmailFor()` in `src/lib/gmail/client.ts`); API tokens (`apiTokens.tokenHash`) are stored as SHA-256 hashes, plaintext shown once.
- `transactions.raw` stores the original email (subject/snippet/body truncated to 2000 chars) as JSON, kept for parse debugging/re-parsing — not surfaced to normal queries.
- `parseHealthStats` is deliberately global (no `userId`) — it's operational telemetry (per-provider counters), not user data, so it stays queryable even for a fully-keyed install where every `transactions` row is sealed. Never add per-user or content columns to it.
- Everything IST-aware: daily/monthly analytics buckets use Asia/Kolkata regardless of server timezone (see `src/lib/parsing/normalize.ts` / analytics route).
- **Every query must be scoped by `userId`** (directly, or via an id already verified as user-owned earlier in the same handler) — this is a hard tenant-isolation invariant, not a style preference. A regression here (missing `userId` filter) is a real cross-tenant data leak; see `tests/sync.test.ts` for the pattern the one bug of this kind we found looked like, and how it's regression-tested.

### Gmail sync

- `src/lib/gmail/sync.ts` — `syncUser()` syncs one account (full or incremental/history-based, with automatic fallback to query sync when Gmail's history window has expired); `syncAllUsers()` sweeps every connection sequentially (used by the self-host background loop and as a building block, not by the Vercel cron directly).
- **Sync lock and live progress are DB columns on `gmailConnections`** (`syncStatus`/`syncStartedAt`, `syncProgressPhase`/`syncProgressDone`/`syncProgressTotal`), not in-memory state — this is what makes sync correct across separate serverless invocations. `syncUser()` acquires the lock via an atomic `UPDATE ... WHERE ... RETURNING`; if another invocation already holds a fresh lock it throws `SyncInProgressError` (treat this as a harmless no-op, not a real failure — callers already do). A `syncing` row older than 10 minutes is treated as an abandoned/crashed invocation and reclaimed automatically.
- Progress writes are throttled (every ~20 items) to avoid one DB round trip per ingested message on a large initial sync; `/api/gmail/status` reads progress straight off the connection row.
- **Production sync path**: `src/app/api/cron/sync/route.ts`, scheduled daily by `vercel.json` (`CRON_SECRET`-protected), iterates connections oldest-`lastSyncAt`-first and stops cleanly under a 250s cutoff (under the 300s function budget) so no single slow sync starves the rest.
- **Self-host sync path**: `src/instrumentation-node.ts`'s `setInterval` loop, controlled by `SYNC_INTERVAL_MINUTES` (0 disables it) — unconditionally disabled when `process.env.VERCEL` is set, so it can never double-run alongside the cron.
- Manual "Sync now" (`POST /api/gmail/sync`) and the post-connect initial sync (`GET /api/gmail/callback`) both wrap `syncUser()` in `waitUntil()` (`@vercel/functions`) — without it, Vercel can freeze the function the instant the HTTP response is sent, killing the sync mid-flight. Any new fire-and-forget sync kickoff needs the same treatment.

## Code style

- Prettier: double quotes, semicolons, 100-char width, trailing commas (`.prettierrc`) — run `npm run format` rather than hand-matching style.
- No test framework beyond vitest; fixtures for the parsing engine belong in `tests/parsers.test.ts`, classifier cases in `tests/detect.test.ts`, matching logic in `tests/match.test.ts`, sync/tenant-isolation logic in `tests/sync.test.ts`.
