# Dinner with Jesus — Android TWA Release Process

**Date:** 2026-07-25
**Why this document exists:** the Play Store listing for this app is a Trusted Web Activity (TWA) that loads the live PWA at `https://flippingtables.ai`. It was originally packaged via PWABuilder's website with no local project ever saved, no keystore ever saved locally, and no record of how to rebuild it. When the upload key needed replacing, none of the original artifacts (AAB, APK, keystore, `twa-manifest.json`) could be recovered anywhere on the machine that had done the original packaging. This process exists so that never happens again — everything needed to rebuild and re-release is now either in this repo or documented here.

**Package identity:** `ai.flippingtables.app` — this is the real, already-published Play Store package name. Never regenerate or substitute a different one; doing so creates a new, unrelated app listing instead of updating the existing one.

---

## 1. Required tooling

| Tool | Version used | Install location on this machine |
|---|---|---|
| JDK | Temurin 17.0.19 (portable zip, no admin rights needed) | `C:\Android\jdk17` |
| Android SDK cmdline-tools | latest (11076708) | `C:\Android\sdk\cmdline-tools\latest` |
| Android SDK platform | `platforms;android-36` | `C:\Android\sdk\platforms\android-36` |
| Android SDK build-tools | `build-tools;36.0.0` | `C:\Android\sdk\build-tools\36.0.0` |
| Android SDK platform-tools | latest | `C:\Android\sdk\platform-tools` |
| Bubblewrap CLI | 1.24.1 | installed globally via `npm install -g @bubblewrap/cli` |

