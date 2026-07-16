# Dinner with Jesus — Shared Table Functional Audit & Repair
**Date:** 2026-07-15 (revised same day — see Section 22 for the final product-rules pass: explicit stored prayer content identifier, family timezone with 4am cutoff, session-invariant columns, UX-clarity toasts)
**Branch:** `fix/dwj-shared-table-sync` (off `fix/dwj-post-launch-p1`)
**Status:** Audit complete, repair implemented, product rules confirmed/implemented. **Nothing pushed, deployed, published, or applied to production.**

---

## 1. Executive Summary

The product promise is "One Verse. One Conversation. One Prayer." — every permanent member of a dinner circle should see the same shared experience regardless of device, timing, or location. Auditing the actual code confirmed this promise was **already true for the verse and the discussion questions**, but **false for the prayer step in two separate, confirmed ways**:

1. **Prayer rotation ("whose turn to pray") was never shared state.** `TablePage.jsx` tracked it entirely in local React state (`prayerIdx`, `prayedCount`), randomly seeded on every device on mount, advanced only in that device's memory, and never written to the database. Two members on two devices could — and would — see different people as "up to pray," with zero persistence across refresh, reopen, or the next day.
2. **The prayer text itself was chosen per-viewer, not per-table.** `getPrayer()` selected `prayer_level_1/2/3` based on the *viewer's own* `profile.faith_level` setting, while the discussion questions (correctly) show all three levels identically to everyone. Two people at the same table with different Settings → Faith Journey selections would read a genuinely different prayer for the same verse.

A third, lower-severity issue was also confirmed: four separate client-side implementations of "lock tonight's verse" (`HomePage.jsx`, `SettingsPage.jsx`, `OnboardingPage.jsx`, `TablePage.jsx`) each did a check-then-upsert with no real atomicity — a narrow but real race where two near-simultaneous first-openers of the night could have the second one's verse pick silently overwrite the first's.

All three are fixed in this branch: a new migration (`20260714000004_shared_dinner_session.sql`) adds a canonical, atomic, idempotent shared-session model to the *already-live* `groups`/`group_verse` schema (not the unused parallel `families` model), and the client is updated to use it. **No SQL has been applied to any database. No code has been pushed or deployed.**

---

## 2. Current Architecture

**Confirmed active model: `groups` / `profiles.group_id` / `group_verse` / `verse_history`.** Every `.from()`/`.rpc()` call in `src/` was re-grepped for this audit — `TablePage.jsx`, `HomePage.jsx`, `GuestTablePage.jsx`, `SettingsPage.jsx`, `OnboardingPage.jsx`, and `useFamily.js` exclusively read/write this model. **The parallel `families`/`family_members`/`family_verse`/`prayer_rotation` model has zero call sites anywhere in current client code** (confirmed by the prior security-remediation pass and re-confirmed here) — it is not used by the live experience at all, for anything, including prayer rotation. Notably, `prayer_rotation` (family_id, current_idx) already exists in the database as purpose-built infrastructure for exactly this problem — but for the *unused* model, disconnected from `groups`. This repair does not wire the unused table in; it extends the model that's actually live (see Section 11 for why).

No realtime subscriptions exist anywhere in the codebase (`supabase.channel`, `postgres_changes` — zero matches). No timezone-handling code exists anywhere (`timezone`, `Intl.DateTimeFormat`, `getTimezoneOffset` — zero matches). Both confirmed by grep across all of `src/`, not assumed.

---

## 2a. Sequence Diagrams — Before vs. After

**Owner starts tonight's dinner:**
```
BEFORE                                              AFTER
Owner opens Table                                   Owner opens Table
  -> loadVerse(): check group_verse (none)             -> rpc get_or_create_tonight_session(group)
  -> pick random verse client-side                        -> INSERT ... ON CONFLICT DO NOTHING
  -> upsert group_verse (verse locked)                       (row created: verse + prayer_order snapshot)
  -> local prayerIdx = random(0..N-1)                   -> client stores prayer_order, prayer_turns_completed=0
     (exists only in Owner's browser memory)               (both server-persisted, not local-only)
```

**Member A opens the app five minutes later:**
```
BEFORE                                              AFTER
Member A opens Table                                Member A opens Table
  -> loadVerse(): group_verse row exists (Owner's)     -> rpc get_or_create_tonight_session(group)
  -> loads the SAME verse (this part already worked)      -> row already exists -> INSERT is a no-op
  -> local prayerIdx = random(0..N-1)  <-- DIFFERENT       -> reads back the SAME prayer_order + turns_completed
     random seed than Owner's device                          as Owner's device
  => A and Owner can show a DIFFERENT "whose turn"      => A and Owner show the IDENTICAL "whose turn"
```

**Member B joins remotely midway through:**
```
BEFORE: same as Member A above -- a THIRD independent random prayerIdx.
AFTER:  same as Member A above -- reads the identical shared prayer_order/turns_completed.
```

**Everyone reaches the prayer step:**
```
BEFORE                                              AFTER
Each device independently computes                 Every device computes:
  currentPrayer = members[prayerIdx % N]               currentPrayer = nameFor(prayer_order[turns_completed])
using ITS OWN prayerIdx and ITS OWN copy of         using the SAME prayer_order array and SAME
`members` (order not guaranteed stable either)      turns_completed value, both read from the one shared row
=> up to N different "whose turn" displays          => exactly one "whose turn" display, shared by all
```

**Two devices press "We prayed together" nearly simultaneously:**
```
BEFORE                                              AFTER
Device 1: local prayerIdx++, prayedCount++          Device 1: rpc complete_prayer_turn(group, expected=k)
Device 2: local prayerIdx++, prayedCount++             -> UPDATE ... WHERE turns_completed = k  (succeeds, k->k+1)
(each device's local state independently advances   Device 2: rpc complete_prayer_turn(group, expected=k)
 by one -- no shared row exists to conflict over,       -> UPDATE ... WHERE turns_completed = k  (0 rows: already k+1)
 so there's no "race" to even detect --                 -> reads back current state instead (k+1, no double-advance)
 both devices simply diverge silently)               => rotation advances by exactly ONE turn, not two
```

**Everyone closes and reopens the app:**
```
BEFORE                                              AFTER
prayerIdx/prayedCount reset to 0 / re-randomize     loadVerse() re-fetches the shared group_verse row;
on next mount -- ALL prayer progress for the        prayer_order + prayer_turns_completed are exactly what
night is silently lost, for every device            they were before closing -- nothing is lost
independently, possibly to different values
```

