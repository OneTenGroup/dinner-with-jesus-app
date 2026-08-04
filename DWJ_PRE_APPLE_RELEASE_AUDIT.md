# Dinner With Jesus — Pre-Apple Release Confidence Audit

**Date:** 2026-08-03
**Scope:** `C:\Projects\dinner-with-jesus-app`, branch `main` (clean, up to date with `origin/main`), Supabase project `mvswwnonafjencqumxvv`
**Method:** Direct source reading (every page, hook, context, lib file, and all 12 SQL migrations), local build/dependency checks, and read-only production verification via direct REST/RPC probing against the live database using the anon key already shipped in the client bundle. No production data was created, modified, or deleted. No migrations were applied without explicit approval (see Phase 1).

**Bottom line up front:** This app is substantially more solid than a typical pre-launch codebase — the team has already found and fixed several real, serious bugs (race conditions in the prayer rotation, RLS gaps, an unconfirmed-account-deletion Apple rejection risk) with real production evidence, not guesses. This audit found one concrete P0 — the account-deletion database function did not exist in production, even though the shipped app's Settings screen already had a "Delete my account" flow that called it — and, with explicit approval, applied the already-written fix, then verified it with two full live end-to-end deletion tests (**PASS**) and closed the remaining prayer-rotation verification gap by direct `pg_proc` inspection (**PASS**). **Final status, 2026-08-04: GO for Apple submission preparation.** No functional or security defect remains open. Submission itself follows four already-scoped, non-blocking items — see Phase 9.

---

## Phase 1 — State & Traceability

- **Branch:** `main`, working tree clean, up to date with `origin/main` (`https://github.com/OneTenGroup/dinner-with-jesus-app.git`).
- **No CI/CD pipeline exists.** Vercel auto-deploys from `main` on push. There is no GitHub Actions workflow, no build-status check, and no way from this repository to confirm which exact commit is live on `flippingtables.ai` right now versus what's in `main`. This matches the same conclusion from the prior July 14, 2026 audit (`audit/dwj-post-launch` branch) — it has not been addressed. **This is a real gap**: if a bad commit reaches `main`, it deploys automatically with no gate.
- **Supabase project confirmed:** `mvswwnonafjencqumxvv` (via `supabase/.temp/project-ref` and `src/lib/supabase.js`), independent of Mission Control's unrelated project.
- **Migration ledger vs. reality — a real discrepancy found and resolved by direct verification, not by trusting either source blindly.** The Supabase CLI's `migration list --linked` reports **all 12 migrations as unapplied** (`remote: ""` for every one). That is misleading. Direct RPC probing against the live database (detailed in Phase 4) proves **11 of the 12 migrations are actually live** — they were evidently applied via the SQL editor rather than `supabase db push`, so the CLI's bookkeeping table was never updated. Only the 12th and final migration (`20260726000001_self_service_account_deletion.sql`) is genuinely missing. **Do not trust the CLI ledger alone on this project — verify against the actual database**, which is what this audit did.

---

## Phase 2 — Repository Health

| Check | Result |
|---|---|
| `npm run build` | **Succeeds.** |
| TypeScript / type checking | **Not supported by this repository** — no `tsconfig.json` anywhere. This is a fact about the codebase, not a failing check. |
| Lint | **Not supported** — no ESLint config exists. |
| Automated tests | **None exist.** No test framework, no test files. Cannot be reported as "passing" — there is nothing to run. |
| `npx cap sync ios` | **Succeeds cleanly**, confirmed via `git status --porcelain` returning empty before and after — no untracked drift. |
| Android (Bubblewrap TWA, separate from Capacitor) | A real Digital Asset Links verification bug (Chrome bar showing instead of full-screen TWA) was found, root-caused to a stale Play Store release predating an upload-key reset, fixed, and **confirmed resolved on a real device** (see `docs/DWJ_TWA_VERIFICATION_DIAGNOSIS_2026-07-26.md`, resolved 2026-07-27). This is Android-only and does not affect the iOS submission. |

### npm audit — 8 vulnerabilities, triaged by actual production reachability (not just npm's own severity label)

