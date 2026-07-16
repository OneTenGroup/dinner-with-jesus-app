# Dinner with Jesus — Product, Content, UX & Church-Partner Strategy
**Date:** 2026-07-16
**Branch:** `fix/dwj-shared-table-sync` (read-only investigation — no code changed)
**Purpose:** One authoritative description of the app as it exists today, for Steve and ChatGPT to build one focused launch plan from.
**Method:** Full repository inventory via direct code inspection (this document's author read/traced every page component, route, and data path) plus a prepared, not-yet-run set of read-only production content-count queries (Section 3 — pending Steve).

**Mission, stated plainly so it anchors every recommendation below:** Honor Maddie. Spread God's Word. Bring families together around One Verse, One Conversation, One Prayer.

---

## 1. Exact Product Inventory

### Navigation model (read this first — it shapes every feature below)

The app is **not** route-based for its core experience. `App.jsx` holds `activeTab` in local state and simultaneously mounts all five main screens (Home, Story, Table, Journal, Settings), toggling `display: block/none` — no URL changes, no back-button semantics, no deep links into a specific tab (`src/App.jsx:72, 209-266`). Only two things are real routes: `/table/:inviteCode` → the unauthenticated guest view, and a password-recovery hash → `ResetPasswordScreen`. `vercel.json` handles `/`, `/privacy-policy`, `/terms-of-service`, `/delete-account` at the hosting layer as static files.

**Taps from cold open to seeing tonight's verse (returning user, group already set up):** 1 tap if today's Kendyl scene was already dismissed earlier that day, 2 taps on the day's first open (dismiss Kendyl, then "Let's Get Started").

### Feature-by-feature inventory

| Feature | Route/Component | Auth | Data source | Status | Priority |
|---|---|---|---|---|---|
| Landing page | `public/landing.html` | none | static | Working | Launch-critical |
| Onboarding | `OnboardingPage.jsx` | required | `onboarding`, `profiles`, `groups`, `get_or_create_tonight_session` | Working | Launch-critical |
| Auth (signup/login/reset) | `AuthPage.jsx`, `App.jsx` `ResetPasswordScreen` | n/a | Supabase Auth | Working | Launch-critical |
| Home — greeting | `HomePage.jsx:7-25` | required | local pool, no DB | Working | Secondary |
| Home — Tonight's Table | `HomePage.jsx:337-355` | required | `get_my_group_members`, `get_or_create_tonight_session` | Working | Launch-critical |
| Home — Verse for This Moment (manual) | `HomePage.jsx:357-408` | required | `bible_verses` | Working | Secondary |
| Home — Verse for This Moment (live clock) | `HomePage.jsx:190-208` | required | `bible_verses` | **Dead code — defined, never wired to UI** | n/a |
| Home — Need a Moment With God | `HomePage.jsx:410-423` | required | `feeling_verses` | Working | Secondary |
| Home — conversations counter | `App.jsx:132-145` | required | `verse_history` (per-user, not group) | Working, mislabeled | Secondary |
| Home — Bible reader overlay | `BiblePage.jsx` via `HomePage.jsx:292` | required | `bible_verses` | Working | Secondary |
| Table — full dinner flow | `TablePage.jsx` | required | `get_or_create_tonight_session`, `complete_prayer_turn`, `verse_history`, `notes` | Working (repaired this engagement) | Launch-critical |
| Journal — personal | `JournalPage.jsx` | required | `notes` (`family_id is null`) | Working | Launch-critical |
| Journal — family table | `JournalPage.jsx` | required | `notes` (`family_id = group.id`) | Working, read/delete only (adds happen from Table) | Launch-critical |
| Settings — account | `SettingsPage.jsx` | required | `profiles`, Supabase Auth | Working | Launch-critical |
| Settings — dinner circle | `SettingsPage.jsx` | required | `useFamily.js` RPCs, `groups.timezone` | Working | Launch-critical |
| Settings — Faith Journey | `SettingsPage.jsx:522-539` | required | `profiles.faith_level` | Working, **copy is stale** (see §5) | Secondary |
| Settings — Bible Translation picker | `SettingsPage.jsx:541-551` | required | `profiles.preferred_translation` | **Decorative — written, read by nothing** | Secondary |
| Settings — Admin Dashboard entry | `SettingsPage.jsx` | admin only | `is_admin()` RPC | Working | Administrative |
| Settings — account deletion link | `SettingsPage.jsx:604-608` | required | links to static page | Working, email-request only | Launch-critical (compliance) |
| Guest table | `GuestTablePage.jsx` | **none** | `get_guest_table_by_invite_code` | Working (repaired this engagement) | Launch-critical |
| Story / Our Story / Maddie | `StoryPage.jsx` | required | static content | Working | Launch-critical (mission) |
| Bible reader (full) | `BiblePage.jsx` | required | `bible_verses` | Working | Secondary |
| Pray page | `PrayPage.jsx` | required | `bible_verses`, `feeling_verses` | **Fully built, completely unrouted** | n/a — decide fate |
| KendylScene daily message | `components/KendylScene.jsx` | required | hardcoded in-file (223 messages) | Working | Launch-critical (mission/tone) |
| Admin dashboard | `AdminPage.jsx` | admin only | `profiles`, `groups`, `dinner_verses`, `analytics`, `announcements` | Working | Administrative |
| Announcements | `AdminPage.jsx` write, `HomePage.jsx:294-300` read | mixed | `announcements` | Working | Administrative |
| Reminders/notifications | — | — | — | **Does not exist anywhere in the codebase** | n/a — not built |
| Account deletion (self-service) | — | — | — | **Does not exist — email request, up to 30 days** | n/a — not built |

**Production behavior now vs. repaired local client vs. planned-not-implemented:** Every row above marked "Working (repaired this engagement)" reflects the **repaired local client on `fix/dwj-shared-table-sync`**, not yet deployed to production — see the security/shared-table docs for exact deployment status. Everything else in this table (onboarding, journal, settings, story, admin, guest content structure) is unchanged by that repair and reflects both current production and the local branch identically. Nothing in this table is "planned but not implemented" except the reminder system (never started) and self-service account deletion (never started) — `PrayPage.jsx` is *built* but not planned-for-launch in its current unrouted state, which is a genuine open decision (§8).

---

## 2. Core Dinner Experience — Exact Journey

**Screen shape:** One long scrolling page (`TablePage.jsx`), not a wizard or progressive-disclosure flow. Order, top to bottom: member chips → verse → context (if present) → questions → prayer → "we discussed this" button → journal entry (with destination picker) → "Leave the Table" closing card.

**Before the verse appears:** A brief "Preparing your verse..." loading state, then the "Who's at the table" card (group name, member chips, invite-guest button) renders *above* the verse — so the verse isn't the literal first pixel, but there's no forced click-through to reach it.

**Questions:** Up to 3 levels, always shown together, in fixed order (level 1 always visible under "For the table tonight," level 2 under "Go deeper" if the verse has it, level 3 under "Push further" if the verse has it). Not gated by the user's Faith Journey setting despite Settings' copy claiming otherwise (§5, finding #2). Not "required" in a form sense — no answer field per question; families discuss them out loud. The only text input is the single journal textarea at the bottom.

**Prayer:** Exactly one prayer text (`prayer_level_1`, server-resolved, identical for every viewer). Prayer person shown via a highlighted member chip + "{name}'s turn to pray" + "Next: {name}" badge, all derived from the shared, server-stored rotation state.

**Completion recording — two different things, easy to conflate:** "✓ We discussed this tonight" is a **per-user** marker (`verse_history`), feeding the Home conversations counter for that individual, not the group. "✓ We prayed together" is the **shared** action — advances the group's server-side rotation atomically, safe against duplicate/concurrent taps.

**Journal:** A 3-way destination toggle — My journal / {Group name} journal / Both — with the default set to "Both." Saves are tracked to avoid duplicate inserts if a partial failure occurs mid-save.

**Refresh / close-reopen / network failure / duplicate taps:** All state is server-backed as of this engagement's repair — refresh or reopen re-fetches the canonical shared session with no data loss; a failed save shows an honest error and preserves the user's draft text; duplicate taps are guarded both client-side (buttons disable mid-request) and server-side (the underlying RPCs are atomic/idempotent).

**Closing experience:** "Leave the Table" → one of six rotating blessing messages in a full-screen overlay → "Amen. Good night." → returns to Home.

**Where the experience matches vs. diverges from One Verse / One Conversation / One Prayer:**
- **One Verse** — genuinely true today (server-canonical, identical across every device — this was the specific subject of this engagement's shared-table repair).
- **One Prayer** — genuinely true today (same repair — prayer text and rotation are both shared, not per-viewer).
- **One Conversation** — the *questions* are shared and identical, which is most of what "one conversation" means. But there's no shared record that "the family had this conversation" — the discussion marker and journal entries are both individual acts, not a collective one. This is a minor, defensible gap (the actual conversation happens out loud at the table, not inside the app) rather than a bug, but it's worth naming precisely since the product promise is phrased as a triad.

---

## 3. Content Inventory — Exact Counts

**These counts require a production database query. The assistant preparing this document does not hold database credentials at any point in this engagement — every production interaction has gone through Steve running prepared read-only SQL and sharing results.** That pattern applies here too. A complete, ready-to-run query file has been prepared:

**`docs/DWJ_CONTENT_COUNT_QUERIES_2026-07-16.sql`**

covering: dinner_verses totals/completeness/richness/duplicates/category breakdown; feeling_verses per-category counts and cross-category duplicate detection; bible_verses coverage for the "Verse for This Moment" time-grid (including exactly how many of the 720 possible `h:mm` slots have zero coverage); WEB vs. KJV text coverage; and a `bible_books` completeness cross-check. **Run it and share the output to fill in this section's exact numbers before finalizing content targets in Section 6.**

What can be reported now, from code and prior conversation history, without that query:

- **KendylScene: exact count confirmed by direct code inspection** — 123 "funny" one-liners + 100 "inspirational" one-liners = **223 total messages**, shuffled into a no-repeat-until-exhausted queue. At one message per day, this supports **223 consecutive days (~7.3 months) before any repeat** — a genuinely strong content depth, not a gap.
- **`bible_books`: 66 rows** (confirmed via an earlier production query in this same engagement, prior to this session — matches a complete Protestant canon; not re-verified this session, worth reconfirming as part of the new query batch above since real time has passed).
- **`time_verses` (31,179 rows, confirmed earlier this engagement) is a *different, confirmed-unused* table** — "Verse for This Moment" actually queries `bible_verses`, not `time_verses`. Do not conflate the two when reasoning about Bible-content coverage; `bible_verses`' own row count is one of the pending query's outputs.
- **Bible Translation picker (§1, §5): only WEB (and separately, KJV in the standalone reader) have any actual data.** NIV/NLT/ESV/NKJV are Settings-page options with zero backing content — this is a **content gap that is also a licensing question**, not just a UX bug: NIV/NLT/ESV/NKJV are commercially licensed translations. **Do not add any of them without a licensing review; flagging this explicitly per instruction, not recommending it.** KJV and WEB are both public domain, which is exactly why they're the two that exist.

---

## 4. Journal and Privacy Experience

### Personal Journal
- **Read/write/edit/delete:** the owning user only — `notes` rows with `family_id is null`, filtered by `user_id = user.id` (`JournalPage.jsx`).
- **Can another group member ever access it:** no — it is never queried with any other user's id, and family-tab queries explicitly filter on `family_id`, which personal notes never have.
- **Labels shown:** "My Journal" tab; empty-state copy *"Your personal journal is empty. Write something worth remembering."*

### Family Table Journal
- **Read:** any current member of the group (`notes` where `family_id = group.id`).
- **Write:** happens only from `TablePage`'s dinner-flow save (destination = "family" or "both") — `JournalPage.jsx`'s Family tab has no add-note form of its own, only browse/delete.
- **Author identity:** notes are **not** labeled with who wrote them anywhere in the UI reviewed — a family-tab entry shows the note content, not an author name. Worth confirming this is the intended experience for a *shared* journal (§5 candidate improvement).
- **Edit/delete:** delete only (any member with visibility can delete any note in the tab per the code path reviewed — this is a product-clarity question, not a re-audit of the underlying RLS, which is covered in the separate security documents).
- **Guests:** cannot read or write family journal entries — the guest route has no journal UI at all.
- **Removed members:** once removed from a group, a user's own client no longer has a `group` context to query family notes through — access is a function of current membership, not retained separately.

### Save-destination UX
The three-way toggle (My journal / {Group name} journal / Both) lives only inside `TablePage`'s dinner-flow journal box, defaults to "Both." **Where a user might misunderstand who sees their words:** the toggle labels are clear in isolation, but nothing on-screen at the moment of writing reminds the user *who is currently in the family circle* — a user typing something vulnerable under "Both" or "{Group} journal" has to separately remember who's in their group. This is a real, specific clarity gap worth a small fix (§5).

---

## 5. Current User Experience Assessment — Ten Highest-Value Improvements

| # | Problem | Evidence | Improvement | Impact | Effort | Priority | Before launch? |
|---|---|---|---|---|---|---|---|
| 1 | Bible Translation picker is fully decorative — 4 of 5 options do nothing, and the app's own Terms of Service already discloses this in legal text | `SettingsPage.jsx:541-551`, `preferred_translation` referenced nowhere else in `src/`; ToS §7 | Either hide NIV/NLT/ESV/NKJV until real licensed content exists, or clearly badge them "Coming soon" and disable selection | Removes a "looks broken" moment for any user who tries it | Small | High | Yes |
| 2 | Faith Journey footnote claims it reorders questions at the table; it doesn't | `SettingsPage.jsx` footnote vs. `TablePage.jsx`'s fixed question order and always-tier-1 prayer | Rewrite the footnote to describe what Faith Journey actually does today (nothing observable at the table, since prayer/questions are now intentionally shared) | Stops a user from expecting personalization that isn't there | Small | High | Yes |
| 3 | `PrayPage.jsx` is a fully-built, more capable version of Home's time-verse feature (live clock, KJV text, one-tap lookup) sitting completely unreachable | Confirmed by grep — zero imports anywhere | Either route it in (replacing or supplementing Home's manual-only version) or delete it — leaving finished, unreachable work is pure waste either way | Could meaningfully improve the "Verse for This Moment" feature for free, or reclaim bundle size if deleted | Small–Medium | Medium | Should decide before launch, doesn't have to ship before launch |
| 4 | Home's live-clock auto-lookup is dead code sitting next to the manual-entry version that *is* shipped | `HomePage.jsx:190-208`, `loadTimeVerses()`/`currentTime` never rendered | Wire it in (shows the live time proactively, one tap to see today's verse-for-now) or delete the dead code | Small UX lift or code-cleanliness win | Small | Low–Medium | No |
| 5 | No reminder/notification system exists at all, for an app whose entire premise is a daily ritual | Confirmed via repo-wide grep, zero matches | At minimum, a simple daily local-notification opt-in ("remind me at dinnertime") — doesn't need a backend push system to start | Directly serves the core "make it a nightly habit" goal | Medium | High | Strong candidate for pre-launch or immediately after |
| 6 | Account deletion is an email request with up to 30 days' turnaround, for an app that will increasingly involve children's/family data | `public/delete-account.html` | Keep the email-request path (it's honest and compliant) but consider whether app-store review or a scaling user base will eventually require a faster or self-service path | Compliance risk mitigation, not urgent at current small scale | Medium–Large | Medium | Not before this launch; revisit before broad public launch |
| 7 | Conversation counter says "your family has shared N conversations" but counts only the viewing individual's `verse_history` | `App.jsx:132-145` vs. `HomePage.jsx:283-287` copy | Either make the count genuinely group-wide (small query change) or adjust the copy to be accurate ("You've discussed N nights...") | Removes a subtle promise/behavior mismatch | Small | Medium | Should fix, not launch-blocking |
| 8 | Shared family journal entries aren't labeled with an author | `JournalPage.jsx` family-tab rendering | Add a small "— {name}" byline to family journal entries | Makes a shared journal feel genuinely shared, and gives context to who said what | Small | Medium | High-value, not launch-blocking |
| 9 | The journal destination toggle doesn't remind the writer who's currently in the group at the moment they're choosing "Both"/"family" | `TablePage.jsx` journal UI | Show the current member list (or count) inline near the destination toggle | Prevents a real, if rare, "who can see this" surprise | Small | Medium | Should fix before broad launch (trust-sensitive) |
| 10 | Navigation has no URL/deep-link support — can't share a link to a specific tab, no back-button semantics inside the app shell | `App.jsx` state-based tabs | Not urgent for a mobile-first single-family-at-a-time app, but worth a deliberate "yes, this is fine for now" decision rather than an accidental one, since it affects future features like deep-linking a specific journal entry or a specific church campaign | Low near-term, higher if church campaigns want direct links later | Large (real routing refactor) | Low | No — defer past launch |

**Not included as "fashionable" changes that don't meet the bar:** visual redesign, animation polish, dark-mode refinement, gamification of any kind (explicitly against the stated product philosophy — "No streaks. No shame. No performance." per `StoryPage.jsx`) — none of these are recommended here.

---

## 6. Content Target Recommendations

Numbers below are reasoned from what's confirmed (KendylScene's exact count) and from general content-depth judgment; **the dinner-verse, feeling-verse, and Bible-coverage numbers should be finalized once the Section 3 query results are in.**

| Content type | Current count | Recommended launch target | Why sufficient | Est. repeat frequency | Launch-critical? |
|---|---|---|---|---|---|
| Complete dinner experiences (verse+context+3 questions+prayer) | **Pending query** | At minimum enough for **90 non-repeating nights** (≈3 months) before any family sees a repeat, growing monthly after launch | A quarter of genuinely fresh nightly content is enough runway to prove retention without needing content-complete before day one | Depends on pending count | Yes — need the floor number confirmed |
| Questions per verse | Currently up to 3 tiers, level 1 mandatory | Keep the 3-tier model; ensure **100% of verses have at least level 1** (a hard content-completeness bar, checkable from the pending query's "missing_question_1" result) | Matches existing UI; tiering already supports families at different depths of conversation | n/a | Yes |
| Prayers per verse | Currently up to 3 tiers, only tier 1 is ever shown | Since only tier 1 is used, **prioritize 100% tier-1 coverage over investing further writing effort into tiers 2/3** until/unless a future group-level tier setting is built | Matches actual current usage exactly — no wasted content work | n/a | Yes (tier 1 only) |
| Context entries | Pending query | Not launch-blocking on its own (context is optional per verse in the current UI), but valuable — target growing coverage over time, not a hard floor | Context is a nice-to-have depth layer, not core to the "have the conversation" mechanic | n/a | No |
| Verses per feeling (Need a Moment With God) | **12 confirmed categories** (exact list in §1); per-category count pending query | Roughly **3-5 verses per category** is enough to avoid immediate repetition for a feature used occasionally, not nightly | This is an as-needed comfort feature, not the nightly ritual — lower repeat pressure than dinner content | Low-medium, occasional use | No — grow after launch |
| Verse for This Moment coverage per time window | Pending query (the query specifically reports how many of the 720 possible `h:mm` slots have zero matches) | Target **zero uncovered slots in the 1:00-12:59 range**, since a family entering a meaningful time and getting nothing is a worse experience than a thin result | Every gap is a visible dead-end for a user who just typed something personal | Depends on pending count | Should fix visible gaps before wide promotion of this specific feature, not the whole app |
| KendylScene quotes | **223 confirmed** | No action needed — already supports ~7 months without repeating | Confirmed by direct count, this is a genuine strength | Effectively none for 7+ months | Already sufficient |
| Bible translation coverage | WEB confirmed working; KJV confirmed working in the separate reader; NIV/NLT/ESV/NKJV have zero data and are licensed | **Launch with WEB (+ KJV in the reader) only; either remove or clearly badge the other four as unavailable** | WEB and KJV are both public domain — no licensing exposure; the other four require legal/licensing work not yet started | n/a | Yes — the picker itself is the launch item, not new translations |

### Recommended ongoing content cadence after launch
- **New dinner experiences:** a steady monthly addition (exact number should be set once the "non-repeating nights" floor from the pending query is known — e.g., if there are already 90+ nights of runway, even a modest monthly addition maintains a multi-month buffer indefinitely).
- **New feeling-verses:** a small monthly addition focused on any category the pending query flags as thin, rather than uniform growth across all 12.
- **KendylScene quote review:** given the 7-month runway, a **quarterly** review pass (theological/tonal consistency check, retire anything that reads oddly out of context) is sufficient — no urgency to add volume.
- **Content approval workflow:** not yet built (`AdminPage.jsx`'s Verses tab only toggles active/inactive, doesn't support drafting/reviewing new content) — worth a lightweight process (even a shared doc + Steve's manual insert via the admin tools or SQL) before content velocity increases, rather than building a full CMS prematurely.

---

## 7. Church Partnership Product

### What already exists that's reusable
- The core devotional content and experience itself (verse/questions/prayer) — the actual product a church would be paying to extend into member households.
- An invite-code join mechanism — the *pattern* (not the current data model) is reusable for a church-specific link.
- An `analytics` event stream (`app_opened`, `verse_locked`, `group_created`, `group_joined`, `discussion_marked`, `prayer_completed`, etc.) — a reasonable foundation for aggregate participation metrics, since it's already event-based without content.
- An admin dashboard *pattern* (tabs, stat tiles, activity charts) — reusable as a UI pattern, **not** as an access model (today's `AdminPage` is one global superuser view across every user and group; a church admin view must be scoped to only that church's aggregate data, never another church's, and never any family's private content).

### What would need to be built
- A **church/organization entity** in the data model. Today's `groups` table is flat — one owner, one member list, one invite code — with no concept of "many families, one church." This is the single largest engineering gap for this product line and should be scoped as real, deliberate work, not a bolt-on.
- A church-specific invite link/QR that auto-tags a newly created family group as affiliated with that church.
- A scoped, privacy-safe aggregate dashboard per church (counts only — active families this week, dinners logged, conversations had — never journal content, never which family said what).
- Seasonal/campaign content tagging — low-effort, since `dinner_verses.category` already exists as a grouping mechanism; a "30-day Advent pack" is largely a curation exercise on existing infrastructure, not new engineering.
- Light church branding hooks (church name shown subtly to that church's families) — small, contained UI work.
- Billing/subscription infrastructure — **does not exist at all today** (confirmed: no IAP/billing library anywhere in `package.json` or `src/`), and shouldn't be built until a pricing model is actually chosen.

### What should not be built initially
- A full self-serve church signup-and-billing portal — too much investment before product-market fit with even one or two churches is proven.
- Per-family visibility for church admins beyond aggregate counts — a bright line worth holding, both ethically and for trust with families.
- Multi-role church staff permissions (lead pastor vs. associate vs. volunteer coordinator, etc.) — start with one named contact per church.
- A CMS letting churches author their own custom dinner content — significant scope for a v1 that doesn't need it to prove value.

### Minimum viable church package
A unique church invite link/QR code that auto-affiliates new families; a one-page (PDF or web) church welcome/onboarding kit; a private, read-only, aggregate-only dashboard for one named church contact; a small set of ready-made assets (bulletin insert, one slide, one social post, one email) introducing the program; optionally, one or two seasonal dinner packs built from existing content tagging. Everything in this list is either already-existing infrastructure repurposed, or lightweight content/design work — not a large engineering lift.

### Likely buyer, and why they'd pay for a free consumer app
**Likely buyer** (informed judgment, not derived from data): a family/children's ministry director, or a lead pastor at a smaller congregation, already looking for a low-lift way to extend Sunday's teaching into weeknight homes. **Why they'd pay:** the free app removes the family's adoption barrier entirely — the church isn't asking members to pay anything. What the church is buying is (1) visibility into whether their families are actually engaging between Sundays, which they otherwise can't measure at all, (2) a turnkey campaign tool tied to their own sermon series or season without building anything themselves, and (3) confidence in a values-aligned, non-monetized-toward-children, non-gamified product they can put their name behind.

**Draft sales message** (a first pass for Steve to refine, not finished copy): *"Dinner with Jesus gives your families one verse, one conversation, and one prayer at dinner — free, always, no ads, no gamification. As a partner church, you get to see your congregation actually living it out between Sundays, with a simple dashboard, ready-made campaign content tied to your sermon series, and materials to launch it in one weekend — without asking families to pay a cent."*

**Draft onboarding process:** church contact agrees to a simple partnership → receives a unique invite link/QR plus the launch kit and a short how-to → church shares it through an existing communication channel (service announcement, bulletin, email list) → families download the free app and join via that link, auto-tagging their circle to the church → church contact gets dashboard access.

**Operational burden on OneTen:** issuing church-specific links (near-zero once the church-entity concept exists); light per-church onboarding support; periodic seasonal content curation; billing/invoicing overhead once real pricing exists (currently zero). No added burden for individual families beyond what already exists today.

### Three pricing models — all numbers below are illustrative placeholders only

**Model 1 — Simple monthly partnership**
- Receives: branded invite link, aggregate dashboard, standard seasonal packs, email support.
- Pricing logic: flat monthly fee regardless of congregation size — simplest to sell and understand.
- Placeholder price: *$49–$199/month* (illustrative only).
- Possible give-back: a percentage returned to the church's own benevolence/missions fund, e.g. *illustratively 10–20%* — **not a real number, not a settled structure.**
- Support burden: low-medium, ongoing.
- Advantages: predictable recurring revenue, simple pitch.
- Disadvantages: requires billing infrastructure from day one; a new recurring line item can be a harder internal "yes" for a church than an annual or one-time ask.

**Model 2 — Annual congregation sponsorship**
- Receives: everything in Model 1, plus a full annual campaign calendar, priority content input, a launch-event kit.
- Pricing logic: single annual sum — matches how many churches actually budget (annually, via a board process), rather than approving a new monthly subscription.
- Placeholder price: *$500–$2,000/year* (illustrative only).
- Possible give-back: a fixed amount or percentage returned annually, e.g. *illustratively $100 or 15%, whichever is greater* — **placeholder only.**
- Support burden: medium, front-loaded around launch.
- Advantages: fits church budgeting cycles; one invoice a year instead of twelve; a stronger annual relationship/renewal moment.
- Disadvantages: bigger single ask upfront; needs stronger proof of value before a church commits a full year.

**Model 3 — Campaign or seasonal program**
- Receives: one defined-length campaign (e.g. Advent, Lent, "30 days at the table") with its own themed content, launch materials, and a short post-campaign report — no ongoing subscription.
- Pricing logic: one-time fee per campaign, timed to an existing sermon series or season — the lowest-commitment entry point.
- Placeholder price: *$99–$399 per campaign* (illustrative only).
- Possible give-back: a flat amount per campaign, e.g. *illustratively $25* — **placeholder only.**
- Support burden: lowest, bounded to the campaign window.
- Advantages: easiest possible first "yes" from a new church; fits an existing rhythm churches already have; natural pilot before a bigger ask.
- Disadvantages: revenue is lumpy and requires repeated re-selling; shallowest ongoing relationship.

**Suggested sequencing:** Model 3 as the natural first offer to a new church (lowest friction, provable value fast), with Models 1 or 2 as the follow-on once a church has seen a campaign work.

**Explicitly flagged, not decided here:** whether any "give-back" structure constitutes a charitable distribution, a marketing rebate, a partnership discount, or something with its own tax/1099 reporting implications is a real, unresolved question. **None of the numbers or structures above should be treated as legal, tax, charitable-solicitation, or accounting fact — all of it needs professional review before anything goes live.**

---

## 8. Launch Readiness and Priorities

### MUST FIX BEFORE PUBLIC LAUNCH
- Deploy the repaired shared-table client (the entire subject of this engagement's prior work) — without it, the core promise (One Verse, One Conversation, One Prayer) is not actually true across devices in production today.
- Apply baseline RLS lockdown and admin-access policies (already staged, reviewed, and pending Steve's supervised application per the separate security runbook) — production user data is currently exposed at the database level until this happens.
- Fix the Bible Translation picker (§5 #1) — showing four non-functional, licensed-content options is both a trust issue and a latent licensing trap if anyone assumes those translations actually exist.
- Confirm dinner-content floor (Section 3 query) meets a real non-repeating-nights minimum before inviting real families in.

### HIGH-VALUE IMPROVEMENTS BEFORE PUBLIC LAUNCH
- Fix the Faith Journey footnote mismatch (§5 #2) — small, but a real accuracy issue in user-facing copy.
- Decide `PrayPage.jsx`'s fate — route it in or remove it (§5 #3) — shouldn't ship indefinitely in limbo.
- Fix the conversation-counter framing mismatch (§5 #7).
- Add author attribution to shared family journal entries (§5 #8).
- Add member-list visibility near the journal destination toggle (§5 #9).
- At least a minimal reminder/opt-in mechanism (§5 #5) — directly serves the core "make it nightly" goal, but can also reasonably be a fast-follow within the first weeks post-launch rather than a hard gate.

### CAN WAIT UNTIL AFTER REAL USER FEEDBACK
- Deep content-volume growth beyond the confirmed launch floor (Section 6).
- Church-partner features in full (Section 7) — should follow real consumer usage data and at least one willing pilot church, not precede it.
- Additional Bible translations (licensing-gated, not a near-term item regardless).
- Self-service account deletion (current email-request path is compliant, just slower).
- Analytics depth beyond what already exists.
- Full routing/deep-link architecture (§5 #10).
- Any visual redesign or animation polish.

---

## 9. Recommended Execution Plan

**Phase 1 — Finalize core functionality and user protection**
- Outcome: the app's actual behavior matches its stated promise, and production data is no longer exposed.
- Work included: deploy the repaired shared-table client; apply baseline RLS; apply admin policies; run the real multi-device family test; fix the Bible Translation picker and Faith Journey copy mismatch (§5 #1, #2 — small enough to bundle here rather than delay).
- Work deliberately excluded: any new feature, church functionality, content-volume growth beyond confirming the floor.
- Approximate effort: the security/shared-table portion is already substantially complete per the separate runbooks — remaining effort is primarily the supervised production migration steps and the live multi-device test itself.
- Decision gate: multi-device test passes observed (not assumed) for verse/prayer/rotation sharing, and the security matrix confirms no cross-user data exposure.
- Evidence required to continue: the existing security runbook's test matrix, actually observed and recorded — not simulated.

**Phase 2 — One focused UX and content sprint**
- Outcome: the app feels finished and trustworthy for a small real audience, with a confirmed content floor.
- Work included: run the Section 3 content-count query and confirm the dinner-content floor; author attribution on family journal entries; member visibility near the journal destination toggle; conversation-counter fix; decide and act on `PrayPage.jsx`'s fate; minimal reminder opt-in if feasible in this window.
- Work deliberately excluded: church features, translation expansion, redesign.
- Approximate effort: small-to-medium, mostly UI-level changes plus one content pass.
- Decision gate: Section 3's counts meet the recommended floor (Section 6); the ten §5 improvements marked "before launch" are done or deliberately deferred with reasons recorded.
- Evidence required to continue: updated content counts; a short internal walkthrough confirming the ten improvements' status.

**Phase 3 — Private family/church pilot**
- Outcome: real usage data from people who aren't the founding team, at small scale, low risk.
- Work included: invite a small set of real families (beyond "friends and family" testers) and, if ready, one pilot church under an informal/no-cost arrangement to validate the church concept's basic mechanics — *not* the paid product yet.
- Work deliberately excluded: any paid church offering, broad public marketing.
- Approximate effort: primarily observation and support, minimal new engineering.
- Decision gate: no critical bugs surface; families report the core promise (One Verse, One Conversation, One Prayer) actually lands emotionally, not just functions correctly.
- Evidence required to continue: direct pilot feedback, retention signal (are families coming back on their own), no unresolved data-exposure or correctness issues.

**Phase 4 — Public consumer launch**
- Outcome: the free app is available to anyone, positioned honestly around what it actually does today.
- Work included: landing/store-listing polish if needed, monitoring plan for the first real-scale usage, support readiness.
- Work deliberately excluded: church-paid features (still not required for consumer launch, since the app is free either way).
- Approximate effort: primarily operational readiness, not new engineering, if Phases 1-3 completed cleanly.
- Decision gate: Phase 3 pilot evidence is positive; no open MUST-FIX items remain.
- Evidence required to continue: Phase 3 results plus a final pre-launch checklist pass.

**Phase 5 — Church-partner validation and sales**
- Outcome: a real, paying (or piloted) church relationship proves the church product concept before broader sales investment.
- Work included: build the church/organization data model and the minimum viable church package (Section 7); run Model 3 (campaign) with one or two real churches first.
- Work deliberately excluded: full self-serve billing, multi-tier church admin roles, a content-authoring CMS for churches.
- Approximate effort: medium — the data-model work is the real lift; everything else in the MVP package is content/design work.
- Decision gate: at least one church completes a campaign and would pay again, or a church-specific data point emerges that changes the model.
- Evidence required to continue: real church feedback and, ideally, a real transaction — not a hypothetical one.

**On "one coordinated release rather than many micro-releases":** Phase 1's security/shared-table work is naturally one coordinated release (it already is, per the staged migration plan). Phase 2's UX/content sprint is small enough to also ship as one release rather than trickling out. Phases 3 onward are inherently gated by real-world feedback loops (pilot families, a pilot church) and shouldn't be compressed just to avoid multiple releases — that would trade evidence quality for release-count vanity.

---

## 10. Closing Summary

**The exact current app, in one paragraph:** Dinner with Jesus is a free, single-family-focused devotional app that gives a household one shared Bible verse, a set of tiered discussion questions, and one shared prayer each night, plus a personal and family journal, a lightweight onboarding built around a short faith-journey questionnaire, an unauthenticated guest-preview link for inviting others in, a 223-message daily "message from Jesus" moment named for Kendyl's vision, and a founder's-story screen honoring Maddie — built on React/Vite/Supabase, currently mid-repair to make the shared-table experience (verse, prayer, rotation) genuinely identical across every family member's device rather than independently generated per phone, with that repair reviewed, staged, and partially applied to production as of this document's date but not yet fully deployed.

**Exact content counts:** KendylScene — 223 messages (confirmed). Bible books — 66 (confirmed, prior session). Dinner verses, feeling-verses per category, and Bible-verse time-coverage — **pending the prepared query in `docs/DWJ_CONTENT_COUNT_QUERIES_2026-07-16.sql`**, to be run and shared before Section 6's targets are finalized as hard numbers.

**Top five pre-launch improvements:** (1) deploy the repaired shared-table client and complete the staged RLS/admin lockdown; (2) fix the decorative Bible Translation picker; (3) fix the Faith Journey copy mismatch; (4) confirm the dinner-content floor meets a real non-repeating-nights minimum; (5) resolve `PrayPage.jsx`'s fate rather than leaving finished work unreachable.

**Recommended content targets:** ship with a confirmed dinner-content floor of roughly a business quarter's worth of non-repeating nights (exact number pending the count query), prioritize 100% tier-1 question/prayer coverage over deeper tiers that aren't currently used, hold translation coverage at WEB+KJV only until licensing is reviewed, and treat KendylScene as already sufficient.

**Recommended minimum church product:** a church-specific invite link, a one-page onboarding kit, a privacy-safe aggregate-only dashboard, a small ready-made asset pack, and optional seasonal content bundles built from existing tagging — deliberately excluding self-serve billing, multi-role church admin, and a church content CMS at this stage.

**Recommended pricing experiments:** start with Model 3 (one-time campaign pricing) as the lowest-friction first "yes" from a pilot church, with Models 1 (monthly) and 2 (annual) as natural follow-ons once value is proven — all dollar figures in this document are explicitly illustrative placeholders pending real market testing and professional legal/tax review of any give-back structure.

**What must be deployed or migrated:** the repaired client (push, merge, Vercel deploy); the baseline RLS lockdown migration; the admin-access-policies migration — all three already prepared and staged per the separate security documentation, pending Steve's supervised production application and the real multi-device test.

**Smallest practical path to a strong public launch:** complete Phase 1 (already mostly done) and Phase 2 (a focused, small UX/content sprint) as one coordinated push, run a real but small pilot (Phase 3) before opening broadly, and treat the church-partner product as an explicitly separate, later effort that shouldn't delay the free consumer launch at all.

**Unanswered decisions requiring Steve's judgment:**
- Does `PrayPage.jsx` get routed in or deleted?
- Is the group-scoped-vs-personal conversation counter worth a data-model fix now, or a copy fix now with a data fix later?
- Should family journal entries show authorship, and if so, is that a product decision the family should be able to opt into or out of?
- What's the real target for "non-repeating dinner nights" at launch, once the content-count query comes back?
- Is a minimal reminder/notification system a launch gate or a fast-follow?
- Which pilot church (if any) is the right first Phase-5 partner, and on what informal terms before any real pricing model is chosen?
- What give-back structure, if any, is actually legally and financially sound — this needs a professional, not a product document, to answer.
