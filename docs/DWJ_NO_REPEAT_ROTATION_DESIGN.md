# No-Repeat Dinner Rotation — Investigation & Design

**Status:** Investigation and design only. No migrations created. No production data or code modified. No frontend changes made. Everything below is traced against the live production schema (via read-only query) and the actual migration history in `supabase/migrations/`, not assumed.

---

## Phase 1 — Trace Current Selection

### What happens today when a group opens Tonight's Dinner?

1. A member opens the app. `HomePage.jsx`, `OnboardingPage.jsx`, `SettingsPage.jsx`, or `TablePage.jsx` — whichever screen needs it — calls `supabase.rpc('get_or_create_tonight_session', { group_id_input: groupId })`. All four call sites are identical; there is no separate client-side selection logic anywhere.
2. Inside the RPC (current production version, last redefined in `20260725000001_group_ownership_protection.sql`):
   - Verifies the caller is an authenticated member of that group, and that the group isn't archived.
   - Resolves "today" via `canonical_dinner_date(group.timezone)` — the group's own IANA timezone with a 4:00 AM local cutoff, computed server-side.
   - **Fast path:** if a `group_verse` row already exists for `(group_id, today)`, skip straight to returning it.
   - **Creation path** (first caller of the day only): builds tonight's `prayer_order` snapshot, then picks a dinner:
     ```sql
     select dv.id from dinner_verses dv
     where dv.active = true
       and dv.id not in (
         select vh.dinner_verse_id from verse_history vh
         join profiles p on p.id = vh.user_id
         where p.group_id = group_id_input
       )
     order by random() limit 1;
     -- if that returns nothing, fall back to:
     select dv.id from dinner_verses dv where dv.active = true order by random() limit 1;
     ```
   - Inserts the new `group_verse` row via `insert ... on conflict on constraint group_verse_group_id_verse_date_key do nothing` — a real, verified `UNIQUE (group_id, verse_date)` constraint (confirmed live via `pg_constraint`), so only the first of any concurrent callers actually creates the row.
   - Returns the full dinner content (verse text, context, three questions, and whichever `prayer_level_N` the row's stored `prayer_tier` points to — always `level_1` today) plus the `prayer_order` array and turn count.
3. Every device that calls the RPC for the same group on the same day gets back the exact same row — the fast path guarantees this regardless of who "won" the creation race.
4. Guests never reach this RPC at all. `GuestTablePage.jsx` calls the separate, read-only `get_guest_table_by_invite_code()`, which looks up whatever `group_verse` row already exists for today and returns it — it has no code path that creates a session. A guest can view but never trigger or influence selection.

### Is selection currently random with replacement, random excluding recent history, deterministic, or something else?

**Random, with a partial, best-effort, non-cycle-aware exclusion.** It excludes dinners present in `verse_history` for any member of the group, but degrades silently to plain random-with-replacement the moment that exclusion would return zero candidates — and, critically, **that degradation is permanent**, not a clean per-cycle reset (see Phase 4).

### What exactly does `verse_history` do today?

It is a **per-user, opt-in "I marked this discussed" log**, not an automatic record of what a group was shown. Specifically:

- **Write path:** `TablePage.jsx`'s `markDiscussed()` — fired only when someone taps a specific "mark as discussed" action — `upsert`s `{ dinner_verse_id, user_id, discussed_at }` with `onConflict: 'dinner_verse_id,user_id'`.
- **Live constraint:** `verse_history_user_verse_unique = UNIQUE (user_id, dinner_verse_id)` (confirmed via `pg_constraint`). This means **at most one row can ever exist per (user, dinner) pair** — a repeat "discussion" of the same dinner in a later cycle *overwrites* `discussed_at` rather than creating a second row. `verse_history` structurally cannot distinguish "seen in cycle 1" from "seen in cycle 3."
- **Two real gaps this creates for rotation purposes:**
  1. If nobody taps "mark discussed" for a given night (the write can also silently fail — the UI just shows "that didn't save, tap it again," with no automatic retry), that dinner never enters `verse_history` at all and remains eligible to be picked again immediately, even the very next night.
  2. Once a family finishes a full pass through the active library (assuming they always tap the button), *every* active dinner has a `verse_history` row for at least one member. From that point on, the "not in verse_history" query returns nothing on every single night, forever — the function falls to the no-exclusion fallback branch permanently, not just for one reshuffle. **There is no code path today that resets this and restores no-repeat behavior for cycle 2.**
- `verse_history` also feeds an unrelated, cosmetic feature: `App.jsx`'s "conversations" stat (`count(*) where user_id = me`), shown as a personal engagement number, not used anywhere in selection logic itself.

**Conclusion: `verse_history` partially prevents repeats within a family's first pass through the library, on a best-effort basis, and provides no protection at all afterward.** It was never designed as a rotation-cycle mechanism — it reads as a personal "discussion journal" checkbox that the selection RPC happens to also consult.

---

## Phase 2 — Identity of a "Dinner"

**Recommendation: `dinner_verses.id` (the UUID primary key) — already what every relevant table uses today.**

- `group_verse.dinner_verse_id` and `verse_history.dinner_verse_id` are both already foreign keys to `dinner_verses.id`. No new identifier concept is needed.
- It survives content edits (an `UPDATE` to `verse_text`/`context_text`/questions/prayer on an existing row never changes its `id`) and active/inactive toggles (`active` is just another column on the same row).
- It does **not** automatically survive an "upgrade/replacement" in the sense the recent content batches used that word — those are modeled as one row's `active` flipping to `false` and a brand-new row (new `id`) being inserted for the expanded/rewritten passage (confirmed: this is exactly how the 7 confirmed upgrade pairs from the global audit work — e.g., the existing Mark 9:24 row stays in the table, deactivated, while Batch 01's Mark 9:21-24 is a separate row with its own `id`).
  - **Practical effect:** a family that saw the old Mark 9:24 before the swap, then later encounters the new Mark 9:21-24 in a subsequent (or even the same) cycle, will not have it excluded — the system has no way to know the two rows are "the same conversation, expanded." Given this affects only the 7 already-identified replacement pairs, and the replacement content is a genuinely richer version of the same passage rather than a true duplicate, **this is worth documenting as an accepted, low-impact edge case, not something that needs bespoke migration logic** (e.g., a `replaces_dinner_verse_id` column) unless the number of future replacements grows much larger.
