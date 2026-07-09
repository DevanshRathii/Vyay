# Migration Status

> Living handover doc for the SQLite → Vercel + Supabase migration.
> Updated after every completed sub-task. Full plan: `MIGRATION_PLAN.md`.
> Resume prompt for a fresh session: *"Continue the Vyay migration. Read MIGRATION_PLAN.md and MIGRATION_STATUS.md, then pick up at the first unchecked item."*

## Done

- **Pre-migration integrations** (previous sessions): git repo pushed to
  https://github.com/DevanshRathii/Vyay (branch `main`); Vercel CLI authed,
  project `devansh-s-team/vyay` linked to the GitHub repo (one stray
  auto-triggered production deployment exists — expected to fail, ignore or
  delete); Supabase CLI authed.
- **Phase 0**: plan approved and persisted as `MIGRATION_PLAN.md`; this
  status file created. Committed together.
- **Phase 1**: Supabase re-provisioned. User deleted the Seoul project and
  created **`llciwbpnlmlroromfdoc`** ("Vyay", `ap-south-1`, Postgres 17,
  ACTIVE_HEALTHY); agent linked it via `supabase link`.
  - OUTSTANDING USER ACTION (non-blocking until first migration run): add
    `DATABASE_URL` (transaction pooler, port 6543) and
    `MIGRATE_DATABASE_URL` (direct, port 5432) to local `.env`, copied from
    dashboard → Connect. Direct host: `db.llciwbpnlmlroromfdoc.supabase.co`.

- **Phase 2**: complete. schema.ts on pg-core (epoch-ms as
  `bigint mode:"number"`, `initialSyncDone` boolean, `confidence`
  doublePrecision, `amountPaise` bigint for large transfers);
  drizzle.config → postgresql (`MIGRATE_DATABASE_URL`); fresh pg migration
  `drizzle/0000_overrated_captain_flint.sql` (sqlite migrations deleted, in
  git history); `db/index.ts` on postgres.js (`max:1, prepare:false` —
  pooler requirement); standalone `migrate.ts` (tsx + process.loadEnvFile,
  direct connection); PGlite test harness (`tests/helpers/pglite.ts`) and
  all 4 DB-backed test files converted to async/await; deps swapped
  (better-sqlite3 removed; postgres, @vercel/functions, @electric-sql/pglite
  added); `.env.example` updated (DATABASE_URL/MIGRATE_DATABASE_URL/
  CRON_SECRET; DATABASE_PATH gone).
  - **Plan correction (honest state):** whole-program typecheck is RED and
    stays red until Phase 3 finishes — the 81 legacy `.get()/.all()/.run()`
    call sites don't exist on pg query types. This was foreseen but
    mis-stated in the plan ("typecheck as Phase 2 gate"); real gates were:
    schema compiles in isolation, migration generates, deps install.

- **Phase 3: complete.** All 81 originally-counted sync call sites
  converted (batches A–D: core lib, gmail path, API routes, auth.ts +
  seed.ts), plus one site the original grep missed —
  `src/app/api/contacts/import/route.ts` called `importContactsFromVCard()`
  without awaiting it (that function has no direct `.get/.all/.run` call
  itself, so it wasn't in the original 81-count; caught by `tsc`, not the
  grep). Conversion conventions used everywhere: `.all()` → `await q`;
  `.get()` → `(await q.limit(1))[0]`; `.run()` → `await q`; better-sqlite3
  `res.changes === 0` checks → `.returning({id}).length === 0` (works on
  both postgres.js and PGlite); `initialSyncDone` writes now use booleans.
  - **Green gates all pass**: `npm run typecheck` clean; `npm run test` —
    68/68 passing on the first-ever PGlite run, no driver quirks, no fixes
    needed in `tests/helpers/pglite.ts`; `npm run lint` clean.