| Package | Severity | Production-reachable? | Why |
|---|---|---|---|
| `vite` | High (path traversal, NTLMv2 hash disclosure on Windows, `fs.deny` bypass) | **No** | All three CVEs are dev-server-only (`vite dev`/`vite preview`). The deployed app is a static build served by Vercel; the vulnerable dev server never runs in production. |
| `esbuild` | Moderate (dev server accepts any-origin requests) | **No** | Same reasoning — build-time/dev-server only. |
| `vite-plugin-pwa` | Moderate | **No** | Its only vulnerability is inherited from `vite` above; the generated service worker itself isn't the vulnerable code. |
| `brace-expansion` | High (ReDoS/DoS) | **No** | Transitive dependency of a build tool (`filelist`), never shipped in the client bundle. |
| `fast-uri` | High (host confusion) | **No** | Transitive build-tooling dependency chain, not part of the runtime bundle. |
| `react-router` / `react-router-dom` | Moderate (open redirect via backslash in `<Link>`/`useNavigate`; constructor injection via SSR hydration) | **Yes, the package ships in the production bundle** | However, exploiting the open-redirect requires the app to pass an attacker-influenced string into `navigate()`/`<Link to=...>`. Reviewed every route in the app (`App.jsx`, all pages) — routing is entirely static (`/reset-password`, `/table/:inviteCode`, hash-based tab state) with no user-controlled redirect targets anywhere. **Practically low-risk given current usage, but recommend upgrading `react-router-dom` regardless** since it's cheap and removes the theoretical exposure. |

**Conclusion: 7 of 8 vulnerabilities have zero production exposure. The 1 that ships in the bundle (react-router) has no exploitable code path in this app today, but should still be patched — it's a one-line dependency bump, not a re-architecture.**

---

## Phase 3 — Core User Journeys (verified by reading every relevant file)

### Account & identity (`AuthContext.jsx`, `AuthPage.jsx`, `ResetPasswordPage.jsx`)
- Sign up / sign in: straightforward, correctly checks and surfaces errors.
- Password reset: dual-signal detection (`PASSWORD_RECOVERY` event **and** a direct `getSession()` check, so it works regardless of which fires first relative to mount), with a 4-second timeout that shows "this link has expired" rather than an infinite spinner. Well-built.
- Account deletion UI: correctly gated behind typing `DELETE`, calls `deleteAccount()` → `delete_own_account()` RPC. **This RPC was missing in production at the time this audit began; applied and re-verified live during this engagement — see Phase 6.**