- `verse_ref` (the text reference) is not a safe identity: it isn't unique by itself in principle (two rows could theoretically share a verse_ref during a transition period — the audit's whole point was that this nearly happened seven times), and it changes if a passage's range is edited.

---

## Phase 3 — Group vs. User

**Confirmed: the rotation already belongs to the group, not the individual, and nothing needs to change to keep it that way.**

Walking the exact scenario:
- Mom opens first → RPC creates the `group_verse` row for `(group_id, today)`.
- Dad opens later, same day → fast path finds the existing row, returns the identical dinner. His `get_or_create_tonight_session` call never re-runs the picker.
- Teen opens on a third device → same fast path, same row.
- A guest opens the invite link → routed to the entirely separate `get_guest_table_by_invite_code`, which only ever reads the group's existing row for today; it has no INSERT path at all.

**No viewer can independently advance the rotation today, and the proposed design below doesn't touch this property** — it only changes *which* dinner gets chosen when a new row is created, never *who* is allowed to trigger that creation or *how many* dinners get created per group per day (still exactly one, enforced by the same unique constraint).

---

## Phase 4 — Define a Cycle

**The existing data model can express "unseen this cycle," but only after adding one small piece of state — a per-group cycle boundary marker. Nothing else about the architecture needs to change.**

Why `verse_history` can't be that marker (recap of Phase 1): it's opt-in, per-user, and structurally limited to one row per (user, dinner) ever — it has no concept of "which cycle" a discussion belonged to.

**Why `group_verse` is the right foundation instead:** every single night a group opens the app, exactly one `group_verse` row is created for them, unconditionally, with no opt-in step. It is already the authoritative record of "what was this group shown, and when" — it just needs a boundary marker to know which of those rows belong to the *current* cycle.

