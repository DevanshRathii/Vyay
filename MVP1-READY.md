# Vyay — MVP1 readiness

Verification pass on `main` @ `261de2d`, 2026-07-10. All 7 steps from `ENHANCEMENT_PLAN.md` §8 are merged.

## Verification results

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| `npm run lint` | Clean |
| `npm run test` | **87/87 passing** (9 files) |
| `npm run build` | Succeeds — migrations applied idempotently (all already-applied, correctly skipped), `next build` compiles all 34 routes. `/demo`, `/privacy`, `/terms` correctly prerender as static (○); everything auth-gated is dynamic (ƒ), as expected. |

No schema drift, no uncommitted changes, working tree clean.

## Cross-check against ENHANCEMENT_PLAN.md §1–§7

Every recommendation below was checked against the code directly (grep/read), not recalled from memory.

**§1 Merchant extraction & confidence** — shipped in full: `merchantSource`/`merchantConfidence` threaded through `parseEmail()` (`engine.ts`), persisted via `resolveMerchant()` (`src/lib/merchant.ts`, shared by ingest + reparse so the two paths can't drift), all four extraction fixes (stop-word truncation, case-sensitive VPA bare-name, `stripDisplaySuffixes()`, tests), `KNOWN_MERCHANTS` alias map (45 entries, plan asked for ~40), low-confidence marker + filter in the Ledger (row/mobile-card/edit-dialog), 5 missing bank providers added (Yes Bank, PNB, Bank of Baroda, Canara, Union Bank — 21 providers total now).

**§2 Categorization rule quality** — shipped in full: `BRAND_RULES`/`GENERIC_RULES` split, word-boundary regex (longest-pattern-first), generic tier excludes the subject (kills the `cred`-class bug structurally), `category_source` column + dashed "auto" badge, `hotel → Travel` and the added `healthcare` generic keyword (needed for the plan's own "Metropolis Healthcare" example to actually resolve correctly), 5/5 named regression tests present and passing.

**§3 Mobile responsiveness** — all 6 fixes shipped: `ActionMenu` component (Gmail card button row), token-row truncation, Dialog safe-area padding (`env(safe-area-inset-bottom)`), `MatchesDot` `sr-only` label, ledger mobile-card keyboard access + chevron, dashboard compact-INR + `BarChart` `minTickGap`. Matches list needed no fix (plan confirmed no break there); verified still true.

**§4 First-sync speed** — all 4 items shipped: client auto-continue (`AUTO_CONTINUE_LIMIT = 6` + resume link), `CONCURRENCY` 4→10, `amazonpay` `queryDomains` narrowed to `payments@amazon.in`/`.com`, provider-selection picker at connect time (`selected_providers` column, state-encoded through the OAuth round-trip).

**§5 Guided tour** — shipped: public `/demo` route, `DemoShell` (real components + static `demo-data.ts` + scoped `window.fetch` override for reads/mutation-toasts), `AppShell` extended with optional demo props (byte-identical when omitted), 6-step `driver.js` tour, entry points on both the login card and README, Contacts hidden.

**§6 Footer** — shipped in both locations (`AppShell`, login card).

**§7 Punch list** — items 1, 2, 3, 5, 6 shipped in step 1/2; item 4 (rate limit + category cap) and item 7 (contrast audit) shipped in the post-MVP1 pass; item 8's sub-items resolved as the plan intended (EditDialog fixed, Gmail batch API and the two "just noting" items correctly left alone — see below).

## Judgment calls made during implementation (worth knowing about)

- **Provider picker default state**: the plan's decision text ("banks listed first, wallets pre-checked") was ambiguous against the separately-stated "default all on skip" requirement. I resolved this by pre-checking **all** providers (banks and wallets) by default — the only reading that makes "skip = all" literally true. If the intent was "banks unchecked by default, wallets checked," that's a one-line change in `settings.tsx`'s `useState<Set<string>>` initializer.
- **`cred` → `cred club` rename**: implemented exactly as decided, but worth flagging a tradeoff I noticed while building it — a real CRED-app UPI id like `9876543210@cred` won't contain the literal substring "club", so this rename slightly *reduces* recall for genuine CRED transactions versus keeping the bare word `cred` (which word-boundary matching alone would have made safe against the `credit`/`credited` false-positive anyway). Implemented as explicitly instructed twice; flagging for awareness, not proposing to revert it unilaterally.
- **`apollo`/`indigo` brand-name collisions** (Apollo Tyres, Indigo Paints) remain uncorrected by design — word-boundary matching fixes pure-substring bugs (`ola` inside `Gola`) but not two-unrelated-companies-share-a-word collisions, and the plan's approved recommendation only named `cred` for renaming. Not a regression from before; just not fixed.
- **Demo tour step-transition fix unverified live**: I found and patched a real bug (driver.js's own step-cleanup racing my page-switch logic) via code inspection, but the interactive browser verification was cut short before I could confirm the fix works end-to-end in a live session. This is the one piece of step 6 that needs a manual click-through before you'd call `/demo` fully trustworthy.

## Post-MVP1 (explicitly deferred, not forgotten)

- Full Gmail batch-request API — plan explicitly rated "not recommended now" (savings marginal given the concurrency fix already shipped).
- `MatchesDot`'s 60s poll per mount — plan noted this as harmless (SWR dedupes) and left it.
- `rangeToMs()`'s client-timezone "This month" bucket vs. the app's strict-IST convention elsewhere — plan judged this acceptable for an India-targeted app; left as-is.
- Contrast audit was scoped to `text-muted`; other color pairs (disabled-state opacity, chart colors, icon-only contrast) weren't in scope and haven't been checked.

## Before this goes fully live — action items only Devansh can close out

1. **Click through `/demo` once** to confirm the tour's page-transition fix actually works (see caveat above).
2. **Confirm Vercel preview deploys build cleanly now** — every one of the 7 steps this session went straight to `main` without a working preview to check against, on your instruction that the failure was an env-var scoping issue you'd already fixed. Worth a final confirmation now that the branch is idle.
3. **Point Google's OAuth consent screen at `/privacy`** (and `/terms` if required) now that they exist — this was the original MVP1-blocking reason `/privacy` was built.
4. **Read the privacy/terms copy once** before it's live-linked from Google's consent screen — template-based wording was approved for MVP1 with this one review step still expected of you.