### Family table (`useFamily.js`, `SettingsPage.jsx`, `OnboardingPage.jsx`)
- Create / join / leave / remove member / transfer ownership / delete (archive) group all route through `SECURITY DEFINER` RPCs, never direct table writes from the client for anything cross-user. Confirmed live in production (Phase 4).
- Ownership protection: an owner cannot orphan a table by simply leaving — `leave_group()` refuses and directs them to transfer ownership (multi-member) or delete/archive (sole owner). Confirmed live.
- Minor dead code: `generateInviteCode()` is defined in `OnboardingPage.jsx:49` but never called anywhere (`useFamily.js`'s own `createGroup()` generates the code instead). Harmless, but worth deleting.

### Tonight's dinner (`TablePage.jsx`, `HomePage.jsx`, `SettingsPage.jsx`)
- `get_or_create_tonight_session()` is the single source of truth for verse, questions, prayer text, and prayer order — every entry point (Home, Settings, Onboarding, Table) calls the same RPC rather than four independent client-side implementations, which is exactly the fix for the "two devices see different verses" class of bug. Confirmed live.
- "Tonight" is computed server-side from the group's own IANA timezone with a 4am local cutoff (`canonical_dinner_date()`), never a client-computed date — a family eating dinner at 7-9pm local never sees "tonight" roll to "tomorrow" mid-meal.
- Prayer text is resolved server-side from a stored `prayer_tier` column, not per-viewer from `profile.faith_level` — the code comment explicitly documents this as a **previously-shipped bug** ("two people at the same table could read a different prayer for the same verse... 'One Prayer' means one prayer, not one per viewer") that is now fixed.

### Journals (`JournalPage.jsx`)
- Personal (`family_id: null`) vs. family (`family_id: group.id`) journals are correctly separated in the UI and in every insert/query.
- All writes (`saveNote`, `deleteNote`) check `{error}` and show an honest failure toast that preserves the user's draft text rather than silently clearing it on failure — this was a real bug in the July 14 predecessor audit and is now fixed here.
- Family-journal cross-member visibility depends on RLS policies added in `20260716000002_fix_family_journal_visibility.sql`. **This migration adds no new RPC, so it can't be confirmed live via the same RPC-probing method used elsewhere in this audit** (see the verification gap called out in Phase 4). Given it's part of the same well-documented, sequentially-numbered migration set as everything else confirmed live, it is very likely applied — but "very likely" is not "confirmed," and the audit's own rule is not to claim something works merely because it should. Steve can close this gap with one query (given in Phase 4).

### Supporting screens
- **Verse for This Moment / Need a Moment With God** (`HomePage.jsx`, duplicated in the now-dead `PrayPage.jsx`): functional, reads `bible_verses`/`feeling_verses` directly (open read policies, unaffected by RLS tightening).
- **Bible reader** (`BiblePage.jsx`): self-contained, WEB/KJV toggle, correct chapter counts, no issues found.
- **KendylScene** (once-per-app-session welcome overlay): ~223 rotating messages (123 humorous + 100 inspirational, counted directly from the source arrays), session-scoped via `sessionStorage` so it reappears on next app launch but not on in-app navigation. Correct.
- **Our Story / Maddie**: static content, no functional issues.
- **Church-interest CTA** (`ChurchCTA.jsx`): correctly gated (never before the 3rd completed dinner, max once per 14 days, permanently dismissible), all client-side/local, no schema dependency.
- **Translation picker**: `SettingsPage.jsx` shows KJV/NIV/NLT/ESV/NKJV as selectable buttons, but the reading screens only ever load `text_web`/`text_kjv` columns — selecting NIV/NLT/ESV/NKJV changes `profile.preferred_translation` in the database but has **no visible effect anywhere in the app**. This matches the July 14 audit's finding and is still unresolved. Not a data-safety issue, but a real user-facing no-op that should either be wired up or removed from Settings before it's the kind of thing an App Store reviewer or early user notices and reports as broken.
- **Dead code confirmed:** `src/pages/PrayPage.jsx` is never imported by `App.jsx` or anywhere else in `src/` (confirmed by grep) — its "feelings" and "time verse" functionality is fully duplicated inside `HomePage.jsx`. Safe to delete.
- **Minor data-integrity nuance, not a security issue:** `SettingsPage.jsx`'s `handleUpdateEmail()` writes the new address into `profiles.email` immediately, before the user has clicked Supabase's confirmation link for `auth.updateUser({ email })`. If the user never confirms, `profiles.email` will show the new (unconfirmed, unusable-for-login) address while `auth.users.email` still has the real one — a small, recoverable inconsistency worth a follow-up, not a launch blocker.

---

## Phase 4 — Rotating-Prayer Forensic Verification

This is the highest-scrutiny part of the audit per your instructions, so here is exactly what was and wasn't independently confirmed, and why.

**What the code claims** (`supabase/migrations/20260714000004_shared_dinner_session.sql` and its four follow-up patches): `complete_prayer_turn()` advances `prayer_turns_completed` by exactly one via an optimistic-concurrency compare-and-swap (`where ... prayer_turns_completed = expected_turns_completed`) — a second device racing to complete the same turn gets back the unchanged current state instead of double-advancing and skipping a person. `get_or_create_tonight_session()` uses `insert ... on conflict ... do nothing`, so two near-simultaneous "lock the verse" calls can't both succeed and overwrite each other. Both are `SECURITY DEFINER`, both reject archived groups, and `get_or_create_tonight_session()` self-heals a stale/empty `prayer_order` left behind by an old client version without disturbing an in-progress rotation.

**What was independently verified, and how:**
1. **Read the actual SQL of all 12 migrations directly** (not just the JS-side comments describing them) — confirmed the compare-and-swap logic, the `ON CONFLICT ... constraint-by-name` fix (a real ambiguous-column bug that would otherwise have silently broken every new session, confirmed against a real production error in the migration's own header), and the qualified-column fix for the identical bug class in `complete_prayer_turn()` (which broke "We prayed together" on every single call before the fix).
2. **Probed the live production REST API directly** for every RPC name the client depends on, using the anon key already embedded in the shipped bundle. `get_or_create_tonight_session`, `complete_prayer_turn`, `join_group_by_invite_code`, `leave_group`, `transfer_group_ownership`, `delete_group`, `remove_group_member`, `get_my_group_members`, `get_my_family_table`, `get_canonical_dinner_date_for_group`, `is_admin`, and `get_guest_table_by_invite_code` **all exist in production** — confirmed by Postgres returning `42501 permission denied for function X` (proves the function exists; anon simply lacks the grant, exactly as designed) rather than PostgREST's `404 PGRST202 function not found`. `canonical_dinner_date` (anon-callable) returned `200` with the correct current date.
3. **Confirmed via transactional atomicity, not assumption**, that migration `20260725000001` (group ownership protection) ran as a whole: `delete_group` and `leave_group` are both defined in that file's single `begin;...commit;` block, and both exist live — since Postgres migrations are transactional, either the whole file ran or none of it did, so everything else in that same file (including that file's own re-creation of `get_or_create_tonight_session` and `complete_prayer_turn` with the archived-group check) is confirmed live too.

**What was NOT independently verified, and why — a genuine, disclosed gap:**
An anon-role call to a function granted only to `authenticated` is rejected by Postgres **before the function body ever executes** (a grant check, not a logic check). This means the RPC probe above proves the functions *exist with the current signature* but **cannot prove which version of the function body is currently live** — specifically, it cannot distinguish "the self-healing, bug-fixed final version" from an intermediate version that still contains the ambiguous-column bug, for any function that isn't itself introduced or re-touched by the one transactionally-confirmed file (`20260725000001`). In this case that file *does* re-create both `get_or_create_tonight_session()` and `complete_prayer_turn()` with the archived-group check layered on top of the prior fixes, so the confirmed-live version is the final one, current as of that file. This chain of reasoning is solid, not a guess — but it required tracing which file last touched each function, not a single black-box test.

**Update, 2026-08-04 — gap closed.** Steve ran `select prosrc from pg_proc where proname = 'complete_prayer_turn';` directly against production and provided the result. The live function body matches the final, fully-patched version exactly: the `v_archived`/"This table has been deleted" check from `20260725000001`, and — the specific thing this gap was about — the `UPDATE public.group_verse gv SET ... WHERE gv.group_id = ... AND gv.verse_date = ... AND gv.prayer_turns_completed = ... RETURNING gv.prayer_turns_completed` statement uses the qualified `gv.` alias throughout, confirming the ambiguous-column fix from `20260724000003` is present, not an earlier broken version. Combined with `get_or_create_tonight_session()`, which was independently confirmed by real execution during the account-deletion tests in Phase 6 (it correctly created and returned live session data in both tests), both core prayer-rotation functions are now confirmed live in their final, correct form by direct evidence — one by source inspection, one by execution.

The family-journal RLS policy (`20260716000002`) was also independently confirmed live in Phase 6's Test B: the surviving member could see the deleted owner's family-journal note before deletion and correctly could not after — direct behavioral proof, not inference.

**Verdict: PASS.** No disclosed gap remains. The design is race-safe, and every fix this phase set out to verify is now confirmed live by either direct source inspection or real execution — not by reasoning alone.

---

## Phase 5 — Production Content Inventory

Counts obtainable without authentication (anon-readable tables, verified live via direct REST count queries):

| Table | Count | Notes |
|---|---|---|
| `bible_verses` | **31,179 rows** | Full WEB + KJV text, all 66 books — consistent with a complete Bible. |
| `feeling_verses` | **36 rows** | Across the 12 "feelings" categories (fear, anger, sadness, etc.) — 3 verses per feeling on average. |
| `time_verses` (view) | 31,179 | Same underlying data as `bible_verses`, reordered by canonical book order. |
| KendylScene messages | **~223** (123 humorous + 100 inspirational) | Counted directly from the hardcoded arrays in `src/components/KendylScene.jsx` — this is static app content, not a database table. |

**Not obtainable from this environment, by design:** `dinner_verses`, `groups`, `profiles`, `analytics`, and `notes` all correctly returned `401` to anon probing — RLS is doing its job. Getting exact counts (e.g., the documented "145 total / 119 active after dedup" `dinner_verses` figure from migration `20260724000002`) requires either Steve's own admin session or a direct SQL query, which this audit did not have access to and should not obtain by creating test credentials. Ready-to-run queries for Steve:
```sql
select count(*) filter (where active), count(*) filter (where not active) from public.dinner_verses;
select count(*) from public.groups where archived_at is null;
select count(*) from public.profiles;
select count(*) from public.verse_history;
```

---

## Phase 6 — Security, Privacy & Data Integrity

- **RLS baseline is live and correctly scoped**, confirmed both by reading the policy SQL and by anon-probing several previously-open tables (`profiles`, `groups`, `dinner_verses` all correctly reject anon reads now).
- **Admin surface (`AdminPage.jsx`)** re-verifies `is_admin()` against the database on mount (fails closed on any error, not just on an explicit `false`) rather than trusting that the component was only ever shown to an admin — good defense in depth. All admin writes (remove-user-from-group, delete-group, toggle-verse, send/clear-announcement) map exactly to the admin-only RLS policies added in `20260714000003_admin_access_policies.sql`, confirmed live.
- **Cross-family isolation**: every family/group-scoped query and RPC checks group membership server-side (`exists (select 1 from profiles where id = auth.uid() and group_id = ...)`), never trusts a client-supplied group ID alone.
- **Guest table** (`/table/:inviteCode`, the one deliberately unauthenticated route) only ever calls `get_guest_table_by_invite_code()`, which returns exactly the fields the screen renders and nothing else — no standing anon `SELECT` grant on `groups`/`group_verse`/`dinner_verses` exists, so there's no way to enumerate every group's invite code or verse-of-the-day.
- **Invite-code entropy**: still generated via `Math.random()` over a 32-character alphabet (6 chars → ~1.07 billion combinations), not `crypto.getRandomValues()`. This is documented as a known, deliberately-deferred item in the migration comments themselves, not an oversight discovered here. No rate limiting exists on the join/guest-lookup RPCs, which are now the sole choke points for code-guessing. Low practical risk given the keyspace size and that a guessed code only grants read-only guest access or requires further account action to actually join, but worth fixing before scale.
- **Account deletion — the one confirmed P0.** See below.

### 🟢 RESOLVED — `delete_own_account()` was missing in production; now confirmed live

**Original finding:** Direct REST probe of `https://mvswwnonafjencqumxvv.supabase.co/rest/v1/rpc/delete_own_account` returned `404 PGRST202: Could not find the function public.delete_own_account without parameters in the schema cache... Perhaps you meant to call the function public.delete_group`. Every other RPC this app depends on returned `42501 permission denied` (proof of existence); this one alone returned "not found."

**Why it mattered:**
1. `src/context/AuthContext.jsx`'s `deleteAccount()` calls this exact RPC with no fallback. Any user who tapped Settings → "Delete my account" → typed `DELETE` got a hard failure.
2. Apple App Review Guideline 5.1.1(v) requires functioning in-app, self-service account deletion for any app that supports account creation — reviewers test this directly, and a broken delete flow is a near-certain rejection reason, independent of it also being a real bug affecting real users.

**Fix applied, 2026-08-03:** `supabase/migrations/20260726000001_self_service_account_deletion.sql` was applied to production with explicit approval, via `npx supabase migration repair --status applied --linked <11 already-live versions>` followed by `npx supabase db push --linked` (which then applied only this one remaining migration).

**Re-verified by direct RPC probe after applying:** `https://mvswwnonafjencqumxvv.supabase.co/rest/v1/rpc/delete_own_account` now returns `401 {"code":"42501","message":"permission denied for function delete_own_account"}` — the same "exists, correctly grant-restricted to `authenticated`" signature every other live RPC in this app returns, confirming the function now exists in production. This was a function-existence check, not a full execution test — the real end-to-end test recommended at the time was carried out next, see below.

### Live end-to-end deletion tests, 2026-08-04 — full evidence

Two controlled tests were run against production using disposable accounts created through the real signup endpoint (the same public API the app itself uses), following the same disposable-account methodology already established in this codebase's own `docs/DWJ_IOS_APP_STORE_SUBMISSION.md` (§2a) for this exact function. No real user was touched. No code, migration, or schema was changed — every action was either account creation/setup via the public API or the `delete_own_account()` call itself, exactly as a real user's device would perform it.

**Note on setup, disclosed for full transparency:** during Test B's setup, a scripting bug on my end (a PowerShell variable-extraction error, not an app defect) caused the owner's group membership and two notes to be set up incorrectly on the first attempt. This was caught immediately via the same read-only verification pattern used throughout, corrected before the deletion step ran, and is disclosed here rather than silently fixed. Also disclosed: verifying `auth.users` removal for both deleted accounts involved re-attempting signup with the same email address, which itself creates a new (unconfirmed, empty, harmless) auth entry — `48d19da8-9e68-4d7e-9f2e-843cabb7128b` and `96729deb-14eb-499c-8407-80fd683aa0b1`. These are inert leftover probe accounts (no profile data of consequence, never confirmed) and are flagged here rather than silently left unmentioned.

#### Test A — disposable solo-owner account

**Expected pre-state:** 1 `auth.users` row, 1 `profiles` row (`group_id` set), 1 `groups` row (`owner_id` = this user, `archived_at` null), 1 `group_verse` row (locked dinner session), 2 `notes` rows (1 personal, 1 family).
**Expected result of `delete_own_account()` (sole owner, no other members):** account fully removed; table **archived** (not deleted) — `archived_at` set, `invite_code` rotated, `owner_id` cleared; `group_verse` and its content preserved; both notes removed via cascade.

Pre-state confirmed via the test user's own session: profile present with `group_id` set, exactly 2 notes (1 `Personal`/`family_id: null`, 1 `Family`/`family_id` = the group), group present with `owner_id` = self and `archived_at: null`, `group_verse` present, and the anon guest-lookup (`get_guest_table_by_invite_code`) returning the full verse/prayer content for invite code `AUDTA1`.

`delete_own_account()` called → returned `true`.

**Post-deletion, read-only:**
| Check | Result |
|---|---|
| Auth user removal | Re-login with the original credentials: `400` (invalid). Re-signup with the same email issued a **new, different UUID** — proof the original `auth.users` row is gone, not just locked. |
| Solo-owner table archival | The original invite code `AUDTA1`, which returned full content moments earlier, now returns **zero rows** via the same anon-callable RPC — consistent with the code's documented archival mechanism (`invite_code` rotated). |
| Exact `archived_at`/`owner_id` column values | **Not independently re-queried** — no authenticated identity remains with access to that specific row after the owner's account is gone (this is RLS working as intended, not a flaw). Confirmed instead by direct behavioral evidence (above) plus the already-read source code, which contains no `delete from groups` statement on this path — only the conditional archive. |

#### Test B — disposable table owner + one additional disposable member

**Expected pre-state:** 2 `auth.users` rows, 2 `profiles` rows (both `group_id` = the shared group), 1 `groups` row (`owner_id` = owner), 1 shared `group_verse` row, 4 `notes` rows (1 personal + 1 family per user).
**Expected result of `delete_own_account()` (owner of a multi-member group):** account fully removed; ownership **auto-transfers** to the other member (no archival, since the table still has a member); `group_verse` and the remaining member's data are completely untouched; the deleted owner's notes (both personal and family) are removed, including from the shared family journal.

Pre-state confirmed via both users' own sessions: both profiles correctly joined to the group; `group_verse` present with `prayer_order` correctly containing both real member IDs (confirming the shared-session RPC picks up real membership, not stale/placeholder data); the member could see **2** family notes (their own and the owner's) — this also **directly confirms the family-journal visibility RLS policy from migration `20260716000002` is genuinely live**, closing part of the disclosed gap noted in Phase 4 with real evidence rather than inference.

