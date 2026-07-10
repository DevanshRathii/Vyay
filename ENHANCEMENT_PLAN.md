# Vyay — Enhancement Plan (MVP1 pass)

Planning date: 2026-07-10. Every claim below was verified against the code as of commit `76b308f`.
File references are `path:line` into the current tree.

---

## 1. Merchant extraction & confidence scoring

### Current state

A merchant name is derived in exactly five places, tried in this order:

1. **Bank narration parse** — `fromNarration()` ([src/lib/parsing/engine.ts:202-210](src/lib/parsing/engine.ts#L202)) handles `"UPI/DR/453212345678/SWIGGY LIMITED/YESB/swiggy@ybl/Payment"`-style strings; the merchant is whatever sits in the second slash-delimited field.
2. **VPA-anchored beneficiary** — `extractVpaBeneficiary()` ([engine.ts:229-253](src/lib/parsing/engine.ts#L229)) looks immediately before/after the already-resolved UPI id: `"towards VPA meenakshi1669@okaxis (MEENAKSHI RATHI)"` → `MEENAKSHI RATHI`; `"Sender: TANYA RATHI (VPA: tanya1999rathi@okaxis)"` → `TANYA RATHI` (both are real fixtures in [tests/parsers.test.ts:29-56](tests/parsers.test.ts#L29)).
3. **Generic patterns** — six regexes in `MERCHANT_PATTERNS` ([engine.ts:212-219](src/lib/parsing/engine.ts#L212)): `Info:/Remarks:/Narration:` free-text capture, `at MERCHANT`, `paid/sent to MERCHANT`, `transferred to`, `received from`, `towards`. Captures pass through `cleanMerchant()` ([engine.ts:176-196](src/lib/parsing/engine.ts#L176)), which strips salutation prefixes, aggregator codes (`"CAS*Swiggy"` → `"Swiggy"` — real HDFC fixture, [tests/parsers.test.ts:58-71](tests/parsers.test.ts#L58)), rejects all-digit/phone-number captures, and truncates at 60 chars.
4. **UPI-id fallback** — `parseEmail()` line [engine.ts:354](src/lib/parsing/engine.ts#L354): `merchant = extractMerchant(...) ?? upiId` — when nothing else matches, the raw VPA becomes the merchant.
5. **Contact override** — [src/lib/ingest.ts:63-64](src/lib/ingest.ts#L63): a saved contact matched by name/VPA replaces whatever the parser produced ("golden source").

After that, `normalizeMerchant()` ([src/lib/parsing/normalize.ts:8-22](src/lib/parsing/normalize.ts#L8)) produces the *separate* `merchantNormalized` column: lowercases, keeps VPA local-parts (`swiggy@ybl` → `swiggy`), strips `NOISE_WORDS` (`pvt|ltd|india|payments|technologies|…`, [normalize.ts:5-6](src/lib/parsing/normalize.ts#L5)) and trailing store numbers (`dmart 4421` → `dmart`). **Only categorization and analytics use it — the Ledger displays the raw `merchant`** ([src/components/ledger.tsx:173](src/components/ledger.tsx#L173)).

A confidence score **already exists**: [engine.ts:360-366](src/lib/parsing/engine.ts#L360) starts at 0.4 and adds flat bonuses (+0.25 known provider, +0.12 *any* merchant present, +0.1 reference, +0.05 channel, +0.05 parsed date), persisted to `transactions.confidence` ([src/lib/db/schema.ts:101](src/lib/db/schema.ts#L101)) and shown only inside the edit dialog ([ledger.tsx:346](src/components/ledger.tsx#L346)). It measures overall parse quality, not *how the merchant was derived* — a mangled `Remarks:` capture and an exact VPA-beneficiary name both earn the same +0.12.

Providers ([src/lib/parsing/providers.ts:8-121](src/lib/parsing/providers.ts#L8)) contribute **no merchant logic at all** — only `senders`/`queryDomains`/`channelHint`. There are 16 providers; despite the README's "17+", **Yes Bank, PNB, Bank of Baroda, Canara Bank and Union Bank have no entry**, so their alerts are never even listed by the sync query.

### Gaps (demonstrated)

1. **Raw corporate suffixes reach the UI.** The GPay fixture `"You paid ₹189.00 to Uber India Systems using Google Pay"` ([tests/parsers.test.ts:131-142](tests/parsers.test.ts#L131)) stores `merchant = "Uber India Systems"` — pattern 3 stops at "using", and nothing strips " India Systems" from the *display* value (only `merchantNormalized` gets the NOISE_WORDS strip). The ledger shows "Uber India Systems", capitalize-styled.
2. **`Info:/Remarks:` free-text capture is a junk funnel.** [engine.ts:213](src/lib/parsing/engine.ts#L213) captures up to 60 chars of *anything* after the label. `"Remarks: NEFT Ref N182260012345678"` → merchant `"NEFT Ref N182260012345678"` (contains letters, so `cleanMerchant`'s digit guards don't reject it). This is the "reference number as merchant" failure mode.
3. **Stop-word replacement doesn't truncate — it excises.** [engine.ts:266](src/lib/parsing/engine.ts#L266) replaces only the *matched stop token* (`" on"`, `" at"`, …) with `""` rather than cutting the string there: `"DECATHLON ON ANNA SALAI"` becomes `"DECATHLON ANNA SALAI"`, not `"DECATHLON"`. Merchants whose legal names contain stop words also get chopped: `"Food On Track"` (IRCTC's real e-catering brand) loses its middle.
4. **The bare-name VPA branch is case-blind.** [engine.ts:235-238](src/lib/parsing/engine.ts#L235) intends "a bare **capitalised** name" (`[A-Z][\w\s.&-]{2,40}?`) but the whole regex is compiled with the `"i"` flag, so the capital-letter anchor matches anything — lowercase boilerplate following a VPA can be captured as the beneficiary.
5. **VPA fallback is presented as a name.** When extraction fails, `merchant` = `"q674835160@ybl"`-style autogenerated PhonePe/Paytm QR VPAs. Accurate but unreadable, and today indistinguishable in the UI from a confidently extracted name.
6. **No coverage for 5 major PSU banks** (Yes Bank, PNB, BoB, Canara, Union) — nothing to extract *from* because sync never fetches their mail. Fixing extraction quality per-provider requires fixtures that don't exist yet for these.

### Options considered

- **A. Derivation-source confidence (heuristic, parse-time).** Tag each merchant with *how* it was found and map source → score. Zero new runtime cost, deterministic, testable with existing fixtures. Doesn't itself fix bad extractions — it makes them visible.
- **B. Known-alias dictionary.** A curated `alias → canonical name` table (seedable from `BUILTIN_RULES` patterns), exact/prefix match on the normalized merchant = high confidence + clean display name ("Uber India Systems" → "Uber"). Fixes display quality *and* feeds confidence, but is a maintenance list that will always trail the long tail (P2P names, kirana stores).
- **C. LLM/embedding-based extraction.** Highest ceiling, but adds latency + cost per email inside a serverless sync loop that is already time-budgeted (§4), non-deterministic, and unnecessary for the dominant failure modes which are structural. Rejected for MVP1.

### Recommendation

Do **A + a thin slice of B**, plus the four safe extraction fixes:

1. In `parseEmail()`, thread a `merchantSource` out of the extraction chain: `"contact" | "narration" | "vpa-name" | "pattern" | "info-freetext" | "upi-id" | null`. (Split pattern 1 of `MERCHANT_PATTERNS` into its own `"info-freetext"` source; contact assignment happens in `ingestEmail`.) Map to `merchantConfidence`: contact 1.0, narration 0.9, vpa-name 0.85, pattern 0.7, info-freetext 0.45, upi-id 0.6, none 0.
2. New columns on `transactions`: `merchant_source text`, `merchant_confidence double precision`. Persist at parse time only — never recomputed on read. Backfill via the **existing** re-parse endpoint ([src/app/api/transactions/reparse/route.ts](src/app/api/transactions/reparse/route.ts)), which replays `raw`.
3. UI: in the Ledger rows and edit dialog, render a small dot/`⚠` marker when `merchantConfidence < 0.6` with tooltip "Merchant name is a guess — tap to verify"; add a "Low-confidence merchant" filter to the filter bar. Don't silently guess: for `info-freetext` captures that fail a sanity check (≥4 words, or mixed digit-letter tokens), **prefer the UPI VPA fallback** — a real VPA beats a mangled remark.
4. Extraction fixes: (a) make the stop-word replace at [engine.ts:266](src/lib/parsing/engine.ts#L266) cut the string at the match index instead of excising the token; (b) drop the `"i"` flag from the bare-capitalised-name branch; (c) apply a display-side suffix strip (`Pvt Ltd`, `Limited`, `India`, `Systems`, `Technologies` — reuse `NOISE_WORDS` but title-cased, on `merchant` at insert time when source is `pattern`/`narration`); (d) add fixture-backed tests for each in `tests/parsers.test.ts`.
5. Thin alias slice: a `KNOWN_MERCHANTS: Record<string,string>` map (~40 entries derived from `BUILTIN_RULES` patterns) checked against `merchantNormalized`; a hit sets display name and bumps `merchantConfidence` to 0.95.

### Effort: **M**

Schema: one migration (2 columns, nullable, no data rewrite — backfill via reparse is user-triggered). Combine with §2's `category_source` column in a **single** migration.

### Decisions (Devansh, 2026-07-10)

- Inline marker + filter is enough for MVP1 — no bulk-review surface.
- Add the 5 missing bank provider entries (~10 lines each) **now**; add fixtures as real redacted emails arrive.

---

## 2. Categorization rule quality

### Current state

`categorize()` ([src/lib/categorize.ts:174-199](src/lib/categorize.ts#L174)) builds one lowercase haystack — `merchantNormalized | merchant | upiId | subject` joined ([categorize.ts:178-181](src/lib/categorize.ts#L178)) — then does raw `String.includes()` first over user `merchantRules`, then over ~90 `BUILTIN_RULES` in array order ([categorize.ts:30-144](src/lib/categorize.ts#L30)). First hit wins; one rule (`amazon`) has an `exclude` escape hatch. Examples of current entries: `{ pattern: "pizza hut", category: "Food" }`, `{ pattern: "blinkit", category: "Groceries" }`, `{ pattern: "cred", category: "Bills" }`. A handful of generic keywords already exist — `electricity`, `broadband`, `pharmacy`, `petrol`, `insurance`, `mutual fund`, `metro`, `fastag` — but the list is overwhelmingly brand-only.

### Gaps (demonstrated)

1. **Confirmed: the "pizza" gap.** `"La Pinoz Pizza"` / `"Oven Story Pizza"` / `"Mojo Pizza"` contain no brand entry (`pizza hut` requires the full phrase) → uncategorized. Same failure mode across categories, none of these match anything today: `"Manipal Hospital"`, `"Third Wave Coffee"`, `"Theobroma Bakery"`, `"Anytime Fitness"`, `"Lakme Salon"`, `"Treebo Hotel"`, `"VLCC"`, `"Sharma Chai Wala"` (a literal seed-data merchant, [src/lib/db/seed.ts:49](src/lib/db/seed.ts#L49), seeded as uncategorized).
2. **Live false positive — `"cred"` matches "credit".** Because the haystack includes the *subject*, any transaction whose subject contains "Credit Card" or "credited" and whose merchant matches no earlier rule falls through to [categorize.ts:110](src/lib/categorize.ts#L110) `{ pattern: "cred", category: "Bills" }`. The real ICICI fixture subject `"Transaction alert for your ICICI Bank Credit Card"` ([tests/parsers.test.ts:93](tests/parsers.test.ts#L93)) contains `cred` — an unknown-merchant purchase on that card is categorized **Bills**. This is not hypothetical; it's the default path for every unrecognized credit-card merchant.
3. **Substring false positives without word boundaries.** `"ola"` ([categorize.ts:68](src/lib/categorize.ts#L68)) is inside `"Gola Sizzlers"`, `"Kolar"`, `"granola"` → Transport. `"metro"` is inside `"Metropolis Healthcare"` (major Indian diagnostics chain) → Transport instead of Healthcare. `"indigo"` is inside `"Indigo Paints"` → Travel. `"apollo"` is inside `"Apollo Tyres"` → Healthcare. `"jio"` inside `"jiomart"` happens to be saved only by array order (Groceries at line 48 precedes Utilities at line 100).
4. **No confidence signal.** A user rule, an exact brand hit, and a lucky substring all produce an identical silent `categoryId`.

### Options considered

- **A. Layered rules + word-boundary matching + scoped haystacks.** Split into `BRAND_RULES` (current list, cleaned) and `GENERIC_RULES` (new keyword tier). Match with precompiled `\b`-anchored regexes. Generic tier matches **merchant/UPI fields only, never the subject** (kills the `cred`-class bugs structurally). Deterministic, no schema change for the matching itself.
- **B. Weighted scoring across all matching rules** (longest/most-specific match wins by score). More "correct" on paper, but harder to explain to a user editing rules, and first-match-in-tier with longest-pattern-first sort inside each tier achieves the same outcomes for realistic collisions at far lower complexity.
- **C. Token-set matching on `merchantNormalized` only.** Cleanest theoretically, but drops legitimate subject-based catches (e.g. GPay subjects like "You paid ₹189.00 to Uber" where body extraction failed) that the brand tier currently benefits from.

### Recommendation

**A**, precisely:

1. Restructure `BUILTIN_RULES` into `BRAND_RULES` (existing entries; fix `"cred"` → `"cred club"`; keep the `amazon`/`amazonpay` exclude) and `GENERIC_RULES` (new). Resolution order: **user rules → brand → generic**; inside each tier, sort patterns longest-first once at module load. A string matching both a generic keyword and a *different* brand rule resolves to the brand (higher tier), which is the desired "pizza hut ≠ generic pizza place" behavior.
2. Compile each pattern to `new RegExp("\\b" + escaped + "\\b")` (space-collapsed variant kept for VPA local-parts, mirroring the existing `haystackNoSpace` trick at [categorize.ts:185](src/lib/categorize.ts#L185)). Brand tier keeps the full haystack (incl. subject); **generic tier matches only `merchantNormalized | merchant | upiId`**.
3. Proposed `GENERIC_RULES` (Indian-market, word-boundary): **Food** — pizza, biryani, cafe, coffee, restaurant, dhaba, kitchen, bakery, sweets, chai, juice, eatery, tiffin, dosa, idli, momos, shawarma; **Groceries** — kirana, mart, supermarket, grocery, provision, fresh; **Transport** — cab, taxi, parking, toll, rickshaw; **Fuel** — fuel, petroleum, filling station; **Healthcare** — hospital, clinic, diagnostic, lab, medical, chemist, dental, physio, gym, fitness, yoga; **Travel** — airlines, resort, travels, tours, lodge; **Utilities** — recharge, dth, gas, water bill; **Education** — school, college, academy, institute, coaching, tuition, classes; **Insurance** — premium, policy; **Investment** — sip, securities, broking, demat; **Rent** — rent; **Entertainment** — cinema, movies, gaming, club. (`hotel` → **Travel**, per Devansh — lodging is the majority case; a "Hotel X" restaurant miscategorized as Travel is one user rule away from fixed.)
4. Confidence: add `category_source text` (`"user" | "brand" | "generic"`, null = uncategorized) to `transactions`, set at ingest/reparse. UI: generic-sourced rows show their category `Badge` with a subtle "auto" affordance (dashed ring or `~` prefix) so users know to verify; ledger gains a "Auto-categorized (generic)" filter. Rides in the same migration as §1's columns.
5. Regression tests in `tests/` for: the `cred`/credit-card case, `Gola Sizzlers`, `Metropolis Healthcare`, `La Pinoz Pizza`, `jiomart`-vs-`jio` ordering independence.

### Effort: **M** (shares one migration with §1; backfill via existing reparse)

### Decisions (Devansh, 2026-07-10)

- `hotel` → **Travel** in GENERIC_RULES (lodging is the common case; restaurants named "Hotel …" are correctable with a user rule).
- Generic-tier assignments count **identically** in analytics for MVP1 — no dashboard distinction, only the ledger's "auto" affordance.

---

## 3. Mobile responsiveness audit

### Current state

Breakpoints in use: `AppShell` switches sidebar↔bottom-tabs at `sm:` (640 px, [src/components/nav.tsx:61,108](src/components/nav.tsx#L61)); the Ledger switches table↔cards at `md:` (768 px, [ledger.tsx:151,240](src/components/ledger.tsx#L151)); the dashboard grids use `lg:` ([dashboard.tsx:152,169,215](src/components/dashboard.tsx#L152)). So they're per-file choices, not a shared system — between 640–768 px you get the desktop sidebar with the *mobile* card list, which is coherent but accidental. All buttons are `whitespace-nowrap` ([src/components/ui.tsx:11](src/components/ui.tsx#L11)) — they never shrink, only overflow.

### Findings (broken state → cause → fix)

1. **Settings / Gmail card — the reported overflow.** With Gmail connected, four buttons render in one row: *Sync now / Full resync / Re-parse / Disconnect* ([settings.tsx:178-197](src/components/settings.tsx#L178)) inside `<div className="flex gap-1.5">` — **no `flex-wrap`**, every child `whitespace-nowrap`. Combined width ≈ 360 px; available at 375 px screen minus `px-4` main padding and `px-5` card padding ≈ 295 px → the row punches out of the card, and the card gets a horizontal scrollbar or clipped buttons. **Fix:** `flex-wrap gap-1.5` as the one-line stopgap; proper fix is *Sync now* + *Disconnect* visible, *Full resync* / *Re-parse* demoted into a small "⋯" overflow menu (they're rare, destructive-ish operations anyway).
2. **Settings / token rows.** [settings.tsx:281-290](src/components/settings.tsx#L281): `flex items-center justify-between` where the left span (`KeyRound` icon + label + "last used …") has **no `min-w-0`/`truncate`** — a 60-char label (allowed by `maxLength={60}`, line 275) pushes the revoke button off-card. **Fix:** `min-w-0` + `truncate` on the label span.
3. **Dialog bottom sheet vs. home indicator.** `Dialog` renders as a bottom sheet on phones (`items-end`, [ui.tsx:175](src/components/ui.tsx#L175)) with `p-5` but **no `env(safe-area-inset-bottom)`** — on notched iPhones the bottom action row (e.g. the ledger edit dialog's Delete/Save, [ledger.tsx:363-376](src/components/ledger.tsx#L363)) sits under the home indicator. Scrollability is fine (`max-h-[85dvh] overflow-y-auto`, [ui.tsx:181](src/components/ui.tsx#L181)) and backdrop tap-to-close is reachable (sheet ≤85dvh leaves the top exposed). **Fix:** `pb-[calc(1.25rem+env(safe-area-inset-bottom))]` on the sheet on `<sm`.
4. **Bottom tab bar.** Six tabs at 375 px = 62 px each — labels (`text-[10px]`) fit, tap targets are ~62×52 px (≥44 px ✓). Content clearance is fine (`main` has `pb-24` = 96 px vs. nav ≈ 54 px + safe-area, [nav.tsx:104](src/components/nav.tsx#L104)). `MatchesDot` ([nav.tsx:48-52](src/components/nav.tsx#L48)) is a 2 px-offset 8 px dot — visible but purely decorative with **no accessible name**; add `sr-only` text ("pending matches"). No breakage here otherwise.
5. **Ledger mobile cards.** The whole `Card` is a clickable `div` (`onClick={() => setEditing(t)}`, [ledger.tsx:247](src/components/ledger.tsx#L247)) — works by touch, but there's no visible edit/delete affordance at all on mobile (discoverability) and no keyboard/screen-reader access (no `role`, no `tabIndex`). **Fix:** `role="button" tabIndex={0}` + `onKeyDown` Enter/Space, and a subtle chevron on the card. The filter bar wraps acceptably (`flex-wrap`, [ledger.tsx:120](src/components/ledger.tsx#L120)); at 375 px it stacks into 3 rows — usable, no fix needed.
6. **Dashboard at 375 px.** Stat cards are `grid-cols-2` ([dashboard.tsx:152](src/components/dashboard.tsx#L152)); a value like `₹1,23,456.78` inside a ~150 px cell silently `truncate`s ([dashboard.tsx:85](src/components/dashboard.tsx#L85)) — the user sees `₹1,23,4…`. **Fix:** `formatINR(v, {compact:true})` below `sm` (helper already supports it, [src/lib/utils.ts:11-19](src/lib/utils.ts#L11)). The monthly `BarChart`'s XAxis has **no `minTickGap`** ([dashboard.tsx:200](src/components/dashboard.tsx#L200)) while the daily AreaChart sets `minTickGap={24}` ([dashboard.tsx:182](src/components/dashboard.tsx#L182)) — 12 month labels in ~340 px collide. **Fix:** add the same `minTickGap`. Recharts containers themselves are responsive (`ResponsiveContainer width="100%"`).
7. **Matches list.** Header row is `flex-wrap` ([matches-list.tsx:81](src/components/matches-list.tsx#L81)) and candidate rows have proper `min-w-0`/`truncate` — no break found at 375 px. No fix.

### Options considered

- **A. Targeted fixes per finding above** (wrap/menu/safe-area/minTickGap/compact-INR). Small diffs, no visual redesign, directly kills the reported bug.
- **B. Systematize first**: shared breakpoint tokens, a `ButtonGroup` component with built-in overflow-to-menu behavior, then migrate. Better long-term, but a component-library detour for a 6-page app with exactly one systemic offender (button rows).

### Recommendation

**A now**, with one small piece of B: extract a tiny `ActionMenu` ("⋯" dropdown) since both the Gmail card and (future) ledger rows want it. Verify each fix in the browser at 375×667 (`preview_resize` mobile preset) and with `prefers-color-scheme: dark`.

### Effort: **S–M** (no schema)

### Open questions

- None blocking; ship at will.

---

## 4. First-sync speed and the 300 s Vercel ceiling

### Current state

`syncUser()` ([src/lib/gmail/sync.ts:271-324](src/lib/gmail/sync.ts#L271)) runs under a 250 s budget (`SYNC_TIME_BUDGET_MS`, [sync.ts:34](src/lib/gmail/sync.ts#L34)). `fullSync()` ([sync.ts:139-188](src/lib/gmail/sync.ts#L139)) lists ids with `buildQuery()` = `senderQuery()` (16 provider domains OR-ed, [providers.ts:128-131](src/lib/parsing/providers.ts#L128)) + `after:1-Jan-2026` (or `SYNC_LOOKBACK_MONTHS`/`EXTRA_GMAIL_QUERY`), caps at `SYNC_MAX_INITIAL_MESSAGES` (default 3000, [sync.ts:151](src/lib/gmail/sync.ts#L151)), then `fetchAndIngest()` pulls **`format: "full"` for every unseen id** ([sync.ts:128](src/lib/gmail/sync.ts#L128)) at `CONCURRENCY = 4` ([sync.ts:54](src/lib/gmail/sync.ts#L54)). On budget expiry it exits cleanly, leaves `initialSyncDone=false` ([sync.ts:175-185](src/lib/gmail/sync.ts#L175)), and the settings card tells the user to click *Sync now* again ([settings.tsx:202-205](src/components/settings.tsx#L202)) — hence the 4–5 manual clicks.

**Hypothesis check (metadata pre-filter): partially refuted.** `incrementalSync()` does pre-filter with `format: "metadata"` + `looksRelevant()` ([sync.ts:232-249](src/lib/gmail/sync.ts#L232)) — but that exists because the *history API* returns every new message regardless of sender. `fullSync`'s listing is **already sender-scoped**, and `looksRelevant()` short-circuits `true` whenever `matchProvider(from)` hits ([providers.ts:134-137](src/lib/parsing/providers.ts#L134)) — which is *every* message a full sync lists. Porting the existing pre-filter to `fullSync` would therefore filter **zero** messages. A *subject-based* pre-filter could skip non-transactional provider mail, but each metadata call is itself an API round-trip, so it only pays when a large share of listed mail is rejectable — which leads to the real finding:

**The `amazon.in` query domain is a candidate-pool poison.** The `amazonpay` provider's `queryDomains: ["amazon.in"]` ([providers.ts:115-120](src/lib/parsing/providers.ts#L115)) pulls **every Amazon order/shipping/marketing email of the whole lookback window** into the full-fetch set, only for `classifyEmail()` to reject them one by one after a 5-quota-unit full fetch each. For a regular Amazon shopper this is easily hundreds of wasted fetches — plausibly the single largest chunk of a slow first sync. Similar but smaller: `cred.club`, `paytm.com` promos (though those at least come from the actual payment sender).

**Concurrency is very conservative.** Gmail's per-user quota is 250 units/s; `messages.get` costs 5 units → ~50 req/s sustained is allowed. At `CONCURRENCY=4` with ~250–400 ms per get + 3–4 sequential DB round-trips per ingested message (insert, duplicate-check select+update, shortcut select — [src/lib/ingest.ts:74-111](src/lib/ingest.ts#L74)), throughput is roughly 8–12 msg/s; 3000 messages ≈ 250–375 s — i.e. exactly "doesn't finish in one invocation". Retry/backoff for 429s already exists (`withRetry`, [sync.ts:57-74](src/lib/gmail/sync.ts#L57)).

### Options considered (ranked: est. speedup ÷ complexity)

1. **Client auto-continue** — settings page already polls `/api/gmail/status` every 1.5 s while syncing ([settings.tsx:68](src/components/settings.tsx#L68)); when it observes `syncStatus === "idle" && !initialSyncDone`, POST `/api/gmail/sync` again (bounded, e.g. ≤6 auto-continues, with the existing progress bar running). Turns "5 clicks" into "1 click, watch the bar". Reuses the lock (`SyncInProgressError` already treated as no-op) and crash-recovery design untouched. **Speedup: eliminates the UX problem outright. Complexity: S (one `useEffect`).**
2. **Raise `CONCURRENCY` 4 → 10** for Gmail fetches. ~2–2.5× wall-clock on the fetch-bound phase, still ≤20% of the API quota; backoff already handles 429s. Watch Supabase connection pressure (postgres.js pool) — keep ingest DB writes as-is. **Speedup: high. Complexity: S.**
3. **Fix the `amazon.in` candidate pool**: change the `amazonpay` provider's query domain to the actual payments sender(s) (e.g. `from:(payments@amazon.in)` / order-update excludes), keeping the broad `senders` regex for *tagging*. `queryDomains` and `senders` are already separate fields, so this is a data-only change. **Speedup: large for Amazon-heavy inboxes, zero risk elsewhere. Complexity: S.**
4. **Provider selection at onboarding (Devansh's idea)**: multi-select of the registry, stored as `selected_providers text` (JSON array of provider ids, `null` = all) on `gmailConnections`; `buildQuery()` filters `senderQuery()` accordingly; `EXTRA_GMAIL_QUERY` continues to append afterward (unchanged semantics — it's a global env-var addition, [sync.ts:89-90](src/lib/gmail/sync.ts#L89)). Must be **skippable, defaulting to all**. Placement: the OAuth callback currently fires the initial sync immediately via `waitUntil` ([src/app/api/gmail/callback/route.ts:63-67](src/app/api/gmail/callback/route.ts#L63)) — the picker therefore belongs **before** connect (on the settings Gmail card, pre-OAuth) or the callback's auto-kickoff must move behind the picker. Pre-OAuth is simpler: select → connect → callback reads the stored selection. **Speedup: moderate (only helps multi-bank promo-heavy inboxes; listing is already domain-scoped). Complexity: M (schema + UI + query change). Also feeds §5's onboarding narrative.**
5. **Not recommended now**: Gmail batch HTTP endpoint (not exposed by `@googleapis/gmail`; hand-rolled multipart — M/L complexity for ~1 RTT saved per message that option 2 already amortizes); subject-level metadata pre-filter in fullSync (pays only in the Amazon case, which option 3 kills at the listing stage instead); shrinking `SYNC_MAX_INITIAL_MESSAGES`/lookback (data loss, not speed); server-side self-chaining invocations (fights the platform; the cron + auto-continue already cover it).

### Recommendation

Ship **1 + 2 + 3 together** (all S, independent, no schema) — that alone should take a 3000-message initial sync from ~4–5 invocations to ~1–2 with zero extra clicks. Then **4** as a follow-up in the same release train as §5, since the picker UI doubles as the onboarding step. Verify with a fresh full resync on a real inbox, watching `syncProgressDone/Total` rates before/after.

### Effort: **S** (items 1–3), **M** (item 4; one migration: `selected_providers` on `gmail_connections`)

### Decisions (Devansh, 2026-07-10)

- Auto-continue hard-stops after **N=6** continuations, then shows a message with a manual "resume" button.
- Provider picker shows **all providers, banks listed first, wallets (GPay/PhonePe/Paytm/Amazon Pay) pre-checked**.

---

## 5. Guided tour / demo mode before login

### Current state

`/login` ([src/app/login/page.tsx](src/app/login/page.tsx), [src/components/auth-forms.tsx:39-57](src/components/auth-forms.tsx#L39)) offers exactly one action: *Continue with Google*. Middleware protects only the five page routes ([src/middleware.ts:15-17](src/middleware.ts#L15)); `(app)/layout.tsx` re-checks and redirects. The seed script creates `demo@vyay.app` with ~90 transactions ([src/lib/db/seed.ts](src/lib/db/seed.ts)) but its own header admits the constraint: **auth is Google-only, so nobody but the owner of that Google address can ever log into it** — it is not a public demo path, and the plan must not pretend otherwise.

### Options considered

- **A. Client-only mock walkthrough (`/demo`).** A public route rendering the *real* components (`Dashboard`, `Ledger`, `MatchesList`, the settings cards) inside an `SWRConfig` with `fallback` data and a no-network fetcher, plus a `driver.js` overlay tour ending in a Google CTA. All reads come from a static `demo-data.ts` module generated once from the seed script's `MERCHANTS` table ([seed.ts:28-51](src/lib/db/seed.ts#L28)); mutations are intercepted by a demo flag (a context that swaps `fetch` for a toast: "Sign in to make changes"). Pros: zero auth surface, zero backend, works offline, no data-leak class of bug is even possible. Cons: mutation flows are simulated, the static dataset can drift from new features (mitigated by *deriving* it from the same seed table), and components fetch via absolute API paths so a thin demo-mode provider is needed.
- **B. Live read-only demo session.** Mint a real session JWT for the seeded demo user via a `/api/demo` route (bypassing Google), guard every mutating route with `if (userId === DEMO_USER_ID) return 403`, and re-seed on a cron. Pros: provably the real product. Cons: carves a second identity path through an intentionally Google-only Auth.js setup ([src/auth.ts](src/auth.ts) pins `token.uid` in the `jwt` callback — a forged-session bug here is an account-takeover class issue); every *future* mutating route must remember the demo guard (a standing tenant-isolation-style invariant, the exact class of bug CLAUDE.md warns about); shared demo state gets vandalized between visitors without per-visitor sandboxing, which escalates to per-session data forks. Materially more to build and to keep safe.
- (Static screenshots/video was considered and dismissed — proves nothing, drifts worst.)

### Recommendation

**A.** Concretely:

1. Route `src/app/demo/page.tsx` (public — matcher untouched, it only lists the five app pages). A `DemoShell` renders the existing `AppShell` chrome with a client-side "page" switcher (no real navigation, so tour state survives), wrapped in `<SWRConfig value={{ fallback, fetcher: demoFetcher }}>` where `demoFetcher` serves `/api/analytics`, `/api/transactions`, `/api/categories`, `/api/matches`, `/api/gmail/status`, `/api/tokens` from `src/lib/demo-data.ts`. A persistent banner: "Demo with sample data — nothing is saved."
2. Tour library: **driver.js** (MIT, ~5 kB gzip, no React dependency, works by CSS selector — fits the existing plain-component setup better than shepherd.js which drags in floating-ui and its own styling opinions).
3. Step sequence: ① Overview — stat cards + "where the money went"; ② Ledger — search box, category select on a row, the edit dialog; ③ Categories — built-in + custom rules; ④ Matches — a pre-seeded pending shortcut event with 2 candidates, explain the Apple Shortcut pairing; ⑤ Settings — Gmail connect card (disconnected state), export, tokens; ⑥ final modal: "Ready to see your own money? → **Continue with Google**" (`signIn("google")`).
4. Entry: a secondary "Take a 2-minute tour" ghost button on the login card under the Google button ([auth-forms.tsx:45-54](src/components/auth-forms.tsx#L45)). Exit: driver.js's built-in ✕/Esc on every step plus the banner's "Exit demo" → `/login`; completing step ⑥ also lands on `/login`.
5. Keep it honest: the demo Contacts tab is hidden (not in the requested tour and its import flow can't be simulated meaningfully).

### Effort: **M** (no schema; one new dependency; the main cost is `demo-data.ts` and the no-network provider)

### Decisions (Devansh, 2026-07-10)

- Tour copy: written during implementation, **simple and straightforward** — plain descriptions of what each screen does, no marketing voice. No separate approval round needed.
- `/demo` is linked from **both** the login page and the production README.

---

## 6. Footer attribution

### Current state

There is no footer anywhere: `AppShell` renders sidebar + `<main>` + bottom tabs ([src/components/nav.tsx:55-131](src/components/nav.tsx#L55)); the login screen is a centered card ([auth-forms.tsx:20-37](src/components/auth-forms.tsx#L20)); the root layout is bare ([src/app/layout.tsx:24-32](src/app/layout.tsx#L24)).

### Recommendation (options are trivial here; the placement decision is the content)

Add it in exactly two places:

1. **Inside `<main>` at the end of `AppShell`** ([nav.tsx:104](src/components/nav.tsx#L104)): `<footer className="mt-10 pb-2 text-center text-[11px] text-muted/70">Created by Devansh Rathi</footer>`. Because it's *inside* `main` (which already carries `pb-24` clearance for the fixed bottom tab bar), it scrolls with content and can never collide with the tab bar or the safe-area inset — putting it in the fixed nav itself would either crowd the 6 tabs or sit under the home indicator, so don't.
2. **Login page**: same line under the `Card` in `AuthCard` ([auth-forms.tsx:33](src/components/auth-forms.tsx#L33)) — this also covers `/demo` if §5 reuses `AppShell`.

Not per-page, not in the sidebar (desktop sidebar bottom already holds account + theme toggle; adding a third row crowds it at short viewport heights).

### Effort: **S** (two files, no schema)

### Decisions (Devansh, 2026-07-10)

- **Plain text**, no link.

---

## 7. Final MVP1 punch list

Verified findings, ordered by severity:

1. **No privacy policy or terms of service exist** — `grep -ri "privacy|terms" src/` returns nothing. Google's OAuth consent screen for the **restricted** `gmail.readonly` scope requires a live privacy-policy URL, and app verification (plus, past 100 users, a CASA security assessment) hinges on it. If the consent screen currently points at a URL on vyay-five.vercel.app, it 404s (no `not-found.tsx` either — see next). **Fix (MVP1-blocking):** static `/privacy` and `/terms` pages (public; middleware matcher already excludes them), content covering: Gmail read-only scope usage, AES-256-GCM token storage, what's stored from emails (`transactions.raw` keeps subject/snippet/2000-char body — say so), deletion via disconnect. **S.**
2. **No `error.tsx`, `not-found.tsx`, `global-error.tsx`, or `loading.tsx` anywhere in `src/app`** (globbed). A thrown server error or bad URL surfaces Next's unstyled defaults. **Fix:** root `not-found.tsx` + `(app)/error.tsx` in app styling; `loading.tsx` optional (pages are client-rendered with their own spinners — `Dashboard`/`MatchesList` already handle loading, [dashboard.tsx:115-121](src/components/dashboard.tsx#L115)). **S.**
3. **Seed data category drift (real bug):** `seed.ts` assigns categories `"Food & Dining"`, `"Health"`, `"Bills & Utilities"` ([seed.ts:29-47](src/lib/db/seed.ts#L29)) but `DEFAULT_CATEGORIES` defines `"Food"`, `"Healthcare"`, `"Bills"`, `"Utilities"` ([categorize.ts:6-24](src/lib/categorize.ts#L6)) — `catId()` returns `null` for all of them, so most seeded transactions are silently uncategorized and the demo dashboard's "By category" panel is nearly empty. Matters doubly because §5 derives its demo dataset from this table. **Fix:** align the names. **S.**
4. **`/api/shortcut/log` — confirmed no rate limiting** ([src/app/api/shortcut/log/route.ts:28-93](src/app/api/shortcut/log/route.ts#L28)), and a valid token **auto-creates a category for any unseen name** ([route.ts:54-56](src/app/api/shortcut/log/route.ts#L54)) — a runaway Shortcut loop (or leaked token) can create unbounded categories and shortcut events. Assessment: token guessing is infeasible (SHA-256-hashed random tokens) and blast radius is the owner's own account, so **per-user rate limiting is not MVP1-blocking**; but the category auto-create deserves a cheap cap (e.g. reject when the user already has ≥100 categories) — that's a two-line guard. Full rate limiting (per-token counter on `shortcutEvents.createdAt`, no new infra) → **post-MVP1 note.**
5. **Dialog focus management** ([ui.tsx:149-196](src/components/ui.tsx#L149)): Escape ✓, `aria-modal` ✓, but no focus trap, no initial focus, no focus restore on close — keyboard/AT users tab behind the sheet. Icon-only buttons across the app *do* carry `aria-label`s (Edit/Delete/Restore/Revoke/Close/theme — checked). **Fix:** minimal trap (focus first focusable on open, wrap Tab, restore on close) in the one shared `Dialog`. **S/M.** Ledger mobile-card keyboard access is covered in §3.5.
6. **Meta/SEO basics:** root metadata has title/description/manifest ([layout.tsx:5-12](src/app/layout.tsx#L5)) but no OpenGraph/Twitter card, no `robots` config. Login and `/demo` are the only public pages worth indexing. **Fix:** `openGraph` + a simple OG image, `robots` allowing `/login`+`/demo` only. **S.**
7. **Color contrast** — `text-muted` values in both themes need a one-time check with devtools' contrast audit, especially `text-muted` on `bg-card-2` chips ([ui.tsx:121-124](src/components/ui.tsx#L121)); flagging as a verification task, not a known failure.
8. **Post-MVP1 notes** (found, judged out of scope): 5 missing bank providers (§1); Gmail batch API (§4); `EditDialog`'s set-state-during-render pattern ([ledger.tsx:329-333](src/components/ledger.tsx#L329)) — works but fragile under React 19 strictness; `MatchesDot` fires a `/api/matches` poll every 60 s per mount (SWR dedupes the two mounts — fine, just noting); analytics `rangeToMs` uses server-local `new Date(now.getFullYear(), now.getMonth(), 1)` for "This month" ([dashboard.tsx:57-61](src/components/dashboard.tsx#L57)) — it runs client-side so it's the *user's* timezone, acceptable for an IST-target app, but inconsistent with the strict-IST convention elsewhere.

### Effort: **S** overall for the MVP1-blocking subset (items 1–3, 5, 6); no schema.

### Decisions (Devansh, 2026-07-10)

- Template-based privacy/ToS wording approved for MVP1 — write it during implementation, no separate review round required before linking it from the Google consent screen.

---

## 8. Suggested implementation order

| # | Work | Why this position | Effort |
|---|------|-------------------|--------|
| 1 | §7.1–7.3 + 7.6: privacy/terms pages, error/404 pages, seed-name fix, meta tags | Privacy policy gates Google OAuth verification, which has external lead time — start the clock first. Seed fix is a prerequisite for the demo dataset (§5). All S, zero risk. | S |
| 2 | §3 mobile fixes + §6 footer | Same files (`nav.tsx`, `settings.tsx`, `ui.tsx`), user-visible pain, no schema. Footer rides along in `nav.tsx`. Includes §7.5 dialog focus trap (same `ui.tsx`). | S–M |
| 3 | §4 items 1–3: client auto-continue, CONCURRENCY 4→10, amazon.in query fix | Biggest UX win per line of code; no schema; independent of everything else. Fixes the "5 clicks" complaint outright. | S |
| 4 | §1 + §2 together: layered categorization rules, `cred` fix, merchant source/confidence, category source | **One shared migration** (`merchant_source`, `merchant_confidence`, `category_source` on `transactions`), one shared backfill path (existing reparse endpoint), overlapping tests. The `cred` bug fix can be cherry-picked into step 2 if a hotfix is wanted sooner. | M–L |
| 5 | §4 item 4: provider selection (schema: `selected_providers` on `gmail_connections`) | After step 3 proves the speed baseline; its picker UI is designed alongside step 6's onboarding narrative so they feel like one flow. | M |
| 6 | §5 demo tour (`/demo`, driver.js, demo-data.ts) | Last because it showcases the UI — build it after steps 2/4 so the tour demonstrates the fixed mobile layout and confidence indicators, and after step 1 so demo data (derived from the corrected seed table) categorizes properly. | M–L |
| 7 | Post-MVP1 backlog: shortcut rate limiting, 5 new bank providers, contrast audit fixes | Explicitly deferred, tracked, not silently dropped. | — |

Dependencies encoded above: seed-name fix (1) → demo dataset (6); provider-picker schema (5) is *not* required by the tour (6) — the tour shows the connect card in its disconnected state either way; migration consolidation makes (§1, §2) one step.

---

## 9. Execution notes

All open questions above are resolved (see the per-section "Decisions" blocks, 2026-07-10). This document is self-contained: an implementation session should be able to execute any step from its section alone plus CLAUDE.md.

**Executor:** implementation is to be done with **Claude Sonnet**, one step of §8 per session/branch, in table order. Each session: read CLAUDE.md + the relevant section(s) of this file, implement, run `npm run typecheck && npm run lint && npm run test`, verify visually where applicable (mobile fixes at 375×667, both themes), then commit.

**Cloud workflow (repo → GitHub → Vercel):** the local clone at this directory *is* the working copy — no directory change needed; `origin` is `github.com/DevanshRathii/Vyay`, and Vercel deploys from it. Per step:

1. Branch off `main` (`feat/<step-name>`), never commit work-in-progress to `main` — pushing `main` deploys to production.
2. Push the branch → Vercel builds a **preview deployment**; note that `npm run build` runs `tsx migrate.ts` first, so **a schema-changing branch's preview build will run its migration against the database `MIGRATE_DATABASE_URL` points to**. The two migrations in this plan (steps 4 and 5) are additive nullable columns — safe to apply ahead of the code that uses them — but merge schema branches promptly and don't let two unmerged migration branches coexist (drizzle migration files are ordered).
3. Verify on the preview URL, then merge to `main` for the production deploy.
4. `MIGRATE_DATABASE_URL` rules (session pooler on Vercel, never the transaction pooler or direct host) are already documented in CLAUDE.md/README — no change needed.