**The next dinner begins the following day:**
```
BEFORE                                              AFTER
No stored concept of "who went first last night" -- rpc get_or_create_tonight_session(group) for the new date
each device's random seed has no memory of            -> no row yet for (group, new_date) -> build fresh
yesterday at all                                          prayer_order from CURRENT members, rotated so
                                                            groups.next_prayer_user_id (set when yesterday's
                                                            rotation completed) opens tonight
                                                     => a different person opens each night, on purpose,
                                                        not randomly and not forgotten
```

---

## 3. Confirmed Prayer-Rotation Root Cause

**File:** `src/pages/TablePage.jsx` (pre-fix)

```js
const [prayerIdx, setPrayerIdx] = useState(0)
const [prayedCount, setPrayedCount] = useState(0)
const prayerInitialized = useRef(false)

useEffect(() => {
  if (members.length > 0 && !prayerInitialized.current) {
    const randomStart = Math.floor(Math.random() * members.length)
    setPrayerIdx(randomStart)          // <- random, per device, per mount
    prayerInitialized.current = true
  }
}, [members])

function nextPrayer() {
  const newIdx = prayerIdx + 1
  setPrayerIdx(newIdx)                 // <- local only
  setPrayedCount(prayedCount + 1)      // <- local only, no DB write at all
  ...
}
```

**Root cause, precisely:** `prayerIdx` and `prayedCount` are ordinary `useState` — component-local memory. Nothing about "whose turn" is ever read from or written to Supabase. Every device that mounts `TablePage` independently rolls its own random starting index and independently increments it. This is not a race condition or a subtle bug — the feature was simply never implemented as shared state.

**Compounding, separate finding:** `getPrayer()` additionally personalized which prayer *text* to show:
```js
function getPrayer() {
  if (faithLevel === 3 && verse.prayer_level_3) return verse.prayer_level_3
  if (faithLevel === 2 && verse.prayer_level_2) return verse.prayer_level_2
  return verse.prayer_level_1 || ''
}
```
where `faithLevel = profile?.faith_level || 1` — the *viewer's own* profile setting. By contrast, `getQuestion(level)` is called three times in the render with hardcoded levels 1/2/3 and shows all three to everyone, gated only by whether the verse has that level's text — never by `faith_level`. Confirmed by reading the full render tree, not inferred.

**Validating detail:** `GuestTablePage.jsx` (the unauthenticated guest view) already always renders `verse.prayer_level_1` with no personalization — because guests have no `profile.faith_level` to read. So the fix applied to `TablePage.jsx` (always `prayer_level_1`) makes the authenticated experience consistent with what guests were already seeing, not a new, invented behavior.

---

## 4. Shared Verse/Question/Prayer Findings

- **Verse:** shared correctly via `group_verse(group_id, verse_date)` → `dinner_verses`. Confirmed atomic *now*; before this pass, four separate client implementations of the lock used `.upsert(..., {onConflict:'group_id,verse_date'})`, which **updates** (overwrites) on conflict rather than leaving the first writer alone — a real, narrow last-write-wins race for the first two people to open the app on a given night before anyone has locked a verse. Fixed by `get_or_create_tonight_session()`'s `insert ... on conflict do nothing`.
- **Context:** tied 1:1 to the verse row (`dinner_verses.context_text`) — always shared once the verse is shared. No issue found.
- **Questions:** confirmed already fully shared (all 3 levels, same for everyone). No issue found.
- **Prayer content:** confirmed **not** shared before this pass (Section 3). Fixed.
- **"Avoid repeating a verse":** the pre-fix logic queried `verse_history` with **no filter at all** — before the security-remediation pass this accidentally spanned every user in the database; after baseline RLS it accidentally scopes to only the calling user. Neither was ever "has this **group** discussed this verse." The new `get_or_create_tonight_session()` computes this correctly for the first time, via a `verse_history` ⋈ `profiles` join on `group_id` inside the `SECURITY DEFINER` function (not exposed to ordinary RLS-scoped queries). This is a genuine correctness improvement enabled by moving the logic server-side, not a new feature — it's the same feature, finally computing the thing its own name implies.

---

## 4a. Phase 2 Invariants — How Each Is Enforced

| Invariant | Enforcement |
|---|---|
| **A. One shared dinner** | `group_verse(group_id, verse_date)` unique key + `insert ... on conflict do nothing` in `get_or_create_tonight_session()`. No device can create a second, competing row for the same group/day. |
| **B. One content package** | The RPC returns verse, context, all question levels, and prayer text from the single `dinner_verses` row referenced by the canonical session — every device derives all of it from one `dinner_verse_id`. |
| **C. One prayer assignment** | `prayer_order` + `prayer_turns_completed` live on the shared `group_verse` row, never computed or stored client-side. |
| **D. Advance exactly once** | `complete_prayer_turn()`'s guarded `UPDATE ... WHERE prayer_turns_completed = expected_turns_completed` — optimistic-concurrency compare-and-swap; see Section 9 for the concurrent-tap analysis. Never advances on page load/refresh — only on an explicit `complete_prayer_turn()` call from the "We prayed together" button. |
| **E. Timezone consistency** | Session key uses Postgres `current_date` (server-side, single reference point) instead of client-computed date — already consistent across devices before this pass (Section 6), confirmed and preserved, not newly invented. |
| **F. Membership changes** | See Section 7 in full — new members enter future rotations, removed members exit future rotations, the current dinner's snapshot isn't rewritten retroactively, guests never enter rotation. |

## 5. Current-Session Behavior

**What represents "tonight's dinner," before and after:**

| | Before | After |
|---|---|---|
| Canonical row | `group_verse(group_id, verse_date)` — verse only | Same row, extended with `prayer_order uuid[]`, `prayer_turns_completed int` |
| Who creates it | Whichever of 4 client implementations ran first, via racy upsert | `get_or_create_tonight_session()`, atomic insert-on-conflict-do-nothing |
| Prayer state | Not stored anywhere | Stored on the same row, snapshotted at creation |
| How a device decides which dinner to load | `group_id` + client-computed UTC date string | Same key, computed server-side via Postgres `current_date` inside the RPC |

