# Dinner with Jesus — Emergency Security Remediation & Safe Rollout Runbook
**Date:** 2026-07-15 (updated same day: Steve UUID verified, family_table/time_verses resolved as views)
**Branch:** `fix/dwj-post-launch-p1`
**Status:** Preparation complete, including view-specific remediation. **Nothing applied to any database. Nothing pushed. Nothing deployed.** Waiting on Steve's approval per Section 18 below.

---

## 1. Executive Summary

Production inspection (three read-only queries Steve ran against Supabase project `mvswwnonafjencqumxvv` and pasted into this session) confirmed real, exploitable access-control gaps across 10 of the app's 20 public tables — not just the single admin-dashboard question the original post-launch audit flagged. The most severe: `profiles` (including every user's email), `notes` (private journal entries), and `groups` (including every invite code, which doubles as the guest-access bearer token) all have Row Level Security **disabled**, with full `SELECT/INSERT/UPDATE/DELETE` grants held by both `anon` and `authenticated` — meaning any request using the public anon key, logged in or not, can currently read or write all of it directly via the Supabase REST API.

**There is no evidence of actual unauthorized access having occurred.** This is a policy-configuration finding, not a breach report — see Section 19 for what would and wouldn't constitute evidence either way.

This runbook prepares a complete, staged remediation: three migrations (security primitives → baseline RLS → admin access), six new server-side RPC functions, the client changes needed to use them safely, a full test matrix, and a deployment order specifically designed so tightening RLS never happens before the client that depends on the new RPCs is live. **Nothing in this package has been applied, pushed, or deployed.** It is prepared for Steve's review and manual, staged execution.

**Update (2026-07-15, same day):** Steve confirmed his admin UUID directly against `auth.users` (returned `steve@onetengroup.ai`) — that blocker is resolved. Steve also ran the metadata-inspection queries from Section 6 (as it then was) and confirmed both previously-unknown relations, `family_table` and `time_verses`, are **views owned by `postgres` with no `security_invoker` option** — meaning both run with the view owner's privileges regardless of caller, not the caller's own RLS. `family_table` is a confirmed, real exposure (it joins `families`/`family_members`/`prayer_rotation` and would hand every caller every family's invite code, member list, and prayer-rotation state). `time_verses` is confirmed pure public reference content over `bible_verses`. Both are now addressed in the migration package — see Sections 6–11 below, all updated in this revision.

---

## 2. Confirmed Production Exposures

From the three production query results Steve provided (RLS-enabled status, `pg_policies`, and table grants):

| Table | RLS | Exposure |
|---|---|---|
| `profiles` | disabled | Full anon/authenticated CRUD. Every user's email, name, faith level, group, onboarding status readable and writable by anyone. |
| `notes` | disabled | Full anon/authenticated CRUD. Private journal entries readable/editable/deletable by anyone, despite correctly-scoped policies existing (inert while RLS is off). |
| `verse_history` | disabled | Full anon/authenticated CRUD. Also, its own dormant policies check only `auth.role() = 'authenticated'`, not `user_id` — would not have been fixed by enabling RLS alone. |
| `groups` | disabled, zero policies | Full anon/authenticated CRUD. Every invite code readable directly, bypassing the "guess the code" guest-access model entirely; any group's owner/name reassignable or deletable. |
| `dinner_verses` | disabled | Full anon/authenticated CRUD. Reference content (verses/questions/prayers) alterable or deletable by anyone, not just readable. |
| `analytics` | disabled, zero policies | Full anon/authenticated CRUD. All users' event data readable, forgeable, or deletable by anyone. |
| `announcements` | enabled | Read is intentionally public. But insert/update/delete policies use `using(true)`/`with_check(true)` for role `{public}` — anyone, including unauthenticated visitors, can post or alter the global announcement banner. |
| `families` | enabled | `authenticated_full_access_families` grants `ALL` to any authenticated user with no ownership check, overriding the correctly-scoped policies already on the same table. |
| `family_verse` | enabled | Both policies check only `auth.role() = 'authenticated'` despite being named "Family members can..." — no membership filter exists. |
| `group_verse` | enabled | Same pattern as `family_verse`. |
| `invites` | enabled | INSERT policy checks `invited_by = auth.uid()` but never verifies the inserter belongs to the `family_id` on the invite. |
| `family_table` | N/A — view, no RLS-equivalent option | **Confirmed 2026-07-15.** A view (owner `postgres`, `reloptions: null` — no `security_invoker`) joining `families` + `family_members` + `prayer_rotation`. Runs with the *view owner's* privileges regardless of caller, so it does not inherit RLS from any of its three underlying tables. Any role granted `SELECT` on it can see every family's invite code, every member's `user_id`/`display_name`/`role`/`prayer_order`, and every family's prayer-rotation state — not just the caller's own family. |

**Phase 4 coverage confirmation:** every relation the production inspection confirmed unsafe is addressed by the migration package — `profiles`, `notes`, `verse_history`, `groups`, `dinner_verses`, `analytics`, `announcements`, `families`, `family_verse`, `group_verse`, and `invites` in `20260714000002_emergency_baseline_rls.sql` (Section 8); `family_table` in the same file plus `get_my_family_table()` in `20260714000001_security_primitives.sql` (Sections 6–7). `family_members`, `prayer_rotation`, `faith_checkins`, and `onboarding` were verified already safe and intentionally left untouched (Section 3). `time_verses` was confirmed as reference content and hardened defensively (explicit `security_invoker` recreation + explicit read-only grants) even though its default exposure was lower-severity than the others. No relation from the three original production queries remains unaddressed.

## 3. Relations Confirmed Safe (no change made)

RLS enabled, every policy correctly scoped to the intended owner/member:

`bible_verses`, `feeling_verses` (public read-only reference data, no write policy), `faith_checkins`, `family_members`, `onboarding` (all owner-scoped `user_id = auth.uid()`), `prayer_rotation` (correctly scoped via `family_members` membership subquery).

`bible_books`: RLS enabled with **zero** policies — fully closed to everyone including admins. Not touched; see Section 20.

`time_verses`: **confirmed 2026-07-15** — a view (owner `postgres`, no `security_invoker`) over `bible_verses` with no per-row user/family scoping in its definition (`id, book, chapter, verse, text, reference`). `bible_verses`' own `SELECT` policy is already `using (true)` — open to everyone — so, unlike `family_table`, recreating this view with `security_invoker = true` reproduces the *already-correct* intended visibility rather than changing it. Addressed in Section 8 by explicit recreation + grants, not left on its prior default (unscoped) grants.

## 4. Unknown Relations

**Resolved 2026-07-15.** Both `family_table` and `time_verses` are confirmed views owned by `postgres`, `rls_enabled: false` / `rls_forced: false` (expected for views — RLS is a table-level concept), `reloptions: null` (no `security_invoker`). Full definitions and the remediation chosen for each are in Sections 2–3 above and Sections 6–11 below. No relation remains in an unknown state from the original three production queries. See Section 20 for the one residual unknown this pass cannot resolve (whether anything outside this repository depends on either view).

## 5. Current and Parallel Data Models

The live client (`fix/dwj-post-launch-p1`, verified by grepping every `.from(...)`/`.rpc(...)` call in `src/`) exclusively uses a `profiles.group_id` + `groups` model: `profiles`, `groups`, `group_verse`, `notes`, `verse_history`, `onboarding`, `dinner_verses`, `bible_verses`, `feeling_verses`, `analytics`, `announcements`.

A second, parallel schema exists in production with small amounts of real data and — notably — RLS policies that were mostly written with more care than the `groups` model's (until this pass, `groups` had *zero* policies, while `families` at least attempted ownership scoping): `families` (6 rows), `family_members` (1 row), `family_verse` (6 rows), `family_table` (1 row), `invites` (0 rows), `prayer_rotation` (0 rows), `faith_checkins` (0 rows), plus reference tables `bible_books` (66 rows — exactly the canonical book count) and `time_verses` (31,179 rows — close to the ~31,102-verse count of the full Bible, and notably *not* what `HomePage.jsx`'s "verse for this moment" feature actually queries; that feature uses `bible_verses` instead).

