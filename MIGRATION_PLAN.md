# Vyay: SQLite → Vercel + Supabase Multi-Tenant SaaS Migration

## Context

Vyay currently runs as a self-hosted, single-user Next.js 15 app on `better-sqlite3` (one local file, synchronous Drizzle queries, an in-process `setInterval` Gmail sync loop). Mission: convert it to a hosted multi-tenant SaaS on Vercel (Hobby, Fluid Compute) + Supabase Postgres serving up to 100 Google test users. Git/Vercel/Supabase CLIs are authenticated; Vercel project `devansh-s-team/vyay` is linked (one stray auto-deployment exists, expected to fail — harmless); Supabase project exists but in the wrong region.

**Decisions already made with user:** Google-only sign-in (drop email+password), production starts with fresh data (no SQLite data port), recreate Supabase in `ap-south-1` (Mumbai). Timestamps stay `bigint` epoch-ms (explicit user constraint — do NOT convert to native timestamps). `initialSyncDone` becomes native `boolean`.

**Exploration findings that shape the plan:**
- **81 synchronous `.get()/.all()/.run()` call sites across 29 files** (per-file counts captured below in Phase 3).
- `src/lib/crypto.ts` **already implements AES-256-GCM** token encryption keyed from `ENCRYPTION_KEY` (base64, 32-byte), and `src/lib/gmail/client.ts` already encrypts/decrypts refresh+access tokens around Gmail API calls. Phase 5 is therefore *verification + prod key management + UI*, not new crypto code.
- **Cross-tenant bug found:** `unseenIds()` in `src/lib/gmail/sync.ts` filters `transactions.gmailMessageId` with `inArray` but **never filters by `userId`** — user B's sync would skip a message if user A has the same Gmail message id. Must fix in the tenant-isolation phase.
- **Serverless correctness bugs that don't exist locally:**
  - `POST /api/gmail/sync` fire-and-forgets `syncUser()` without awaiting — on Vercel the function freezes after the response is returned, killing the sync mid-flight. Needs `waitUntil()` (from `@vercel/functions`).
  - In-memory `locks` and `progress` Maps in `sync.ts` don't work across serverless instances. Lock → use the existing `gmailConnections.syncStatus` DB column as the guard; progress → persist to two new columns on `gmailConnections`.
  - `src/instrumentation-node.ts` `setInterval` loop must not run on Vercel (gate on `process.env.VERCEL`).
- Tests (4 of 8 files) mock `@/lib/db` with in-memory better-sqlite3 + raw migration SQL. Postgres has no in-memory mode → swap the mock to **PGlite** (`@electric-sql/pglite` + `drizzle-orm/pglite`), which runs the same generated pg migration SQL in-process.
- Auth.js v5 split config already exists (`auth.config.ts` edge-safe with conditional Google provider, `auth.ts` node-side with user upsert in jwt callback). Google login for users largely already works — main work is removing the credentials path.
- Gmail connect stays a **separate** OAuth flow from sign-in (as today): sign-in requests only openid/email/profile; `gmail.readonly` is granted explicitly via the Connect button. Least-privilege, matches the trust messaging.

## Working agreements (apply throughout)

- **Handover-ready at all times**: maintain `MIGRATION_STATUS.md` (repo root), updated after every completed sub-task: done / in-progress + exact state / next / decisions + rationale. Commit & push with each logical increment. Never leave the repo half-converted without notes.
- This plan is persisted as `MIGRATION_PLAN.md` in the repo in Phase 0, so an interrupted session never needs re-ideation.
- Never commit secrets; `.env*` stays gitignored. Validate with vitest between major phases. Pause and ask on any decision materially affecting security or cost.

## Phase 0 — Repo groundwork (small)

1. Write `MIGRATION_PLAN.md` (this plan) and `MIGRATION_STATUS.md` (initial state) to repo root. Commit, push.

## Phase 1 — Supabase re-provisioning (ap-south-1)

1. User creates the new project (password must not pass through agent tool calls — same protocol as before): user runs `supabase projects create vyay-prod --org-id qwjneuxpugfinxqliktl --db-password <their-generated> --region ap-south-1 --size nano` themselves via `!`, or dashboard. **Ask user to confirm deletion** of the Seoul project (`kknoqdkxyvdjvyfgeenu`) before running `supabase projects delete`.
2. Re-link: `supabase link --project-ref <new-ref>` (no password needed for link).
3. Capture the two connection strings (structure only; password placeholder): pooled/transaction (port 6543, for app runtime) and direct/session (port 5432, for migrations). User puts real values in `.env.local` themselves; agent never sees the password.

## Phase 2 — Postgres schema + driver + test harness (one atomic phase; repo stays green at its end)

All three must land together — the suite can't pass with a pg schema and a sqlite test mock.

1. **Schema** (`src/lib/db/schema.ts`): `sqlite-core` → `pg-core`.
   - `integer(...)` epoch-ms columns → `bigint({ mode: "number" })` (stays JS number; safe until year ~287,396).
   - `initialSyncDone` → `boolean(...)` default false; update its two read/write sites (`sync.ts`, `status/route.ts`).
   - `real("confidence")` → `doublePrecision`.
   - `$defaultFn(() => Date.now())` / `randomUUID()` defaults carry over unchanged.