**Proposed mechanism:**
1. Add `groups.rotation_cycle_started_at timestamptz not null default now()`.
2. Change the picker query inside `get_or_create_tonight_session()` from excluding via `verse_history` to excluding via `group_verse`, scoped to the current cycle:
   ```sql
   select dv.id from dinner_verses dv
   where dv.active = true
     and dv.id not in (
       select gv.dinner_verse_id from group_verse gv
       where gv.group_id = group_id_input
         and gv.dinner_verse_id is not null
         and gv.created_at >= v_cycle_started_at
     )
   order by random() limit 1;
   ```
3. If that returns nothing (the group has now seen every currently-active dinner since the cycle began), **reset the marker and re-run the same query once, unfiltered by definition** (the exclusion set is now empty because nothing has a `group_verse.created_at` at or after the brand-new `v_cycle_started_at`):
   ```sql
   update groups set rotation_cycle_started_at = now() where id = group_id_input;
   -- re-select with the same query; exclusion set is now empty
   ```

This satisfies the requested behavior exactly: no pre-generated shuffle array, no separate "seen list" table, one boolean-ish comparison against data that's already being written today for an unrelated reason (persisting the session). `verse_history` is left completely alone — it keeps doing its actual job (the personal "mark as discussed" checkbox and conversation-count stat), decoupled entirely from rotation correctness.

**Why `created_at` (timestamp) rather than `verse_date` (date) for the boundary:** the cycle boundary doesn't need to align with any calendar day or timezone — it's just "before or after the moment of the last reset." Comparing timestamps sidesteps any per-group-timezone subtlety entirely (see Phase 7) and keeps this concern fully independent of the dinner-day-boundary logic.

---

## Phase 5 — Library Changes Mid-Cycle

With the design above, every case resolves naturally, with no special-case code:

| Event | Behavior | Why |
|---|---|---|
| New dinner activated mid-cycle | Immediately joins the unseen pool | It has `active = true` and no `group_verse` row for this group since the cycle started — it's automatically a candidate. |
| Unseen dinner deactivated | Drops out of the candidate pool | `active = true` is already a hard filter in the picker query. |
| Already-seen dinner deactivated | No effect on rotation correctness | Its `group_verse` row (historical) still exists and still counts toward "already shown," but it's no longer selectable anyway since it's inactive — consistent either way. |
| Dinner content edited (same `id`) | No effect | Rotation keys on `id`, never on content (Phase 2). |
| Replacement/upgrade (old deactivated, new row inserted) | New row is treated as a genuinely new, unseen dinner | Accepted minor edge case per Phase 2 — a family may eventually see both the old and new version of the same passage across different cycles. Not worth new schema for 7 known cases. |

**A family's cycle is never restarted just because content was added or removed** — the cycle boundary is purely time-based (`rotation_cycle_started_at`), untouched by any content-table change.

---

## Phase 6 — Concurrency

**No new race is introduced; the existing race-safety fully covers the new logic**, because the entire picker (exclusion query + insert) already runs inside the same `if v_existing_id is null then ... end if` block, guarded by the real `UNIQUE (group_id, verse_date)` constraint and `insert ... on conflict ... do nothing`.