**No `.from()` or `.rpc()` call anywhere in current client source touches any parallel-model table.** This reads as either an in-progress rewrite that was never wired into the client, or a schema built by a different branch/tool not present in this repository. This pass does not drop, rename, or assume away either model. Per Phase 2's instruction, every populated table is treated as live for remediation purposes regardless of whether the current UI reads it — a table reachable via the Supabase REST API is exploitable directly via the anon key regardless of what the JS client does. **This is a product question for Steve, not something resolvable from RLS output alone.**

### Phase 2 Classification

| Table | Class | Basis |
|---|---|---|
| `profiles`, `groups`, `group_verse`, `notes`, `verse_history`, `onboarding`, `dinner_verses`, `bible_verses`, `feeling_verses`, `analytics`, `announcements` | **A** — actively used by current client | Confirmed via `.from()`/`.rpc()` grep across all of `src/` |
| `families`, `family_members`, `family_verse`, `invites`, `prayer_rotation`, `faith_checkins`, `bible_books` | **C** — populated, but no current-client call site found | Row counts >0 (except `invites`, `prayer_rotation`, `faith_checkins` at 0) confirm real or test data exists; treated as live per Phase 2 regardless |
| `family_table` | **C** — a view over the class-C parallel model, populated (1 row), no current-client call site found | Confirmed 2026-07-15 as a `postgres`-owned view; no `.from('family_table')` anywhere in `src/` |
| `time_verses` | **D** — reference content, no current-client call site found | Confirmed 2026-07-15 as a `postgres`-owned view over `bible_verses`; `HomePage.jsx`'s equivalent "verse for this moment" feature queries `bible_verses` directly instead, not this view |
| *(none)* | **B** — used by a DB function/trigger/view/Edge Function | No Edge Functions exist in this repo (`supabase/functions/` absent, no `functions.invoke` calls in `src/`). Whether any parallel-model table or either view is referenced by a database-side trigger or function **cannot be determined from this repository** — that visibility requires direct database access this session does not have. Flagged as an open question for Steve, not assumed either way. |

---

## 6. Phase 1 — Inspection SQL for family_table / time_verses (RUN, results below — kept for reference/reproducibility)

