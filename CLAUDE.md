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
src/lib/ingest.ts        email → classified → parsed → categorized → stored (one function, idempotent)
src/lib/match.ts         Apple Shortcut ↔ transaction pairing
src/lib/db/              Drizzle ORM (pg-core) schema + postgres.js connection (schema.ts, index.ts)
src/app/api/             REST routes (auth, transactions, analytics, export, gmail, rules, matches, shortcut…)
src/app/api/cron/sync/   daily Vercel Cron sweep (CRON_SECRET-protected, see vercel.json)
src/app/(app)/           Overview, Ledger, Categories, Matches, Settings pages
src/instrumentation-node.ts   self-host-only background sync loop (setInterval; disabled when process.env.VERCEL is set)
migrate.ts               standalone migration runner (tsx migrate.ts), used by npm run build and locally
```

All DB access is async (postgres.js is an async driver — there's no synchronous `.get()/.all()/.run()` anywhere in `src/`, unlike the old better-sqlite3 codebase).

### Email → transaction pipeline

`ingestEmail()` in `src/lib/ingest.ts` is the single entry point for turning one Gmail message into a stored transaction, run per-message during sync:

1. `classifyEmail()` (`src/lib/parsing/detect.ts`) — a layered regex classifier that rejects OTPs, statements, due-date reminders, future/scheduled debits, collect requests, failed transactions, and promotional mail, while still requiring an amount + a strong "money moved" phrase to accept. Promotional wording is a soft negative overridden by an explicit debit/credit phrase (real cashback credits still get through).
2. `parseEmail()` (`src/lib/parsing/engine.ts`) — generic field extraction (amount, direction, merchant, channel, bank, UPI id, card last-4, reference number, IST-aware occurred-at). Providers (`providers.ts`) mostly just contribute `senders` regexes for tagging + `queryDomains` for the Gmail search query; the engine does the actual extraction, so adding a bank is normally a ~10-line provider entry, not new parsing logic.
3. `resolveMerchant()` (`src/lib/merchant.ts`, shared with reparse) — a saved contact wins outright; otherwise a corporate-suffix strip and a curated `KNOWN_MERCHANTS` alias map clean up the display name and set `merchantConfidence`/`merchantSource`. `normalizeMerchant()` + `categorize()` (`src/lib/categorize.ts`) — user-defined `merchantRules` win, then word-boundary `BRAND_RULES` (matches merchant/UPI id/subject), then broader `GENERIC_RULES` keywords (merchant/UPI id only, never subject); `categorySource` records which tier matched.
4. Insert with `onConflictDoNothing()` against the unique `(userId, gmailMessageId)` index — re-ingesting the same message is a safe no-op, which is what makes repeated/incremental syncs safe to retry.
5. `flagPotentialDuplicate()` — marks likely duplicate alerts (same user/amount/direction within a 3-minute window, e.g. bank + UPI app both emailing) by setting `duplicateOfId`, without deleting either row.
6. `tryResolvePendingShortcuts()` (`src/lib/match.ts`) — resolves any pending Apple Shortcut expense log waiting for this amount/direction within `MATCH_WINDOW_HOURS` (72h).

When adding a bank/payment app, add a fixture to `tests/parsers.test.ts` with a real (redacted) email body — that's how parsing regressions are caught.

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