Environment variables (set at the User level, and must also be set inline in any new shell session if they weren't picked up automatically):
```
JAVA_HOME=C:\Android\jdk17
ANDROID_HOME=C:\Android\sdk
ANDROID_SDK_ROOT=C:\Android\sdk
PATH must include: C:\Android\jdk17\bin, C:\Android\sdk\platform-tools, C:\Android\sdk\cmdline-tools\latest\bin
```

Bubblewrap's own config (`%USERPROFILE%\.bubblewrap\config.json`) points at the same JDK/SDK so its first-run wizard never re-prompts:
```json
{"jdkPath":"C:\\Android\\jdk17","androidSdkPath":"C:\\Android\\sdk"}
```

To reinstall from scratch on a new machine: download the Temurin 17 Windows x64 zip from Adoptium, extract it anywhere and point `JAVA_HOME` at it; download `commandlinetools-win-*_latest.zip` from `https://dl.google.com/android/repository/`, extract so that `sdkmanager.bat` ends up at `<sdk_root>/cmdline-tools/latest/bin/`; run `sdkmanager --licenses` (accepts licenses interactively — pipe `y` answers via a file redirect if scripting it) then `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"`.

## 2. Project location

`C:\Projects\dinner-with-jesus-app\android-twa\` — a real, persistent Bubblewrap-generated Gradle project, committed to this repo (minus build output and secrets — see `.gitignore`). Key files:
- `twa-manifest.json` — the source of truth Bubblewrap uses to (re)generate the Android project. Edit this, then regenerate, rather than hand-editing generated Gradle files where avoidable.
- `app/build.gradle` — generated from `twa-manifest.json`, plus one manual patch (see §4 — `targetSdkVersion` is not exposed by the manifest schema in this Bubblewrap version and must be edited directly).
- `manifest-checksum.txt` — Bubblewrap's own drift-detection file; `bubblewrap update` compares against this to warn if `twa-manifest.json` and the generated project have diverged.

## 3. Package identity

- `applicationId` / `packageId`: `ai.flippingtables.app`
- Confirmed against the currently-published bundle's generated permission string (`ai.flippingtables.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`), reported directly by Steve from Play Console — never inferred or guessed.

## 4. Version-update procedure

For every future release:
1. Open `android-twa/twa-manifest.json`, bump `appVersionCode` (integer, must be strictly greater than the currently-published value in Play Console) and `appVersionName` (the human-readable string).
2. Regenerate the project: `bubblewrap update --manifest=android-twa` (run from the repo root, or `cd android-twa && bubblewrap update` — see `bubblewrap help update`). This regenerates the Gradle project from the manifest without touching the signing key.
3. **Re-check `app/build.gradle`'s `targetSdkVersion` after every regeneration** — this Bubblewrap version's template does not read target SDK from `twa-manifest.json` at all (only `compileSdkVersion` tracks a recent default); it must be set/verified by hand each time. As of this document, `compileSdkVersion 36` / `targetSdkVersion 36` are both set correctly in the checked-in project — confirm they still match after any `bubblewrap update`.
4. Rebuild (see §7).

## 5. Secure signing procedure — without recording secrets

- **Keystore location:** `C:\Android\dwj-release-keys\dwj-upload-key.jks` — deliberately **outside this git repository and outside any OneDrive-synced folder**. This is the single most important rule: losing this file again means going through this entire replacement-key process again.
- **Key alias:** `dwj-upload`
- **Algorithm:** RSA, generated via `keytool -genkeypair -keyalg RSA -validity 20000` (Bubblewrap's own standard signing-key generation, ~54 years validity).
- **Passwords:** randomly generated (24-character alphanumeric) at creation time, written once to `C:\Android\dwj-release-keys\CREDENTIALS-DO-NOT-COMMIT.txt`. **This file has never been and must never be printed in any chat/log/commit.** Steve: move these two passwords into a real password manager, then you may delete that file — nothing in this repo or process depends on it continuing to exist there.
- **Public certificate:** exported (non-secret, safe to share with Google) to `C:\Android\dwj-release-keys\upload_certificate.pem`.
- **SHA-256 upload-certificate fingerprint:** `9B:D4:36:71:5B:C7:48:01:20:43:DD:E0:1B:40:8B:3F:F0:C7:C0:7F:1C:CC:75:C7:66:75:DE:9B:46:8F:CF:14`
- **SHA-1 upload-certificate fingerprint:** `A7:F9:23:0C:61:68:1E:A9:F6:F7:84:4B:0E:D8:A3:98:44:D5:7F:BD`
- `twa-manifest.json`'s `signingKey` block references this keystore by path/alias only — never a password.

**Backup requirement:** copy `C:\Android\dwj-release-keys\` (the whole folder) to at least one offline or access-controlled location outside this machine (e.g., a company password manager's secure file storage, an encrypted drive) as soon as possible. If this machine is lost or wiped, that copy is the only way to sign a future update without going through Google's key-reset process again.

**Getting the new key accepted by Google Play (one-time, manual, Play Console only):**
Play Console → your app → **Setup → App integrity → App signing** → request an upload key reset, uploading `C:\Android\dwj-release-keys\upload_certificate.pem` as the new upload certificate. **Do not build or upload a signed release AAB until Google confirms this reset is accepted** — an AAB signed with a key Google hasn't registered yet will be rejected.

## 6. Digital Asset Links (`assetlinks.json`) — known gap, not yet fixed

Inspected `https://flippingtables.ai/.well-known/assetlinks.json` (and the `www` host the TWA actually resolves to) during this process: **it does not exist**. The request falls through Vercel's catch-all SPA rewrite (`vercel.json`'s `"/(.*)" → "/index.html"`) and returns the React app's HTML instead of JSON. There is no `.well-known/assetlinks.json` file anywhere in this repo.

This means Digital Asset Links verification for the TWA is not currently working at all — independent of anything in this release process. Fixing it requires:
1. The **Google Play app-signing certificate** SHA-256 fingerprint (Play Console → App integrity → App signing — this is Google's own signing cert, NOT the upload-key fingerprint in §5 above; they are different keys and must not be confused).
2. A real `public/.well-known/assetlinks.json` file in this repo containing that fingerprint and package name, plus a `vercel.json` route added *before* the catch-all rewrite so the static file is served instead of the SPA fallback.

**Not fixed as part of this release** — flagged for a decision, since creating it is a product/infra change beyond pure Android packaging and needs that Play Console fingerprint value first.

## 7. Build command

Once (and only once) Google Play has confirmed the new upload certificate is accepted:
```
cd C:\Projects\dinner-with-jesus-app\android-twa
bubblewrap build
```
This signs with the keystore/alias referenced in `twa-manifest.json`, prompting for the store/key passwords (retrieve from wherever Steve has stored them per §5 — never re-typed into a script or chat). Output AAB lands in `android-twa/app/release/app-release.aab` by default; copy the final artifact into a clearly labeled release folder, e.g. `android-twa/release/app-release-v2.aab`.

A **debug/unsigned** sanity build (safe to run anytime, proves the project compiles, never touches signing or Play Store) is:
```
cd android-twa
.\gradlew.bat assembleDebug --no-daemon
```

## 8. Bundle-inspection commands

```
# Confirm application ID, version code/name, min/target SDK from the manifest that ships in the AAB:
"C:\Android\sdk\build-tools\36.0.0\aapt2.exe" dump badging app\release\app-release.aab

# Confirm the signing certificate fingerprint actually used to sign a build:
keytool -list -v -keystore "C:\Android\dwj-release-keys\dwj-upload-key.jks" -alias dwj-upload

# Confirm no unexpected permissions:
"C:\Android\sdk\build-tools\36.0.0\aapt2.exe" dump permissions app\release\app-release.aab
```

## 9. Internal-testing upload steps

1. Play Console → your app → **Testing → Internal testing** → Create new release.
2. Upload the AAB from `android-twa/release/`.
3. Add release notes, save, and roll out to internal testers.
4. Install on a real device from the internal-testing opt-in link and confirm the TWA opens full-screen (no browser URL bar) and behaves identically to the live web app — verse, prayer, journal, settings, the full acceptance flow already verified in the browser.
5. Only promote to production after that manual check passes.

## 10. Future API-level update process

Each year Google raises the minimum target API level required for new releases. To update:
1. `sdkmanager "platforms;android-<N>" "build-tools;<N>.0.0"` to fetch the new platform.
2. Bump `compileSdkVersion` in `app/build.gradle` (Bubblewrap's manifest schema does not expose this either — same manual-edit caveat as targetSdk, confirm both after any regeneration).
3. Bump `targetSdkVersion` the same way.
4. Bump `appVersionCode`/`appVersionName` in `twa-manifest.json` (§4).
5. Run the debug sanity build (§7) before attempting a signed release, to catch any AGP/API compatibility issues early.
6. No signing-key changes are needed for a routine API bump — reuse the existing upload key.

## 11. Keystore backup requirements (repeat of §5, because this is the part that already went wrong once)

- Live copy: `C:\Android\dwj-release-keys\` (this machine only).
- At least one independent backup copy, off this machine, before this is considered done.
- Never inside this git repo. Never inside `OneDrive` or any other auto-synced consumer cloud folder unless that folder is itself access-controlled and encrypted at rest.
- If lost again: this entire replacement-upload-key process (Play Console upload-key reset) must be repeated. The Google Play **app-signing key**, by contrast, is held by Google (Play App Signing) and is not something a lost upload key affects.
