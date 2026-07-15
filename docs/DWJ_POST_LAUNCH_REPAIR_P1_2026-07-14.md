# Dinner with Jesus — Post-Launch Repair Pass P1
**Date:** 2026-07-14
**Branch:** `fix/dwj-post-launch-p1` (built from `main` at `79ad06d`, with the corrected audit docs cherry-picked on top)
**Status:** Repairs complete and committed locally. Nothing pushed, deployed, or published.

This is the repair pass authorized after Steve approved the corrected audit (`docs/DWJ_POST_LAUNCH_AUDIT_2026-07-14.md`, commits `35c4693` and `23a3477`, cherry-picked onto this branch as `d6d62e4` and `f0eacab`).

---

## 1. RLS Findings and Evidence

**No production Supabase access was available in this environment**, and none was obtained during this repair pass. Checked and confirmed absent before starting:

- No `supabase` CLI installed (`Get-Command supabase` returns nothing)
- No `SUPABASE_*` / `POSTGRES_*` / `DATABASE_*` environment variables set
- No `.supabase` project-link directory, no `.env` file, no service-role key anywhere in this repo or this machine's environment
- No Supabase MCP tool or other credentialed access available to this session

**This audit could not directly inspect the production Supabase project.** Per the instruction not to describe a possible exposure as confirmed unless it is proven: **the RLS status of the production database remains unverified — neither confirmed safe nor confirmed unsafe.** This is a fact about the audit's access, not a finding about the database itself.

## 2. Confirmed Security Exposure, If Any

**None can be confirmed, because the underlying system could not be inspected.** What *is* confirmed from source code alone (not from testing against the live database):

- `src/pages/AdminPage.jsx` issued `supabase.from('profiles').select('*')` and similar broad reads/writes across `profiles`, `groups`, `analytics`, and `announcements`, gated only by a client-side `user.id === <hardcoded UUID>` check (now removed — see §5/§9 below).
- Whether those reads/writes were actually restricted by RLS at the database level prior to this pass is unknown. If they were not, the exposure was real; if they were, the client-side check was redundant but not actively dangerous.
- Given this is unresolved, this repair pass treated the conservative case as the working assumption: it removed the client-only gate and prepared (but did not apply) a database-side fix. See §3.

**This repair pass could not test as a normal authenticated user, an admin user, or via direct API requests against production**, for the same reason — no credentials to create test sessions or reach the project. That testing remains outstanding and is the single most important verification left for Steve or whoever holds Supabase access.

## 3. Proposed SQL Migration and Rollback

Two files were added, **neither applied to production**:

- `supabase/migrations/20260714000000_harden_admin_access.sql`
- `supabase/migrations/20260714000000_harden_admin_access_ROLLBACK.sql`

The migration:
1. Creates `public.is_admin(uuid)` — a `SECURITY DEFINER` SQL function that returns true only for the app's one admin UUID (the same UUID that used to be hardcoded in `App.jsx`). This is the function the app's new client-side check calls via `supabase.rpc('is_admin')`.
2. Adds **additive** permissive RLS policies on `profiles`, `groups`, `dinner_verses`, `analytics`, and `announcements` scoped to `is_admin()`, matching exactly the reads/writes `AdminPage.jsx` performs. Postgres OR-combines multiple permissive policies on the same table/command, so these policies can only grant the admin account access — they cannot narrow or remove whatever access existing policies already grant to ordinary users.
3. Does **not** touch, replace, or guess at any existing policy, and does not blindly `ENABLE ROW LEVEL SECURITY` without a prominent warning — see the comments in the file for why that specific step needs Steve's (or whoever has dashboard access) direct confirmation first.

**This was not tested against production and not applied.** The migration file itself was reviewed for internal consistency (valid SQL syntax, idempotent `create or replace function`, `drop policy if exists` in the rollback) but has not been run anywhere. Per the "if RLS is unsafe" branch of the repair instructions: **stopping here and requesting Steve's approval before this is applied is exactly what this pass did.**

**Deployment ordering matters:** the client code committed in this pass (`App.jsx`, `AdminPage.jsx`) calls `supabase.rpc('is_admin')` and fails closed (denies admin access) if that function doesn't exist. If the web app is redeployed before this SQL is applied, **the admin dashboard will become inaccessible to everyone, including Steve**, until the migration runs. That is a safe failure mode (closed, not open) but it needs to be sequenced: **apply the SQL migration first, then deploy the code.**

## 4. Root Cause of False Success Messages

Confirmed by reading the code: `@supabase/supabase-js` **resolves its promise rather than throwing** when a write is rejected by RLS, fails validation, or hits a network error — the caller must explicitly destructure and check the returned `error`. Across `JournalPage.jsx`, `TablePage.jsx`, and `AdminPage.jsx`, most writes called `await supabase.from(...).insert/update/delete(...)` inside a `try {}` block, never checked `error`, and unconditionally ran the success path (toast message, clearing the draft, flipping local state) directly afterward. A network error or RLS rejection would only have been caught if it also threw — which these calls generally don't — so the write could silently fail while the UI reported success. `SettingsPage.jsx`'s `handleTranslation`/`handleFaithLevel` had the same pattern one level up: they called `updateProfile()` (which does correctly return `{ error }`) but never checked what came back.