**Is the create/advance operation atomic and idempotent?** Yes, now. `get_or_create_tonight_session()` uses `insert ... on conflict do nothing` (atomic; only one caller's row ever lands). `complete_prayer_turn()` uses a guarded `update ... where prayer_turns_completed = expected_turns_completed` (optimistic-concurrency compare-and-swap; a losing concurrent call gets back the current state instead of double-advancing). Neither existed before this pass.

---

## 6. Timezone Behavior

**Confirmed: no timezone setting exists anywhere in the schema** (no column on `groups`, `profiles`, or elsewhere — confirmed against every column list seen in `AdminPage.jsx`'s queries and the production inspection from the security pass). Per the audit brief's own instruction not to invent one without checking, none is added in this repair.

**What actually happens, confirmed by reading the code:** the client computed "today" via `new Date().toISOString().split('T')[0]` — this is **UTC-based**, not each device's local date, despite reading like a local-date call at first glance (`toISOString()` always normalizes to UTC). This repair moves the equivalent computation to `current_date` evaluated inside the Postgres function (the database's session timezone, which for a standard Supabase project is UTC) — so the behavior is **unchanged, and already consistent across devices regardless of the viewer's own timezone** (invariant E's core requirement — no per-device divergence — was already met, just not documented).

**What is *not* fixed, and is a real, separate finding:** the UTC-midnight boundary does not align with any real family's local evening. A U.S. family eating dinner after roughly 4–8pm local time (depending on their timezone) is dining *after* the UTC date has already rolled over — meaning "tonight's" `verse_date` could already read as tomorrow's date mid-dinner for US-based users specifically. This is real, but it does not cause cross-device disagreement (everyone still agrees on the same, if oddly-timed, boundary) — it's a UX/product question, not a sync bug. See Section 16.

---

## 7. Membership Behavior

| Scenario | Behavior | Why |
|---|---|---|
| Newly added permanent member | Enters the **next** dinner's rotation automatically | `get_or_create_tonight_session()` builds `prayer_order` fresh from current `profiles.group_id` membership every time a new day's row is created |
| Removed member | Excluded from the **next** dinner's rotation automatically | Same mechanism — a removed member's `profiles.group_id` is null, so they're absent from the fresh membership query |
| Removed member mid-dinner (already in tonight's `prayer_order`) | Still appears in **tonight's** already-created rotation | `prayer_order` is a snapshot, captured once, fixed for that row's lifetime — satisfies the brief's explicit "the current completed dinner must not be rewritten retroactively." Any present member can still tap "We prayed together" regardless of whose named turn it technically is — the action was already collective, not identity-gated, so an absent person doesn't block completion. |
| Current prayer person leaves the group | Same as above for tonight; excluded from future sessions | — |
| Group owner | No special rotation treatment — owner participates like any member; owner-only actions (invite, remove, lock verse) are unaffected by this pass | Confirmed by re-reading `useFamily.js`/`SettingsPage.jsx` — ownership logic untouched |
| Remote permanent member (different device/home) | Sees the identical shared session, including prayer state, on next load | Root fix of this pass |
| Temporary guest (`GuestTablePage.jsx`) | Read-only — sees verse/context/questions/`prayer_level_1`, **no prayer button, no rotation participation at all** | Confirmed by re-reading `GuestTablePage.jsx`: no `nextPrayer`-equivalent exists there. Guests were never part of the rotation and remain excluded — matches the brief's "temporary guests do not silently become permanent rotation members" without any code change needed, since it was already true. |

**Flagged, not inferred:** "who opens tomorrow" advances to the member one rotation-position after tonight's starter (not the same person every night, and not reset to position 1) — this is a product judgment call this repair made explicitly (documented in the migration's comments), not something derivable from existing code, since the old implementation never persisted this at all. Steve should confirm this matches intent (see Section 16).

---

## 8. Guest Behavior

Unaffected by this pass — already routed through `get_guest_table_by_invite_code()` from the prior security-remediation pass, which itself already returns only `prayer_level_1` (no personalization, no rotation data, no member identities). No changes made here.

---

## 9. Concurrency Findings

| Scenario | Before | After |
|---|---|---|
| Two devices race to be first to lock tonight's verse | Second caller's upsert silently overwrites the first's pick | `insert ... on conflict do nothing` — only the first caller's insert lands; everyone else reads it back |
| Two devices tap "We prayed together" for the same turn nearly simultaneously | N/A — rotation wasn't shared at all, so this scenario couldn't even be described as a race, just independent local counters | `update ... where prayer_turns_completed = expected_turns_completed` — the losing call's `WHERE` clause matches zero rows (Postgres re-evaluates against the just-committed row when it acquires the lock), so it receives back the current, correct, unchanged state instead of double-advancing and skipping a person |
| Duplicate taps on the same device | Already guarded client-side (`markingPrayer`/`lockingVerse`/`saving` flags disable the button while a request is in flight) — unchanged by this pass | Same |

---

## 10. Files and Tables Affected

**New migration:** `supabase/migrations/20260714000004_shared_dinner_session.sql`
- `alter table public.group_verse add column prayer_order uuid[] ...`
- `alter table public.group_verse add column prayer_turns_completed int ...`
- `alter table public.groups add column next_prayer_user_id uuid references profiles(id) ...`
- `create or replace function public.get_or_create_tonight_session(uuid) ...`
- `create or replace function public.complete_prayer_turn(uuid, int) ...`

**Client files changed:**
- `src/pages/TablePage.jsx` — removed local `prayerIdx`/`prayedCount`/random-seed logic entirely; `loadVerse()` now calls `get_or_create_tonight_session()`; `nextPrayer()` now calls `complete_prayer_turn()`; `getPrayer()` always returns `prayer_level_1`; member-chip highlighting now compares by member id (via `memberProfiles`) instead of array index, incidentally fixing a latent same-name-collision bug too.
- `src/pages/HomePage.jsx` — `lockVerseForGroup()` now calls the RPC instead of its own check-then-upsert.
- `src/pages/SettingsPage.jsx` — same consolidation.
- `src/pages/OnboardingPage.jsx` — same consolidation.

No changes to `src/pages/GuestTablePage.jsx`, `src/hooks/useFamily.js`, `src/lib/supabase.js`, `src/pages/AuthPage.jsx`, or any RLS/grant from the prior security-remediation package.

---

## 11. Fix Implemented

**Design choice: extend `group_verse`, don't build a new table or wire in the unused `prayer_rotation` table.** Three options existed:
1. Wire the existing-but-disconnected `prayer_rotation`/`families`/`family_members` tables into the live `groups` model. Rejected — this model isn't used by any live code path, has no `group_id` linkage at all (it's keyed by `family_id`), and connecting two previously-separate schemas mid-repair would be exactly the "larger new architecture" the brief said not to build.
2. A new standalone `dinner_session` table. Rejected — `group_verse(group_id, verse_date)` already *is* a one-row-per-group-per-day canonical record with working RLS; a second table would just be a second source of truth to keep in sync for no benefit.
3. **Extend `group_verse` with two columns, add one column to `groups`, add two RPCs.** Chosen — the smallest change that gives every group a true canonical per-day session record for verse *and* prayer state together, reusing infrastructure that already works.

