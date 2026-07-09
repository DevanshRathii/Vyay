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

- **Phase 6 (in progress).** Encryption verification (no code changes
  needed): `src/lib/crypto.ts` `encrypt()`/`decrypt()` use AES-256-GCM
  correctly — random 12-byte IV per call, auth tag stored alongside
  ciphertext (`base64(iv).base64(tag).base64(ciphertext)`), key loaded from
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
  - **Outstanding — user action in progress**: generate + set NEW
    production `ENCRYPTION_KEY`, `AUTH_SECRET`, `CRON_SECRET` via
    `vercel env add <NAME> production`, values piped from
    `node -e "console.log(require('crypto').randomBytes(32).toString('base64'|'hex'))"`
    so they never appear in shell history, a process list, or this chat
    (same protocol as the Supabase DB password). User confirmed they'd run
    these themselves in their own terminal, not via the `!` in-session
    prefix. **Confirm these are set (`vercel env ls`, or just proceed to
    Phase 7 which will need them) before the first production deploy.**

## In progress

- Phase 6 mostly done — see above. Waiting on user confirmation that the 3
  production secrets have been set on Vercel before treating Phase 6 as
  fully closed and moving to Phase 7.

## Next

- Confirm the 3 prod secrets landed, then **Phase 7 — Deployment**
  (`MIGRATION_PLAN.md` §Phase 7): `package.json` build script →
  `tsx migrate.ts && next build`; set remaining Vercel envs
  (`DATABASE_URL`, `MIGRATE_DATABASE_URL`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `APP_URL`, `SYNC_INTERVAL_MINUTES=0` — the DB
  connection strings contain the DB password, so those two also go through
  the user via `!`/their own terminal, not me); `vercel deploy --prod`;
  reconnect Git auto-deploy (`vercel git connect`) only after that first
  manual deploy succeeds; update README.
- User-side prerequisite: `DATABASE_URL` + `MIGRATE_DATABASE_URL` in local
  `.env` — **done**, both set as of a previous session. Migrations have
  NOT yet been run against the real Supabase DB (`npx tsx migrate.ts`) —
  still fine to defer to Phase 7 per the plan's risk mitigation, but THREE
  migrations (`0000_...`, `0001_...`, `0002_...`) are now queued up for
  that first run.
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