Walking the required scenarios:
- **Mom and Dad open simultaneously right after midnight (or right at the 4am cutoff):** both compute the same `canonical_dinner_date()` (server-side, deterministic for a given instant and timezone), both find no existing row, both attempt to build a `prayer_order` and pick a dinner, both attempt the `INSERT`. Only one `INSERT` actually lands (`ON CONFLICT DO NOTHING`); the loser's `RETURNING` clause yields nothing, so `v_was_created` correctly resolves to `false` for the loser, and the final `SELECT` at the bottom of the function reads back whichever row actually landed — both callers return the identical dinner. **This is already true today and is unaffected by this proposal.**
- **Two devices, near-simultaneous:** same mechanism as above.
- **Guest link opens concurrently:** guests never call the creation path at all (Phase 3) — no interaction possible.
- **Page refresh:** hits the fast path (row already exists) — a pure read, no risk.
- **Poor network / client retries the RPC call:** the RPC is naturally idempotent — a retried call either hits the fast path or loses the insert race exactly like a second device would; either way it converges on the one persisted row.
- **Realtime events arrive twice:** realtime is not part of the selection path at all (it's used elsewhere for prayer-turn UI updates) — irrelevant to this concern.
- **The cycle-reset step itself, under concurrency:** the reset (`update groups set rotation_cycle_started_at = now()`) only runs inside the same already-serialized "I am the one creating today's row" branch — only the winning caller ever reaches it for a given group+day. In the vanishingly unlikely case that a reset and a not-yet-expired old cycle's last pick briefly overlapped across two different days' sessions, the worst realistic outcome is one cycle resetting slightly earlier than the mathematically ideal moment — never a crash, never two different dinners assigned to the same group/date, and never a corrupted exclusion set.

**The database remains the sole authority throughout** — no proposed change relies on client-side coordination, client clocks, or optimistic client state.

---

## Phase 7 — Date/Time

**No timezone or day-boundary change is needed, and none is proposed.** Auditing what exists:

- "Tonight" is already resolved once, server-side, via `canonical_dinner_date(tz)` — `(now() at time zone group.timezone) - interval '4 hours'` cast to a date. This is a per-*group* timezone (`groups.timezone`, IANA-validated by a real Postgres-level `CHECK` constraint), not a per-user timezone — correct, since the whole point is one shared dinner for the table regardless of which member's device clock is being read.
- The 4:00 AM local cutoff means a family eating dinner in the evening never has "tonight" quietly become "tomorrow" mid-meal, and this logic already correctly handles DST transitions by construction — `at time zone` is DST-aware in Postgres, so a shift in local offset doesn't change which side of 4am local time a given instant falls on.
- No client ever independently computes this date; even the lightweight "is verse locked yet" check (`get_canonical_dinner_date_for_group`) delegates to the same single function.

**Effect on rotation correctness:** none, and the new cycle-boundary comparison (`group_verse.created_at >= rotation_cycle_started_at`, both plain UTC timestamps under the hood) deliberately avoids re-entangling itself with per-group-timezone date math — it only needs "before or after a moment," not "which calendar day."

---

## Phase 8 — Privacy / Security

**No new RLS policy is required.** The one new column (`groups.rotation_cycle_started_at`) sits on a table that already has working, audited RLS scoping members to their own group; it needs exactly the same protection every other column already added to `groups` in this project's history (`timezone`, `next_prayer_user_id`, `archived_at`) received — none, because row-level security applies per-row, not per-column, and all reads/writes of this new column happen either (a) inside the existing `SECURITY DEFINER` RPC, which already checks group membership before touching anything, or (b) via a member's own existing ability to read their own group's row.

Confirmed no leakage path:
- `get_guest_table_by_invite_code()` explicitly enumerates its own return columns and would need to be deliberately edited to expose this field — it won't be.
- The exclusion query itself runs inside the `SECURITY DEFINER` function, exactly like today's `verse_history` join across `profiles.group_id` — one group's members can never see another group's `group_verse` rows through this mechanism, same as today.
- One family cannot inspect another family's dinner history through this change any more than they can today (they can't at all — `group_verse` RLS already scopes to `group_id`).

---

## Phase 9 — Proposed Smallest Safe Design

### Current behavior
Random selection excluding an opt-in, per-user, non-cycle-aware "discussed" log (`verse_history`) that silently and permanently stops providing any protection once a family finishes one full pass through the library, or immediately for any dinner nobody bothered to mark discussed.

### Why repeats can happen today
1. `verse_history` rows are never written unless someone taps "mark discussed," and that write can silently fail with no retry.
2. Once every active dinner has at least one `verse_history` entry for the group (a near-certainty after ~354 nights of consistent use), the exclusion query returns nothing on *every subsequent night, forever* — not just once at the reshuffle boundary — and the function falls to true random-with-replacement permanently.

