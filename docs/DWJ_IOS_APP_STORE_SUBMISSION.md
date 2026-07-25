# Dinner with Jesus — iOS App Store Submission Package

**Date:** 2026-07-26
**Status:** Pre-enrollment preparation. No Apple Developer Program account exists yet. Nothing has been uploaded to App Store Connect, no paid service has been purchased, no production behavior has changed without explicit prior approval (see each section for what's committed vs. merely prepared).

**Architecture correction (2026-07-26):** the first draft of this document used Capacitor's `server.url` to point the iOS app at the live remote site, mirroring the Android TWA. That was wrong for iOS — Capacitor's own documentation describes `server.url` as a live-reload development tool, not a production distribution mechanism, and it invites exactly the Guideline 4.2 "repackaged website" scrutiny this document originally tried to argue around. **Corrected: the shipped iOS app now bundles the Vite production build directly** (`webDir: "dist"`, no `server` block in `capacitor.config.json`) via the standard `npx cap sync ios` workflow. The app launches its own bundled `index.html`/JS/CSS from local storage, exactly like any other Capacitor app — it does not fetch its interface from the network on launch. **Supabase and all other remote calls are unaffected**: `src/lib/supabase.js` already talks to `https://mvswwnonafjencqumxvv.supabase.co` via an absolute URL, entirely independent of where the HTML/JS/CSS shell itself was loaded from — auth, database, and RPC calls work identically whether the shell is bundled or remote. A separate, clearly-labeled `capacitor.config.dev.json` retains `server.url` for local live-reload development only; it is never used for a CI, TestFlight, or App Store build.

---

## 1. What was built (files and commits)

| Area | What | Where |
|---|---|---|
| Capacitor core | `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, plus `app`, `status-bar`, `keyboard`, `splash-screen`, `browser` plugins | `package.json` |
| Config | Bundle ID `ai.flippingtables.app`, remote `server.url`, safe-area/keyboard/status-bar/splash settings | `capacitor.config.json` |
| iOS project | Scaffolded Xcode project (buildable only on macOS, but the project files, Info.plist, and asset catalogs are all real and already configured) | `ios/App/` |
| App icon | 1024×1024, generated from the existing 512px source (see risk note below) | `ios/App/App/Assets.xcassets/AppIcon.appiconset/` |
| Launch screen | Brand-colored (#0D1829) splash matching the web app's own loading screen, background-color-corrected storyboard (was defaulting to white) | `ios/App/App/Assets.xcassets/Splash.imageset/`, `ios/App/App/Base.lproj/LaunchScreen.storyboard` |
| Info.plist | Portrait-only (iPhone + iPad), status bar style set app-wide, **no** camera/location/microphone/photo-library usage-description keys (none are used anywhere in the app — confirmed by source review) | `ios/App/App/Info.plist` |
| Native bridge | Splash-screen handoff, status bar style, external-link interception, **plus** `getAuthRedirectOrigin()` (fixes auth email links under bundling) and `appUrlOpen` handling for Universal Links (§1a) — all `Capacitor.isNativePlatform()`-gated, no-op on web/Android | `src/lib/nativeBridge.js`, wired into `src/App.jsx`, `src/context/AuthContext.jsx`, `src/pages/AuthPage.jsx` |
| Config split | `capacitor.config.json` (production, bundled, no `server` block) vs. `capacitor.config.dev.json` (dev-only live-reload, never used for a real build) | `capacitor.config.json`, `capacitor.config.dev.json` |
| Safe areas | `viewport-fit=cover` added to the shared `index.html` (harmless on web/Android); `.app-shell` gets `padding-top: env(safe-area-inset-top)` to match the bottom nav's pre-existing `env(safe-area-inset-bottom)` | `index.html`, `src/index.css` |
| Universal Links (prep only) | `apple-app-site-association` with a placeholder Team ID, deployed with correct routing/content-type — **inert until the real Team ID is filled in post-enrollment** | `public/.well-known/apple-app-site-association`, `vercel.json` |
| **Account deletion (the biggest fix)** | New self-service `delete_own_account()` RPC + in-app typed-confirmation UI in Settings, replacing the email-only flow as the primary path (email kept as a documented fallback) | `supabase/migrations/20260726000001_self_service_account_deletion.sql` (NOT applied to production), `src/context/AuthContext.jsx`, `src/pages/SettingsPage.jsx` |

All of the above is committed to `main` on `dinner-with-jesus-app` **except** the account-deletion migration, which is written and reviewed but deliberately left unapplied, exactly like every other database change in this engagement's established pattern — it needs the same "apply and verify against production" step the Android ownership-protection work went through, and that's a production-data action, not a pre-enrollment-prep one.

---

## 1a. Verification under the bundled architecture

Reasoned through against the actual code (not assumed), since this environment has no way to run the iOS app on a device or simulator. Each item below should still get a real pass during the BrowserStack App Live test in §11.

| Flow | Under bundling, expected to... | Why |
|---|---|---|
| Signup / login | Work identically | Supabase Auth calls are absolute-URL network requests, unaffected by shell origin |
| Session persistence | Work identically within the app | supabase-js persists to the webview's own localStorage; that storage is private to the app (not shared with mobile Safari) but persists across app relaunches the same as any native app's local storage |
| Password reset | **Fixed, was broken by the bundled switch** — see below | |
| `/app` routing | Unaffected | `/app` is a *web-server* route alias (`vercel.json`); the bundled app's own `index.html` is its own root document and never needs that alias |
| Universal Links | **Now wired**, inert until Team ID exists | See below |
| External links | Unaffected | Already handled by `nativeBridge.js`'s `Browser.open()` interception, independent of shell origin |
| Dinner flow / journaling | Unaffected | All read/write calls go straight to Supabase via absolute URLs |
| Account deletion | Unaffected by bundling; separately tested — see §2a | |

**Password reset / signup confirmation — real bug found and fixed:** Supabase's `emailRedirectTo`/`redirectTo` previously used `window.location.origin`. Under `server.url`, that was the real website's origin, so it worked by accident. Under bundling, the webview's own origin is a non-http Capacitor scheme — a confirmation/reset email would have linked to something no mail client can open. Fixed by adding `getAuthRedirectOrigin()` (`src/lib/nativeBridge.js`): returns the real production origin (`https://flippingtables.ai`) when running in the native app, and `window.location.origin` everywhere else (web/Android — zero behavior change there, confirmed by the `Capacitor.isNativePlatform()` gate). `AuthContext.jsx` (signup) and `AuthPage.jsx` (password reset) both updated to use it.

**Universal Links — now actually wired to in-app navigation:** under the old remote-URL design, a tapped link could just reload the (remote) page at that path and it would work. Under bundling, the app never fetches pages over the network, so a Universal Link needs to be translated into in-app navigation instead. Added an `appUrlOpen` listener (`src/App.jsx`) that takes the incoming URL, updates `window.location` via `history.pushState` (so `ResetPasswordPage`'s own token/hash parsing keeps working unchanged), and forces a re-render so the app's existing path-based routing picks it up. Still inert end-to-end until the real Team ID replaces the placeholder in `apple-app-site-association` — the code path is ready, there's just nothing to trigger it yet.

**Not independently verified, flagged for the BrowserStack pass:** the service worker (`sw.js`) registration is unchanged from the web build and now runs inside a bundled native webview for the first time — this combination isn't something I could find a strong reason to doubt, but I also have no way to confirm it here. Worth a specific look during the first real-device test rather than assumed fine.

## 2a. Account deletion — tested against disposable production accounts, migration NOT applied

Per your instruction, the real migration (`20260726000001_self_service_account_deletion.sql`) was never applied to production. Instead, its exact function body was applied under a temporary name (`_test_delete_own_account`, taking a target user id directly rather than reading it from a session), exercised against four fresh disposable accounts created through the real signup endpoint, then **dropped** — production now has zero trace of either the test function or the test accounts/data (verified by count).

**A real bug was found and fixed during this test, before you ever saw it:** the first version archived a sole owner's table (as designed) but then deleted their `auth.users` row in the same call — and `groups.owner_id` still pointed at that user. `groups.owner_id references auth.users(id) ON DELETE CASCADE` fired, silently deleting the "archived" group and its entire dinner-session history the instant the account was removed, completely undoing the archive. Fixed by also clearing `owner_id` to `NULL` (nullable, confirmed) as part of the same archive statement — re-tested clean afterward. `delete_group()` (the existing Settings-page flow) never had this bug, since it never deletes the caller's own account in the same call.

**Final, verified results, exactly what is deleted vs. retained:**

| Scenario | Auth account | Profile | Own notes (personal + family-journal) | Verse history | Group membership | Owned group | Other members' data |
|---|---|---|---|---|---|---|---|
| Plain member deletes | Deleted | Deleted (cascade) | Deleted (cascade) | Deleted (cascade) | Cleared | N/A | **Untouched** — confirmed empirically |
| Owner of a multi-member group deletes | Deleted | Deleted | Deleted | Deleted | Cleared | **Ownership auto-transfers** to the next-longest-tenured member; group and its dinner-session history (`group_verse`) untouched | **Untouched** — confirmed empirically |
| Sole owner deletes | Deleted | Deleted | Deleted (including their own family-journal note — see note below) | Deleted | Cleared | **Archived** (`archived_at` set, `invite_code` rotated, `owner_id` cleared to `NULL`) — dinner-session history (`group_verse`) preserved, group row itself preserved | N/A (no other members) |

**One nuance worth knowing, not a bug:** `notes.user_id` cascades on *who wrote it*, not which journal they posted it to — a note the deleted user wrote to a *shared* family journal is removed along with their personal ones, while every other member's notes in that same journal are left completely untouched (confirmed empirically in every scenario above). This exactly matches what the pre-existing `public/delete-account.html` policy text already promises ("your journal entries and reflections" are listed as deleted) — not a new behavior introduced here.

**Still pending your approval before this applies to production:** the actual `20260726000001_self_service_account_deletion.sql` migration, now containing this fix, has not been run against production. Apply it the same way every other migration in this engagement has been — review, apply, then have Steve confirm the Settings-page UI flow end-to-end on a real account.

## 2. App Review audit — risks found and resolved

### 🔴 5.1.1(v) Account deletion — was a near-certain rejection, now fixed (pending DB apply)
**Before:** `Settings → Delete my account` linked to `/delete-account.html`, an email-request process with up to 30-day manual turnaround. Apple explicitly requires in-app, self-service deletion for any app that supports account creation, and reviewers test this directly.
**After:** in-app typed-confirmation flow calling `delete_own_account()` — immediate, no manual step, handles group ownership automatically (transfers or archives so deletion is never blocked), preserves shared history exactly like the existing archive mechanism. **Still needs to be applied to production and verified before submission** — see Steve's action list.

### 🟡 4.2 Minimum functionality / "repackaged website" — real risk, mitigated not eliminated
This is a genuine hybrid app (Capacitor + native plugins), not a bare browser wrapper — native splash screen, status bar, safe-area handling, in-app link handling, and offline service-worker caching are all real, working native behavior. But it does load remote web content as its primary experience, which is exactly the pattern Guideline 4.2 scrutinizes. Mitigation in place: the App Review notes (§6 below) proactively explain the architecture and point reviewers at the same live, working, multi-user product already approved on Google Play. This cannot be fully "resolved" from code alone — it's a judgment call Apple's reviewer makes, and if rejected on 4.2 specifically, the standard remedy is adding one or two visibly-native-only features (e.g., a native share extension or widget), which would be new product scope requiring your sign-off, not something to do preemptively.

### 🟡 5.1.1 Data collection at signup — currently fine, confirm at submission
Signup collects only email, password, and display name; the onboarding faith-journey questions are optional/self-reported and stored server-side but never required to use the app. No age-gating exists — recommend age rating reflects that (see §4).

### 🟢 User-generated content (family journal) — proportionate, no action taken
The "Family journal" feature is UGC (notes visible to other members of an invite-only family group), which Guideline 1.2 governs for apps with public or open UGC (moderation, reporting, blocking). This app's UGC is closed, invite-code-gated, small-group family content — the same risk category as a private notes/family-organizer app, not a public social feed. No moderation/reporting system was added; building one would be real, unrequested new scope for a UGC surface that isn't public. Flagging the reasoning here so it's a documented decision, not an oversight, in case a reviewer asks about it in review notes.

### 🟢 Permissions — clean
No camera, location, microphone, contacts, or photo-library APIs used anywhere in the codebase. Info.plist correctly has zero usage-description keys — nothing to over- or under-declare.

### 🟢 Sign in / auth — no third-party login, no Sign in with Apple requirement
Email/password only via Supabase Auth. Guideline 4.8 (Sign in with Apple parity requirement) only applies when a third-party login option (Google, Facebook, etc.) exists alongside email — this app has neither, so no Sign in with Apple obligation exists. If a "Sign in with Google" button is ever added later, Sign in with Apple would become mandatory at that point.

### 🟡 Guest table (unauthenticated) content exposure — reviewed, no change needed
`/table/:inviteCode` shows verse/prayer content with no login. This is intentional, deliberately narrow (never member data, invite codes, or anything beyond what `get_guest_table_by_invite_code()` explicitly returns — already audited earlier in this engagement), and mirrors normal "shared read-only link" patterns Apple doesn't flag. No changes needed.

---

## 3. Bundle ID

`ai.flippingtables.app` — same as the Android package, used exactly as instructed. No documented conflict found (nothing to check against without a live Apple Developer account — App ID registration itself is the actual conflict-detection step, and it's a genuine enrollment-gated action, not something resolvable beforehand).

---

## 4. Age rating — provisional recommendation, not a filled-out questionnaire

**Provisional: 4+.** This is a recommendation based on reading the actual content and features, not a completed pass through Apple's real questionnaire — App Store Connect's age-rating flow (Apple replaced the old fixed-category system with a graduated questions-and-severity model) is only reachable from inside App Store Connect, which doesn't exist until enrollment. Treat every answer below as "what I'd honestly answer given what this app actually contains," to be re-verified against the live questionnaire's exact current wording at submission time, not copy-pasted blind.

Honest answers based on DWJ's actual, closed, invite-only content:
- **Violence, sexual content, profanity, gambling, alcohol/drugs, mature/suggestive themes:** None present anywhere in the app — answer "None" throughout.
- **Horror/fear themes:** None. The Pray page's "feelings" picker (fear, anger, sadness, anxiety, etc.) is a self-reflection/devotional check-in, not depicted fear content or horror theming — this is a real distinction Apple's questionnaire draws (it asks about *content depicting* these themes, not wellness features that name emotions) but worth a second look at the exact current question text before answering.
- **User-generated content / user-to-user communication:** The family journal is UGC visible to other users, but strictly within a closed, invite-code-gated group the user explicitly joined — not open chat with strangers, not public posting. Answer honestly per the questionnaire's exact phrasing on unrestricted web access and user-generated content; this app has no open/public UGC surface and no unrestricted in-app browser.
- **Gambling/contests, medical/treatment information:** None.

Expected outcome: 4+. Not guaranteed until someone actually completes the live questionnaire post-enrollment.

## 5. Privacy nutrition label recommendation

Based on the actual schema (not guessed): `profiles` (email, name, faith_level, preferred_translation), `notes`/journal content, `verse_history`, `analytics` (usage events via `track()`).

| Apple category | Collected? | Linked to identity? | Used for tracking? |
|---|---|---|---|
| Contact Info (email) | Yes | Yes | No |
| User Content (journal entries) | Yes | Yes | No |
| Identifiers (user ID) | Yes | Yes | No |
| Usage Data (`analytics` table — `track()` calls) | Yes | Yes | No |
| Health & Fitness, Location, Financial, Contacts, Browsing History, Search History, Sensitive Info | No | — | — |

"Used for tracking" should be **No** across the board — `analytics` is first-party product-usage telemetry only (no ad network, no cross-app/cross-site tracking, no IDFA usage found anywhere in the codebase). Confirm this against Apple's exact definition of "tracking" at submission time, but nothing in this codebase does anything resembling it.

## 6. App Review notes (draft)

> Dinner with Jesus is a family devotional app: one shared Bible verse, guided conversation questions, and a rotating prayer turn, once per day, for an invited family group. The same product is live on Google Play (same backend, same account system) — this iOS build loads the identical live web experience inside a native Capacitor shell (native splash screen, status bar, and safe-area handling; external links open in-app via Safari View Controller rather than leaving the app).
>
> Test account: [see §7 — to be created by Steve before submission]
>
> Account deletion: Settings → scroll to bottom → "Delete my account" → type DELETE to confirm. This is immediate and self-service.
>
> No camera, location, or microphone access is requested or used.

## 7. Test credentials for reviewers

**Do not give Apple reviewers a real family's account.** Recommend Steve create one dedicated, real, monitored email (e.g. `appreview@onetengroup.ai`) and:
1. Sign up normally through the app.
2. Create a small dinner circle (name it something obviously a test fixture, e.g. "App Review Test Table").
3. Complete one full prayer rotation and save one journal entry, so reviewers see a populated app on first login, not an empty first-run state.
4. Provide that email + password directly in App Store Connect's review-notes credential fields (not in this document, not in git).

This is a Steve action (§9) — I have no way to create or monitor a real inbox myself.

## 8. Screenshots plan

Recommend **iPhone only** for the initial submission (6.7" display class is Apple's current mandatory minimum set; iPad is not targeted — see the orientation/device-family note in §10). Five screens, in this order, each with a one-line caption overlay (design work, not copy already drafted here):
1. Table screen — verse + questions (the core daily moment)
2. Table screen — prayer rotation ("whose turn" state visible)
3. Journal — family table view
4. Onboarding "Your table is ready" success screen (already redesigned earlier this engagement)
5. Settings — dinner circle / invite code

Actual screenshots require a real device or simulator (BrowserStack App Live or Appetize, per §11) — not producible from this environment.

## 9. Exact unavoidable actions needed from Steve

Kept to the minimum, in the order they actually block:

1. **Enroll in the Apple Developer Program** ($99/year, requires a real Apple ID, legal entity/individual info, and payment — a genuine account/payment gate, not something to work around).
2. **Register the App ID** `ai.flippingtables.app` in the Apple Developer portal once enrolled, and note the real **Team ID** (needed to replace the placeholder in `public/.well-known/apple-app-site-association`).
3. **Create the App Store Connect app record** (name, bundle ID, SKU, primary category — recommend "Lifestyle" or "Education").
4. **Create a dedicated App Review test account** per §7 (real, monitored email — I cannot do this myself).
5. **Approve applying** `20260726000001_self_service_account_deletion.sql` to production (same review-then-apply process used for every other migration this engagement) — must happen before submission, since reviewers will test deletion.
6. **Sign up for Codemagic and BrowserStack App Live** (per your instruction, these are the chosen build/test tools) — both need an account and, for real usage beyond free-tier limits, payment. I have not created either account or spent anything.
7. **Connect Codemagic to the GitHub repo and to App Store Connect** (via an App Store Connect API key, generated in App Store Connect — a credential only Steve/the account owner can create).
8. **One real-device (or BrowserStack App Live) interactive test pass**, and **final release authorization** before anything goes to the public App Store — per your own stated operating model.

## 10. Known gaps / decisions flagged for confirmation, not blocking

- **App icon quality:** generated from the existing 512×512 source, upscaled to the required 1024×1024. Functional, but soft compared to true high-resolution source art — recommend regenerating from real 1024px+ vector art before final submission if available.
- **iPad:** the web layout is fixed at a 480px-wide mobile column with no responsive iPad design. Recommend iPhone-only distribution (`TARGETED_DEVICE_FAMILY = 1`) for the initial release — this is a one-checkbox change in Xcode's General tab, not made here since I can't verify it in a project I can't open, but it's a two-minute first step once someone has Xcode access (Codemagic build agent counts).
- **Universal Links:** functional fallback (opens in mobile Safari) works today with zero further changes; full "reopens the native app" behavior activates automatically once the real Team ID replaces the placeholder — no code change needed then, just a data edit to one JSON file.

---

## 11. Cloud macOS build/signing + real-device testing pipeline

Per your direction: **Codemagic** for build/signing, **BrowserStack App Live** as the primary real-iPhone testing environment (interactive, from Steve's Windows browser, no Mac/iPhone purchase), **Appetize** as an optional simulator-only preview, not device validation.

**How it fits together:**
1. Codemagic connects directly to the `dinner-with-jesus-app` GitHub repo (already has a real `ios/` project and `capacitor.config.json` ready to build — nothing further needed from this repo's side).
2. Codemagic's iOS code-signing integration uses an **App Store Connect API key** (generated by Steve in App Store Connect after enrollment) to automatically manage certificates and provisioning profiles — no manual `.p12`/keychain handling, no separate signing-certificate purchase.
3. Each build produces a signed `.ipa`. Codemagic can publish it straight to **TestFlight** automatically, or output it as a build artifact.
4. That `.ipa` is uploaded to **BrowserStack App Live**, where Steve tests it interactively on a real iPhone, remotely, from a normal Windows browser tab — this is the "one real-iPhone test" gate in your operating model.
5. Optional: the same `.ipa`/build can be previewed on **Appetize** for a quick simulator smoke-test before spending a BrowserStack session, but Appetize is never the final validation step.

**Cost shape (for awareness, nothing purchased):** Codemagic has a free tier (limited build minutes/month) sufficient for infrequent releases; BrowserStack App Live requires a paid plan for real-device access beyond its trial. Both are Steve's account/payment decisions per your explicit "do not purchase" instruction.

---

## 12. What happens immediately after Apple enrollment is approved

1. Register the App ID and pull the real Team ID; update `apple-app-site-association` from its placeholder (one-line JSON edit, immediate commit).
2. Create the App Store Connect app record and connect Codemagic (build/signing pipeline goes live).
3. Apply and verify `20260726000001_self_service_account_deletion.sql` against production, using the same disposable-account verification method already proven for the Android ownership-protection migration.
4. Trigger the first Codemagic build → TestFlight.
5. Set `TARGETED_DEVICE_FAMILY` to iPhone-only in the Xcode project (via Codemagic's build agent or a quick Xcode Cloud/CI script edit).
6. Hand the resulting build to BrowserStack App Live for Steve's interactive real-iPhone pass.
7. Fill in App Store Connect metadata (description/keywords copy — draft available on request, not written here since it's marketing copy rather than an engineering artifact), privacy labels and age rating from §4/§5, and the dedicated test account from §7 into the review-notes credential fields.
8. Submit for review once Steve authorizes it — not before.
