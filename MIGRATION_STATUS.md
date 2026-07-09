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

## In progress

- Nothing mid-flight, but **the repo does not typecheck** until Phase 3
  batches land (expected, tracked, next up).

## Next

- **Phase 3 — async conversion** (`MIGRATION_PLAN.md` §Phase 3), batches:
  A core lib (categorize, match, ingest, contacts/*, reparse) →
  B gmail path (sync, client, gmail routes) →
  C remaining API routes →
  D auth.ts + seed.ts.
  Gate per batch: shrinking `\.(get|all|run)\(\)` grep count; final gate:
  typecheck + vitest + lint all green, then commit per batch.

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
