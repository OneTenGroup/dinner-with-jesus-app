# Dinner With Jesus — App Store Connect Metadata (ready to enter)

**Date:** 2026-08-04
**Status:** Draft, factual, ready for Steve to paste into App Store Connect. Not yet entered anywhere — I have no browser/API access to App Store Connect, so this document is the deliverable; entering it is a Steve action.
**Source of truth:** Verified app behavior (source code, live production checks) and `docs/DWJ_IOS_APP_STORE_SUBMISSION.md` (2026-07-26). Nothing below is invented — where a fact wasn't verifiable, it's left blank for Steve, not guessed.

---

## App Information

| Field | Value |
|---|---|
| **App name** | Dinner with Jesus |
| **Bundle ID** | `ai.flippingtables.app` |
| **SKU** | *(Steve's choice — any unique internal string, e.g. `DWJIOS001`. Never shown to users, doesn't need to match anything else.)* |
| **Primary language** | English (U.S.) |
| **Category (primary)** | Lifestyle |
| **Category (secondary, optional)** | Education |
| **Copyright** | © 2026 OneTen Group Incorporated |

## Store Listing

**Subtitle** (30 chars max): `One verse. One prayer.` (23 chars)

**Promotional text** (170 chars max, editable without a new build):
> One verse, one conversation, one prayer — every night, for your family. 15 minutes at the table that adds up to something real.

**Description:**
> Dinner with Jesus brings families back to the table — not just to eat, but to talk about what matters.
>
> Every night, one Bible verse lands at your table, with context that makes it real and a question calibrated to where your family is in their faith. Read it together. Talk about it. Pray — the prayer is already written, so nobody has to perform. Then write down what happened, in a personal journal or one you share with your family.
>
> What's inside:
> - **Tonight's Table** — a new verse every night, three levels of discussion questions, and a shared prayer, synced across everyone in your family circle
> - **Family Circles** — create or join a table with an invite code, so everyone in your family sees the same verse and takes their turn in the same prayer rotation
> - **Personal & Family Journals** — save what happened at the table, privately or shared with your family
> - **Need a Moment With God** — a short verse and prayer for however you're feeling right now
> - **Verse for This Moment** — enter any time and find every verse in Scripture that shares that chapter and verse number
> - **Full Bible reader** — World English Bible and King James Version
>
> No ads. No streaks or scoreboards. No subscription required to use the core experience. Just a table, a verse, and fifteen minutes.
>
> Built by a family who lost someone before they were ready, and built this so other families would have more nights like the ones we wish we'd had.

**Keywords** (100 chars max, comma-separated, no spaces after commas):
`bible,family,devotional,prayer,christian,scripture,dinner,faith,verse,journal,couples,parenting`

