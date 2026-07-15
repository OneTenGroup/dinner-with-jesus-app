# Dinner with Jesus — Post-Launch Full Audit
**Date:** 2026-07-14
**Auditor:** Claude Code (audit-only pass, no fixes applied)
**Branch:** `audit/dwj-post-launch` (documentation only — no application code touched)

> **Correction notice:** An earlier draft of this report incorrectly assumed Dinner with Jesus is a $4.99 one-time paid Play Store app, based on inaccurate initial briefing. Steve confirmed the app launched **free** on Google Play, with no current paid tier. That earlier "pricing mismatch" finding has been removed. This version replaces it with a pricing/monetization **consistency check** (§9) confirming the app's actual public copy and code are internally consistent with a free app — no inconsistency was found, so no legal-copy changes were made or are recommended.

---

## 1. Executive Summary

Dinner with Jesus is live and technically functional at its core — a family can sign up, form a "dinner circle," get a nightly verse, discuss it, pray, and save a journal entry. The app is not broken end-to-end. This audit found one P0-class security question that needs urgent verification, plus a cluster of P1 bugs that plausibly explain the "bugs and usability issues" Steve is seeing:

1. **Admin functionality (`AdminPage.jsx`) is gated only in the client.** If Supabase Row Level Security doesn't independently restrict the underlying tables, any signed-in user could — via browser devtools — read every user's email and profile data, delete any family's table, or broadcast a fake announcement to the whole user base. This cannot be confirmed or ruled out without access to the live Supabase project, and it is the top item to verify before doing anything else.
2. **A large fraction of write operations in the app don't check whether the write actually succeeded.** Saving a journal note, deleting a note, marking a verse "discussed," and several admin actions all show a success message unconditionally, even if the underlying database call silently failed (e.g., due to an RLS rejection or network hiccup). This is a strong candidate for the "usability issues" Steve is noticing — a parent could believe a precious family journal entry saved, and it never did.
3. **A JSON syntax error in `vercel.json`**, introduced five days ago (commit `79ad06d`, 2026-07-09, "Add route for delete account page"), likely breaks the account-deletion URL routing in production — on a feature that exists specifically for app-store compliance.
4. **Pricing/monetization consistency check: passed.** All public-facing copy this audit could reach (Terms of Service, privacy policy, landing page) and all in-app source code consistently describe a free app with no ads, no subscriptions, no premium tiers, and no purchase code of any kind. See §9 for the full check and the one item that remains unverifiable from this environment (the live Play Console listing itself).

This audit is code- and repo-based only. No physical Android device, emulator, or Google Play Console access was available in this environment, so every claim about live runtime/device/store behavior is explicitly marked **NOT TESTED** below rather than assumed. Nothing in production was changed — see §17/§18 and the final confirmation.

---

## 2. Production Architecture Discovered

**Repository ambiguity resolved with Steve before proceeding:** two "Dinner with Jesus" repositories exist on this machine —`C:\Projects\dinner-with-jesus` (a single static `index.html` design mockup, git history consisting entirely of drag-and-drop file uploads) and `C:\Projects\dinner-with-jesus-app` (a real React/Vite/Supabase codebase with auth, database-backed tables, journal, and legal pages). Steve confirmed **`dinner-with-jesus-app` is production.** All findings below refer to that repository.