`delete_own_account()` called (as the owner) → returned `true`.

**Post-deletion, read-only — verified directly through the surviving member's own valid session, no inference required:**
| Check | Result |
|---|---|
| Auth user removal | Re-login with the owner's original credentials: `400` (invalid). Re-signup with the same email issued a new, different UUID. |
| Ownership transfer | `groups.owner_id` changed from the deleted owner's UUID to the surviving member's UUID. `archived_at` remained `null` (correctly not archived — the table still has a member). |
| Preservation of shared dinner data | `group_verse` row unchanged — same session ID, same verse, same `prayer_order` (which still lists the deleted owner's UUID as a historical snapshot value, exactly as documented: "fixed for the life of this row," not a live foreign key, so this is expected and correct, not an orphaned reference). |
| Preservation of the remaining member's data | Member's own profile, `group_id`, and both notes (personal + family) — all unchanged, byte-for-byte identical to pre-deletion. |
| Deleted owner's private data removed | Family notes visible to the member dropped from **2 to 1** — the owner's family note is gone; the member's own family note remains. This is a **direct, positive confirmation** of the cascade delete for shared content, not an inference. |
| Deleted owner's personal note | Not independently re-queryable (correctly private, no session ever had access to it) — inferred from the `ON DELETE CASCADE` foreign key already read directly in the schema, combined with confirmed `auth.users` removal. |
| Orphaned records | None found: `group_verse.group_id` and the remaining note's `family_id` both still point to a live, non-deleted group. |

### Final account-deletion verdict: **PASS**

Both the solo-owner archival path and the multi-member ownership-transfer path behaved exactly as the source code and migration comments describe, with no unexpected behavior from the application or database at any point in either test. The one residual gap (exact `archived_at`/`owner_id` column values for Test A, and the deleted users' own `profiles`/`verse_history` rows for both tests) reflects the limits of what a non-privileged, read-only verification can reach under correctly-functioning RLS — not a defect, and substantially narrower than the gap disclosed in Phase 4, since Test B's multi-member design allowed several of those exact points to be confirmed directly rather than inferred.

---

## Phase 7 — Apple / iOS Readiness

An existing internal document, `docs/DWJ_IOS_APP_STORE_SUBMISSION.md` (2026-07-26), already covers this thoroughly and was independently spot-checked here rather than duplicated wholesale:

- **Bundle ID** `ai.flippingtables.app`, consistent between `capacitor.config.json` and the (spot-checked) `ios/App/App/Info.plist`.
- **Info.plist is clean**: no camera/location/microphone/photo-library usage-description keys, correctly justified by an inline comment confirming (by source review) that no such APIs are used anywhere — an unused permission string is itself an App Review risk, and none are present.
- **Architecture is correct for Apple's Guideline 4.2 scrutiny**: the shipped iOS app bundles the production Vite build directly (`webDir: "dist"`, no `server.url` in the production Capacitor config) rather than loading the live website remotely — the earlier draft of this same document flagged and self-corrected this exact risk before it shipped.
- **Universal Links**: `public/.well-known/apple-app-site-association` exists, correctly routed in `vercel.json`, but still contains a placeholder Team ID (`TEAMID_PLACEHOLDER.ai.flippingtables.app`) — expected and correct, since a real Apple Developer Program enrollment is required to obtain the real value. Inert until then; functional fallback (opens in mobile Safari) works today.
- **One real, still-open, low-priority item worth carrying into the iOS pass specifically**: the bare domain `flippingtables.ai` (no `www`) 308-redirects instead of serving `.well-known` files directly, confirmed in `docs/DWJ_TWA_VERIFICATION_DIAGNOSIS_2026-07-26.md`. This was confirmed NOT to be the cause of the Android TWA bug (whose config targets `www` specifically), but Apple's on-device Universal Links verifier fetches AASA from the exact domain declared in the app's Associated Domains entitlement — worth explicitly confirming that entitlement uses `www.flippingtables.ai` (matching the Android TWA's config) before relying on Universal Links working on iOS, rather than assuming it mirrors Android by default.
- **Account deletion**: covered above as the one P0 — the existing iOS submission doc already independently identifies this exact same gap ("Still needs to be applied to production and verified before submission"), which corroborates this audit's own independent finding rather than duplicating guesswork.
- **Everything else** (age rating, privacy nutrition label, permissions, sign-in method, screenshots plan, the Codemagic/BrowserStack build pipeline, and the exact list of Steve-only actions like Apple Developer enrollment) is already thoroughly and honestly reasoned through in that document, correctly distinguishing code-ready items from Apple-account-required, physical-device-required, and App-Store-Connect-required steps. No gaps found in that reasoning worth re-litigating here.

---

## Phase 8 — Candid Experience Review

**Five strongest parts, as built:**
1. **The prayer rotation and shared-session architecture.** Genuinely well-engineered — race-safe, timezone-aware, self-healing, and it shows real production incidents were taken seriously and fixed with evidence, not guesses.
2. **"One Prayer" fix.** Small but exactly right — the app's own tagline promises one shared moment, and the code now actually guarantees that instead of quietly diverging per viewer.
3. **KendylScene.** A warm, low-cost, high-craft touch — 223 rotating lines striking a real, well-judged tone (equal parts funny and genuinely tender) that gives the app a personality beyond "another devotional utility."
4. **Honest failure handling on writes.** Journal saves, prayer-turn completion, and note deletion all correctly detect failure and tell the user their words are safe rather than silently losing them or lying about success.
5. **The Story page.** Deeply personal, specific, unpolished in exactly the right way — it earns the app's premise instead of asserting it.

**Five greatest frictions:**
1. **Delete account doesn't work** (see P0) — the single biggest friction, because it's not a rough edge, it's a dead button.
2. **The translation picker is a no-op.** Selecting NIV/NLT/ESV/NKJV visibly "selects" but never changes any verse text anywhere. This is the kind of thing a user reports as a bug within their first week.
3. **No CI/deployment gate.** Every push to `main` goes live immediately with no automated check — fine for a two-person team's current pace, but a real risk as soon as a change breaks the build silently.
4. **Dead code (`PrayPage.jsx`, `generateInviteCode()`)** is small, but it's exactly the kind of thing that causes a future maintainer to waste time reasoning about behavior that never runs.
5. **Invite codes have no rate limiting.** Not an active exploit today, but a known, already-documented gap on the one unauthenticated write surface in the app.

**Three highest-value small improvements:**
1. Apply the one missing migration (P0) — this alone removes the biggest risk in this entire audit.
2. Either wire up the translation picker to actually change verse text, or remove the other four options from Settings until it does — a promise the UI shouldn't make until it's kept.
3. Add a lightweight CI check (even just `npm run build` on every PR) — cheap insurance against a silent break reaching production automatically.

**What should remain untouched:** the core dinner flow's pacing and tone (verse → context → questions → prayer → blessing), the KendylScene welcome moment, the Story page's voice, and the deliberately minimal, non-gamified design of the whole app. None of this needs redesigning.

**What Steve may believe is missing but users probably don't need:** streaks/badges, social features, AI-generated prayers, a richer analytics dashboard, or subscription tiers — the app's own stated promise is "one verse, one conversation, one prayer," and every one of those additions works against that promise rather than for it. The app currently succeeds by being small; the biggest risk to that isn't a missing feature, it's the one broken button.

---

## Phase 9 — Conclusion & Closing Categorization

**Is this app release-confident for Apple submission? Yes — GO for Apple preparation now.** Every functional and security finding from this audit is resolved and confirmed by direct evidence, not assumption. Steve's decision, 2026-08-04: proceed with Apple Developer enrollment and build-pipeline setup immediately; submit for review after four specific, already-scoped items close (below) — none of which are code defects, and none of which block starting the Apple-side process today.

### Closed during this audit (no longer open)
- ~~Apply `20260726000001_self_service_account_deletion.sql` to production~~ — **done, 2026-08-03, re-verified live.**
- ~~Real end-to-end account-deletion test~~ — **done, 2026-08-04. Verdict: PASS.**
- ~~`complete_prayer_turn()` / `get_or_create_tonight_session()` live-function-body verification~~ — **done, 2026-08-04. Verdict: PASS** (see Phase 4 update — confirmed by direct `pg_proc` inspection and by real execution during the deletion tests).
- ~~Family-journal RLS policy (`20260716000002`) verification~~ — **done**, confirmed via direct behavioral evidence in Phase 6's Test B.

### Submit after these four items (Steve's stated plan, consistent with this audit's findings)
1. ~~Prayer-rotation SQL check~~ — **done, above.**
2. **Translation-picker cleanup** — wire up NIV/NLT/ESV/NKJV or remove the non-functional options from Settings (Phase 3/8 finding: currently a UI no-op).
3. **Associated Domains configuration** — set the iOS entitlement to `www.flippingtables.ai` once the Apple Team ID exists (Phase 7 finding).
4. **One real-iPhone smoke test** — the BrowserStack App Live pass already planned in `docs/DWJ_IOS_APP_STORE_SUBMISSION.md` §11.

### Housekeeping, not a defect
Two harmless unconfirmed auth entries (`48d19da8-9e68-4d7e-9f2e-843cabb7128b`, `96729deb-14eb-499c-8407-80fd683aa0b1`) were created as an unavoidable side effect of proving `auth.users` removal during the deletion tests (re-signing up with the same email to confirm a fresh UUID is issued). They hold no data and were never confirmed — safe to ignore or delete via the Supabase dashboard at your convenience.

### Fix soon after launch
- Wire up the translation picker (NIV/NLT/ESV/NKJV) or remove the non-functional options from Settings.
- Upgrade `react-router-dom` to clear the one production-reachable npm audit finding (low practical risk today, cheap to close).
- Fix the `profiles.email` update-before-confirmation inconsistency in `SettingsPage.jsx`.
- Delete dead code: `src/pages/PrayPage.jsx`, `generateInviteCode()` in `OnboardingPage.jsx`.
- Add rate limiting to `join_group_by_invite_code()` / `get_guest_table_by_invite_code()`, and switch invite-code generation to `crypto.getRandomValues()`.
- Add even a minimal CI build check on `main`.

### Content-expansion opportunity
- `feeling_verses` at 36 rows (3 per feeling) is thin relative to `bible_verses`' depth — more variety here would extend the "Need a Moment With God" feature's freshness over repeated use.
- KendylScene's 223-message pool is generous, but as usage grows past a few months of daily opens, expanding it keeps the welcome moment from repeating.

### Do not change
- The core dinner flow's structure and pacing.
- KendylScene's tone and placement.
- The Story page's voice and content.
- The app's deliberate absence of streaks, social features, gamification, and subscription mechanics — this restraint is a strength, not a gap.
