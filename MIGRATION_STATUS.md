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

## In progress

- Nothing mid-flight. Repo is green: 68/68 vitest, typecheck + lint clean,
  still fully on SQLite (no conversion code written yet).

## Next

- **Phase 1 — Supabase re-provisioning** (`MIGRATION_PLAN.md` §Phase 1):
  1. USER ACTION: create new project in `ap-south-1` (password stays with
     user, never through agent):
     `supabase projects create vyay-prod --org-id qwjneuxpugfinxqliktl --db-password <generated> --region ap-south-1 --size nano`
  2. USER CONFIRMATION REQUIRED, then agent deletes the Seoul project
     (`kknoqdkxyvdjvyfgeenu`) via `supabase projects delete`.
  3. Agent: `supabase link --project-ref <new-ref>`.
  4. USER ACTION: put pooled (port 6543) + direct (port 5432) connection
     strings into `.env.local` as `DATABASE_URL` / `MIGRATE_DATABASE_URL`.
- Then Phase 2 (schema/driver/test harness) per plan.

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
