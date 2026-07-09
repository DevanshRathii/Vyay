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
  - Green gates all pass: typecheck clean; `npm run test` — 72/72; lint
    clean.

- **Phase 8: complete.** `CLAUDE.md` rewritten for the current
  architecture (Postgres/multi-tenant/Vercel, async DB, Google-only auth,
  DB-backed sync lock/progress, cron). Git auto-deploy reconnected and
  proven working (a routine push auto-deployed successfully).

  **Real production bugs found during first-login testing** (this is
  exactly what the smoke-test checklist is for — these would not have
  surfaced from any of the automated gates):

  1. **BOM corruption in every env var set via a PowerShell-piped
     `vercel env add`.** Windows PowerShell 5.1 prepends a UTF-8 BOM when
     piping a string directly into an external process's stdin — a known
     PS 5.1 quirk. First symptom: Google's OAuth screen showed
     `Error 401: invalid_client` / "The OAuth client was not found" on
     sign-in. Diagnosed by having the user paste the actual failed
     `accounts.google.com` error URL and reading the `client_id` query
     param — it was `%EF%BB%BF877063526258-...` (the BOM, URL-encoded).
     The client ID text itself was correct; an invisible character in
     front of it made it a different string as far as Google's exact-match
     lookup was concerned.
     - **Fix**: re-set every affected var via a `cmd.exe`-piped `echo`
       instead of PowerShell's own pipe (`cmd /c "echo %VAR%| vercel env
       add NAME production"`, with the value staged into a `$env:` var
       first so it's never retyped or exposed) — this sidesteps
       PowerShell's stdin-encoding path entirely. Confirmed the fix by
       inspecting a subsequent OAuth error URL and seeing a clean
       `client_id` with no BOM.
     - **Every var originally set this way needed re-doing**:
       `GOOGLE_CLIENT_ID`, `SYNC_INTERVAL_MINUTES`, `APP_URL` (agent-set,
       re-set by agent after explicit user confirmation — these are
       production-secret-store writes, which the permission system
       correctly gated on user approval even though the agent had set the
       originals); `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`, `AUTH_SECRET`,
       `CRON_SECRET` (user re-set in their own terminal — genuine secrets).
       `ENCRYPTION_KEY`/`AUTH_SECRET`/`CRON_SECRET` were regenerated fresh
       rather than reusing the (possibly corrupted, unverifiable-by-us)
       originals — safe, since nothing in production had been
       encrypted/signed with them yet. `MIGRATE_DATABASE_URL` did NOT need
       redoing — a corrupted connection string would have failed to parse,
       and the migration had already succeeded twice, which is direct
       proof it was clean.
     - **`DATABASE_URL` re-add briefly failed silently** during the fix —
       the `rm` succeeded but a multi-line pasted follow-up didn't
       re-`add` it (almost certainly the interactive CLI swallowing a
       pasted line as if it were answering a prompt). Caught by routinely
       re-running `vercel env ls` after every remediation step, which is
       now a standing practice: **verify by listing names/timestamps after
       any secret-store write, don't assume a command succeeded from its
       absence of an error.** Fixed by having the user re-run the two
       remaining steps one at a time with explicit output checks between
       them, rather than as a pasted block.
  2. **`redirect_uri_mismatch`** — straightforward: the production
     redirect URIs hadn't actually been added to the Google Cloud OAuth
     client yet (Phase 8's own Google Console step, not yet done when
     first login was attempted). Fixed by the user adding both
     `https://vyay-five.vercel.app/api/auth/callback/google` and
     `https://vyay-five.vercel.app/api/gmail/callback` in Google Cloud
     Console → Credentials.
  3. **Real bug, fixed and deployed: large initial Gmail syncs get
     hard-killed mid-flight by Vercel's 300s `maxDuration`, leaving the
     account stuck in `syncStatus: "syncing"` forever (until the 10-min
     staleness window).** Found via direct (user-approved) read-only query
     against `gmail_connections` for the affected account:
     `sync_status: "syncing"`, 18.8 minutes elapsed,
     `sync_progress_done: 440` of `1401`, `sync_error: null` (null because
     the process was hard-killed by the platform, never reached the code
     that would have written a graceful error). `waitUntil()` (added in
     Phase 5) keeps the function alive past the HTTP response returning,
     but does **not** extend `maxDuration` — this is a real gap Phase 5's
     design didn't cover: the cron sweep already had a clean 250s cutoff
     *between users*, but a single user's initial sync had no cutoff
     *within* itself.
     - **Fix**: added a `SYNC_TIME_BUDGET_MS = 250_000` wall-clock budget
       checked inside `fetchAndIngest`'s per-message loop and both
       `fullSync`/`incrementalSync`'s listing loops
       (`src/lib/gmail/sync.ts`). Past the deadline, remaining work is
       skipped (not attempted, not counted as inserted/skipped) rather
       than erroring — this is safe because ingestion is idempotent
       (unique `(userId, gmailMessageId)` index) and `unseenIds()` will
       naturally re-surface anything not yet inserted on the next attempt.
       `fullSync` now only sets `initialSyncDone: true` when genuinely
       complete (not merely hitting the intentional `SYNC_MAX_INITIAL_MESSAGES`
       cap, which still counts as "done" like before — only an actual
       deadline hit keeps it `false`), so a timed-out sync correctly
       retries via `fullSync` again next time rather than switching to
       incremental-only coverage. `syncUser()` computes one deadline up
       front and threads it through. typecheck/test (72/72)/lint all
       green.
     - **Deployed and verified**: pushed, auto-deploy built successfully,
       user clicked "Sync now" again on the stuck account — the stale
       (>10min) lock was reclaimed automatically and the sync resumed
       progressing past 440/1401.
  4. **Apple Shortcut "network connection lost", then several follow-on
     errors — fully resolved, root cause was never a server bug.** Traced
     through multiple layers with the user, in order:
     - The original "network connection lost" was the Shortcut's JSON
       body being **pasted as raw text** instead of built with Shortcuts'
       structured field UI — malformed/mis-encoded raw text can fail to
       leave the Shortcuts networking layer cleanly, surfacing as a vague
       connectivity error rather than an HTTP error. Ruled out DNS/TLS/
       network path first (`vercel logs` showed zero requests ever
       reaching the server for the real attempt; a control GET request to
       the same URL from Safari *did* reach the server with the expected
       405, proving reachability); ruled out WiFi/cellular/iCloud Private
       Relay (user tested all three with no change) before landing on the
       actual cause.
     - Fixed by rebuilding the body with Shortcuts' "Add new field" UI →
       got a real HTTP response, but then `"number must be greater than
       0"`, then `"expected number, received nan"` — both were the
       `amount` field's value not being wired to the right variable/format.
     - Final root cause, found by temporarily adding debug logging
       (`console.log` of the raw request body/content-type in
       `src/app/api/shortcut/log/route.ts`, deployed, inspected via
       `vercel logs --expand`, then fully reverted once diagnosed — never
       committed to git, so no permanent trace in history): the JSON
       field **key names** had typos — `category200`/`amount200` (an
       apparent artifact of how the user was editing the field key text),
       then briefly a single stray `"200"` key — instead of `category`/
       `amount`. Once corrected to the exact expected key names, the
       request succeeded (`200`, real `shortcutEvents` row created).
     - **No code changes were needed or made** to fix this — the debug
       logging was added and removed in the same session, never merged.
       The route's behavior was correct throughout; this was purely a
       client-side Shortcut configuration issue, notable mainly for how
       long it took to diagnose without visual access to the user's
       Shortcut. Worth considering for a future session: the server could
       return a more diagnostic 400 error body (e.g. echoing which keys
       it did receive) to make this class of client misconfiguration
       faster to self-diagnose — not done here, out of scope for the
       migration itself.

  **Phase 8 smoke-test checklist — closed out.**
  - ✅ Google sign-in, Gmail connect (readonly scope), initial sync
    populating the ledger, manual "Sync now" — exercised live during the
    bug-hunting above.
  - ✅ Excel export, contacts `.vcf` import, re-parse, tenant isolation
    between two real signed-in accounts — all confirmed working by the
    user.
  - ⏸ **Cron with the real `CRON_SECRET` — deferred, not blocking.**
    Confirmed via `vercel cron ls` that the job itself is correctly
    registered (`/api/cron/sync` at `30 2 * * *` = 08:00 IST); it simply
    hasn't fired yet as of this session. Will self-verify at the next
    scheduled run (check Vercel dashboard → Cron Jobs → Logs), or the user
    can test manually anytime with
    `curl -H "Authorization: Bearer <CRON_SECRET>" https://vyay-five.vercel.app/api/cron/sync`
    (expect `200` + a JSON summary). The negative case (401 without a
    valid secret) was already verified earlier.
  - ✅ Stray pre-migration deployment — checked via `vercel ls`: it shows
    `Ready` (not `Error`), 16h old, simply superseded by every deployment
    since — confirmed harmless, no cleanup needed. (The handful of
    `Error`-status deployments visible in history are from this session's
    own troubleshooting — ENETUNREACH, BOM env vars — equally harmless
    now that the current deployment is healthy.)