2. **Config/migrations**: `drizzle.config.ts` dialect → `postgresql`, `dbCredentials.url = process.env.MIGRATE_DATABASE_URL`. Delete the sqlite `drizzle/` folder (git history keeps it), regenerate a fresh `0000_` pg migration.
3. **Driver** (`src/lib/db/index.ts`): `better-sqlite3` → `postgres` (postgres.js) with `max: 1`, `prepare: false` (**required** — Supavisor transaction-mode pooler breaks with prepared statements), via `drizzle-orm/postgres-js`. Remove boot-time auto-migrate (migrations move to build).
4. **`migrate.ts`** (repo root): standalone, `tsx migrate.ts`, uses `process.loadEnvFile()` (Node ≥20.12; local is 24, Vercel is 24.x) with a try/catch so it also works on Vercel where env vars come from the platform and no `.env` file exists. Uses `MIGRATE_DATABASE_URL` (direct connection) and `drizzle-orm/postgres-js/migrator`.
5. **Test harness**: add `@electric-sql/pglite` dev-dep; rewrite the `vi.mock("@/lib/db", ...)` block (4 files: `tests/match.test.ts`, `reparse.test.ts`, `contacts.test.ts`, `categorize.test.ts`) to a shared helper using `drizzle-orm/pglite`, executing the generated pg migration SQL. Test bodies get `await` added as the driver is async.
6. **Dependencies**: remove `better-sqlite3`, `@types/better-sqlite3`; add `postgres`, `@electric-sql/pglite` (dev), `@vercel/functions`.
7. `.env.example`: replace `DATABASE_PATH` with `DATABASE_URL` (pooled) + `MIGRATE_DATABASE_URL` (direct), add `CRON_SECRET`.
8. Run typecheck. (Vitest goes green only after Phase 3's async conversion — typecheck is the Phase 2 gate; note this in MIGRATION_STATUS.)

## Phase 3 — Async conversion (81 call sites, 29 files, in dependency order)

Mechanical rule: `.get()` → `await …` + drizzle `.limit(1)` semantics via postgres-js (`(await q)[0]`) or drizzle's `.then()`; `.all()` → `await …`; `.run()` → `await …`; every touched function becomes `async`, callers updated up the chain.

Batches (run `npm run typecheck` after each; vitest after batches C and D):
- **A. Core lib** (heaviest, most-imported): `lib/categorize.ts` (5), `lib/match.ts` (4), `lib/ingest.ts` (3), `lib/contacts/match.ts` (1), `lib/contacts/import.ts` (3), `lib/transactions.ts` (0 sites but callers), `lib/reparse.ts` (2).
- **B. Gmail path**: `lib/gmail/sync.ts` (8), `lib/gmail/client.ts` (1 — the `tokens` event handler can't await; make it fire-and-forget with `.catch(console.error)`), routes `gmail/{sync,status,callback,disconnect}` (4 total).
- **C. API routes**: transactions (6), categories (8), rules (6), matches (4), contacts (2), tokens (3), analytics (2), export (1), shortcut/log (5), register (2 — being deleted in Phase 4 anyway; convert only if ordering demands).
- **D. Auth + seed**: `auth.ts` (3), `lib/db/seed.ts` (8 — dev-only utility; keep working for local dev).
- Full vitest suite green at end of phase. Commit per batch.

## Phase 4 — Multi-tenant auth (Google-only) + tenant-isolation audit

1. Remove credentials provider from `auth.ts`, delete `/register` page + `/api/register`, strip password fields from `auth-forms.tsx` (login page becomes a Google sign-in button). Google provider becomes required, not conditional. Keep `users.passwordHash` column (harmless; avoids a migration churn) but nothing writes it.
2. **Fix the found bug**: add `eq(transactions.userId, userId)` to `unseenIds()` in `sync.ts`.
3. Systematic tenant audit: grep every `db.select/update/delete/insert` and verify a `userId` predicate (or ownership join) on: transactions, categories, merchantRules, contacts, apiTokens, shortcutEvents, gmailConnections. Fix any others found; add a short section to MIGRATION_STATUS with the audit table.
4. Per-user Gmail tokens: already per-user via `gmailConnections.userId` unique FK — verify `syncAllUsers()` iterates connections and passes the right userId everywhere.
5. Tests: add a tenant-isolation regression test (user A's message id doesn't block user B's ingest).

## Phase 5 — Serverless sync correctness + cron

1. `POST /api/gmail/sync`: wrap `syncUser()` in `waitUntil()` (`@vercel/functions`), `export const maxDuration = 300`.
2. Replace in-memory `locks` Map with a DB guard: atomic `UPDATE gmail_connections SET sync_status='syncing' WHERE user_id=$1 AND sync_status != 'syncing' RETURNING id` — no row returned ⇒ already syncing. Add a staleness escape (if `syncStatus='syncing'` but `lastSyncAt` older than 10 min, allow takeover) so a crashed function can't wedge a user forever.
3. Persist progress: add `sync_progress_done`/`sync_progress_total` int columns (new migration) written where the Maps are written today; `status/route.ts` reads them. Delete the Maps.
4. Gate `instrumentation-node.ts` loop: skip when `process.env.VERCEL` is set.
5. **Cron**: `src/app/api/cron/sync/route.ts` — requires `Authorization: Bearer ${CRON_SECRET}` (Vercel sends this automatically when the env var exists), iterates all connections **sorted by oldest `lastSyncAt` first**, syncs sequentially, checks elapsed time and stops cleanly at ~250s (remainder caught next day / by manual sync). `maxDuration = 300`. `vercel.json`: `{ "crons": [{ "path": "/api/cron/sync", "schedule": "30 2 * * *" }] }` (once daily = Hobby limit; 08:00 IST).
6. Vitest between-phase gate.

## Phase 6 — Encryption verification + trust UI

1. Verify (no rewrite needed): AES-256-GCM in `crypto.ts` meets spec; decryption only happens in-memory inside `gmailFor()` at API-call time. Document in MIGRATION_STATUS.
2. Generate a **new production** `ENCRYPTION_KEY` + `AUTH_SECRET` + `CRON_SECRET` via shell, set via `vercel env add` (piped stdin, not CLI args, so values stay out of process listings). Local `.env.local` keeps dev values (dev key already exists; prod fresh-start means no re-encryption concern).
3. Trust UI: info affordance (tooltip/popover) beside the Gmail connect button in `settings.tsx`: read-only scope, tokens AES-256-GCM-encrypted at rest, used only to read transaction alert emails, disconnect anytime.

## Phase 7 — Deployment

1. `package.json`: `"build": "tsx migrate.ts && next build"` (`tsx` moves to `dependencies` or is invoked via `npx`; migrations run in Vercel build using `MIGRATE_DATABASE_URL`).
2. Set all Vercel envs (production): `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CRON_SECRET`, `APP_URL` (the prod URL), `SYNC_INTERVAL_MINUTES=0`. Connection strings contain the DB password → user pastes those two via `!`-prefixed `vercel env add` commands themselves; agent sets the non-DB ones.
3. `vercel deploy --prod` via CLI; verify build (incl. migration step) succeeds; report production URL. Delete/ignore the stray failed auto-deployment.
4. Update `README.md` deployment/privacy sections (the "your data never leaves your server" pitch must change) and `.env.example`.

## Phase 8 — Handover

1. **Manual Google Cloud Console steps for user** (exact list, with prod URL substituted): add `${PROD_URL}/api/auth/callback/google` and `${PROD_URL}/api/gmail/callback` redirect URIs; add up to 100 test users on the OAuth consent screen (app stays in Testing mode — `gmail.readonly` is a restricted scope, full verification not needed at this scale; note 7-day refresh-token expiry does NOT apply to restricted-scope testing apps… actually it does for external testing apps — flag: **test-mode refresh tokens expire after 7 days**; document that users may need to reconnect Gmail weekly until the app is verified, or keep publishing status "In production (unverified)" trade-offs — present options in handover doc).
2. **Smoke-test checklist**: Google sign-in; Gmail connect (consent screen shows readonly scope); initial sync populates ledger; second user account isolation (no cross-tenant data); manual "Sync now"; cron route responds 401 without secret / 200 with; Excel export; Apple Shortcut token + log; contacts import; re-parse.
3. Update `CLAUDE.md`: new architecture (Postgres/postgres.js, async DB layer, serverless sync w/ waitUntil + cron, Google-only auth, PGlite tests, migrate.ts, deployment commands).

## Risks & mitigations

- **Supavisor pooler vs prepared statements** → `prepare: false` is non-negotiable; missing it yields cryptic runtime errors only in prod. Covered in Phase 2.3.
- **Build-time migrations block deploys** if the DB is unreachable/migration fails → deploy fails loudly (acceptable; Hobby has no staged environments). Mitigation: run `tsx migrate.ts` locally against prod DB once before first deploy to de-risk.
- **Cron 300s budget with 100 users**: incremental history-based syncs are ~1–3s/user when idle; worst case (many users with new mail) exceeds budget → oldest-first ordering + clean 250s cutoff means no user starves; heavy initial syncs happen interactively at connect time (via waitUntil), not in cron.
- **Google test-mode 7-day refresh-token expiry** (external apps in Testing): users must reconnect weekly. Surfaced in handover with options (accept, or publish unverified, or start verification).
- **PGlite fidelity**: minor behavioral gaps vs real Postgres are possible; the migration SQL itself is exercised against real Supabase at build time, so drift risk is confined to test-only behavior.
- **81-call-site conversion churn**: mitigated by batch order (leaf libs first), typecheck per batch, tests per phase, one commit per batch for bisectability.

## Verification

- Per batch: `npm run typecheck`; per phase: `npm run test` (68 tests currently green; PGlite harness must keep them green), `npm run lint`.
- Post-deploy: run the Phase 8 smoke-test checklist against the production URL; verify cron via manual `curl` with/without secret; confirm `SELECT count(*)` growth in Supabase after first real sync.
