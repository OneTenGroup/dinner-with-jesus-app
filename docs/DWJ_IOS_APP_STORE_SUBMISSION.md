# Dinner with Jesus — iOS App Store Submission Package

**Date:** 2026-07-26
**Status:** Pre-enrollment preparation. No Apple Developer Program account exists yet. Nothing has been uploaded to App Store Connect, no paid service has been purchased, no production behavior has changed without explicit prior approval (see each section for what's committed vs. merely prepared).

**Architecture decision (made autonomously, documented here):** the iOS app is a Capacitor shell that loads the live production site (`https://flippingtables.ai`) via `server.url` in `capacitor.config.json`, the same architecture as the already-approved Android TWA, rather than bundling a static snapshot of the web build. Reasoning: this app is a live, frequently-updated, Supabase-backed experience (auth, real-time-ish shared state, rapid bug-fix cadence all through this engagement) — a bundled static copy would drift from production and require an App Store resubmission for every web fix, exactly the operational cost this architecture avoids on Android today. The tradeoff is Apple Guideline 4.2 scrutiny of "repackaged website" apps — addressed below in the App Review audit, not avoided.

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
| Native bridge | Splash-screen handoff synced to the app's existing `appReady` state, status bar style, and external-link interception (opens non-`flippingtables.ai` links, and `mailto:`, via in-app Safari instead of hijacking the single webview) — a no-op on web/Android, `Capacitor.isNativePlatform()`-gated | `src/lib/nativeBridge.js`, wired into `src/App.jsx` |
| Safe areas | `viewport-fit=cover` added to the shared `index.html` (harmless on web/Android); `.app-shell` gets `padding-top: env(safe-area-inset-top)` to match the bottom nav's pre-existing `env(safe-area-inset-bottom)` | `index.html`, `src/index.css` |
| Universal Links (prep only) | `apple-app-site-association` with a placeholder Team ID, deployed with correct routing/content-type — **inert until the real Team ID is filled in post-enrollment** | `public/.well-known/apple-app-site-association`, `vercel.json` |
| **Account deletion (the biggest fix)** | New self-service `delete_own_account()` RPC + in-app typed-confirmation UI in Settings, replacing the email-only flow as the primary path (email kept as a documented fallback) | `supabase/migrations/20260726000001_self_service_account_deletion.sql` (NOT applied to production), `src/context/AuthContext.jsx`, `src/pages/SettingsPage.jsx` |

All of the above is committed to `main` on `dinner-with-jesus-app` **except** the account-deletion migration, which is written and reviewed but deliberately left unapplied, exactly like every other database change in this engagement's established pattern — it needs the same "apply and verify against production" step the Android ownership-protection work went through, and that's a production-data action, not a pre-enrollment-prep one.

---

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

## 4. Age rating recommendation

**4+.** No violence, no mature/suggestive content, no gambling, no user-to-user chat beyond a closed family journal, no unrestricted web access (the app only ever loads `flippingtables.ai`/Supabase). The "feelings" picker in the Pray page (fear, anger, sadness, anxiety, etc.) is emotional/spiritual self-reflection content, not the kind of content Apple's questionnaire flags (that targets horror/fear *themes as entertainment content*, not a wellness/devotional check-in feature) — answer "None" on the relevant mature/suggestive-themes questions.

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