## Migration status: COMPLETE

All 8 phases done, deployed to production at **https://vyay-five.vercel.app**,
and the full smoke-test checklist is closed out (one item — cron with the
real secret — deferred to its natural first scheduled run, not a blocker).
Two real production bugs were found and fixed during live testing that no
amount of automated gates would have caught (the sync `maxDuration` timeout,
and the BOM-in-piped-env-vars issue); one apparent bug (Apple Shortcut) was
fully diagnosed and turned out to require zero code changes.

**Operational lessons worth remembering for any future production work on
this project:**
- Never pipe a value through PowerShell's own pipeline into an external
  process's stdin on Windows (prepends a UTF-8 BOM) — use the `$env:VAR` +
  `cmd /c "echo %VAR%| ..."` pattern instead.
- Always re-run `vercel env ls` after any secret-store write to confirm it
  actually landed — don't trust the absence of a visible error.
- Supabase's **direct connection** host is IPv6-only and unreachable from
  Vercel's build containers — use the **session pooler** for
  `MIGRATE_DATABASE_URL` there.
- `waitUntil()` keeps a serverless function alive past the HTTP response,
  but does **not** extend `maxDuration` — any loop that could plausibly run
  long needs its own internal wall-clock budget check, not just
  `waitUntil()`.

**Deferred to a future session** (explicitly out of scope for right now,
per user instruction): a redesign of contact-based merchant-name matching
to use a confidence score with a review/suggestion step instead of
directly overwriting data, plus possibly improving categorization —
motivated by a real false-positive the user hit in production. Some
exploratory research was done on this but is intentionally not summarized
or acted on here; it'll be picked up fresh in a later session.

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

## Known bugs fixed during migration

- `unseenIds()` in `src/lib/gmail/sync.ts` didn't filter by `userId` —
  cross-tenant dedup bug (fixed Phase 4).
- `POST /api/gmail/sync` and `GET /api/gmail/callback` fire-and-forgot
  `syncUser()` — dies on serverless without `waitUntil()` (fixed Phase 5).
- `instrumentation-node.ts` setInterval loop now gated off on Vercel
  (fixed Phase 5).
- Large initial Gmail syncs got hard-killed mid-flight by Vercel's 300s
  `maxDuration` with no graceful recovery (found + fixed post-deploy,
  Phase 8 — see above).