### Existing infrastructure to reuse
- `get_or_create_tonight_session()`'s existing atomic creation branch, unique-constraint-guarded insert, and fast path — unchanged.
- `group_verse` itself as the "what has this group already been shown" ledger — it's already complete, unconditional, and per-group; it just isn't currently consulted for this purpose.
- `canonical_dinner_date()` / per-group timezone — untouched, still the sole source of "what day is it."
- `dinner_verses.id` — already the correct identity key everywhere.

### Proposed no-repeat algorithm
1. Pick candidates: `active = true AND id NOT IN (group_verse.dinner_verse_id for this group WHERE created_at >= groups.rotation_cycle_started_at)`.
2. `ORDER BY random() LIMIT 1`.
3. If no candidate: `UPDATE groups SET rotation_cycle_started_at = now()`, then repeat step 1-2 (now unfiltered, since nothing satisfies the new boundary yet) to pick tonight's dinner from the freshly reshuffled full pool.
4. Insert exactly as today.

### Database changes required
One column: `alter table public.groups add column if not exists rotation_cycle_started_at timestamptz not null default now();` — safe backfill default explained under Migration requirements below.

### RPC/function changes required
`create or replace function public.get_or_create_tonight_session(...)` — same signature, same return shape, same grants. Only the verse-picking block inside the existing "creation path" changes (swap the `verse_history` exclusion subquery for the `group_verse` + cycle-boundary one, add the reset-and-reselect fallback). No other function needs to change. `complete_prayer_turn`, `get_guest_table_by_invite_code`, `advance_past_absent`, `set_member_absent`, `resolve_current_turn*` are all untouched.

### Frontend changes required
**None.** Every call site (`HomePage.jsx`, `OnboardingPage.jsx`, `SettingsPage.jsx`, `TablePage.jsx`) already just calls the RPC and renders whatever it returns — the return shape is unchanged, so this is entirely a server-side swap.

### Migration requirements
A single, small, idempotent migration in the same style as the existing package (`add column if not exists`, `create or replace function`):
- **Backfill for existing groups:** default the new column to a timestamp that makes every one of a group's *actual* historical `group_verse` rows count as "already seen" in their very first cycle under the new logic — i.e., something at or before the group's own `created_at` (or a fixed distant-past constant, since `DEFAULT now()` on `ADD COLUMN` only affects the backfill moment, not each row's individual history). Recommend explicitly backfilling to `'epoch'::timestamptz` (or each group's own `created_at`) for all pre-existing rows in the same migration, rather than leaving every existing group's cycle silently starting from "now" (which would make an established family's entire prior dinner history invisible to the new exclusion logic and re-servable immediately — the opposite of the intended fix).

### Concurrency strategy
Reuse the existing pattern exactly — no new locking primitive, no advisory locks, no application-level mutex. The unique constraint plus `INSERT ... ON CONFLICT DO NOTHING` is already sufficient and is not weakened by anything proposed here (see Phase 6).

### Cycle-reset strategy
Automatic, lazy, and per-group: a cycle "ends" the instant a group's exclusion query would otherwise return nothing, and the very next pick both resets the marker and immediately serves the first dinner of the new cycle in the same function call — no separate cron job, no batch process, no pre-computed shuffle.

### Mid-cycle content-change behavior
Covered in full in Phase 5 — no dinner-table change requires touching rotation state.

### Rollback strategy
Consistent with this codebase's own documented convention ("FORWARD-REPAIR, NOT ROLLBACK," `20260714000004`'s closing note): if a problem is found, fix forward with another `create or replace function` restoring the old (or a corrected) picker logic. Do **not** drop `rotation_cycle_started_at` once any deployed function version depends on it — an unused column is harmless; a dropped column under a live function is not. Reverting to the exact pre-change behavior requires no data migration at all, since `verse_history` was never modified by this design.

---

## Phase 10 — Test Plan

To validate before implementation, using a temporary/staging `dinner_verses` slice, not production data:

