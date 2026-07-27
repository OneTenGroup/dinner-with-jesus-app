# DWJ Android TWA verification — diagnosis, parked 2026-07-26

## Symptom
Mandy's Google Play install of "Dinner with Jesus" opens with a visible Chrome Custom Tab
bar showing flippingtables.ai. Steve's install does not. Mandy deleted and reinstalled
directly from Google Play; the bar persisted.

## Confirmed facts (direct inspection, not assumption)

1. **TWA config is internally consistent and targets `www`, not the bare domain.**
   `android-twa/twa-manifest.json`: `host: "www.flippingtables.ai"`, `startUrl: "/app"`
   (full launch URL `https://www.flippingtables.ai/app`), `fullScopeUrl:
   "https://www.flippingtables.ai/"`. `AndroidManifest.xml`'s `assetStatements` string
   also declares `"site": "https://www.flippingtables.ai"`. Package: `ai.flippingtables.app`.
2. **`https://www.flippingtables.ai/.well-known/assetlinks.json` is correct and healthy** —
   direct `200`, `application/json`, no redirect. Contains the Play App Signing SHA-256
   fingerprint for `ai.flippingtables.app` (Steve confirmed this value from Play Console's
   App integrity page when it was added in commit `db3a2c7`).
3. **`https://flippingtables.ai/.well-known/assetlinks.json` (bare domain) redirects
   (308) instead of serving JSON directly** — confirmed on every path tested (`/`,
   `/manifest.json`, `/.well-known/assetlinks.json`), so it's a Vercel domain-level
   redirect (Project → Settings → Domains), not an app/vercel.json routing issue —
   `vercel.json` already has an explicit route for this path (added in `db3a2c7`) and it
   still doesn't take effect for the bare domain, proving the redirect happens upstream
   of the app's own routing.
   - **This is a real, confirmed bug**, but is currently believed NOT to be the primary
     cause of Mandy's issue, since the TWA's declared host/start URL/scope all use `www`,
     not the bare domain — Android's on-device verifier only checks the exact host in the
     app's intent filter.
4. **The `assetlinks.json` fingerprint is not the local upload key** — independently
   verified by computing the SHA-256 of `C:\Android\dwj-release-keys\upload_certificate.pem`
   (`9B:D4:36:71:5B:C7:48:01:20:43:DD:E0:1B:40:8B:3F:F0:C7:C0:7F:1C:CC:75:C7:66:75:DE:9B:46:8F:CF:14`)
   — it does not match what's published in `assetlinks.json`, ruling out the classic
   "used the upload key instead of the App Signing key" mistake.
5. **No adb/Android SDK is present on this dev machine** — on-device verification state
   (`pm get-app-links`) has not been directly observed by this agent on either Steve's or
   Mandy's phone. Nothing about device-side verification state should be treated as
   confirmed until it's actually run and reported.

## Unresolved / unverifiable from this machine

- Whether the currently published Play Store **Production** release's version/build
  actually reflects today's (2026-07-25) TWA/assetlinks fixes, or predates them.
- The live Play Console **App Signing key certificate SHA-256**, to be re-confirmed
  character-for-character against the value in `assetlinks.json`.
- Steve's vs. Mandy's actual installed version/build number.
- Actual on-device `pm get-app-links` verification status for either phone.

## Decision: pause further diagnosis until the upload-key reset is live

A Google Play upload-key reset is in progress and expected to become active
**2026-07-27 ~1:47 PM Central**. Per Steve's explicit instruction, **no further
speculative changes to the TWA config, certificates, assetlinks.json, or domain
configuration** are to be made before the updated Play build is installed and tested —
this includes not touching the bare-domain redirect (confirmed real, but deliberately left
alone for now since it isn't believed to be the cause).

**Current bundle staged for the next release:**
`C:\Projects\dinner-with-jesus-app\android-twa\release\app-release-v2.aab`

## Plan for 2026-07-27, after the upload-key reset is active

1. Upload `app-release-v2.aab` to Internal Testing.
2. Install cleanly from the Play testing link (not sideloaded).
3. Confirm the actual Play Console version and certificate fingerprints match what's
   expected.
4. Test whether the app opens as a verified full-screen TWA or still shows the Chrome bar.
5. Only if the problem remains: run `adb shell pm get-app-links ai.flippingtables.app` and
   `adb shell pm verify-app-links --re-verify ai.flippingtables.app` on the test device,
   and continue diagnosis from there using real on-device data instead of inference.

## How to resume this engagement

Re-read this doc first. Do not re-derive the diagnosis from scratch — the facts above are
already confirmed by direct inspection. Pick up at whichever step of the 2026-07-27 plan
is next, using the real Play Console/device data gathered by then rather than the
hypotheses in this doc.
