# Setting up Vyay's SMS & Apple Wallet capture

This is the step-by-step build guide for the automations described in Settings → "SMS & Apple Wallet". Do this once; it never needs to be repeated unless Apple changes the Shortcuts app UI significantly.

**Before you start:** create an API token in Vyay (Settings → API tokens → Create) and copy it somewhere you can paste from — you'll need it in Part 1, step 6.

**Scope reminder:** this only catches SMS and Apple Pay activity from the moment you finish setup onward. iOS has no API for any app to read message history, so this can never backfill past transactions — use "Import bank statement" in Settings for that.

---

## Part 1 — Build the shared action shortcut ("Vyay: Log Transaction")

You build this **once**. Every automation in Part 2 and Part 3 just calls it.

1. Open the **Shortcuts** app.
2. Tap **+** in the top-right corner to start a new shortcut.
3. Tap the shortcut's name at the top of the editor (it starts as "New Shortcut") and rename it to **Vyay: Log Transaction**. Exact name doesn't matter, but note it — you'll pick it by name in Part 2/3.
4. Tap the search field at the bottom ("Search for apps and actions") and type **Get Contents of URL**. Tap the action to add it to the shortcut.
5. Configure the action's fields:
   - Tap the **URL** field and type: `https://vyay-five.vercel.app/api/ingest` (replace the domain if you're self-hosting).
   - Tap **Method** — if you don't see it, tap **Show More** to expand advanced options first — and set it to **POST**.
   - Under **Headers**, tap **Add new header**. Set the key to `Authorization`. For the value, type `Bearer ` (with a trailing space) — then you need to insert a variable right after it (see step 6).
6. **This is the important part — setting up the one-time token entry:**
   - Tap directly into the Authorization header's *value* field, right after the `Bearer ` you typed.
   - Above the keyboard, Shortcuts shows a row of variable/magic-variable suggestions. Look for **Ask Each Time** (it may be under a "..." or variable-picker icon depending on your iOS version — tap into the field and look for it in the suggestions bar, or tap the small icon that looks like a variable/puzzle-piece at the left of the keyboard bar). Tap it.
   - The header value should now read as `Bearer ` followed by a purple **Ask Each Time** pill.
   - **Do not use a literal "Ask for Input" action for this.** That action prompts every single time the shortcut runs — meaning you'd get a popup asking for your token on every bank SMS. "Ask Each Time" on this one field, combined with the import-question conversion in step 10, is what makes it a one-time entry instead.
7. Still in the same action, find **Request Body** (may also be under "Show More"). Set it to **JSON**.
8. For the JSON body content, insert the **Shortcut Input** magic variable as the whole body (not a hand-built dictionary) — the automations in Part 2/3 will hand this shortcut a ready-made dictionary, and this action just forwards it untouched to Vyay.
9. Test it once: tap the **Play (▶)** button at the bottom of the editor. It'll prompt "Bearer" — since there's no real input yet this test run will likely fail or return an error from the server, and that's fine; you're just confirming the action runs without a crash. You can skip this if you'd rather test after Part 2.
10. **Share it as an import-question-enabled link:**
    - Tap the **Share** icon (top-right, looks like a box with an arrow) or the "..." menu → **Share**.
    - Choose **Copy iCloud Link**.
    - Before finalizing, Shortcuts should show a screen listing the "Ask Each Time" values found in the shortcut (here, just the Authorization header) and let you turn each into an **import question** — a prompt shown once to whoever imports the link. Set the question text to something like **"Enter your Vyay API token"**.
    - Confirm and copy the link.
11. **Send that link to Devansh** (or whoever manages your Vyay deployment) — it gets set as `NEXT_PUBLIC_VYAY_SHORTCUT_URL`, which lights up the "Add to Shortcuts" button in Settings for every future user.

You (and everyone who taps that link) will see the "Enter your Vyay API token" prompt exactly once, at import time. After that, the imported copy has the token baked in permanently — it's never asked again, even across app updates, until you personally edit that action.

---

## Part 2 — SMS automations (two of them)

iOS's "Message Contains" condition can't OR multiple keywords within one automation, so you need two separate automations — one for debit wording, one for credit wording.

**Automation A — debit:**
1. Open **Shortcuts** → **Automation** tab (bottom) → **+** (top-right) → **Create Personal Automation**.
2. Scroll to and tap **Message**.
3. Under **Message Contains**, type `debited`. Leave Sender blank (see note below).
4. Tap **Next**.
5. Tap **Add Action**, search for **Dictionary**, add it.
6. Build the dictionary with these three keys (tap "Add new item" for each):
   - `type` → text value `sms`
   - `body` → tap the value field, insert the **Shortcut Input** magic variable (this is the message text)
   - `timestamp` → tap the value field, insert **Current Date** magic variable
7. Add one more action: search **Run Shortcut**, add it. Tap "Shortcut" and pick **Vyay: Log Transaction** from your library.
8. Tap the Run Shortcut action's **Input** field and set it to the **Dictionary** you just built (the output of the Dictionary action above).
9. Tap **Next**, then toggle **Run Immediately** (not "Ask Before Running"), and turn off **Notify When Run**.
10. Save.

**Automation B — credit:** repeat steps 1–10 exactly, except set **Message Contains** to `credited` in step 3.

**Why Sender is left blank:** the iOS "Message Contains" automation trigger can't reliably match DLT alphanumeric sender IDs (like `VM-HDFCBK`) the way it matches saved contacts, so filtering by sender isn't dependable here. This means OTPs, promotional texts, and reminders will also reach the shared shortcut — that's expected and handled: Vyay's classifier rejects those server-side and always replies success, so you'll never see an error notification for a rejected message.

---

## Part 3 — Apple Wallet automation (one, fully automatic)

1. **Shortcuts** → **Automation** → **+** → **Create Personal Automation**.
2. Scroll to the **Wallet** section, tap **Transaction**.
3. Leave the card and merchant/category filters empty — this catches every Apple Pay payment regardless of card or store. (You can narrow this later if you only want specific cards tracked.)
4. Tap **Next**.
5. Add a **Dictionary** action with these keys:
   - `type` → text value `wallet`
   - `merchant` → insert the **Merchant** magic variable (available from the Transaction trigger)
   - `amount` → insert the **Amount** magic variable
   - `card` → insert the **Card** magic variable
   - `timestamp` → insert **Current Date**
6. Add **Run Shortcut** → pick **Vyay: Log Transaction** → set its Input to the Dictionary above.
7. Tap **Next**, toggle **Run Immediately**, turn off **Notify When Run**.
8. Save.

---

## Troubleshooting

- **Nothing shows up in Vyay after a bank SMS arrives.** Automations are silent by design (no notification). Check Ledger after a minute — if it's still missing, open Shortcuts → the automation → tap it manually once with a sample message to see if it errors.
- **The Authorization header didn't offer "Ask Each Time."** Some iOS versions hide this behind a long-press on the field, or a small "..." icon on the right edge of the text field rather than a bar above the keyboard. It's always reachable from that exact field — look for anything resembling a variable/magic-variable picker.
- **You need to change your token later** (e.g. after revoking and recreating one in Settings): open the "Vyay: Log Transaction" shortcut, tap the Authorization header's value, and retype it — the "Ask Each Time" pill can be replaced with a literal value if you'd rather hardcode it directly instead of re-triggering the import-question flow.
- **You want to verify the request actually reached Vyay**: temporarily add a **Show Result** action after Run Shortcut in any automation while testing, then remove it once confirmed (keeping it permanently would show a popup on every real bank SMS, which defeats the "silent" setup).