1. **2-dinner library:** two active dinners, one group, two consecutive nights → confirms both are shown once each before any repeat, and the second night's pick correctly excludes the first.
2. **3-dinner library, 4 consecutive nights:** confirms dinners 1-3 appear in some order across nights 1-3, and night 4 is a fresh reshuffle (may repeat night 1-3's dinner, but only because the cycle has genuinely restarted).
3. **No repeats before exhaustion:** for an N-dinner library, N consecutive sessions for one group contain N distinct `dinner_verse_id`s.
4. **Final unseen dinner is selected correctly:** on the Nth night (one candidate remaining), confirm that exact dinner is chosen deterministically (only one candidate exists, so `ORDER BY random() LIMIT 1` is a formality, but confirms the exclusion query is correct at the boundary).
5. **Cycle resets after exhaustion:** the (N+1)th night successfully produces a dinner (does not error, does not return null) and correctly resets `rotation_cycle_started_at`.
6. **First dinner of a new cycle:** confirm it can legitimately be the same dinner shown on night 1 of the prior cycle (this is correct, expected behavior, not a bug).
7. **Newly activated dinner joins the unseen pool:** activate a new row mid-cycle, confirm it becomes selectable before the current cycle's exhaustion.
8. **Deactivated dinner is never selected:** deactivate an unseen dinner mid-cycle, confirm it never appears, and confirm cycle-completion math adjusts (a shrunk active pool exhausts sooner).
9. **Same group, two devices, same date:** simulate two near-simultaneous RPC calls for the same group+day, confirm both return the identical `dinner_verse_id` and only one `group_verse` row exists.
10. **Simultaneous requests at exactly the exhaustion boundary:** two concurrent calls both land on "no candidates remain" — confirm only one reset actually occurs and both callers converge on the same freshly-picked dinner (not two different resets producing two different picks).
11. **Refresh / retry:** repeated calls against an already-created session return the same row every time, with `was_created = false` after the first.
12. **Guest sees the same dinner:** confirm `get_guest_table_by_invite_code()` returns the identical dinner a permanent member's RPC call returned, with no ability to trigger creation itself.
13. **Next calendar day advances correctly:** confirm a new `verse_date` produces a new session (subject to the group's own timezone + 4am cutoff), and that the exclusion pool correctly still includes everything from earlier in the same cycle, not just "yesterday."
14. **Historical groups with existing `verse_history` but no `group_verse` cycle marker yet:** confirm the migration's backfill produces correct, non-repeating behavior for a family with real pre-existing history, not just fresh test groups.
15. **Null/empty history (brand-new group):** first-ever session for a group with zero `group_verse` rows selects freely from the entire active pool, as expected.
16. **354-dinner scale:** run the full cycle end-to-end (or a representative simulation) to confirm query performance stays trivial (`NOT IN` over at most ~354 UUIDs, indexed lookups) and no dinner is ever skipped or double-served across a complete pass.

---

## Related finding, out of scope for this design but relevant to the next phase

`dinner_verses.category` has a live `CHECK` constraint limiting it to 18 specific values (`Wisdom, Love, Faith, Courage, Forgiveness, Gratitude, Hope, Peace, Purpose, Identity, Community, Prayer, Perseverance, Surrender, Redemption, Joy, Family, Grace`) — confirmed via `pg_constraint`. Batches 01-08's content uses descriptive titles, not these category labels, for their `category`/theme field. **This will need a mapping decision (or a constraint change) before the 354-dinner library can actually be loaded** — unrelated to rotation logic, but worth flagging now so it doesn't surprise the production-load phase.

---

## Summary

The simplest database-authoritative fix is **one new timestamp column on `groups` and a small, contained edit to the existing verse-picking block inside `get_or_create_tonight_session()`** — reusing `group_verse` (already complete and mandatory) instead of `verse_history` (opt-in and structurally incapable of cycle-awareness) as the source of "already seen." No new tables, no pre-generated shuffle arrays, no frontend changes, no new RLS, no change to timezone/day-boundary logic, and no weakening of the concurrency guarantees that already make today's daily-session creation race-safe.
