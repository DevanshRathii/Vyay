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

## In progress

- Nothing mid-flight. Repo is fully green.

## Next

- **Phase 5 — Serverless sync correctness + cron** (`MIGRATION_PLAN.md`
  §Phase 5): wrap `syncUser()` in `waitUntil()` for
  `POST /api/gmail/sync`; replace the in-memory `locks`/`progress` Maps in
  `sync.ts` with DB-column-based state (atomic `UPDATE ... WHERE
  sync_status != 'syncing' RETURNING id` guard + persisted progress
  columns — needs a new migration); gate `instrumentation-node.ts`'s
  `setInterval` loop off when `process.env.VERCEL` is set; add the cron
  route (`src/app/api/cron/sync/route.ts`, `CRON_SECRET`-protected,
  oldest-`lastSyncAt`-first, ~250s cutoff) and `vercel.json`.
- User-side prerequisite: `DATABASE_URL` + `MIGRATE_DATABASE_URL` in local
  `.env` — **done**, both set as of the previous session. Migrations have
  NOT yet been run against the real Supabase DB (`npx tsx migrate.ts`) —
  still fine to defer to Phase 7 per the plan's risk mitigation, but two
  migrations (`0000_...`, `0001_...`) are now queued up for that first run.
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