```sql
-- Relation type + owner
select c.relname, c.relkind, pg_get_userbyid(c.relowner) as owner
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('family_table', 'time_verses');
-- relkind: r = ordinary table, p = partitioned table, v = view, m = materialized view

-- Columns and types
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name in ('family_table', 'time_verses')
order by table_name, ordinal_position;

-- Grants (re-scoped from the original query, for confirmation)
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('family_table', 'time_verses')
order by table_name, grantee, privilege_type;

-- View / materialized view definition, if applicable
select viewname, definition from pg_views
where schemaname = 'public' and viewname in ('family_table', 'time_verses');
select matviewname, definition from pg_matviews
where schemaname = 'public' and matviewname in ('family_table', 'time_verses');

-- security_invoker option, if it's a view (PG15+)
select c.relname, c.reloptions
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('family_table', 'time_verses');
-- look for 'security_invoker=true' in reloptions

-- RLS status (meaningful only if relkind = 'r' or 'p')
select relname, relrowsecurity, relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('family_table', 'time_verses');

-- Existing policies, if it's a table
select * from pg_policies
where schemaname = 'public' and tablename in ('family_table', 'time_verses');

-- What views/relations depend on these (or that these depend on)
select distinct dependent_ns.nspname as dependent_schema, dependent_view.relname as dependent_view,
       source_ns.nspname as source_schema, source_table.relname as source_table
from pg_depend
join pg_rewrite on pg_depend.objid = pg_rewrite.oid
join pg_class as dependent_view on pg_rewrite.ev_class = dependent_view.oid
join pg_class as source_table on pg_depend.refobjid = source_table.oid
join pg_namespace dependent_ns on dependent_ns.oid = dependent_view.relnamespace
join pg_namespace source_ns on source_ns.oid = source_table.relnamespace
where source_table.relname in ('family_table', 'time_verses')
   or dependent_view.relname in ('family_table', 'time_verses');

-- Any function whose body mentions either name (best-effort text search)
select n.nspname, p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (pg_get_functiondef(p.oid) ilike '%family_table%'
    or pg_get_functiondef(p.oid) ilike '%time_verses%');

-- Triggers on either relation, if base tables
select tgname, tgrelid::regclass, tgtype, tgenabled
from pg_trigger
where tgrelid::regclass::text in ('public.family_table', 'public.time_verses');
```

**Results (2026-07-15) and which decision-tree branch applied:**

Both relations came back as **ordinary views** (`relkind = 'v'`), owner `postgres`, `reloptions: null` (no `security_invoker`):

```sql
-- public.family_table
SELECT f.id AS family_id, f.name AS family_name, f.invite_code,
       fm.user_id, fm.display_name, fm.role, fm.prayer_order,
       pr.current_idx AS prayer_current_idx
FROM public.families f
JOIN public.family_members fm ON fm.family_id = f.id
LEFT JOIN public.prayer_rotation pr ON pr.family_id = f.id;

-- public.time_verses
SELECT id, book, book_abbr, book_order, chapter, verse,
       text_niv AS text, chapter || ':' || verse AS reference
FROM public.bible_verses
ORDER BY book_order, chapter, verse;
```