See Section 3 for the client-side `getPrayer()` fix (always `prayer_level_1`) and Section 10 for the full file list.

---

## 12. SQL / RPC Changes

Full source: `supabase/migrations/20260714000004_shared_dinner_session.sql`. Summary:

```sql
alter table public.group_verse add column if not exists prayer_order uuid[] not null default '{}';
alter table public.group_verse add column if not exists prayer_turns_completed int not null default 0;
alter table public.groups add column if not exists next_prayer_user_id uuid references public.profiles(id) on delete set null;

create or replace function public.get_or_create_tonight_session(group_id_input uuid)
returns table(session_id uuid, verse_date date, dinner_verse_id uuid, verse_ref text, category text,
              verse_text text, context_text text, question_level_1 text, question_level_2 text,
              question_level_3 text, prayer_level_1 text, prayer_order uuid[], prayer_turns_completed int)
-- security definer; atomic insert...on conflict do nothing; group-scoped verse_history dedup; membership snapshot

create or replace function public.complete_prayer_turn(group_id_input uuid, expected_turns_completed int)
returns table(prayer_turns_completed int, all_prayed boolean)
-- security definer; optimistic-concurrency compare-and-swap; sets groups.next_prayer_user_id once, on completion
```

**Not directly verified against the live schema, flagged explicitly in the migration file:** the RPC's `on conflict (group_id, verse_date)` assumes a matching unique constraint already exists. This is a strong inference (every pre-existing client implementation already called `.upsert(..., {onConflict:'group_id,verse_date'})`, which errors at call time without a matching constraint, and that code path is evidently live) but not something this session could query directly. A one-line verification query is included in the migration's own header comment; if the constraint is missing, the migration comment includes the exact `ADD CONSTRAINT` to run first.

**Reviewed against the existing security-remediation package:** this migration touches only `group_verse` and `groups`, both already RLS-enabled by `20260714000002_emergency_baseline_rls.sql`. It adds no new policy (RLS applies at the row level, existing `group_verse_select_member`/`insert_member`/`update_member` and `groups_select_owner_or_member`/etc. already cover the new columns) and does not modify any policy from parts 1–3. It is designed to be applied as **part 4**, after the existing three-part package, in the staged runbook (see Section 17).

---

## 13. Test Identities Used

**None — no live Supabase credentials or local database exist in this environment**, consistent with every prior phase of this engagement. See Section 14/15 for exactly what that means for "passed" claims.

---

## 14. Tests Passed

| Check | Result |
|---|---|
| `npm run build` | **Passed.** Client compiles cleanly with all changes; bundle size marginally smaller (four duplicated functions consolidated into RPC calls). |
| `npm audit` | **Ran** — see Section 15 for the result, unchanged from prior passes. |
| Manual code trace of every scenario in Section 15's test matrix | **Performed** (read the exact SQL/JS execution paths by hand for each scenario) — this is verification-by-inspection, not verification-by-execution. Documented as such, not conflated with "tested." |

**No scenario in Phase 3's or Phase 7's requested test matrix was actually executed against a running app or database.** Per the brief's own instruction — "Never report 'passed' unless the behavior was actually observed" — none of those scenarios are reported as passed. Section 15 lists them explicitly as not performed and why, with the exact protocol to run them once credentials/an environment exist.

## 15. Tests Not Performed and Why