- **Local path:** `C:\Projects\dinner-with-jesus-app`
- **GitHub repository:** `https://github.com/OneTenGroup/dinner-with-jesus-app.git`
- **Branch at audit start:** `main`, HEAD `79ad06da42334bbaa8be3caa008a001fd249f796` ("Add route for delete account page", 2026-07-09), clean except untracked `node_modules/` and `package-lock.json` (see Technical Debt — no `.gitignore` exists in this repo)
- **Audit branch created:** `audit/dwj-post-launch`, off `main` at the same commit
- **Stack:** React 18 + React Router 6 + Vite 5 + `@supabase/supabase-js` 2, `vite-plugin-pwa` for offline/installable PWA behavior. No native Android project (no `android/` folder), no Capacitor. Deployed as a web app (`vercel.json` present) and apparently wrapped for the Play Store as a Trusted Web Activity (TWA) via an external tool (PWABuilder/Bubblewrap) — **that wrapper project is not stored in this repository**, so its config (signing, versionCode, min/target SDK) is not auditable from source.
- **Application/package ID:** `ai.flippingtables.app` (from `public/manifest.json:2`) — this is very likely the Android application ID used when the TWA was generated, but cannot be confirmed against an actual Play Console listing from here.
- **Version name:** `1.0.0` (`package.json:3`). No Android `versionCode` exists anywhere in this repo.
- **Supabase project ref:** `mvswwnonafjencqumxvv` (from the hardcoded URL `https://mvswwnonafjencqumxvv.supabase.co` in `src/lib/supabase.js:3` and duplicated inline in `public/landing.html:19`)
- **Production web/marketing domain:** `flippingtables.ai` (referenced throughout `privacy-policy.html`, `terms-of-service.html`, `landing.html`)
- **Hosting:** Vercel (`vercel.json` present; routes file is malformed — see Confirmed Bugs #2)
- **Backend:** Supabase (Postgres + Auth + Realtime client library in use). No `supabase/` folder, no SQL migrations, and no dashboard/CLI credentials are present in this environment — RLS policies, table schemas, and any Postgres functions could not be inspected directly. This limits several findings to "confirmed in code, RLS-dependent in effect" rather than fully confirmed exploits.
- **Pricing model:** Free on Google Play (confirmed by Steve). No IAP/billing SDK, ad SDK, or subscription code exists anywhere in `package.json` or `src/` — consistent with a free app with no monetization mechanics in this codebase. See §9.

---

## 3. Published-Version / Source-Code Alignment

**NOT TESTED / CANNOT CONFIRM** — no Google Play Console access in this environment.

What can be said from the repository alone:
- There is **no CI/CD pipeline** (no `.github/workflows`), **no git tags**, and **no version-stamping mechanism** anywhere in this repo.
- The Android/TWA wrapper that would actually get uploaded to Play is generated outside this repository entirely.
- **Conclusion: the published Play Store build cannot be tied to a specific source commit from anything in this repo.** There is no reproducible, traceable path from "this commit" to "this Play Store release." That is itself a finding — see Technical Debt.
- The local repository's `main` branch is up to date with `origin/main` (no local-vs-remote drift) as of the audit's start, so at minimum the *source* seen here matches what's on GitHub. Whether that source matches what's actually live on Vercel and in the Play Store bundle could not be verified.

---

## 4. Tests Performed

- `npm install` — completed, 380 packages, no install failures (one benign `allow-scripts` warning for `esbuild`'s postinstall script)
- `npm audit` — completed, see Security Findings
- `npm run build` (production Vite build) — **succeeded**, output inspected (bundle sizes, PWA precache manifest, generated files)
- Static scan for hardcoded dev URLs / localhost / test credentials / stray `console.log`/`debugger`/`TODO` across `src/` — none found
- Static scan for ad SDKs, IAP/billing SDKs, subscription libraries, and donation/payment mechanisms in `package.json` and source (`src/` and `public/`) — **none found anywhere**: no ad network, no Stripe/PayPal/RevenueCat/billing library, no subscription/premium/paywall/feature-gate code, no donate button or contribution link on the landing page or in-app
- Full read of every source file in `src/` (all 12 pages, all hooks/lib/context files, the App shell) and every public HTML file (`landing.html`, `privacy-policy.html`, `terms-of-service.html`, `delete-account.html`) — manual code review for correctness, security, dead code, and content tone
- Git history review of `vercel.json` and the delete-account commit to establish root cause and date
- File-integrity check on `public/favicon.png` (byte-level) confirming corruption
- JSON validity check on `vercel.json` confirming it is malformed
- Manifest/PWA config cross-check (`public/manifest.json` vs. `vite.config.js`'s `VitePWA` manifest vs. what `index.html` actually links)
- Pricing/monetization consistency check across every public-copy and in-app-copy source available in this repo (§9)

## 5. Tests Not Performed and Why

All of the following are marked **NOT TESTED** — the exact blocker is given for each:

- Fresh Play Store install, first launch, splash/startup timing — **NOT TESTED: no Android device, emulator, or Play Store test-track access in this environment**
- Registration/onboarding, login/logout/session persistence, table creation/joining, verse/question/prayer flow, journal save/retrieval, invitations, deep links, settings, account/profile changes, account deletion — **traced statically through source code (see §Confirmed/Suspected Bugs and the code-journey trace), but not exercised on a running app or real Supabase project. NOT TESTED as live behavior.**
- Notifications — no notification code exists in the source at all (confirmed by grep), so there is nothing to runtime-test; marked **NOT TESTED / NOT IMPLEMENTED**
- Back-button behavior, app backgrounding/resume, weak/lost network, slow API responses, multiple simultaneous users, uninstall/reinstall, app upgrade over an old install — **NOT TESTED: requires a physical/emulated Android device and a real network environment**
- All of Phase 4 (Android-specific: cold start, ANRs, Logcat, keyboard covering fields, safe-area, gesture nav, rotation, text scaling, dark mode on-device, share sheet, notification permission flow) — **NOT TESTED: no Android Studio project, emulator, or device available**
- Google Play Console: rollout status, crash reports, Android vitals, pre-launch report, Data Safety declaration, store listing text/screenshots/icon/feature graphic, content rating, and **the listing's declared price/free status itself** — **NOT TESTED: no Play Console access in this environment.** Everything reachable from this repo (ToS, privacy policy, landing page, in-app code) is internally consistent with a free app (§9); confirming the Play Console listing itself shows "Free" (not "Free trial," not a hidden paid tier) is the one remaining gap and needs a direct look at the console.
- FAQs — **no FAQ page or content exists anywhere in this repository** (confirmed by search); if a FAQ exists elsewhere (e.g., only in the Play Store listing or a page not in this repo), it could not be checked for pricing-language consistency from here.
- Row Level Security policy contents, table schemas, Postgres functions, rate limiting — **NOT TESTED: no Supabase dashboard/CLI/service-role access in this environment; every RLS-dependent finding below is explicitly flagged as such**
- Real device performance measurement (cold start ms, API latency, memory) — **NOT TESTED: requires a running instance; only static bundle/asset size analysis was possible**

---

## 6. Confirmed Bugs

Each entry below was directly verified in the repository (code read, build output, byte-level file check, or git history) — not inferred.

### 6.1 — Admin dashboard has no server-verifiable access control in this codebase
- **Severity:** P0 (pending RLS verification — see §8)
- **Affected user:** every user, if RLS doesn't independently restrict the tables `AdminPage.jsx` touches
- **Repro:** Read `src/App.jsx:18` — `const ADMIN_USER_ID = '28356e7e-067c-49a8-81a2-095576c432a7'` and `:84` — `const isAdmin = user?.id === ADMIN_USER_ID`. This only controls whether the "Admin Dashboard" button renders (`SettingsPage.jsx:563-565`) and whether `<AdminPage>` mounts (`App.jsx:204`). `AdminPage.jsx:32-36` then issues plain `supabase.from('profiles').select('*')` / `groups` / `analytics` / `announcements` reads, and `:97-142` issues group-delete, verse-toggle, and global-announcement writes — all through the same public anon key every other page uses (`src/lib/supabase.js:3-4`).
- **Expected:** Admin-only data and mutations are enforced server-side (RLS policy scoped to the admin's UID, or a Postgres role check), independent of any client-side UI gate.
- **Actual:** Cannot be confirmed from this repo — no RLS policies, Postgres functions, or service-role usage exist in source. If the live RLS policies allow any authenticated user to read/write these tables, the client-side `isAdmin` check is purely cosmetic and any user could call the same Supabase queries directly from devtools.
- **Files:** `src/App.jsx:18,84,204`, `src/pages/SettingsPage.jsx:563-565`, `src/pages/AdminPage.jsx:32-36,97-142`, `src/lib/supabase.js:1-6`
- **Recommended fix:** Verify (this is the most urgent next step, before any other remediation) that every table `AdminPage.jsx` touches has RLS policies restricting reads/writes to the specific admin UID or an admin role/claim — not just "any authenticated user." If not, add that policy immediately.
- **Regression risk:** Low to add correct RLS; the risk is entirely in *not* verifying this promptly.
- **Test required after fix:** Attempt the same `supabase.from(...)` calls from a non-admin authenticated session (e.g., via browser devtools) and confirm they are rejected.
- **Estimated effort:** Small if RLS is already correctly scoped (just needs confirming); Medium if policies need to be written.

### 6.2 — `vercel.json` is invalid JSON; the account-deletion route is almost certainly unreachable
- **Severity:** P0/P1
- **Affected user:** any user trying to reach `/delete-account`, and potentially all custom routing if Vercel falls back to default behavior
- **Repro:** `Get-Content vercel.json | ConvertFrom-Json` fails with `Invalid array passed in, ',' expected` pointing at the transition between the catch-all route and the delete-account route. Exact text (`vercel.json:15-16`):
  ```json
      { "src": "/(.*)", "dest": "/index.html" }
      { "src": "/delete-account", "dest": "/delete-account.html" },
  ```
  Two problems in one: (1) missing comma between the two route objects, making the whole file invalid JSON; (2) even if the comma were fixed, the catch-all `/(.*)`  is listed *before* `/delete-account`, and Vercel routes match top-to-bottom — the catch-all would intercept the request first regardless.
- **Root cause (dated and attributed):** commit `79ad06d`, author `steve@onetengroup.ai`, 2026-07-09, "Add route for delete account page" — a one-line append that introduced both the syntax error and the ordering bug.
- **Expected:** `flippingtables.ai/delete-account` serves `delete-account.html`.
- **Actual:** Very likely serves the SPA shell (`index.html`) instead, or Vercel silently ignores the whole malformed routes array and falls back to default static-file routing (in which case `/delete-account` 404s since the actual file is `delete-account.html`, not `delete-account`).
- **Files:** `vercel.json`
- **Recommended fix:** Fix the JSON (add the missing comma) and reorder so `/delete-account` is listed before the catch-all `/(.*)`.
- **Regression risk:** Very low — this is a small, mechanical fix.
- **Test required after fix:** Validate `vercel.json` parses as JSON; after deploy, load `flippingtables.ai/delete-account` directly and confirm it renders the deletion instructions, not the app shell.
- **Estimated effort:** Small.

### 6.3 — No in-app account-deletion entry point
- **Severity:** P1 (compliance-adjacent — Google Play policy expects an accessible, discoverable account-deletion path)
- **Affected user:** any signed-in user wanting to delete their account
- **Repro:** `SettingsPage.jsx` (572 lines, full file read) contains zero references to "delete"/"Delete" for account/data removal. The only deletion path anywhere in the product is the standalone `public/delete-account.html`, which is not linked from Settings (Settings links `/privacy-policy` and `/terms-of-service` at `SettingsPage.jsx:532-533`, but never `/delete-account`).
- **Expected:** A user inside the app can find and initiate account deletion without already knowing a special URL exists.
- **Actual:** No such path exists in-app.
- **Files:** `src/pages/SettingsPage.jsx` (absence), `public/delete-account.html` (orphaned)
- **Recommended fix:** Add a "Delete my account" link/button in Settings pointing to `/delete-account` (once §6.2 is fixed) or, better, wire it to an actual self-service deletion flow.
- **Regression risk:** Low.
- **Test required after fix:** Confirm the link is visible in Settings and resolves correctly.
- **Estimated effort:** Small (link only) to Medium (real self-service deletion).

### 6.4 — Corrupted favicon (2-byte file)
- **Severity:** P1 for brand trust, P2 functionally
- **Affected user:** every user, on every page load, browser tab, bookmark, and share preview
- **Repro:** `public/favicon.png` is exactly 2 bytes (`0x0D 0x0A`, i.e. a bare CRLF) — not a valid PNG. Referenced at `index.html:7-8` for both `rel="icon"` and `rel="apple-touch-icon"`. A visually correct 423 KB image exists in the same folder under the wrong filename, `public/publicfavicon.png`, which is never referenced anywhere in source (only picked up incidentally by the PWA precache list in `dist/sw.js`).
- **Expected:** A real icon shows in the browser tab / share cards / bookmarks.
- **Actual:** Broken/blank icon.
- **Root cause:** Almost certainly a file mix-up when a new favicon was added — the new image landed as `publicfavicon.png` instead of overwriting `favicon.png`.
- **Files:** `public/favicon.png`, `public/publicfavicon.png`, `index.html:7-8`
- **Recommended fix:** Replace `public/favicon.png` with a correctly sized, real PNG (reuse/derive from `publicfavicon.png` or the existing `public/icons/icon-192.png`), then delete the orphaned `publicfavicon.png`.
- **Regression risk:** None.
- **Test required after fix:** Load the site, confirm the tab icon renders; check a social share preview.
- **Estimated effort:** Small.

### 6.5 — Widespread "success" feedback shown even when the database write silently failed
- **Severity:** P1 — plausible root cause of Steve's reported "bugs"
- **Affected user:** anyone saving a journal note, deleting a note, marking a verse discussed, or an admin performing any admin action
- **Repro:** Supabase-js resolves (does not throw) on an RLS-denied or failed write; the caller must explicitly check the returned `error`. These paths don't:
  - `src/pages/JournalPage.jsx:76-84` (`deleteNote`) — toast reads "Note deleted." unconditionally
  - `src/pages/TablePage.jsx:172-201` (`saveNote`) — "Saved. ✓" fires unconditionally
  - `src/pages/TablePage.jsx:127-141` (`markDiscussed`) — UI flips to "discussed" regardless of DB outcome
  - `src/pages/AdminPage.jsx:97-142` (`resetUserGroup`, `deleteGroup`, `toggleVerse`, `sendAnnouncement`, `clearAnnouncement`) — none check `error`
  - By contrast, `SettingsPage.jsx:216-254` (name/email/password updates) *do* correctly check and surface errors — so the pattern is inconsistent, not universal, which makes it harder for users (and Steve) to know which "Saved" messages can be trusted.
- **Expected:** A failed save shows an error, not a success toast.
- **Actual:** Users can lose a saved family memory (the exact kind of thing this app exists to protect) with no indication anything went wrong.
- **Files:** as listed above
- **Recommended fix:** Destructure and check `{ error }` on every Supabase write; show an honest error state on failure. This is a mechanical, low-risk fix that should be applied consistently across all write paths.
- **Regression risk:** Low.
- **Test required after fix:** Temporarily force a write failure (e.g., revoke a permission or disconnect network) and confirm the UI now shows an error instead of a false success.
- **Estimated effort:** Medium (touches many files, but each change is small and mechanical).

### 6.6 — "Message from Jesus" splash (KendylScene) is session-based, not daily, despite its own copy
- **Severity:** P1 for experience quality
- **Affected user:** every returning user
- **Repro:** `src/components/KendylScene.jsx:237-247` gates the scene using `sessionStorage` key `dwj_seen_this_session`. The in-scene copy says *"Come back tomorrow. I've got something to say to you."* (`:229`), implying a once-per-day cadence. A same-named-but-unused helper, `getDayKey()` (`:232-235`), suggests day-based gating was intended but never wired in.
- **Expected:** The scene shows once per calendar day, as its own text promises.
- **Actual:** It shows once per app session — meaning it reappears every time the Android app (or PWA) is fully closed and reopened, which for a mobile app killed by the OS could be several times a day.
- **Files:** `src/components/KendylScene.jsx:232-247`
- **Recommended fix:** Swap `sessionStorage` gating for the already-written (but unused) `getDayKey()` day-based logic, or persist "last seen date" to `localStorage`/the user's profile.
- **Regression risk:** Low.
- **Test required after fix:** Force-close and reopen the app twice in one day; confirm the scene shows only on the first open.
- **Estimated effort:** Small.

### 6.7 — Translation picker in Settings does nothing
- **Severity:** P2
- **Affected user:** any user who selects NIV/NLT/ESV/NKJV expecting the app to switch translations
- **Repro:** `SettingsPage.jsx:507-516` lets a user pick among KJV/NIV/NLT/ESV/NKJV and persists the choice via `updateProfile({ preferred_translation: t })`, with the caption directly underneath admitting *"WEB translation loaded. Other translations coming soon."* (`:516`). `BiblePage.jsx` only ever reads `text_web`/`text_kjv` columns (`:64-70,204`) — nothing reads `preferred_translation`.
- **Expected:** Either the picker is hidden/disabled until the feature ships, or it works.
- **Actual:** A user can "select" ESV and see no change, with no clear explanation why, despite the row appearing fully interactive.
- **Files:** `src/pages/SettingsPage.jsx:507-516`, `src/pages/BiblePage.jsx:64-70,204`
- **Recommended fix:** Either hide the non-functional options (leave only WEB/KJV, which are actually implemented) or clearly mark the others "Coming soon" and disable selection.
- **Regression risk:** None.
- **Test required after fix:** Confirm only working options are selectable.
- **Estimated effort:** Small.

### 6.8 — Duplicate PWA manifests, one of them internally inconsistent
- **Severity:** P3
- **Repro:** `index.html:11` links `/manifest.json` (the real, correctly-pathed one). Separately, `vite.config.js:19-41`'s `VitePWA` plugin auto-generates `dist/manifest.webmanifest` with a different `short_name`, `start_url`, and icon paths (`/icon-192.png` at the root, which doesn't exist — actual icons live under `/icons/`). This generated file is orphaned (nothing links to it) but is still built and shipped in every deploy.
- **Impact:** No live bug today (the linked manifest is fine), but pure confusion/clutter risk for anyone regenerating the Play Store TWA wrapper later, since PWA-wrapping tools sometimes auto-discover `manifest.webmanifest`.
- **Files:** `vite.config.js:19-41`, `public/manifest.json`, `index.html:11`
- **Recommended fix:** Remove the redundant manifest block from `vite.config.js`'s `VitePWA` config, or point `vite-plugin-pwa` at the real `public/manifest.json` via `manifestFilename`/`injectManifest` so there's exactly one source of truth.
- **Estimated effort:** Small.

---

## 7. Suspected Bugs Requiring More Evidence

These are real code-level observations whose actual production impact depends on Supabase RLS policy contents, which are not visible from this repository.

- **Unscoped `verse_history` reads** (`src/pages/HomePage.jsx:86-89`, `src/pages/TablePage.jsx:88-91`, `src/pages/SettingsPage.jsx:28-31`) — no filter at all when building the "already-discussed" verse pool. Either RLS permits any authenticated user to read every group's history (a data-scoping leak), or RLS scopes it to the caller and the de-dup feature silently only excludes the current user's own history rather than the whole table. **Needs:** RLS policy for `verse_history` SELECT.
- **Unscoped `notes` delete** (`src/pages/JournalPage.jsx:78`) — deletes by note ID with no ownership filter. **Needs:** RLS policy for `notes` DELETE, and ideally a test deleting another user's note ID directly.
- **`removeMember` cross-user profile write** (`src/hooks/useFamily.js:144-159`) — a group owner's client updates *another user's* `profiles.group_id` based only on a client-side `isOwner` flag. **Needs:** confirmation that RLS actually permits "group owner" writes to other members' profile rows (an unusual policy shape) rather than this silently failing (see §6.5 — it wouldn't show an error either way).
- **Invite-code collision handling** (`src/hooks/useFamily.js:76-86`) — assumes `groups.invite_code` has a DB-level unique constraint but doesn't distinguish a collision error from any other insert failure, so a collision (rare, ~1-in-a-billion per attempt, but not zero) would just show a generic "Could not create group" with no retry. **Needs:** confirmation a unique constraint exists.

---

## 8. Security / Privacy Findings

(Numbering continues from the bug list where the same issue applies; see §6.1, §6.5 (unscoped reads), §7 for the RLS-dependent items. Additional findings not already covered above:)

- **Invite/table-code generation is not cryptographically random.** `src/hooks/useFamily.js:76-78` (duplicated in `src/pages/OnboardingPage.jsx:49-53`):
  ```js
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))
  ```
  `Math.random()` is not a CSPRNG. The keyspace (32⁶ ≈ 1.07 billion) makes brute-forcing impractical for casual abuse, but this code is the *sole* access control for the no-login guest table view (`GuestTablePage.jsx:20-59`) — anyone with a valid code sees that family's verse, questions, and prayer content for the night. Low real-world risk given the keyspace and lack of any obvious enumeration UI, but worth tightening (`crypto.getRandomValues`) since it's acting as a bearer token, not just a UX nicety.
- **No rate limiting visible anywhere in this repo** on group-join lookups or guest-table access — any throttling, if present, would be Supabase/edge-level and isn't visible here.
- **Credentials are hardcoded, not environment-variable-driven.** The Supabase URL and anon key are hardcoded in three places: `src/lib/supabase.js:3-4` and duplicated inline in `public/landing.html:19-20`. The anon key is *designed* to be public (it's meaningless without correct RLS), so this is not a secret leak by itself — but the complete absence of `.env`/Vite env vars anywhere in the project means there is no mechanism to point at a staging Supabase project without editing source, and no separation between environments. Filed as technical debt (§14), not a live vulnerability.
- **No `dangerouslySetInnerHTML`/`innerHTML` usage found anywhere in `src/`** — no obvious XSS vector in how journal notes, names, or group names are rendered (React's default JSX escaping is relied on throughout, correctly).
- **Admin user ID is hardcoded in shipped client JS** (`src/App.jsx:18`) — not itself a secret (a Supabase user UUID isn't sensitive), but it does mean anyone reading the bundle knows exactly which account is the admin account, which is free reconnaissance for a social-engineering or credential-stuffing attempt against that specific account. Low severity, easy to note.
- **Children's privacy:** `privacy-policy.html:82` and `terms-of-service.html:50` both state a 13+ age requirement (COPPA-consistent framing), consistent with the "family-oriented" positioning; no code-level age-gate exists at signup (`AuthPage.jsx`) beyond the policy text — this is standard for apps in this category and not flagged as a defect, just noted for completeness given the family/kids-adjacent audience.
- **Third-party service disclosure (`privacy-policy.html:84-91`) lists "Resend" for transactional email**, but no Resend integration exists anywhere in this source tree — email is presumably handled via Supabase Auth's built-in templates. This is either a stale disclosure (naming a service no longer/never actually used) or a server-side integration invisible from this repo. Worth a quick verification so the privacy policy doesn't over- or under-disclose.

---

## 9. Google Play Findings

**NOT TESTED — no Google Play Console access in this environment.** Rollout status, version code/name as registered with Play, crash reports, Android vitals, ANR rate, device-specific failure data, install failure rate, pre-launch report warnings, Data Safety declaration content, in-console privacy-policy link validity, app-access instructions, content rating, target-audience declaration, store listing text/screenshots/icon/feature graphic, support/developer contact fields, release notes, and testing-track configuration were all out of reach.

### Pricing & Monetization Consistency Check

Per Steve's correction, the app launched **free** on Google Play with no current paid tier. This audit checked every public-copy and in-app-copy surface reachable from the repository for consistency with that fact, and to confirm no hidden monetization exists:

| Surface | Finding |
|---|---|
| `public/landing.html` | States "Free forever," "Free. No ads. Just family.," "Come to the Table — Free," "Free. Always." throughout (lines 7, 447, 452, 538, 549). **Consistent with a free app.** |
| `public/terms-of-service.html` §8 "Voluntary Contributions" | *"Dinner with Jesus is free to use. We may offer optional voluntary contributions to support the App and The Table ministry. All contributions are voluntary and non-refundable. Contributions do not entitle you to additional features or services beyond what is available to all users."* This is phrased conditionally ("we may offer") and already states contributions carry no feature entitlement — **already compliant** with "voluntary and unrelated to app access." No active donate button, donation link, or payment flow exists anywhere in `public/` or `src/` (confirmed by search) — the clause describes a possible future/occasional option, not a currently-live mechanism. **No inconsistency found; no copy change made or recommended.** |
| `public/privacy-policy.html` | Does not mention pricing at all — silent on the topic, which is not a contradiction. |
| In-app source (`src/`) | No ad SDK, no billing/IAP library, no subscription/premium/paywall/feature-gate code, no donation UI anywhere in `package.json` or the 12 page components (confirmed by dependency review and full-file reads). **Consistent with a free app with no monetization mechanics.** |
| FAQs | No FAQ content exists anywhere in this repository. If a FAQ page exists outside this repo (e.g., only within the Play listing), it could not be checked. |
| Google Play Console listing | **NOT TESTED — no console access.** This is the one surface this audit cannot verify directly. Recommend Steve (or whoever has console access) confirm the listing is marked "Free" with no in-app purchase items configured, to close the loop with everything above. |

**Result: no inconsistency found across any of the surfaces this audit could reach.** Confirmed via code review: no subscriptions, no advertisements, no premium tiers, no feature gates, and no required purchases exist anywhere in the current codebase. No legal-copy changes were made, per instruction, since no actual inconsistency was found.

---

## 10. Performance Findings

Measured from the actual `npm run build` output (not simulated):

- **JS bundle:** `dist/assets/index-D-djSOFj.js` = 510.91 kB minified / 142.61 kB gzipped, all in a single chunk. Vite's own build output flags this: *"Some chunks are larger than 500 kB after minification."* No code-splitting/dynamic `import()` is used anywhere — every page (including the fully unused `PrayPage.jsx`, §11 dead code) ships in one bundle loaded on first paint.
- **PWA precache footprint:** Workbox precaches 16 entries totaling **4,759.99 KiB (~4.76 MB)** on first load/install — this is what a user's device downloads before the app is usable offline.
- **Largest contributors:** `public/jesus-at-table.png` (1.97 MB) and `public/jesus-welcome.png` (1.9 MB) — two hero images, uncompressed/unresized for web, together ~3.9 MB of the 4.76 MB precache. `jesus-at-table.png` is additionally `<link rel="preload">`-ed in `index.html:3`, meaning it competes for bandwidth during the critical initial page load on every visit, not just install.
- **Orphaned asset:** `public/publicfavicon.png` (423 KB) is precached despite never being referenced by any page (§6.4) — pure waste.
- These numbers translate directly to Phase 3's weak-network/slow-API concerns: on a slow or metered connection, first load/install of this app is downloading nearly 5 MB before anything is usable, largely driven by two unoptimized images.
- **Recommended fix (not urgent, but real):** resize/compress both hero PNGs (convert to WebP, target well under 200 KB each for imagery of this kind) and remove the preload hint or replace it with a properly sized image; delete `publicfavicon.png`.
- **Not measured (requires a running instance):** cold-start time, warm-start time, actual API response latency, time-to-first-useful-screen, real device memory behavior. Marked **NOT TESTED**.

---

## 11. User-Experience Findings

Reviewed as a warm/simple faith-centered family experience, per Steve's stated vision — evaluated from the code and copy, not a live device session.

- **Tone is genuinely warm and on-brand.** Sampled copy (§12) reads as intentional, gentle, and consistent with "a spark, not a replacement for family conversation" — e.g. `HomePage.jsx:19` *"The table is ready. So is He."*, `TablePage.jsx:8` blessing copy, `OnboardingPage.jsx:216` *"Welcome to the Table."* This is a real strength worth preserving carefully in any future work.
- **The KendylScene daily-message concept is a strong differentiator** (a warm, personal "message from Jesus" moment) but its actual cadence bug (§6.6) works directly against the intended experience — reappearing multiple times a day risks feeling repetitive or gimmicky instead of special, which cuts against Steve's "not gamified, not repetitive" goals even though nothing about it is literally a game mechanic.
- **The translation picker (§6.7) is the kind of "looks interactive, does nothing" UI element that erodes trust** in an app whose whole value proposition is warmth and reliability — worth fixing precisely because it's small and easy to fix.
- **Silent-failure saves (§6.5) are the most experience-damaging finding in this audit** — this app's core promise is capturing "something someone said that you never want to forget," and right now some fraction of those saves can silently vanish with no indication to the family that anything went wrong.
- **Prayer-turn tracking is not persisted** (`TablePage.jsx:38-44,157-170` — purely client-side state) — if the app is backgrounded or refreshed mid-meal, whose turn it is to pray resets. Minor but worth knowing; not classified as a bug since there's no stated requirement it persist, but it works against the "phones-down" flow if someone has to fiddle with the app again after an interruption.
- **Account deletion is not discoverable in-app** (§6.3) — for an older adult or less technical user specifically named in Steve's review personas, "email us and wait 30 days" with no in-app pointer to that fact is a rough, unclear off-ramp.

## 12. Content Findings

Representative verbatim copy (also listed in the background review, consolidated here):
- `AuthPage.jsx:124` — *"Not a ritual. A relationship."*
- `HomePage.jsx:19` — *"The table is ready. So is He."* / *"Pull up a chair. Someone's been waiting."*
- `JournalPage.jsx:160-161` — *"Your personal journal is empty. Write something worth remembering."*
- `TablePage.jsx:8` — *"Go now — and carry what happened at this table into the rest of your night. I'll be here tomorrow. Same time. Same table. Don't be late. 🙏"*
- `KendylScene.jsx:3` — *"I turned water into wine. The least you can do is show up on time."*

No content found that reads as preachy, corporate, or artificial. Discussion questions are delivered in three tiers per verse (`question_level_1/2/3`, all three always shown together per `TablePage.jsx:143-148`) — content quality/appropriateness of the actual verse/question database itself could not be assessed since that data lives in Supabase, not this repo. The app's pricing/free messaging is accurate and consistent (§9) — everything in the app's actual voice supports Steve's vision well.

## 13. Accessibility Findings

Not systematically audited (would require a running instance with a screen reader/accessibility inspector — **NOT TESTED**). One static observation: `index.html:5`'s viewport meta tag includes `user-scalable=no`, which disables pinch-to-zoom — a real accessibility concern for older adults or low-vision users, directly relevant to the "older adult who is not technically confident" persona Steve asked this audit to consider. Recommend removing `user-scalable=no` unless there's a specific reason for it.

## 14. Technical Debt

- No `.gitignore` in the repository — `node_modules/` and `package-lock.json` are untracked by omission, not by intent, and nothing prevents them from being accidentally committed. **No lockfile is committed at all**, so builds aren't guaranteed reproducible across machines/CI.
- No environment-variable usage anywhere (`.env` files) — Supabase credentials are hardcoded in source in multiple places (§8), making a staging environment impossible without editing code.
- No test framework, no test files, anywhere in the project.
- No ESLint/lint configuration at the project root.
- No CI/CD pipeline, no release tagging — nothing ties a Play Store build back to a commit (§3).
- Four separate, slightly-diverging implementations of "lock tonight's verse for the group" logic (`HomePage.jsx:71-112`, `SettingsPage.jsx:15-54`, inline in `TablePage.jsx:57-119`, inline in `OnboardingPage.jsx:136-163`).
- Duplicated invite-code generator (`useFamily.js:76-78`, `OnboardingPage.jsx:49-53`) and duplicated invite/share-message builders in five places.
- `src/pages/PrayPage.jsx` (317 lines) is fully built and completely unrouted/unreachable — dead weight in the bundle, and worth a decision: finish wiring it in, or delete it.
- No Android/TWA wrapper project stored in version control at all.

## 15. Recommended Upgrades

Scoped to what genuinely strengthens the existing simple, warm, free product — nothing here adds complexity for its own sake:
- Fix the write-error-handling pattern app-wide (§6.5) — the single highest-leverage reliability fix available.
- Verify and, if needed, correct RLS policies for the admin-only tables (§6.1) — the single highest-leverage security fix available.
- Add environment-variable-driven Supabase config so a staging project can exist without editing source — this directly protects "the working production system," which is a named constraint.
- Add a minimal CI step that at least runs `npm run build` on every push, so a broken build (or a malformed `vercel.json`) is caught before it reaches production instead of five days later.
- Consolidate the four duplicated "lock verse" implementations into one shared function — reduces the chance that a future fix lands in only one of the four copies.

## 16. Things That Should NOT Be Added

Per Steve's explicit constraints, and reaffirmed by this audit: no subscriptions, no premium tiers, no feature gates, no ads, no streaks/badges/points/leaderboards/gamification of any kind, and no paid tier of any kind — confirmed the app is and should remain free. Nothing found in this audit suggests adding any of these would fix anything uncovered here — every confirmed bug above is a reliability, security, or accuracy problem, not a "needs monetization or more features" problem. Specifically avoid the temptation to turn the admin dashboard into a bigger internal tool, to add analytics dashboards beyond what already exists, to build out the "voluntary contributions" clause into an active donation flow unless Steve specifically wants that, or to "gamify" the prayer-turn tracker (e.g., streaks) to compensate for its lack of persistence — the fix there is just to persist it quietly, not to make it a feature.

## 17. Remediation Plan

See the prioritized lists below (§A/B/C). In sequence:
1. Verify RLS on admin-touched tables (§6.1) — do this first, before anything else, since it's the one finding with a plausible mass-data-exposure blast radius.
2. Fix `vercel.json` (§6.2) and confirm `/delete-account` resolves correctly in production.
3. Add an in-app account-deletion entry point (§6.3).
4. Fix the write-error-handling pattern across journal/table/admin actions (§6.5).
5. Fix the favicon (§6.4) and the KendylScene daily-cadence bug (§6.6) — both small, both visible to every user.
6. Confirm the Google Play Console listing itself is marked Free (the one gap §9 couldn't close) — a quick console check, not a code change.
7. Everything else in §B/§C on a normal cadence.

## 18. Regression-Test Plan

After each fix above, re-verify manually (no automated test suite exists yet — see Technical Debt):
- Attempt admin-only Supabase calls from a non-admin session; confirm rejection.
- Load `/delete-account` directly in production; confirm correct page renders.
- Confirm the Play Console listing shows Free with no configured in-app purchase items.
- From Settings, locate and follow the account-deletion path.
- Save a journal note, then force a failure (e.g. airplane mode mid-save) and confirm an honest error appears instead of a false "Saved."
- Load the app fresh, confirm favicon renders in the browser tab.
- Force-close and reopen the app twice in one calendar day; confirm the Jesus-message scene shows only once.
- Re-run `npm run build` and confirm no new warnings were introduced.

---

## A. FIX BEFORE PROMOTION
*(Launch-critical, trust-damaging — do these before actively promoting/marketing the app further)*
1. Verify/fix RLS on admin-gated tables (§6.1)
2. Fix `vercel.json` JSON error + route order; confirm `/delete-account` works live (§6.2)
3. Add an in-app link to account deletion (§6.3)
4. Fix silent-failure "Saved"/"Deleted" toasts on journal and table actions (§6.5, at minimum `JournalPage.jsx` and `TablePage.jsx`)

## B. NEXT 30 DAYS
*(Reliability, clarity, retention, operational hygiene)*
- Fix the corrupted favicon and delete the orphaned `publicfavicon.png` (§6.4)
- Fix KendylScene's daily-vs-session cadence bug (§6.6)
- Hide or fix the non-functional translation picker (§6.7)
- Extend error-checking to the remaining write paths, including `AdminPage.jsx` actions (§6.5)
- Add environment-variable-driven Supabase config (§14/§15)
- Add a `.gitignore` and commit a lockfile for reproducible builds (§14)
- Compress/resize the two hero images; drop the precache/bundle footprint from ~4.76 MB toward something much smaller (§10)
- Add a minimal CI build check (§15)
- Verify the invite-code generator against a real unique-constraint/collision story, or add explicit retry logic (§8)
- Remove `user-scalable=no` from the viewport meta tag unless there's a specific reason to keep it (§13)
- Confirm the Play Console listing itself is marked Free (§9)

## C. LATER / OPTIONAL
*(Nice-to-have, not urgent, not scope-expanding)*
- Consolidate the four duplicated "lock verse" implementations into one shared function
- Decide the fate of the fully unused `PrayPage.jsx` — finish it or delete it
- Move to crypto-secure invite-code generation (`crypto.getRandomValues`) since the code doubles as a bearer token for guest access
- Remove the redundant `vite-plugin-pwa` auto-generated manifest or reconcile it with the real one (§6.8)
- Add a lightweight test suite covering the core table/journal/auth flows
- Persist prayer-turn state so it survives a refresh/backgrounding
- Verify the "Resend" third-party disclosure in the privacy policy still matches reality

---

*No production application code, database contents, RLS policies, or Google Play Console settings were changed during this audit. This document and the audit branch are the only artifacts created.*