- **`family_table` → view exposing private family data, branch taken: replace with a narrow RPC, do not recreate as `security_invoker`.** Reason it's *not* a simple `security_invoker` recreation: `family_members`' own `SELECT` policy (already correctly scoped, kept as-is in Section 8) is `user_id = auth.uid()` — a caller may see only their *own* membership row, not fellow members'. A `security_invoker` version of this view would inherit that restriction and return exactly one row per caller (their own), not the family roster the view is clearly meant to provide — it would not "produce the exact intended family-member visibility" that Option A requires. So: direct access to the view is revoked entirely (Section 8), and `public.get_my_family_table()` (Section 7) — `SECURITY DEFINER`, looks up the caller's family server-side, returns only that family's rows — replaces it.
- **`time_verses` → confirmed pure public reference content, branch taken: `security_invoker` recreation.** Its definition has no user/family-scoping column at all, and the table it reads from (`bible_verses`) already has an open `using (true)` `SELECT` policy — recreating with `security_invoker = true` reproduces that same, already-correct, intended-open visibility. `security_invoker` views require PostgreSQL 15+; not directly confirmed against the live project in this session (see Section 8's migration comment for the fail-closed behavior if unsupported, and the RPC fallback to use instead).

---

## 7. Security-Primitives Migration

**File:** `supabase/migrations/20260714000001_security_primitives.sql`

Adds, without restricting any existing access:
- `public.is_admin()` — zero-argument, `SECURITY INVOKER`, `search_path = ''`. **UUID verified 2026-07-15** — `steve@onetengroup.ai` (Section 16).
- `public.join_group_by_invite_code(invite_code_input text)` — `SECURITY DEFINER`. Exact-match lookup, updates only the caller's own `profiles.group_id`.
- `public.get_guest_table_by_invite_code(invite_code_input text)` — `SECURITY DEFINER`. Granted to `anon` + `authenticated` (unauthenticated guest access is a confirmed, load-bearing route in `App.jsx`, not speculative). Returns only the fields `GuestTablePage.jsx` renders.
- `public.remove_group_member(member_id_input uuid)` — `SECURITY DEFINER`. Verifies caller owns the target's group; touches only `group_id`; refuses to remove the owner or the caller.
- `public.get_my_group_members()` — `SECURITY DEFINER`. Returns `id, name` only (never email) for the caller's own group.
- `public.get_my_family_table()` — `SECURITY DEFINER`. **New in this revision.** Replaces direct `SELECT` on the `family_table` view (Section 6). Looks up the caller's `family_id` via `family_members`, returns only that family's roster (`family_id, family_name, invite_code, user_id, display_name, role, prayer_order, prayer_current_idx`) — never another family's rows. Column types for `prayer_order`/`prayer_current_idx` are inferred as `int` from naming alone and flagged in the migration file for verification against the live schema before applying.

Full source is in the migration file itself (see repo). Every function is `revoke all ... from public` + explicit `anon`/`authenticated` grants stated individually, not left implicit.

## 8. Emergency Baseline RLS Migration

**File:** `supabase/migrations/20260714000002_emergency_baseline_rls.sql`

Enables RLS and/or replaces unsafe policies on: `profiles`, `notes`, `verse_history`, `groups`, `group_verse`, `dinner_verses`, `analytics`, `announcements`, `families`, `family_verse`, `invites`. Also now hardens the two views (`family_table`, `time_verses`) confirmed in Section 6. Full source in the migration file. Highlights:
- `profiles` is deliberately **tighter** than what existed before RLS was disabled — same-group profile visibility now goes through `get_my_group_members()` (id+name only), so no policy grants any user visibility into another user's email.
- `groups`' invite-code lookup no longer needs a standing policy at all, since both the join flow and guest flow now go through `SECURITY DEFINER` RPCs that read the table as owner.
- `dinner_verses` needs no `anon` read policy — the guest RPC handles that path too.
- **`family_table`**: `revoke all ... from public, anon, authenticated` — no role retains direct `SELECT`. Replacement path is `get_my_family_table()` (Section 7).
- **`time_verses`**: recreated with `create or replace view ... with (security_invoker = true)`, then `revoke all` followed by `grant select` to both `anon` and `authenticated` — explicit read-only, matching `bible_verses`' own already-correct open-read posture.
- **No rollback script exists for this migration.** See Section 19.

## 9. Admin Access Migration

**File:** `supabase/migrations/20260714000003_admin_access_policies.sql`

Adds the same 10 admin-only additive policies as the original single-file migration (now correctly sequenced to apply *after* baseline RLS exists, so they're never inert), scoped to `is_admin()`, on `profiles`, `groups`, `dinner_verses`, `analytics`, `announcements` — exactly the five tables `AdminPage.jsx` touches, no more.

## 10. Every Policy Removed

| Table | Policy removed |
|---|---|
| `profiles` | `Users can read profiles` (replaced — see Section 11) |
| `profiles` | `Users can update own profile` (replaced with identical logic, renamed) |
| `verse_history` | `Users can insert verse history`, `Users can view own verse history` (both replaced — mis-scoped) |
| `group_verse` | `Anyone authenticated can read group_verse`, `Anyone authenticated can insert group_verse` (both replaced) |
| `announcements` | `insert_announcements`, `update_announcements`, `delete_announcements` (public write removed; admin-only replacements added separately) |
| `families` | `authenticated_full_access_families` (removed, not replaced — the narrower existing policies on this table already cover legitimate access) |
| `families` | `Anyone can look up family by invite code` (removed — didn't actually filter by invite code despite its name) |
| `family_verse` | `Family members can insert family verse`, `Family members can read family verse` (both replaced — mis-scoped) |
| `invites` | `Family members can create invites` (replaced — added missing membership check) |

## 11. Every Policy Created

| Table | Policy | Scope |
|---|---|---|
| `profiles` | `profiles_select_own` | `id = auth.uid()` |
| `profiles` | `profiles_update_own` | `id = auth.uid()` |
| `profiles` | `profiles_insert_own` | `id = auth.uid()` (defensive; no current client insert path) |
| `verse_history` | `verse_history_insert_own` | `user_id = auth.uid()` |
| `verse_history` | `verse_history_select_own` | `user_id = auth.uid()` |
| `groups` | `groups_select_owner_or_member` | `owner_id = auth.uid()` OR caller's `profiles.group_id` matches |
| `groups` | `groups_insert_own` | `owner_id = auth.uid()` |
| `groups` | `groups_update_owner` | `owner_id = auth.uid()` |
| `groups` | `groups_delete_owner` | `owner_id = auth.uid()` |
| `group_verse` | `group_verse_select_member` | caller's `group_id` matches row's `group_id` |
| `group_verse` | `group_verse_insert_member` | same |
| `group_verse` | `group_verse_update_member` | same (needed for the client's `upsert`) |
| `dinner_verses` | `dinner_verses_select_active` | `authenticated` AND `active = true` |
| `analytics` | `analytics_insert_own` | `user_id = auth.uid()` |
| `family_verse` | `family_verse_insert_member`, `family_verse_select_member` | caller is a `family_members` row for that `family_id` |
| `invites` | `invites_insert_family_member` | `invited_by = auth.uid()` AND caller belongs to that `family_id` |
| `profiles` | `admin_select_all_profiles`, `admin_update_any_profile` | `is_admin()` |
| `groups` | `admin_select_all_groups`, `admin_delete_any_group` | `is_admin()` |
| `dinner_verses` | `admin_select_all_dinner_verses`, `admin_update_dinner_verses` | `is_admin()` |
| `analytics` | `admin_select_all_analytics` | `is_admin()` |
| `announcements` | `admin_select_announcements`, `admin_insert_announcements`, `admin_update_announcements` | `is_admin()` |

`notes`: RLS enabled, all 4 pre-existing policies left as-is (already correctly `user_id = auth.uid()`-scoped).

`family_table` and `time_verses` are **views**, not tables — they have no RLS policies of their own (RLS is a table-level mechanism); their access is controlled entirely by grants. See Section 12.

## 12. Every Grant Changed

Table-level grants changed by the migration package (new in this revision — the original draft changed none):

| Relation | Grants revoked | Grants granted |
|---|---|---|
| `public.family_table` (view) | `ALL` from `public`, `anon`, `authenticated` | *(none — no role retains direct access; use `get_my_family_table()` instead)* |
| `public.time_verses` (view, recreated with `security_invoker = true`) | `ALL` from `public`, `anon`, `authenticated` (re-revoked after recreation, defensive) | `SELECT` to `anon`; `SELECT` to `authenticated` — no `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` to any role |

Function-level grants (all new, all three migrations): `EXECUTE` on six functions in part 1 (five original + `get_my_family_table()`), explicitly scoped per function (see Section 7) — `is_admin()`, `join_group_by_invite_code()`, `remove_group_member()`, and `get_my_group_members()` to `authenticated` only; `get_guest_table_by_invite_code()` to `anon` + `authenticated`; `get_my_family_table()` to `authenticated` only. A **separate, optional** table-grant hardening review for the remaining base tables is proposed in Section 13 but not included in the three-migration package and not applied.

## 13. Table-Grant Hardening (Phase 6 — proposed only, not applied, not part of the 3 required migrations)

The grants query showed `anon`/`authenticated` holding `TRUNCATE`, `REFERENCES`, and `TRIGGER` on every public table — PostgREST never issues any of these operations, so they're unused surface, not a functional requirement. Verified: the `SECURITY DEFINER` RPCs from part 1 (including `get_my_family_table()`) execute with the function owner's privileges, not the caller's table grants, so revoking these does not affect them.

```sql
-- PROPOSED, NOT APPLIED. Defense-in-depth, not required for the RLS fix.
do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Pure reference tables should not be writable via the API at all.
-- time_verses is excluded here -- it's already handled explicitly in
-- 20260714000002_emergency_baseline_rls.sql (Section 8), which revokes
-- ALL then grants only SELECT to anon/authenticated on that view.
revoke insert, update, delete on public.bible_verses from anon, authenticated;
revoke insert, update, delete on public.feeling_verses from anon, authenticated;
revoke insert, update, delete on public.dinner_verses from anon, authenticated;
revoke insert, update, delete on public.bible_books from anon, authenticated;
```

Recommend Steve review and apply this separately, after the three staged migrations are confirmed working — not blocking, since RLS (not table grants) is the actual gate for row access.

## 14. RPC Definitions

Full definitions are in `supabase/migrations/20260714000001_security_primitives.sql`. Summary signatures:

```
public.is_admin() returns boolean
public.join_group_by_invite_code(invite_code_input text) returns table(group_id uuid, group_name text)
public.get_guest_table_by_invite_code(invite_code_input text) returns table(group_name text, verse_ref text, category text, verse_text text, context_text text, question_level_1 text, question_level_2 text, prayer_level_1 text)
public.remove_group_member(member_id_input uuid) returns boolean
public.get_my_group_members() returns table(id uuid, name text)
public.get_my_family_table() returns table(family_id uuid, family_name text, invite_code text, user_id uuid, display_name text, role text, prayer_order int, prayer_current_idx int)
```

## 15. Client Call Sites Changed

| File | Change |
|---|---|
| `src/hooks/useFamily.js` | `joinGroup()` now calls `rpc('join_group_by_invite_code')` instead of `.from('groups').select().eq('invite_code', ...)`. `removeMember()` now calls `rpc('remove_group_member')` instead of `.from('profiles').update({group_id:null}).eq('id', memberId)`. `loadGroup()` now calls `rpc('get_my_group_members')` instead of `.from('profiles').select('name').eq('group_id', ...)`, and exposes a new `memberProfiles` (id+name) array from the hook. |
| `src/pages/GuestTablePage.jsx` | `loadGuestTable()` now calls `rpc('get_guest_table_by_invite_code')` instead of three sequential `.from('groups')` / `.from('group_verse')` / `.from('dinner_verses')` queries. |
| `src/pages/SettingsPage.jsx` | Removed its own local `loadMemberProfiles()` (`.from('profiles').select('id, name').eq('group_id', ...)`, which would return nothing under baseline RLS); now consumes `memberProfiles` from `useFamily()`. |

**`family_table` / `time_verses`: no client files changed.** Confirmed by grep across all of `src/` — no `.from('family_table')`, `.from('time_verses')`, `.from('families')`, `.from('family_members')`, or `.from('prayer_rotation')` call exists anywhere in current client source. `get_my_family_table()` and the recreated `time_verses` view have no current caller to update; they exist so a safe access path is already in place if/when this parallel data model becomes active product surface.

**Confirmed by re-grepping after all changes:** no remaining `.from('groups')...eq('invite_code', ...)` outside `useFamily.js`'s own `createGroup()` (which sets its own row's `invite_code`, not a lookup); no remaining `.from('profiles').update(...)` targeting another user's row (both instances in `AdminPage.jsx` are intentional, admin-only, and governed by the admin migration's policies); no remaining client-side hardcoded admin UUID check (removed in the prior repair pass, commit `fa025eb`); `App.jsx`/`AdminPage.jsx` already called zero-argument `is_admin()` before this pass.

## 16. Steve UUID Verification — RESOLVED (2026-07-15)

```sql
select id, email, created_at from auth.users
where id = '28356e7e-067c-49a8-81a2-095576c432a7';
```
**Run by Steve. Returned `steve@onetengroup.ai`, confirmed by Steve directly.** This blocker is resolved — the UUID is trusted because it was independently verified against `auth.users`, not because it previously existed in client code. `is_admin()` (part 1) and its comment have been updated to reflect this; `20260714000003_admin_access_policies.sql`'s prerequisite checklist item for this is marked done.

## 17. Security Test Matrix

Practical approach: since this session has no database credentials, these are written as ready-to-run `supabase-js` snippets to paste into a browser console while signed in as each identity (or via a REST client with the appropriate `apikey`/`Authorization` headers), not simulated. Run after Step 4 (primitives applied) and again after Step 8 (baseline RLS applied) in Section 18 — expected results differ at each stage as noted.

**Anonymous** (no session, anon key only):
```js
await supabase.from('profiles').select('*')        // expect: [] or error, never other users' rows
await supabase.from('notes').select('*')            // expect: [] or error
await supabase.from('groups').select('*')           // expect: [] or error — no invite-code enumeration
await supabase.rpc('get_guest_table_by_invite_code', { invite_code_input: '<VALID_CODE>' })   // expect: one row, verse fields populated
await supabase.rpc('get_guest_table_by_invite_code', { invite_code_input: 'ZZZZZZ' })          // expect: zero rows, no distinguishing error
await supabase.from('analytics').select('*')        // expect: [] or error
await supabase.from('announcements').insert({ message: 'test', active: true })  // expect: error (RLS denies)

// View-specific (new)
await supabase.from('family_table').select('*')                              // expect: [] or error — no direct access for any role
await supabase.rpc('get_my_family_table')                                    // expect: error — auth.uid() is null, function raises "Not authenticated"
await supabase.from('time_verses').select('*').limit(5)                      // expect: rows returned — public reference content
await supabase.from('time_verses').update({ text: 'x' }).eq('id', ANY_ID)    // expect: error — no write grant for anon
```

**Authenticated User A** (real test account):
```js
await supabase.from('profiles').select('*').eq('id', A_ID)   // expect: own row only
await supabase.from('profiles').select('*').eq('id', B_ID)   // expect: [] — cannot read User B
await supabase.from('notes').select('*')                     // expect: only A's own notes
await supabase.from('notes').delete().eq('id', B_NOTE_ID)    // expect: 0 rows affected
await supabase.rpc('get_my_group_members')                   // expect: A's own group members, id+name only, no email
await supabase.rpc('remove_group_member', { member_id_input: UNRELATED_USER_ID })  // expect: error, "not in your group"
await supabase.rpc('is_admin')                                // expect: false
await supabase.from('analytics').select('*')                  // expect: [] or error
await supabase.from('announcements').update({ message: 'x' }).eq('active', true)  // expect: error

// View-specific (new) -- requires A to be a family_members row for some family
await supabase.from('family_table').select('*')                      // expect: [] or error — direct access revoked for authenticated too
await supabase.rpc('get_my_family_table')                            // expect: only A's own family's rows (own invite_code, own family's member roster)
// If A belongs to Family 1 and a second test family (Family 2) exists with a
// different invite_code, confirm Family 2's invite_code/members never appear
// in A's get_my_family_table() result.
await supabase.from('time_verses').select('*').limit(5)              // expect: rows returned — same open read as anon
await supabase.from('time_verses').insert({ id: 1, book: 'x' })      // expect: error — no INSERT grant for authenticated
```

**Group Owner** (owns a group with ≥1 other member):
```js
await supabase.rpc('remove_group_member', { member_id_input: REAL_MEMBER_ID })     // expect: success
await supabase.rpc('remove_group_member', { member_id_input: OTHER_GROUP_MEMBER_ID }) // expect: error
await supabase.rpc('get_my_group_members')                                          // expect: id+name only, no email column
```

**Guest** (no session, valid vs invalid code — see Anonymous section above): valid code returns only verse content + group name; invalid code returns zero rows with no hint distinguishing "malformed" from "not found."

**Authenticated User B** (real test account, different family than User A, if `family_members` has ≥2 distinct families to test with):
```js
await supabase.rpc('get_my_family_table')   // expect: only B's own family's rows -- never A's invite_code, A's family's member list, or A's prayer_order/prayer_current_idx
await supabase.from('family_table').select('*')  // expect: [] or error, same as every other role
```

**Steve (Admin)**, after Section 9 is applied and Section 16 is confirmed:
```js
await supabase.rpc('is_admin')                       // expect: true (identity: steve@onetengroup.ai, 28356e7e-067c-49a8-81a2-095576c432a7)
await supabase.from('profiles').select('*')          // expect: all users, via admin policy
await supabase.from('analytics').select('*')          // expect: all events
await supabase.from('announcements').insert({ message: 'test', active: true })  // expect: success
```

**Normal authenticated user, admin routes:**
```js
await supabase.rpc('is_admin')                        // expect: false
// AdminPage.jsx's own useEffect independently re-checks and closes the panel
// even if somehow mounted — verify by attempting to reach it directly.
```

## 18. Safe Deployment Order

**A.** Read the RLS-status/policies/grants queries again immediately before applying anything, to confirm nothing has changed in production since this package was prepared.
**B.** Review Supabase Auth/API/Postgres logs per Section 21's checklist, before making any change, so a pre-existing baseline is on record.
**C.** ~~Verify Steve's UUID~~ — **done** (Section 16).
**D.** Apply `20260714000001_security_primitives.sql` **only**. This adds the RPCs and `is_admin()` without restricting any current access. Before this step, confirm the live Postgres version (`select version();`) to verify `security_invoker` view support ahead of step H (see the migration file's comment on `time_verses`).
**E.** Test each RPC directly per Section 17's snippets, run against the *currently deployed* client's session (which won't call them yet, but they're now callable directly for verification): valid/invalid join code, guest lookup valid/invalid, `get_my_group_members`, authorized/unauthorized `remove_group_member`, `is_admin` true/false, `get_my_family_table` for a user who is/isn't in `family_members`.
**F.** Push and deploy the repaired client (this branch) that calls the new RPCs.
**G.** Smoke-test production before lockdown: create a table, join a table, guest table view, list members, remove a member, journal save/edit/delete, admin access, normal-user admin denial.
**H.** Apply `20260714000002_emergency_baseline_rls.sql`.
**I.** Immediately run the full anon/User-A/User-B matrix from Section 17.
**J.** Apply `20260714000003_admin_access_policies.sql`.
**K.** Confirm: Steve's admin access works, normal users remain denied, guests receive only intended fields.
**L.** Test the installed Google Play app (per the original audit, this is believed to be a TWA wrapper loading the live web app — if so, step F already covers it; confirm this assumption before assuming no separate release is needed).
**M.** Continue reviewing logs for 24–72 hours after deployment per Section 21.

If any technical blocker prevents deploying the client before baseline RLS (step F before H), stop and report the specific blocker — do not improvise a different order. No such blocker is known at the time of writing.

## 19. Forward-Repair Plan

**No rollback SQL exists for migrations 2 or 3, by design** — the rule is:

```
KEEP RLS ENABLED → FIX THE SPECIFIC POLICY OR RPC → RETEST → REDEPLOY CLIENT IF REQUIRED
```

Never: disable RLS, or restore a `using(true)`/`with_check(true)`/`authenticated_full_access_*`-style broad policy.

- **Migration fails before `COMMIT`:** the transaction rolls back automatically. Nothing changed; safe to re-run after fixing the error.
- **Problem discovered after `COMMIT`:** fix the specific policy with `drop policy if exists "<name>" on public.<table>; create policy ...` (matching the corrected logic), or fix a function body with `create or replace function ...`. Re-run the relevant portion of the Section 17 test matrix immediately after.
- **A client feature breaks in production after baseline RLS:** the safest immediate mitigation is reverting the *client* to the previous Vercel deployment (instant via Vercel's dashboard rollback, or `git revert` + redeploy) while leaving the database migrations in place — RLS staying enabled is always the safe failure mode; a reverted client simply loses the new feature temporarily, it doesn't reopen data access.
- **Emergency contact / decision point:** any step requiring a choice between "temporarily disable a feature" vs. "temporarily accept degraded UX" is Steve's call — do not decide unilaterally which user-facing behavior to sacrifice.
- **Verification after every forward fix:** re-run the specific Section 17 snippets relevant to the changed policy/function, not just a smoke test — a narrow fix can have a narrow blast radius that a general smoke test misses.

## 20. Remaining Product Decisions (for Steve, not resolved by this pass)

- **Is the `families`/`family_members` schema active, legacy, or an in-progress rewrite?** This determines whether it should eventually be removed, finished, or left as-is. Not resolvable from RLS output alone (Section 5). `family_table`'s remediation (Section 6) doesn't depend on this answer — the RPC replacement is safe either way — but it's still worth Steve's eventual decision.
- **Does anything outside this repository depend on `family_table` or `time_verses`?** Confirmed: nothing inside this repo does (no client call site, no Edge Function). Cannot rule out an external client, internal tool, or integration this session has no visibility into. If one exists and depends on direct `SELECT` of `family_table`, it will break once Section 8 is applied (by design — that access was never safe) and would need to be migrated to `get_my_family_table()`.
- **`bible_books` is fully closed (RLS on, zero policies).** Not currently read by any client code, so not believed to be an active bug — confirm nothing outside this repo depends on it before deciding whether to add a read policy.
- **`verse_history`'s "avoid repeating a verse" pool is now user-scoped, not global.** Before this pass, `HomePage.jsx`/`SettingsPage.jsx`/`TablePage.jsx`'s `lockVerseForGroup()`/`loadVerse()` queried `verse_history` with no filter — under disabled RLS this silently returned *every* user's discussed-verse history, meaning the "pick an undiscussed verse" pool was accidentally global rather than personal. Once baseline RLS is applied, that same unfiltered query will only ever return the *calling user's own* history (RLS filters transparently; the code doesn't error, it just receives less data). This is very likely closer to the originally intended behavior (a verse someone else discussed shouldn't exclude it for you), but it is a real behavior change worth Steve's awareness — not a bug introduced by this pass, but a side effect of no longer being able to see other users' data. No code change is proposed for this; flagging it is the deliverable.
- **Invite-code entropy** (Section 7's migration-file note): `Math.random()`, not a CSPRNG, 32^6 keyspace. Not fixed in this pass; recommended as a fast-follow once the RPC choke points exist to add rate limiting alongside it.
- **Table-grant hardening** (Section 13) is proposed but intentionally not bundled into the required 3-migration package — a separate, lower-urgency decision.

## 21. Log-Review Checklist (Phase 12 — separate, read-only)

Look for, in Supabase's Auth/API/Postgres logs:
- Unusually large `SELECT` responses from `profiles` (bulk email harvesting)
- Broad, unfiltered `notes` queries from a single session
- Repeated `groups` requests varying only `invite_code` (enumeration attempts)
- Bulk `analytics` reads or deletes
- `announcements` writes from accounts that aren't Steve's
- Deletes on `notes`/`groups`/`profiles` affecting rows not owned by the requesting session
- Unusual `anon`-key traffic volume or pattern
- Requests from unexpected origins/IP ranges, especially direct REST calls (not from `flippingtables.ai` or the app's known origins)
- Any of the above concentrated in a narrow time window (suggests scripted access rather than normal usage)

**What logs are available, their retention window, and what would constitute conclusive vs. inconclusive evidence: unknown from this session** — no log access was available here. This needs Steve or whoever holds Supabase dashboard access to pull the actual log retention settings and review the above. **No conclusion about whether a breach occurred can be drawn without that review — none is claimed here.** Do not send user notifications or change public messaging based on this checklist alone; that decision requires actual log evidence, not the possibility that exposure existed.

## 22. Testing Performed / Not Performed

| Check | Result |
|---|---|
| `npm run build` | **Passed**, including a re-run after this revision's migration-only changes (no client files touched in the `family_table`/`time_verses` revision, so this re-confirms nothing regressed). Bundle size unchanged (~514 kB / 143 kB gzipped, same pre-existing chunk-size warning). |
| `npm audit` | **Ran**, including a re-run after this revision. Same 3 pre-existing vulnerabilities (2 moderate, 1 high) in the dev-only `esbuild → vite → vite-plugin-pwa` chain, unchanged from the original audit baseline — not introduced by this pass, not fixed by it (fixing requires a breaking Vite major-version upgrade, out of scope). |
| Typecheck | **N/A** — this is a JavaScript (JSX) project; no TypeScript is configured. |
| Lint | **NOT TESTED** — no ESLint config exists anywhere in this project (confirmed absent in the original audit and unchanged since). |
| Unit / integration tests | **NOT TESTED** — no test framework or test files exist anywhere in this project. |
| Production build | **Passed** (see above). |
| Android debug build | **NOT TESTED** — no `android/` folder or Capacitor project exists in this repository (confirmed in the original audit, unchanged); the Play Store build is believed to be an externally-generated TWA wrapper not stored here. |
| Capacitor checks | **N/A** — no Capacitor project exists. |
| The actual RPCs against a live database | **NOT TESTED** — no Supabase credentials/CLI access in this environment. This is the most important outstanding verification; see Section 17/18. |

## 23. Files Changed

**Migrations added, then revised in place (2026-07-15, same day) to add the `family_table`/`time_verses` view fixes and the verified Steve UUID:**
- `supabase/migrations/20260714000001_security_primitives.sql` — added `get_my_family_table()`; marked `is_admin()`'s UUID verified.
- `supabase/migrations/20260714000002_emergency_baseline_rls.sql` — added the `family_table` grant revocation and the `time_verses` `security_invoker` view recreation + grants.
- `supabase/migrations/20260714000003_admin_access_policies.sql` — updated its prerequisite checklist to reflect the UUID verification being done; no policy content changed.

**Migrations removed** (restructured into the three files above, per the staged-rollout requirement):
- `supabase/migrations/20260714000000_harden_admin_access.sql`
- `supabase/migrations/20260714000000_harden_admin_access_ROLLBACK.sql`

**Client files changed:**
- `src/hooks/useFamily.js`
- `src/pages/GuestTablePage.jsx`
- `src/pages/SettingsPage.jsx`

**Docs:**
- This file (new)
- `docs/DWJ_POST_LAUNCH_REPAIR_P1_2026-07-14.md` (pointer added — see its Section 18)

## 24. Branch and Commits

Branch: `fix/dwj-post-launch-p1`. See the branch's own `git log` for exact commit hashes — this remediation pass's commits follow immediately after `92dbbdf` (the prior session's `is_admin()` hardening documentation commit).

## 25. Confirmation

**Nothing in this remediation package has been applied to any database, pushed to `origin`, deployed to Vercel, or published to the Play Store.** `npm run build` and `npm audit` were run locally only, to verify the client changes compile and to capture the dependency-audit baseline — neither touches Supabase or any remote. All work is local commits on `fix/dwj-post-launch-p1`. Stopping here, per instruction, for Steve's approval before any of Section 18's deployment steps begin.