**Support URL:** `https://www.flippingtables.ai/#how` *(the "How it works" section of the live marketing page — verified live, HTTP 200. A dedicated support page doesn't currently exist; if Apple requires a distinct support-specific URL, use the Marketing URL below or `mailto:info@onetengroup.ai` as the support contact instead.)*

**Marketing URL:** `https://www.flippingtables.ai/` *(verified live, HTTP 200)*

**Privacy Policy URL:** `https://www.flippingtables.ai/privacy-policy` *(verified live, HTTP 200)*

**Terms of Service URL:** `https://www.flippingtables.ai/terms-of-service` *(verified live, HTTP 200 — for App Store Connect's EULA field if a custom EULA is desired; otherwise Apple's standard EULA applies by default and this field can be left blank)*

## Version Information

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Build** | 1 *(will increment automatically if a resubmission is required)* |
| **What's New in This Version** | *(Steve's call — for a first release, App Store Connect typically doesn't require this field; if it does, something like "The first release of Dinner with Jesus for iPhone." is factual and sufficient.)* |

## Pricing and Availability

- **Price:** Free (Tier 0)
- **Availability:** *(Steve's call — worldwide vs. specific territories. No technical reason to restrict; the app has no region-gated content.)*

## Age Rating Questionnaire — recommended answers

Based on actual app content (source-reviewed, not guessed) — re-verify against the exact current questionnaire wording at submission time, since Apple periodically changes the question set:

| Question | Answer | Why |
|---|---|---|
| Violence (cartoon, fantasy, realistic) | None | No such content anywhere in the app |
| Sexual content or nudity | None | — |
| Profanity or crude humor | None | — |
| Alcohol, tobacco, or drug use/references | None | — |
| Mature/suggestive themes | None | — |
| Horror/fear themes | None | The "feelings" check-in (fear, anxiety, etc.) is a self-reflection/devotional prompt, not depicted horror content |
| Gambling and contests | None | — |
| Medical/treatment information | None | — |
| Unrestricted web access | No | External links open via in-app Safari View Controller, not an unrestricted browser |
| User-generated content | Yes, but closed | Family journal entries are visible only within a closed, invite-code-gated family group — not open/public UGC |
| **Expected result** | **4+** | Provisional — final confirmation requires walking the live questionnaire in App Store Connect, which needs Steve's login |

## App Privacy Disclosures (Privacy Nutrition Label)

Based on the actual schema, not guessed:

| Data type | Collected? | Linked to identity? | Used for tracking? |
|---|---|---|---|
| Contact Info (email address) | Yes | Yes | No |
| User Content (journal entries) | Yes | Yes | No |
| Identifiers (user ID) | Yes | Yes | No |
| Usage Data (in-app analytics events) | Yes | Yes | No |
| Health & Fitness, Location, Financial Info, Contacts, Browsing History, Search History, Sensitive Info | No | — | — |

**"Used for tracking" is No across the board** — the app's analytics are first-party product-usage telemetry only (no ad network SDK, no cross-app/cross-site identifiers, no IDFA usage anywhere in the codebase). Confirm this matches Apple's current definition of "tracking" at submission time.

## App Review Information

**Sign-in required:** Yes (email/password via Supabase Auth; no third-party login, so no Sign in with Apple requirement applies)

**Demo account for reviewers:** *(Steve action — do not give Apple a real family's account.)* Recommend creating one dedicated, monitored account (e.g. `appreview@onetengroup.ai`), signing up normally through the app, creating a small family circle named something obviously a test fixture (e.g. "App Review Test Table"), and completing one full prayer rotation plus saving one journal entry — so reviewers see a populated app on first login rather than an empty first-run state. Enter that email/password directly into App Store Connect's review-notes credential fields, never in this document or in git.

**Review notes (draft, factual):**
> Dinner with Jesus is a family devotional app: one shared Bible verse, guided conversation questions, and a rotating prayer turn, once per day, for an invited family group. This iOS build loads the same production web app used on Android (same backend, same account system) inside a native Capacitor shell — native splash screen, status bar, and safe-area handling; external links open in-app via Safari View Controller rather than leaving the app.
>
> Account deletion: Settings → scroll to bottom → "Delete my account" → type DELETE to confirm. This is immediate and self-service, verified end-to-end against production with disposable test accounts (solo-owner and multi-member paths both confirmed working).
>
> No camera, location, or microphone access is requested or used anywhere in the app.

**Account-deletion instructions for the review notes field:** Settings → "Delete my account" (bottom of screen) → type `DELETE` to confirm → immediate, in-app, self-service. No email request or manual turnaround. (This exact flow was independently built, applied to production, and verified with two live end-to-end tests during this project's technical audit — see `DWJ_PRE_APPLE_RELEASE_AUDIT.md`.)

**Contact information for App Review:** *(Steve action — first name, last name, phone number, and email of the person Apple can reach if reviewers have questions. Not something I can supply.)*

---

## Fields left for Steve (personal, legal, or judgment-dependent — not filled in above)

- SKU (any unique string, no functional impact)
- Availability territories
- "What's New" text style preference, if App Store Connect requires it for a first version
- Reviewer contact name/phone/email
- Demo account creation itself (needs a real, monitored inbox only Steve can set up)
- Final confirmation of the age-rating questionnaire and privacy label against the live App Store Connect UI (this document is a verified-accurate starting point, not a substitute for walking the actual form)
- Export compliance / encryption declaration (standard "uses only standard OS-provided HTTPS encryption, no proprietary crypto" answer applies here, but this is a legal attestation only Steve/the account holder should make)