**The entire Phase 3 multi-session harness and Phase 7 regression list — not executed. No exceptions.** This environment has no Supabase project credentials, no local Postgres/Supabase instance, and no way to create real Owner/Member A/Member B/Guest sessions against a live backend. This has been true for every phase of this engagement (see the prior security-remediation runbook's own Section 22) and remains true here.

**What follows is the protocol to run these tests once an environment exists** — written to be directly executable, not aspirational:

### Setup
1. Apply migrations 1–4 to a **staging** Supabase project (never production first).
2. Create 3 real accounts via the app's normal signup: Owner, Member A, Member B. Have Owner create a group; A and B join via invite code.
3. Open 4 separate browser contexts (e.g., 3 separate browser profiles/incognito windows + `curl`/Postman with the anon key for the guest route) so each identity has a genuinely independent session — sharing one browser's localStorage/cookies across tabs does not satisfy this.

### Scenarios (numbered to match the brief's Phase 3 list)
1. **Owner starts a dinner** — Owner opens Table, confirm `get_or_create_tonight_session` is called and a `group_verse` row is created with a non-empty `prayer_order`.
2. **Member A opens after the verse is selected** — confirm A's Table screen shows the *same* `verse_ref`/`verse_text` as Owner's, not a re-roll.
3. **Member B opens after the first question** — same check.
4. **Guest joins via invite code** — confirm guest sees the same verse/questions/`prayer_level_1`, and confirm the guest screen shows **no** prayer button/rotation UI at all.
5. **All four compare** verse, context, questions, prayer, and designated prayer person — byte-for-byte identical text expected across Owner/A/B; guest matches on verse/context/questions/prayer text (guest has no "designated person" concept).
6. **Refresh every device** — confirm `prayer_turns_completed` and the derived "whose turn" are identical before and after refresh on every device.
7. **Close and reopen every device** — same check, plus confirm across an actual app-kill (not just tab refresh) on at least one device.
8. **Simulate a weak network** (e.g., browser devtools network throttling / offline toggle mid-request) — confirm the RPC call either completes or fails cleanly with the existing error toast; confirm no duplicate `group_verse` row and no `prayer_turns_completed` corruption from a retried request.
9. **Complete the prayer from two devices at nearly the same time** — script two near-simultaneous `complete_prayer_turn` calls with the *same* `expected_turns_completed` value (e.g., two `fetch`/RPC calls fired within the same event-loop tick from two different sessions). Confirm `prayer_turns_completed` advances by exactly 1, not 2.
10. **Verify the rotation advances exactly once** — direct consequence of #9; also confirm via a SQL check: `select prayer_turns_completed from group_verse where ...` immediately after.
11. **Start the next dinner and verify the next eligible person is selected** — after a full rotation completes, confirm `groups.next_prayer_user_id` is the member one position after tonight's starter (not the same person, not null unless the group had only one member).
12. **Remove a member and test the next rotation** — remove Member B via the existing `remove_group_member()` RPC, start a new day's session (or manually adjust `verse_date` in staging for testability), confirm B is absent from the new `prayer_order`.
13. **Add a member and test future rotation** — join a new Member C, start a new day's session, confirm C appears in the new `prayer_order`.
14. **Different simulated time zones** — set the OS/browser timezone on two test devices to e.g. `America/Los_Angeles` and `Asia/Tokyo`, confirm both resolve to the *same* `group_verse` row for "tonight" (they should, per Section 6 — this test exists to catch a regression, not because divergence is expected).

### Phase 7 additions not covered above
- Same group, 2 vs. 3 authenticated devices — covered by scaling scenarios 1–3.
- Invalid invite code — already covered by the existing guest-flow error path (unchanged by this pass).
- Next-day session — covered by scenario 11's mechanism; needs either waiting for a real day boundary or adjusting `verse_date` directly in a staging database for practical testing.
- No duplicate session rows / no double prayer advancement / no cross-group data visibility — covered by scenarios 9–10 plus a direct SQL check (`select count(*) from group_verse group by group_id, verse_date having count(*) > 1` should return zero rows).

**Also not performed, and not newly required by this pass** (unchanged from the prior security runbook, re-confirmed): lint (no ESLint config exists), unit/integration tests (no test framework exists), typecheck (JavaScript project, N/A), Android/Capacitor checks (no native project exists in this repo).

---

## 16. Remaining Product Decisions

- **"Who opens tomorrow" advances by one rotation position (not the same person every night, not reset to first).** This is a genuine product judgment call made explicitly in this repair (documented in the migration), since nothing in the prior code persisted an opinion on it at all. Confirm this matches what Steve actually wants — the alternative (same person always opens, or a fully re-randomized order each night) is a one-line change in `complete_prayer_turn()`.
- **UTC midnight as the day boundary** (Section 6) causes "tonight's" session to roll to tomorrow's date mid-evening for US-timezone families. Not fixed in this pass (no timezone setting exists to base a fix on, and inventing one is explicitly out of scope per the brief). If Steve wants this fixed, the smallest addition would be a single `groups.timezone text` column (default `'UTC'`) and swapping `current_date` for `(now() at time zone groups.timezone)::date` in both RPCs — a small, contained follow-up, deliberately not bundled into this pass.
- **The "Tonight's verse is already set" vs. "Tonight's verse is set!" toast distinction was simplified away.** Before this pass, tapping "Set tonight's verse" when someone else had already locked it showed a different message ("already set") than locking it yourself ("is set!"). The new RPC is idempotent and returns the same shape either way, so the client now always shows "is set!" regardless of who actually created it. This is a deliberate simplification traded for atomicity and less client-side special-casing — recoverable cheaply (have the RPC return an extra `was_just_created` boolean) if Steve wants the distinction back; flagged here rather than silently dropped.
- **No realtime propagation to already-open devices.** A device that already has the Table screen open will not see another member's prayer-turn advance or verse lock until it re-fetches (refresh, re-navigate, or reopen) — the fix guarantees everyone converges on the *same* truth, not that everyone sees it *instantly*. Adding a Supabase Realtime subscription would close this gap; deliberately not included here as it's a genuinely separate, larger change (new subscription lifecycle, cleanup on unmount, etc.) than "make the state correct," and the brief asked for the smallest necessary repair.

---

## 17. Deployment Impact

This migration is **part 4** of the staged rollout, applied after the existing 3-part security package, since it depends on nothing from that package but should be tested in the same staging pass. Updated order:

1. `20260714000001_security_primitives.sql`
2. Deploy repaired client (security-pass RPCs)
3. `20260714000002_emergency_baseline_rls.sql`
4. `20260714000003_admin_access_policies.sql`
5. **`20260714000004_shared_dinner_session.sql`** *(new — this pass)*
6. Deploy repaired client (this pass's `TablePage.jsx`/`HomePage.jsx`/`SettingsPage.jsx`/`OnboardingPage.jsx` changes) — **must not deploy before step 5**, since the new client calls `get_or_create_tonight_session()`/`complete_prayer_turn()`, which don't exist until migration 4 is applied. This is the same "primitives before client" ordering discipline as the security package.
7. Run the Section 15 test protocol against staging before any production application.

No existing production data needs repair or backfill — `group_verse.prayer_order` defaults to `'{}'` and `prayer_turns_completed` to `0` for all existing rows; the first `get_or_create_tonight_session()` call for a *new* day naturally populates a real snapshot. Old rows for past dates are simply inert (never re-read once the day passes).

## 18. How This Fits Into the Existing Security Rollout

Purely additive to the 3-part security package — no policy, grant, or function from parts 1–3 is modified. The two new RPCs follow the exact same pattern established there: `SECURITY DEFINER`, `SET search_path = ''`, `revoke all` then explicit `grant execute` to `authenticated` only (no `anon` access — this feature has no unauthenticated use case). `docs/DWJ_SECURITY_REMEDIATION_RUNBOOK_2026-07-14.md` is not modified by this pass; this document stands alongside it as a separate, later addition to the same staged rollout.

## 19. Branch and Commits

Branch: `fix/dwj-shared-table-sync`, created off `fix/dwj-post-launch-p1` at commit `ac60b3b`. See this branch's own `git log` for exact commit hashes from this pass.

## 20. Confirmation

**Nothing in this pass has been applied to any database, pushed to `origin`, deployed to Vercel, or published to the Play Store.** `npm run build` and `npm audit` were run locally only. All work is local commits on `fix/dwj-shared-table-sync`. The broader UX redesign explicitly requested to wait has not been started — only the functional-clarity findings in Section 21 below were identified, none implemented beyond what Section 11/12 already describes.

---

## 21. Phase 6 — Smooth Experience Review (findings only; no redesign performed)

| Question | Finding |
|---|---|
| Does "Let's Get Started" always load the shared dinner? | Yes, now — `HomePage.jsx`'s CTA leads to `TablePage`, whose `loadVerse()` always calls the shared RPC. |
| Does a joining member immediately see the verse is already set? | Yes, now — first load reads the existing canonical row. |
| Is the designated prayer person clear to everyone? | Yes, now — same `prayer_order[turns_completed]` computation on every device. |
| Does the prayer button accurately reflect shared completion? | Yes, now — `allPrayed` is derived from the shared row, not a local counter. |
| Does refreshing lose progress? | No — state is re-fetched from the shared row on every mount. |
| Does reopening resume correctly? | Yes, same mechanism. |
| Does the app explain when another member already completed the dinner? | **Partially.** The screen shows the *current correct state*, but doesn't explicitly call out "X already did this" the way the pre-fix "already locked" toast used to for verse-locking specifically (see Section 16 — a deliberate, flagged simplification). Not fixed in this pass. |
| Are loading states honest? | Unchanged, already reasonable (`Preparing your verse...`, explicit error state with retry). |
| Are failure messages warm and understandable? | Unchanged existing copy, already on-brand ("That didn't save. Tap it again when you're ready."). |
| Does guest access show only intended content? | Unaffected by this pass, already correct from the prior security pass. |
| Dead buttons or misleading success states? | The core one (prayer button not reflecting reality) is fixed. None newly introduced by this pass. |

No screens were redesigned, moved, or restyled. Every change in this pass is behind existing UI elements, not new ones.

---

# Revision 2026-07-15b — Final Shared-Table Product Rules

This section covers a same-day follow-up pass that confirmed and hardened five specific product rules against the repair above. **Nothing new was pushed, deployed, published, or applied to production in this revision either.**

## 22. Section 1 — Shared Prayer Content: Before and After This Revision

**Exact state confirmed by re-reading the code (not assumed), before this revision:**
- `TablePage.jsx`'s `getPrayer()` already always returned `verse.prayer_level_1` (fixed in the prior pass) — sourced from `session.prayer_level_1`, which came from a **hardcoded literal** `dv.prayer_level_1` inside `get_or_create_tonight_session()`'s `SELECT` list. Not a stored, named identifier — an implicit rule baked into one function's query.
- `GuestTablePage.jsx` independently received `prayer_level_1` from a **second, separate hardcoded literal** inside `get_guest_table_by_invite_code()` — the same value in practice, but via two independent literals that could have silently drifted apart if one were ever edited without the other.
- `SettingsPage.jsx`'s "Faith Journey" `faith_level` picker remained fully present and functional as a personal profile preference — already fully decoupled from the shared Table prayer (confirmed: no `faith_level`/`faithLevel` reference anywhere in `TablePage.jsx` except an explanatory comment).
- Guests already received the same text as permanent members, coincidentally (both hardcoded to level 1 independently).

**Fixed in this revision:**
- `group_verse.prayer_tier text not null default 'level_1'` — an explicit, stored, named identifier for which `dinner_verses.prayer_level_N` column is canonical for that specific dinner, snapshotted once at session creation. Constrained to `('level_1','level_2','level_3')` by a `CHECK` constraint.
- `get_or_create_tonight_session()` now resolves prayer text via a `CASE` on the row's own `prayer_tier`, returned as `prayer_text`.
- `get_guest_table_by_invite_code()` (upgraded via `create or replace` inside `20260714000004_shared_dinner_session.sql`, after the column exists) reads the **same stored `prayer_tier`** from the **same session row** — not a second independent literal.
- Only `'level_1'` is ever written today (no group-level faith setting exists to base anything else on), but the identifier itself is now real, stored data, not an implicit rule buried in two places.

**Once a session exists, its prayer cannot change because a member's personal Faith Journey setting is different or changes later** — `prayer_tier` is read once at creation and frozen on the row; nothing in `getPrayer()`, `get_or_create_tonight_session()`, or `get_guest_table_by_invite_code()` reads any viewer's `profile.faith_level` at any point.

**Test protocol (see Section 25 — not executed, no live environment):** Owner/Member A/Member B each set a different Faith Journey level in Settings, then all three plus a guest load the same dinner and are expected to see byte-identical prayer text.

## 23. Section 2 — Prayer Rotation Rule: Confirmed Already Correct

Verified by re-reading `complete_prayer_turn()` and `get_or_create_tonight_session()` line by line, not assumed:

| Required rule | Status | Where enforced |
|---|---|---|
| Advances only after a dinner is completed | ✅ already true | `complete_prayer_turn()` is the only write path to `prayer_turns_completed`; nothing else calls it |
| Not on a new date beginning | ✅ already true | `get_or_create_tonight_session()` never writes `groups.next_prayer_user_id` |
| Not on app open / session load | ✅ already true | Same — session creation/loading is a separate function from turn completion |
| Not on opening the prayer section | ✅ already true | No code path from rendering `TablePage` calls `complete_prayer_turn()` |
| Not on refresh | ✅ already true | `loadVerse()` only ever calls `get_or_create_tonight_session()` |
| Not double-advanced by concurrent taps | ✅ already true, now doubly guarded | Optimistic-concurrency compare-and-swap on `prayer_turns_completed`, **plus** (new this revision) an explicit `rotation_advanced` boolean guard in the same statement that writes `groups.next_prayer_user_id` — belt and suspenders on the specific "idempotent dinner-completion key" requirement |
| Skipped day preserves the next person's turn | ✅ already true, confirmed not assumed | `next_prayer_user_id` is untouched by anything except full completion — if no session is ever created for a skipped day, nothing runs at all, so the value carries forward unchanged to whenever the family next opens the app |
| Incomplete dinner doesn't consume a turn | ✅ already true | Same mechanism — `next_prayer_user_id` only changes on the transition to full completion, never partial progress |
| Reopening a completed dinner still shows who prayed | ✅ already true | `group_verse` rows are never deleted or reset; `get_or_create_tonight_session()`'s fast path returns the existing, frozen row for that date |
| Next dinner uses the next eligible permanent member | ✅ already true | Fresh `prayer_order` built from current `profiles.group_id` membership each new session |
| Removed members skipped / new members included | ✅ already true | Same mechanism |
| Guests excluded from rotation | ✅ already true | Guests never have a `profiles` row with `group_id` set |
| Owner follows the same rules as everyone else | ✅ already true | No owner-specific branch exists anywhere in the rotation logic |

**No code correction was required for the rotation-advancement logic itself.** The only change made this revision is the additional `rotation_advanced` guard column, added for auditability and defense-in-depth on the specific "idempotent completion key" requirement — not because a bug was found in the existing compare-and-swap.

## 24. Section 3 — Family/Table Timezone and the 4:00 AM Cutoff

**Schema:** `groups.timezone text not null default 'America/Chicago'`, constrained by `groups_timezone_valid check (public.is_valid_iana_timezone(timezone))` — a real validation function that attempts `now() at time zone tz` and catches failure, not a static allowlist. No arbitrary text can be stored via any code path, including a hypothetically compromised client, since the constraint is enforced by Postgres itself on every `INSERT`/`UPDATE`.

**Backfill:** `America/Chicago` is used **only** as the migration-time fallback for groups created before this column existed, applied automatically by `ALTER TABLE ... ADD COLUMN ... DEFAULT ... NOT NULL` (a single efficient statement in Postgres 11+, no separate `UPDATE` needed) — documented explicitly in the migration file as a fallback, not a claim about where most families actually live.

**On group creation:** `useFamily.js`'s `createGroup()` now detects the owner's device timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone` (the standard browser API) and sends it; if detection fails for any reason, the field is simply omitted and the database's own default applies.

**Owner-editable:** `SettingsPage.jsx` now has an owner-only timezone picker (curated list of common US IANA zones — not exhaustive, since the database validates whatever is actually sent regardless of what the picker offers). Writes through the existing `groups_update_owner` RLS policy — no new policy needed.

**4:00 AM cutoff, exact mechanism:** `public.canonical_dinner_date(tz)` computes `((now() at time zone tz) - interval '4 hours')::date`. At 3:59:59 AM local time, this still resolves to the previous calendar day; at exactly 4:00:00 AM, it resolves to the current day. A dinner day therefore runs 4:00 AM through 3:59 AM the following local day, exactly as specified — a family eating dinner at 7–9pm local time is nowhere near either boundary, so "tonight" never rolls over mid-meal.

**Computed server-side, not per-client:** both `get_or_create_tonight_session()` and `complete_prayer_turn()` look up `groups.timezone` and call `canonical_dinner_date()` internally — no client computes this date. `get_guest_table_by_invite_code()` does the same, using the group looked up by invite code, so a guest resolves the identical dinner day as permanent members. The two remaining client-side date computations found during this pass (`HomePage.jsx`/`SettingsPage.jsx`'s `checkVerseLocked()`) were replaced with calls to a new, read-only `get_canonical_dinner_date_for_group()` RPC — deliberately **not** `get_or_create_tonight_session()` itself, since that would create a session as a side effect of merely viewing the Home/Settings screen, changing the deliberate "owner sets the verse first, then invites" flow that exists today.

**Historical sessions are not rewritten when the timezone changes:** `group_verse.timezone_used` snapshots the group's timezone at the moment each session was created. Changing `groups.timezone` later only affects the *next* session created (a new date, under the new timezone) — the fast path in `get_or_create_tonight_session()` returns existing rows unchanged regardless of any later timezone edit.

**Test protocol (Section 25, not executed):** owner in Central time, remote members in Eastern and Pacific time, all three should resolve to the identical `group_verse` row both before and after each device's local midnight, and only roll to a new session at each's respective 4am-local-adjusted boundary relative to the *group's* timezone (not their own) — i.e., a Pacific-time member should see "yesterday's" dinner continue even after their own midnight has passed, if the group's Central-time 4am cutoff hasn't arrived yet.

## 25. Section 4 — Session Content Invariants: Final Column List

`group_verse` (the canonical per-group-per-day session row) now freezes or identifies:

| Field | Frozen/identifies |
|---|---|
| `group_id` | Which family/group |
| `verse_date` | Canonical dinner date (server-computed, timezone + 4am cutoff) |
| `timezone_used` | Which timezone was active when `verse_date` was computed — new this revision |
| `dinner_verse_id` | Verse/content ID — context and questions are other columns on the same referenced row, so identified transitively |
| `prayer_tier` | Explicit prayer content identifier — new this revision |
| `prayer_order` | Prayer-order snapshot (member ids) |
| (implicit: `prayer_order[1]`) | Designated (starting) prayer member — no separate column needed, it's the first array element by construction |
| `prayer_turns_completed` | Prayer completion state / progress |
| `rotation_advanced` | Rotation advancement state — new this revision, explicit idempotency guard |

**Uniqueness:** one row per `(group_id, verse_date)`, enforced by a unique constraint this migration assumes already exists (see the migration file's own verification query and fallback `ADD CONSTRAINT`, not independently re-verified against the live schema in this revision).

**Atomicity, re-confirmed:** `get_or_create_tonight_session()` uses `insert ... on conflict do nothing ... returning id` — the first concurrent caller's insert lands; every other simultaneous caller's insert is a genuine no-op, and `was_created` (new this revision, see Section 26) tells each caller precisely whether *their own* call created the row, computed from the `RETURNING` clause itself (not a pre-check-then-guess), so it stays correct even under a real concurrent race.

## 26. Section 5 — UX Clarity Messaging (implemented, not deferred)

The three requested messages are implemented, using the exact copy specified:

- **"Tonight's table is ready."** — shown when `get_or_create_tonight_session()`'s `was_created` return value is `true` for *this* call (`HomePage.jsx`/`SettingsPage.jsx`'s "Set tonight's verse" button).
- **"Tonight's table was already set."** — shown when `was_created` is `false`.
- **"Your family already completed tonight's dinner."** — shown once, on `TablePage.jsx`'s load, when the freshly-loaded session's `prayer_turns_completed` already equals `prayer_order.length`.

`was_created` is computed precisely, not approximately: the RPC checks for an existing row before attempting its insert (an initial guess), then corrects that guess using `INSERT ... ON CONFLICT DO NOTHING ... RETURNING id INTO ...` — `RETURNING` only yields a row for an insert that actually happened, so a caller that *loses* a concurrent creation race gets the correct `false`, not a stale `true` from its own earlier pre-check.

**Loading/error honesty, re-confirmed unchanged:** no success is shown before the database confirms it (every write path checks `error` before showing a success toast — unchanged from the prior repair pass); journal drafts are preserved on failure (unchanged, `savedTargetsRef` logic untouched); no local fallback dinner content is ever silently generated (the RPC either returns real data or the existing error toast fires — no client-side verse fabrication exists anywhere in this codebase).

## 27. Section 6 — Multi-Device Test Plan (Executable Protocol — NOT RUN)

**No Supabase credentials or local database exist in this environment**, consistent with every phase of this entire engagement. Nothing below is claimed as passed. This is the exact protocol to run once a staging environment exists.

### Setup
1. Apply, in order: `20260714000001_security_primitives.sql`, `20260714000004_shared_dinner_session.sql`, then `20260714000002_emergency_baseline_rls.sql`, then `20260714000003_admin_access_policies.sql` (see Section 28 for the full rationale).
2. Create 3 real accounts: Owner, Member A, Member B. Owner creates a group (timezone auto-detected from the creating device); A and B join via invite code.
3. Four independent sessions: 3 separate authenticated browser profiles + one anonymous session (incognito or a plain HTTP client with only the anon key) for the guest route.

### Scenarios
1. **Owner creates the dinner** — confirm `group_verse` row created with non-empty `prayer_order`, `prayer_tier = 'level_1'`, `timezone_used` matching the group's current timezone, `rotation_advanced = false`.
2. **Member A joins 5 minutes later** — confirm A sees byte-identical `verse_ref`/`verse_text`/`context_text`/all question levels/prayer text to Owner.
3. **Member B joins after midnight in their own device timezone** (but before the group's 4am-local cutoff) — confirm B still sees the *same* session as A and Owner, not a new one, by setting B's OS/browser timezone to something whose local midnight has already passed relative to the group's timezone.
4. **Guest joins with the table code** — confirm identical verse/context/questions/prayer text to permanent members; confirm no prayer button/rotation UI is shown to the guest at all.
5. **All devices refresh** — confirm `prayer_turns_completed` and derived "whose turn" identical before/after on every device.
6. **All devices close and reopen** — same check, across an actual app-kill, not just a tab refresh.
7. **Two permanent members complete prayer concurrently** — fire two `complete_prayer_turn` calls with the same `expected_turns_completed` value within the same event-loop tick from two different sessions.
8. **Rotation advances exactly once** — direct consequence of #7; confirm via `select prayer_turns_completed from group_verse where group_id = ... and verse_date = ...` immediately after — expect +1, not +2.
9. **The next dinner shows the correct next permanent member** — after a full rotation completes, confirm `groups.next_prayer_user_id` is the member one position after tonight's starter, and confirm the next day's `get_or_create_tonight_session()` call builds a `prayer_order` starting with that person.
10. **Skip a calendar day and verify no turn was lost** — do not open the app for a group for one full calendar day (or manipulate `verse_date`/system clock in staging), then open on a later day; confirm `groups.next_prayer_user_id` is unchanged from before the skip and the new session's `prayer_order` starts with that same person.
11. **Remove the upcoming prayer person and verify the next eligible person** — call `remove_group_member()` targeting whoever `groups.next_prayer_user_id` currently points to, start a new day's session, confirm the new `prayer_order` excludes them and starts with a different (still-current) member.
12. **Add a new permanent member and verify future inclusion** — join a new member, start a new day's session, confirm they appear in the new `prayer_order`.
13. **Change the family timezone and verify future sessions use it without rewriting historical ones** — as Owner, change the group's timezone in Settings; confirm a *new* session created afterward has the new `timezone_used`, while a session created *before* the change retains its original `timezone_used` and `verse_date` unchanged.
14. **No cross-group visibility** — confirm neither `group_verse` nor `groups.next_prayer_user_id` nor any RPC response for Group 1 ever includes data from an unrelated Group 2, for any of the four identities.

**Also verify explicitly, tied to this revision's specific additions:** the three UX toasts fire with the exact specified copy at the exact specified moments (Section 26); the `is_valid_iana_timezone` constraint actually rejects a garbage string (e.g. attempt `update groups set timezone = 'Not/A/Real/Zone' where id = ...` directly against staging and confirm it errors).

## 28. Final Combined Staged Deployment Order

Supersedes the deployment order in the prior revision of this document and in `docs/DWJ_SECURITY_REMEDIATION_RUNBOOK_2026-07-14.md` — this is the single authoritative order going forward, combining both the security package and the shared-table repair:

**Phase 1 — Security primitives**
A. `supabase/migrations/20260714000001_security_primitives.sql`

**Phase 2 — Shared dinner/session primitives**
B. `supabase/migrations/20260714000004_shared_dinner_session.sql` (depends on nothing from Phase 1 except running after it, since it upgrades `get_guest_table_by_invite_code()` via `create or replace` — must run after A, not before)
C. Verify the `group_verse(group_id, verse_date)` unique constraint actually exists (migration file's own header query) before proceeding, since both A and B's RPCs assume it
D. Test every RPC directly per this document's Section 27 and the security runbook's Section 17 (both are additive-only at this point — nothing has been restricted yet)

**Phase 3 — Repaired client deployment**
E. Push and deploy the client on `fix/dwj-shared-table-sync` (which includes every change from `fix/dwj-post-launch-p1`) — only after A and B are both applied, since the client calls RPCs from both
F. Smoke-test production before lockdown: create a table, join a table, guest table view, list/remove members, prayer rotation end-to-end, journal save/edit/delete, admin access, normal-user admin denial, timezone picker

**Phase 4 — Baseline RLS lockdown**
G. `supabase/migrations/20260714000002_emergency_baseline_rls.sql`
H. Immediately run the full anon/User-A/User-B security matrix (security runbook Section 17)

**Phase 5 — Admin policies**
I. `supabase/migrations/20260714000003_admin_access_policies.sql`
J. Confirm Steve's admin access works; confirm normal users remain denied

**Phase 6 — Multi-device production testing**
K. Run every scenario in Section 27 above against the real production environment with real devices
L. Continue reviewing logs per the security runbook's Section 21

**Nothing in Phases 1–6 has been executed. This is the order for Steve (or whoever holds deployment access) to follow, not a record of what has happened.**

## 29. Assumptions Carried Into This Revision

- The `group_verse(group_id, verse_date)` unique constraint (needed by `ON CONFLICT`) is inferred, not directly verified against the live schema — same caveat as the prior revision, now applying to both the original insert and the guest-RPC lookup.
- `is_valid_iana_timezone()`'s `exception when others` is intentionally broad (catches any failure mode, not just the specific SQLSTATE Postgres raises for an unrecognized zone) since this session cannot verify the exact error code against a live database — the broad catch is the safer choice for a pure validation function (a false "invalid" is recoverable; an uncaught exception crashing an `INSERT` is not).
- The curated `TIMEZONES` list in `SettingsPage.jsx` is a convenience picker only, not exhaustive — any group needing a non-US zone would need that value set some other way (e.g., directly in the database) until the picker is expanded, which is a small follow-up, not a blocker.

## 30. Unresolved Issues (unchanged from the prior revision unless noted)

- Whether `families`/`family_members` (the unused parallel schema) is active, legacy, or an in-progress rewrite — still not resolvable from code alone (Section 5 of the original repair section).
- No realtime propagation to already-open devices — still true; a device must refetch (refresh/reopen/renavigate) to see another member's advance. Not addressed in this revision either, for the same reason as before (a genuinely separate, larger change).
- The curated timezone list (Section 29) — small, explicitly flagged follow-up.

## 31. Confirmation

**Nothing in this revision has been applied to any database, pushed to `origin`, deployed to Vercel, or published to the Play Store.** `npm run build` and `npm audit` were run locally only. All work is local commits on `fix/dwj-shared-table-sync`.