- **Phase 4: complete.** Google-only auth: `src/auth.ts` no longer imports
  `Credentials`/`bcryptjs`/zod-schema — only the Google-upsert `jwt`
  callback remains; `src/app/register/` (page) and
  `src/app/api/register/route.ts` deleted entirely;
  `src/components/auth-forms.tsx` reduced to a single Google-only
  `LoginForm` (shows a clear "not configured" message instead of a broken
  button if `GOOGLE_CLIENT_ID`/`SECRET` are unset — `RegisterForm` and all
  email/password JSX removed); `users.passwordHash` dropped from
  `schema.ts` and via new migration `drizzle/0001_nostalgic_lenny_balinger.sql`
  (`ALTER TABLE users DROP COLUMN password_hash`); `bcryptjs` +
  `@types/bcryptjs` removed from `package.json`; `src/lib/db/seed.ts`
  reworked to not hash/store a password (demo user signs in with Google
  using `demo@vyay.app`).
  - **Fixed the known cross-tenant bug**: `unseenIds()` in
    `src/lib/gmail/sync.ts` now filters by `eq(transactions.userId, userId)`
    in addition to the `inArray(gmailMessageId, ...)` check (was previously
    treating any user's stored message id as "seen" for every user).
    Function exported (was private) so it's directly testable.
  - **Full tenant-isolation audit** (via research subagent, all call sites
    across `transactions`, `categories`, `merchantRules`, `contacts`,
    `apiTokens`, `shortcutEvents`, `gmailConnections` traced): only the
    `unseenIds()` bug found — every other query either filters directly by
    `userId` or operates on an id pre-verified as user-owned earlier in the
    same handler (e.g. `categories/[id]/route.ts` deletes cascade from a
    category id checked against `userId` first). `syncAllUsers()`'s
    unscoped `gmailConnections` select is intentional (it's the background
    sweep iterating every account, re-scoped per-connection immediately
    after). No other fixes needed.
  - **New regression test**: `tests/sync.test.ts` — two users, one stores
    a transaction under message id `"msg1"`; asserts `unseenIds()` for the
    *other* user still returns `"msg1"` as unseen, and for the owning user
    correctly excludes it. This is a real regression test — it exercises
    exactly the code path the bug was in, not just a general isolation
    smoke test.
  - **Green gates all pass**: typecheck clean (after clearing a stale
    `.next` type-cache that still referenced the deleted `/register`
    routes — expected, not a real error); `npm run test` — 69/69 (68 + the
    new sync test); lint clean.

- **Phase 5: complete.** Serverless sync correctness:
  - **DB-backed lock replaces the in-memory `locks` Map**: `syncUser()` now
    does an atomic `UPDATE gmail_connections SET sync_status='syncing', ...
    WHERE id=$1 AND (sync_status != 'syncing' OR sync_started_at IS NULL OR
    sync_started_at < now - 10min) RETURNING *`. Zero rows returned ⇒
    another invocation genuinely holds the lock ⇒ throws the new
    `SyncInProgressError` (callers treat this as a harmless no-op, not a
    real failure). A `syncing` row older than 10 minutes (new
    `syncStartedAt` column) is treated as an abandoned/crashed invocation
    and reclaimed — this is what makes it safe across serverless instances,
    unlike the old per-process Map.
  - **DB-backed progress replaces the in-memory `progress` Map**: new
    `syncProgressPhase`/`syncProgressDone`/`syncProgressTotal` columns on
    `gmailConnections`, written by a `setProgress()` helper. Writes during
    the ingest loop are throttled to every 20 items (or on completion) —
    UI already polls every 1.5s while syncing, so this stays visually
    smooth without one UPDATE per message on a 3000-message initial sync.
    `getSyncProgress()` removed; `/api/gmail/status` now reads progress
    straight off the connection row it already fetches.
  - New migration `drizzle/0002_chubby_ezekiel.sql` adds the 4 columns
    above (`sync_started_at`, `sync_progress_phase`, `sync_progress_done`,
    `sync_progress_total`) — 3 migrations now queued for the first real
    `npx tsx migrate.ts` run (Phase 7).
  - **`waitUntil()` wrapping** (`@vercel/functions`) on both places that
    were fire-and-forgetting `syncUser()`: `POST /api/gmail/sync` (the
    known bug from planning) **and** `GET /api/gmail/callback`'s
    post-OAuth-connect initial sync kickoff (found during this phase — same
    bug, wasn't in the original known-bugs list, same fix). Both routes get
    `export const maxDuration = 300`.
  - **Cron**: `src/app/api/cron/sync/route.ts` — `CRON_SECRET`-protected
    (`Authorization: Bearer` header, 401 otherwise), iterates all
    connections oldest-`lastSyncAt`-first (nulls/never-synced first, via
    `connectionsOldestFirst()`), calls `syncUser()` sequentially, stops
    cleanly at a 250s cutoff (under the 300s function budget) and reports
    `{synced, alreadySyncing, failed, remaining, cutoff}`. `vercel.json`
    added: daily at `30 2 * * *` UTC = 08:00 IST.
  - **`instrumentation-node.ts`** setInterval loop now gated off when
    `process.env.VERCEL` is set (self-host-only; Vercel cron replaces it).
  - **New tests** in `tests/sync.test.ts`: lock semantics — a fresh
    `syncing` row blocks a second `syncUser()` call
    (`SyncInProgressError`); a stale (>10min) `syncing` row is reclaimed
    (call proceeds past the guard); one user's held lock never blocks
    another user's sync. These don't need Gmail API mocking — the guard
    fires (or doesn't) before any Gmail call.
  - **Green gates all pass**: typecheck clean; `npm run test` — 72/72
    (69 + 3 new lock tests); lint clean.

- **Phase 6: complete.** Encryption verification (no code changes needed):
  `src/lib/crypto.ts` `encrypt()`/`decrypt()` use AES-256-GCM correctly —
  random 12-byte IV per call, auth tag stored alongside ciphertext
  (`base64(iv).base64(tag).base64(ciphertext)`), key loaded from
  `ENCRYPTION_KEY` (must be exactly 32 bytes base64 — validated, throws
  otherwise). `gmailFor()` in `src/lib/gmail/client.ts` decrypts
  `accessToken`/`refreshToken` only in-memory, immediately before building
  the OAuth2 client for a Gmail API call; refreshed tokens are re-encrypted
  before the fire-and-forget persist. Meets spec as originally planned —
  confirmed by reading both files in full, not just from memory of earlier
  planning.
  - Trust UI: added an expandable "How is my data protected?" disclosure
    next to the Connect Gmail button in `src/components/settings.tsx`
    (`showTrustInfo` state, no new dependency — this codebase has no
    tooltip/popover component, so it follows the existing inline-disclosure
    pattern already used for the fresh-API-token reveal). Explains
    AES-256-GCM at rest, in-memory-only decryption, read-only scope, and
    that disconnecting removes the token immediately. typecheck/lint clean.
  - **Production secrets set**: `ENCRYPTION_KEY`, `AUTH_SECRET`,
    `CRON_SECRET` generated by the user in their own terminal (piped from
    `node -e "...randomBytes(32).toString(...)"` straight into
    `vercel env add <NAME> production`, never touching shell history, a
    process list, or this chat) — confirmed present via
    `vercel env ls production` (values show as `Encrypted`, not
    readable — exactly as expected; names/timestamps only).

- **Phase 7: complete.** Production is live at
  **https://vyay-five.vercel.app**.
  - `package.json` build script → `tsx migrate.ts && next build`.
  - **All 8 production env vars set**: `ENCRYPTION_KEY`/`AUTH_SECRET`/
    `CRON_SECRET` (Phase 6, user-generated), `GOOGLE_CLIENT_ID` +
    `SYNC_INTERVAL_MINUTES=0` (non-secret, set directly), and
    `GOOGLE_CLIENT_SECRET`/`DATABASE_URL`/`MIGRATE_DATABASE_URL`/`APP_URL`
    (secret-bearing — user set the first three from their own terminal,
    reading straight out of local `.env` and piping into
    `vercel env add <NAME> production` so nothing was retyped or exposed
    in this chat; `APP_URL` was set by the agent after the first deploy
    reported the production URL, since it's a runtime-only, non-secret
    value).
  - **De-risked before deploying**: ran `npx tsx migrate.ts` locally
    against the real Supabase DB first (per the plan's own risk
    mitigation) — succeeded, and a follow-up query confirmed all 8 tables
    exist (`api_tokens`, `categories`, `contacts`, `gmail_connections`,
    `merchant_rules`, `shortcut_events`, `transactions`, `users`).
  - **Found a real deploy-time bug the local run couldn't catch**: the
    first `vercel deploy --prod` failed at the migration step with
    `ENETUNREACH` connecting to
    `db.llciwbpnlmlroromfdoc.supabase.co:5432`. Root cause: Supabase's
    **direct connection** host is IPv6-only, and Vercel's build
    containers have no outbound IPv6 — this only surfaces in Vercel's
    build environment, not a normal dev machine with IPv6 connectivity
    (which is why the local pre-deploy check passed). **Fix**:
    `MIGRATE_DATABASE_URL` must be the **session pooler** connection
    string instead (also port 5432, but reachable over IPv4 through
    Supabase's proxy) — never the transaction pooler (port 6543, breaks
    migrations' need for session-scoped statements) and never the direct
    connection (works locally, fails on Vercel specifically). User updated
    local `.env` and the Vercel env var to the session pooler string;
    verified locally again (idempotent — `already exists, skipping`
    notices, `[migrate] all migrations applied`) before redeploying.
    Documented in `.env.example`, `migrate.ts`'s header comment, and
    README's env var table + Troubleshooting section, so this doesn't
    bite anyone else setting this up.
  - **Redeploy succeeded**: build completed (`next build` compiled, all
    ~30 routes traced as serverless functions), deployment `READY`,
    aliased to `https://vyay-five.vercel.app`.
  - **Smoke-checked**: `/login` returns 200 and renders the Google
    sign-in button; `/api/gmail/status` correctly returns 401 unauthenticated
    (confirms the auth/middleware stack is running end-to-end in
    production).
  - **Git auto-deploy reconnected** (`vercel git connect`) now that a
    manual deploy has succeeded — future pushes to `main` will deploy
    automatically again, as originally intended before it was disconnected
    mid-migration.
  - **README.md fully rewritten** for the new architecture: Postgres
    instead of SQLite throughout, Google-only sign-in (no more
    email+password instructions), a new two-path Deployment section
    (Vercel+Supabase primary, self-host secondary), an expanded env var
    table (`DATABASE_URL`/`MIGRATE_DATABASE_URL`/`CRON_SECRET`, with the
    session-pooler-vs-direct-connection gotcha called out), two new
    Troubleshooting entries (the `ENETUNREACH` gotcha, and Google's 7-day
    test-mode refresh-token expiry), and an updated Privacy & security
    section (multi-tenant isolation language, no more bcrypt/"one SQLite
    file" claims).
  - **`CLAUDE.md` intentionally NOT updated yet** — it's stale in several
    places (describes boot-time auto-migration, the deleted Credentials
    provider, better-sqlite3) but updating it is explicitly a Phase 8 item
    per the plan, not Phase 7. Don't mistake this for an oversight if
    picking up mid-Phase-8.
  - Green gates all pass: typecheck clean; `npm run test` — 72/72; lint
    clean.

## In progress

- Nothing mid-flight. **Production is live and smoke-checked.** Repo fully
  green.

## Next

- **Phase 8 — Handover** (`MIGRATION_PLAN.md` §Phase 8): rewrite
  `CLAUDE.md` for the current architecture (see the stale-points list
  above); write the exact manual Google Cloud Console steps for the user
  (add the two production redirect URIs, add test users, note the 7-day
  test-mode token expiry trade-off — README's Troubleshooting section
  already covers the user-facing version of this, Phase 8 should point
  there rather than duplicate it); write a smoke-test checklist covering
  what a real signed-in user flow needs (Google sign-in as a *second*
  test account, not just the unauthenticated checks already done — Gmail
  connect + consent screen scope display, initial sync populating the
  ledger, tenant isolation between two real accounts, manual "Sync now",
  cron route 401-without-secret/200-with-secret, Excel export, Apple
  Shortcut token + log, contacts import, re-parse).
- **Still outstanding, not blocking**: the stray pre-migration auto-deployment
  mentioned at the very top of this doc (from before any migration work
  started) — worth a quick look in the Vercel dashboard during Phase 8 to
  confirm it's just an old failed/superseded deployment, not something
  needing cleanup.
- **Vercel Git auto-deploy is DISCONNECTED** (`vercel git disconnect`,
  2026-07-09) — every mid-migration push was triggering a doomed production
  build + failure email. **Phase 7 must run `vercel git connect` after the
  first successful manual deploy.**

## Decisions log

| Decision | Choice | Rationale |
| --- | --- | --- |
| Sign-in | Google-only, drop email+password | One identity path; every user needs Google for Gmail anyway; less surface |
| Prod data | Fresh start, no SQLite port | Re-sync from Gmail rebuilds history; local SQLite stays as dev DB |
| DB region | Recreate in ap-south-1 (Mumbai) | User base in India; project was accidentally created in Seoul |
| Timestamps | Keep bigint epoch-ms | Explicit user constraint — do not refactor to native timestamps |
| `initialSyncDone` | Convert to native boolean | User-specified |
| Runtime driver | postgres.js, `max: 1`, `prepare: false` | Serverless requirement; Supavisor transaction pooler breaks prepared statements |
| Test DB | PGlite in-process Postgres | Postgres has no in-memory mode; PGlite runs the same generated pg migration SQL |
| Sync lock/progress | DB columns, not in-memory Maps | Maps don't survive across serverless instances |
| Cron | Once daily, oldest-lastSyncAt-first, ~250s cutoff | Vercel Hobby limit; no user starves; initial syncs happen interactively via waitUntil |

## Known bugs to fix during migration (found in planning)

- `unseenIds()` in `src/lib/gmail/sync.ts` doesn't filter by `userId` —
  cross-tenant dedup bug (Phase 4).
- `POST /api/gmail/sync` fire-and-forgets `syncUser()` — dies on serverless
  without `waitUntil()` (Phase 5).
- `instrumentation-node.ts` setInterval loop must be gated off on Vercel
  (Phase 5).