## 5. Files Changed

All committed to `fix/dwj-post-launch-p1`:

| Commit | Files | Summary |
|---|---|---|
| `bc79810` | `vercel.json`, `public/delete-account.html`, `src/pages/SettingsPage.jsx` | Fixed invalid JSON + route order; clarified deletion instructions; added in-app "Delete my account" link |
| `46c65a3` | `public/favicon.png` | Replaced corrupted 2-byte file with the valid existing image |
| `0a1280f` | `src/components/KendylScene.jsx` | Fixed daily-vs-session cadence bug |
| `4b5806d` | `src/pages/JournalPage.jsx`, `src/pages/TablePage.jsx` | Fixed false-success pattern on save/delete/markDiscussed; preserve drafts on failure; prevent double submission and duplicate inserts |
| `fa025eb` | `src/App.jsx`, `src/pages/AdminPage.jsx`, `supabase/migrations/*` | Removed hardcoded admin UUID from client; added database-verified check with fail-closed behavior; fixed same false-success pattern in all five admin write actions; added (unapplied) SQL migration + rollback |

Also present on this branch from the audit cherry-pick: `docs/DWJ_POST_LAUNCH_AUDIT_2026-07-14.md` (`d6d62e4`, `f0eacab`).

**Not changed:** Terms of Service, privacy policy, landing page copy (Phase 7 re-check found no new inconsistency — see §9), Android launcher icon (not proven broken, left untouched per instruction), any duplicated business logic not directly tied to a named bug (e.g., the four separate "lock verse" implementations were each given their own narrow error-check fix only where explicitly in scope; they were not consolidated, since that would be a refactor beyond this pass's mandate).

## 6. Bugs Fixed

1. **`vercel.json` invalid JSON / unreachable `/delete-account` route** — fixed: valid JSON, correct route order.
2. **No in-app account-deletion entry point** — fixed: link added in Settings; deletion instructions clarified (what's deleted, what may be retained, timing, support path).
3. **Corrupted favicon** — fixed: real image now at the referenced path.
4. **KendylScene daily-cadence bug** — fixed: now gated by calendar day via `localStorage`, not by session.
5. **False success messages on journal/table/admin writes** — fixed across `saveNote` (Journal + Table), `deleteNote`, `markDiscussed`, and all five `AdminPage.jsx` mutations (`resetUserGroup`, `deleteGroup`, `toggleVerse`, `sendAnnouncement`, `clearAnnouncement`), plus `SettingsPage.jsx`'s translation/faith-level handlers.
6. **Client-only admin gate** — fixed at the client layer: hardcoded UUID removed, replaced with a database-verified, fail-closed check, plus a second independent check inside `AdminPage.jsx` itself.

## 7. Tests Passed

- `npm install` — clean, 380 packages, no new errors
- `npm run build` (production Vite build) — **succeeded** after all changes; output inspected (bundle still ~514 kB / 143 kB gzipped — unchanged in any meaningful way by these fixes, no new size regression)
- `vercel.json` validated as parseable JSON post-fix (`ConvertFrom-Json` succeeds; previously failed)
- `dist/favicon.png` confirmed as the real 423,765-byte image post-build (previously 2 bytes)
- `npm audit` re-run post-fix: same 3 pre-existing vulnerabilities (2 moderate, 1 high, all in the dev-only `esbuild`→`vite`→`vite-plugin-pwa` chain) — unchanged, not part of this pass's scope
- Grep-confirmed: no remaining reference to the old hardcoded admin UUID anywhere in `src/`
- Grep-confirmed (Phase 7 re-check): no subscription/billing/ad/paywall/premium/donation code introduced by any of these changes; `src/` still contains none

## 8. Tests Not Performed and Why

- **Non-admin vs. admin RPC verification** (`supabase.rpc('is_admin')` returning correctly for each) — **NOT TESTED: no Supabase project access.** This is the most important test still outstanding and must be done once the migration is applied.
- **Any live/device testing** (fresh launch, session restoration, join table, invalid code, weak/lost network, duplicate taps against a real backend, refresh on a protected route, app close/reopen, narrow-width rendering, Android back button) — **NOT TESTED: no Android device, emulator, or reachable Supabase project in this environment.** These were traced through the code (e.g., the double-submission guards were verified to exist in the code and to correctly disable their buttons) but not exercised live.
- **TypeScript/typecheck** — **NOT APPLICABLE: this is a JavaScript (JSX) project, no TypeScript is configured.**
- **Lint** — **NOT TESTED: no ESLint config exists anywhere in this project** (confirmed absent both before and after this pass; adding one was out of scope for a repair pass focused on named bugs).
- **Unit tests / integration tests** — **NOT TESTED: no test framework or test files exist in this project.** Per Phase 6's instruction, a *documented manual test procedure* was written for the KendylScene fix instead (see the `0a1280f` commit message) since adding a full test framework would be new infrastructure beyond this repair's scope.
- **Android debug build / release build / Capacitor sync** — **NOT TESTED: no `android/` folder or Capacitor project exists in this repository** (confirmed in the original audit and unchanged). The Play Store package is believed to be a TWA wrapper generated outside this repo; that wrapper project was not available to build or test here.
- **Dependency vulnerability scan** — performed (`npm audit`, §7); unchanged from the audit baseline, not otherwise re-verified against a live environment.

## 9. Remaining Issues

- **RLS verification is still outstanding** — the single highest-priority remaining item. Someone with Supabase dashboard/CLI access needs to check the actual current policies on `profiles`, `groups`, `analytics`, `announcements`, and `dinner_verses` before applying the prepared migration, per the migration file's own warnings about `ENABLE ROW LEVEL SECURITY` on a table with no existing policies.
- **The SQL migration is unapplied.** Nothing in this repair pass touches production data or policies.
- Everything in the audit's §B ("Next 30 Days") and §C ("Later/Optional") lists remains open — this pass only addressed §A ("Fix Before Promotion") items plus the specific phases Steve named in the repair-pass instructions.
- **Phase 7 free-app consistency check, re-confirmed:** no subscriptions, ads, premium tiers, feature gates, billing/purchase code, or active donation flow exist anywhere in the codebase, before or after this pass's changes. The Google Play Console listing itself remains unverifiable from this repository — that is a manual check for Steve, not a code question.
- Dead code and duplicated logic identified in the audit (unused `PrayPage.jsx`, four duplicated "lock verse" implementations, duplicated invite-code generator) were **not** touched, per the explicit instruction not to refactor unrelated working code.

## 10. Vercel-Required Changes

All of the following are pure web-bundle/static-asset changes and only require a Vercel redeploy: the `vercel.json` fix, the account-deletion link and copy, the favicon fix, the KendylScene fix, and all of the false-success error-handling fixes (Journal/Table/Settings/Admin). **No native/Android-specific code was touched.**

## 11. Play Store-Required Changes

**Likely none**, with one important caveat: this repository contains no `android/` project or Capacitor config, so the strong working assumption (also stated in the original audit) is that the Play Store listing is a Trusted Web Activity (TWA) wrapper that loads this same live web app rather than bundling a static snapshot of it. If that assumption is correct, a Vercel redeploy alone brings every fix above to the Play Store version of the app automatically, with no new AAB/release needed. **This assumption could not be verified** — there was no Play Console access in this environment to confirm the packaging mechanism. If Steve knows the Play Store build is instead a bundled/native package that does not load live web content, a new release would be required and that should be flagged back to this process.

The one item that is **not** a Vercel-vs-Play question at all: the Supabase SQL migration (§3), which must be applied directly against the database, independent of either deployment target.

## 12. Recommended Release Version/Code

- **Web (`package.json`):** currently `1.0.0`. Recommend bumping to `1.0.1` as an internal marker for this fix set if Steve wants one recorded — this has no effect on anything Play-Store-facing since it isn't wired to any Android version.
- **Android version code/name:** no recommendation made, since (per §11) no new Play Store release is believed to be required for this fix set. If Steve's actual packaging process does require a new release, that decision — and the version bump — belongs to whoever owns that TWA/wrapper project, which lives outside this repository.

## 13. Release Notes (Draft, In Case Steve Publishes)

> Fixed a bug where saving a journal entry or table conversation could occasionally not go through without telling you. Fixed the account-deletion page. Small icon and reliability fixes.

## 14. Rollback Procedure

- **Vercel:** if any of these changes cause an issue after deploy, use Vercel's dashboard to instantly roll back to the immediately prior deployment, or `git revert` the relevant commit(s) on this branch and redeploy. Each commit above is scoped to one concern, so a single problematic commit can be reverted independently of the others.
- **Supabase (if the migration is applied later and needs reverting):** run `supabase/migrations/20260714000000_harden_admin_access_ROLLBACK.sql`. Note its own documented consequence: rolling back while the new client code is still deployed will make the admin dashboard inaccessible (fail-closed) until either the migration is re-applied or the client is reverted to a commit before `fa025eb`.
- Nothing has been deployed as of this report, so no rollback is currently needed — this section is prepared for if/when Steve deploys.

## 15. Branch and Commit

- Branch: `fix/dwj-post-launch-p1`
- Built from `main` at `79ad06d`
- Commits, in order: `d6d62e4`, `f0eacab` (audit docs, cherry-picked), `bc79810`, `46c65a3`, `0a1280f`, `4b5806d`, `fa025eb` (this repair pass)
- This report will be committed as its own commit immediately following `fa025eb`.

## 16. Confirmation

**Nothing was pushed. Nothing was deployed. No Play Store release was published. No production database, RLS policy, or Google Play Console setting was changed.** All work is local commits on `fix/dwj-post-launch-p1`. The prepared SQL migration exists only as a file in this repository and has not been executed against any database.
