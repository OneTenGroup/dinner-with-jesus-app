-- Dinner with Jesus — Emergency baseline RLS migration
-- Date: 2026-07-15
-- Status: NOT APPLIED TO PRODUCTION. Part 2 of 3. Review before running.
--
-- *** DO NOT APPLY THIS BEFORE THE REPAIRED CLIENT IS DEPLOYED AND
-- SMOKE-TESTED AGAINST supabase/migrations/20260714000001_security_
-- primitives.sql. *** Applying this migration first, against the
-- currently-deployed client, will break invite-code joining, the
-- unauthenticated guest table view, group-member removal, and
-- same-group member-name display -- those flows only work once the
-- client calls join_group_by_invite_code(), get_guest_table_by_
-- invite_code(), remove_group_member(), and get_my_group_members()
-- instead of querying groups/profiles directly. See
-- docs/DWJ_SECURITY_REMEDIATION_RUNBOOK_2026-07-14.md for the full
-- staged order.
--
-- WHAT THIS MIGRATION IS FOR
-- Production inspection (read-only queries run against the live
-- database, not by this repair pass) confirmed the following relations
-- have RLS disabled, or RLS enabled with policies that grant far more
-- access than intended:
--
--   profiles          RLS disabled -- anon/authenticated hold full grants
--   notes             RLS disabled -- same
--   verse_history     RLS disabled, and its dormant policies check only
--                      auth.role() = 'authenticated', not user_id
--   groups            RLS disabled, no policies exist at all
--   dinner_verses     RLS disabled -- anon/authenticated can write, not
--                      just read, the shared verse/question/prayer content
--   analytics         RLS disabled, zero policies exist
--   announcements     RLS enabled, but insert/update/delete policies use
--                      using(true)/with_check(true) for role {public}
--   families          RLS enabled, but "authenticated_full_access_families"
--                      grants ALL to any authenticated user regardless of
--                      ownership, overriding the correctly-scoped policies
--                      already on the same table
--   family_verse      RLS enabled, but policies check only
--                      auth.role() = 'authenticated', not family membership
--   group_verse       RLS enabled, same pattern as family_verse
--   invites           RLS enabled; INSERT policy checks invited_by =
--                      auth.uid() but never verifies the inserter actually
--                      belongs to the family_id on the invite
--
-- Metadata inspection (2026-07-15) additionally confirmed:
--   family_table      A VIEW (owner: postgres, no security_invoker),
--                      joining families + family_members + prayer_rotation.
--                      Runs with the view owner's privileges regardless of
--                      caller -- exposes every family's invite_code, every
--                      member's user_id/display_name/role/prayer_order, and
--                      prayer rotation state to anyone granted SELECT on it.
--   time_verses       A VIEW (owner: postgres, no security_invoker) over
--                      bible_verses -- public reference content, but same
--                      "runs as owner" risk in principle, so handled
--                      explicitly rather than left on its default grants.
--
-- NOT touched by this migration (verified already correctly scoped by
-- production inspection -- see docs/DWJ_SECURITY_REMEDIATION_RUNBOOK_
-- 2026-07-14.md Section 3 for the full per-table evidence):
--   family_members, prayer_rotation, faith_checkins, onboarding,
--   bible_verses, feeling_verses
-- (family_members and prayer_rotation's own direct-table policies are
-- untouched and remain correctly restrictive -- family_table's fix
-- below works by revoking the VIEW's access and routing through
-- get_my_family_table(), a SECURITY DEFINER function from part 1 that
-- deliberately looks past those restrictive policies in a controlled,
-- caller-scoped way. Direct queries against family_members/
-- prayer_rotation remain exactly as restricted as before.)
--
-- bible_books: RLS is enabled with zero policies (fully closed to
-- everyone, including admins). No `.from('bible_books')` call exists
-- anywhere in current client source, so this is not believed to be an
-- active functional bug -- left untouched pending Steve confirming
-- nothing outside this repo depends on reading it.
--
-- FORWARD-REPAIR ONLY -- NO ROLLBACK THAT REOPENS ACCESS
-- There is deliberately no rollback script for this migration. If a
-- specific policy needs correction after COMMIT, fix that policy with
-- `drop policy if exists ...; create policy ...` and re-test -- do not
-- disable RLS, do not recreate a using(true)/with_check(true) policy,
-- and do not restore "authenticated_full_access_families" or any
-- equivalent broad grant. If this migration fails before COMMIT, the
-- transaction rolls back on its own and nothing changes.

begin;

-- ============================================================
-- PROFILES
-- ============================================================
-- Deliberately tighter than the dormant policies that existed before
-- this pass ("Users can read profiles" allowed same-group SELECT of
-- full rows, including email). Same-group member display now goes
-- through get_my_group_members() (part 1), which returns only id+name
-- -- so profiles no longer needs a same-group policy at all. Owner-
-- initiated member removal goes through remove_group_member() (part 1,
-- SECURITY DEFINER), so no cross-user UPDATE policy is needed either.
alter table public.profiles enable row level security;

drop policy if exists "Users can read profiles" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Defensive: no client code currently inserts into profiles directly
-- (profile rows are created by a database trigger on auth.users, which
-- runs as table owner and is unaffected by RLS either way), but this
-- keeps the policy set self-consistent for the "own row only" model
-- and unblocks a future direct-insert path without needing a new
-- migration for it.
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

-- No DELETE policy: ordinary users cannot delete any profile row,
-- including their own. Account deletion goes through the separate
-- delete-account.html / support flow, not a direct client delete.

-- ============================================================
-- NOTES
-- ============================================================
-- Existing 4 policies (select/insert/update/delete, all
-- user_id = auth.uid()) were already correctly written -- they were
-- simply never enforced because RLS was off. Enabling RLS alone closes
-- this table; no policy rewrite needed.
alter table public.notes enable row level security;

-- ============================================================
-- VERSE_HISTORY
-- ============================================================
-- Existing policies checked only auth.role() = 'authenticated', not
-- user_id, despite one being named "Users can view own verse history".
-- Enabling RLS alone would NOT have fixed this table -- the policies
-- themselves must be replaced.
alter table public.verse_history enable row level security;

drop policy if exists "Users can insert verse history" on public.verse_history;
create policy "verse_history_insert_own" on public.verse_history
  for insert with check (user_id = auth.uid());

drop policy if exists "Users can view own verse history" on public.verse_history;
create policy "verse_history_select_own" on public.verse_history
  for select using (user_id = auth.uid());

-- No client code currently updates or deletes verse_history rows
-- (TablePage.jsx only inserts/upserts), so no update/delete policy is
-- added here. Add one later, scoped to user_id = auth.uid(), if a
-- feature needs it.

-- ============================================================
-- GROUPS
-- ============================================================
-- No policies existed at all. Invite-code lookup (join flow) and
-- unauthenticated guest access are now handled entirely by the
-- SECURITY DEFINER RPCs in part 1, which query this table as table
-- owner and are therefore unaffected by these policies -- so the
-- direct-client policy set below can be as narrow as "owner or current
-- member only," with no invite-code carve-out needed.
alter table public.groups enable row level security;

create policy "groups_select_owner_or_member" on public.groups
  for select using (
    owner_id = auth.uid()
    or id = (select p.group_id from public.profiles p where p.id = auth.uid())
  );

create policy "groups_insert_own" on public.groups
  for insert with check (owner_id = auth.uid());

create policy "groups_update_owner" on public.groups
  for update using (owner_id = auth.uid());

create policy "groups_delete_owner" on public.groups
  for delete using (owner_id = auth.uid());

-- ============================================================
-- GROUP_VERSE
-- ============================================================
-- Existing policies checked only auth.role() = 'authenticated', with no
-- group-membership filter -- any signed-in user could read or write any
-- group's verse-of-the-day lock. Client only ever needs select/insert
-- (HomePage.jsx/SettingsPage.jsx/OnboardingPage.jsx use upsert, which
-- requires both); no delete path exists in source, so none is added.
drop policy if exists "Anyone authenticated can read group_verse" on public.group_verse;
create policy "group_verse_select_member" on public.group_verse
  for select using (
    group_id = (select p.group_id from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "Anyone authenticated can insert group_verse" on public.group_verse;
create policy "group_verse_insert_member" on public.group_verse
  for insert with check (
    group_id = (select p.group_id from public.profiles p where p.id = auth.uid())
  );

-- Upsert requires UPDATE too when the ON CONFLICT branch fires.
create policy "group_verse_update_member" on public.group_verse
  for update using (
    group_id = (select p.group_id from public.profiles p where p.id = auth.uid())
  );

-- ============================================================
-- DINNER_VERSES
-- ============================================================
-- Reference content. Guest access no longer needs direct table access
-- at all -- get_guest_table_by_invite_code() (part 1) reads this table
-- as table owner. So, unlike an earlier draft of this migration, anon
-- does not need a read policy here.
alter table public.dinner_verses enable row level security;

create policy "dinner_verses_select_active" on public.dinner_verses
  for select using (auth.role() = 'authenticated' and active = true);

-- No insert/update/delete policy for ordinary users. Admin write access
-- is added separately in 20260714000003_admin_access_policies.sql.

-- ============================================================
-- ANALYTICS
-- ============================================================
-- analytics.js's track() only ever inserts (never reads/updates/
-- deletes) and explicitly skips tracking when there's no authenticated
-- user (`if (!user) return`), so no anonymous-insert policy is added --
-- current source proves it isn't needed.
alter table public.analytics enable row level security;

create policy "analytics_insert_own" on public.analytics
  for insert with check (user_id = auth.uid());

-- No select/update/delete policy for ordinary users. Admin read access
-- is added separately in 20260714000003_admin_access_policies.sql.

-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================
-- Public read is intentional (HomePage.jsx shows the active banner to
-- everyone) and is left as-is. Public write access is removed --
-- writes are re-added, admin-only, in
-- 20260714000003_admin_access_policies.sql.
drop policy if exists "insert_announcements" on public.announcements;
drop policy if exists "update_announcements" on public.announcements;
drop policy if exists "delete_announcements" on public.announcements;
-- "read_announcements" (using true) intentionally left in place.

-- ============================================================
-- FAMILIES
-- ============================================================
-- Treated as live per Phase 2 (6 rows exist; not proven legacy even
-- though the current React client's live code path doesn't query this
-- table -- anything reachable via PostgREST is exploitable directly
-- regardless of what the JS client does). The "Owners can update
-- family," "Family members can view family," and "Authenticated users
-- can create families" policies already on this table are correctly
-- scoped and untouched. Only the catch-all is removed.
drop policy if exists "authenticated_full_access_families" on public.families;

-- The existing "Anyone can look up family by invite code" SELECT policy
-- (using = auth.role() = 'authenticated', no actual invite-code filter)
-- is also removed -- it doesn't do what its name claims (it doesn't
-- restrict by invite code, so it duplicates the catch-all's exposure in
-- a different name). If family-invite-code lookup becomes an active
-- product feature, it needs the same SECURITY DEFINER RPC treatment as
-- groups' invite-code lookup got in part 1, not a standing SELECT
-- policy.
drop policy if exists "Anyone can look up family by invite code" on public.families;

-- ============================================================
-- FAMILY_VERSE
-- ============================================================
-- Existing policies checked only auth.role() = 'authenticated' despite
-- being named "Family members can...". Replaced with real membership
-- checks against family_members (already correctly owner-scoped, left
-- untouched).
drop policy if exists "Family members can insert family verse" on public.family_verse;
create policy "family_verse_insert_member" on public.family_verse
  for insert with check (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = family_verse.family_id
        and fm.user_id = auth.uid()
    )
  );

drop policy if exists "Family members can read family verse" on public.family_verse;
create policy "family_verse_select_member" on public.family_verse
  for select using (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = family_verse.family_id
        and fm.user_id = auth.uid()
    )
  );

-- ============================================================
-- INVITES
-- ============================================================
-- Existing INSERT policy checked invited_by = auth.uid() but never
-- verified the inserter actually belongs to the family_id on the
-- invite -- a user could create an invite record attributing themselves
-- to a family they aren't in. Tightened to require both. The existing
-- SELECT policy (family-membership EXISTS check) was already correct
-- and is untouched.
drop policy if exists "Family members can create invites" on public.invites;
create policy "invites_insert_family_member" on public.invites
  for insert with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.family_members fm
      where fm.family_id = invites.family_id
        and fm.user_id = auth.uid()
    )
  );

-- ============================================================
-- FAMILY_TABLE (view)
-- ============================================================
-- public.family_table is owned by postgres with no security_invoker
-- option, so it runs with the OWNER's privileges regardless of caller
-- -- it does not inherit RLS from families/family_members/
-- prayer_rotation. A security_invoker recreation was considered and
-- rejected (see part 1's get_my_family_table() comment: family_members'
-- own SELECT policy is user_id = auth.uid()-scoped, so a
-- security_invoker view would only ever return the caller's own single
-- row, not the family roster the view is meant to provide -- it would
-- not "produce the exact intended family-member visibility"). Chosen
-- fix: revoke all direct access to the view; the replacement path is
-- get_my_family_table() (part 1), which returns only the caller's own
-- family's rows.
--
-- No current client code depends on direct SELECT of family_table
-- (confirmed by grep across src/); no Edge Functions exist in this
-- repo. Whether anything outside this repository depends on it cannot
-- be ruled out from here -- flagged for Steve to confirm before
-- applying (see the runbook's Remaining Unknowns).
revoke all on public.family_table from public;
revoke all on public.family_table from anon;
revoke all on public.family_table from authenticated;
-- Deliberately no grant statement follows -- no role should have
-- direct SELECT on this view. Access is get_my_family_table() only.

-- ============================================================
-- TIME_VERSES (view)
-- ============================================================
-- public.time_verses is owned by postgres with no security_invoker
-- option, same as family_table -- but it's a single-table view over
-- bible_verses with no per-row user/family scoping in its definition
-- (id, book, chapter, verse, text, reference), and bible_verses'
-- existing SELECT policy is already `using (true)` -- open read for
-- everyone. Recreating this view with security_invoker = true
-- therefore DOES produce the intended visibility (identical to
-- bible_verses' own, already-correct policy), so -- unlike
-- family_table -- the security_invoker view path is the right choice
-- here, not an RPC.
--
-- security_invoker views require PostgreSQL 15+. Supabase projects
-- created since 2023 run PG15+ by default, but this was not directly
-- confirmed against the live project in this session -- run
-- `select version();` before applying. If unsupported, this CREATE
-- VIEW statement will error and the whole transaction rolls back
-- (fail-closed, not a partial apply) -- in that case, replace this
-- section with a get_time_verses() SECURITY DEFINER RPC using the
-- same pattern as get_my_family_table(), which works on any PG version.
create or replace view public.time_verses
with (security_invoker = true)
as
select
  id,
  book,
  book_abbr,
  book_order,
  chapter,
  verse,
  text_niv as text,
  chapter || ':' || verse as reference
from public.bible_verses
order by book_order, chapter, verse;

revoke all on public.time_verses from public;
revoke all on public.time_verses from anon;
revoke all on public.time_verses from authenticated;

-- Read-only reference content for everyone, matching bible_verses'
-- own existing policy. No insert/update/delete/truncate/references/
-- trigger grant follows for any role.
grant select on public.time_verses to anon;
grant select on public.time_verses to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- Run the full anon / User-A / User-B security matrix, INCLUDING the
-- view-specific tests (family_table inaccessible directly to anyone;
-- get_my_family_table() returns only the caller's own family; anon can
-- SELECT time_verses but not write to it) -- see
-- docs/DWJ_SECURITY_REMEDIATION_RUNBOOK_2026-07-14.md, Section 17,
-- before proceeding to 20260714000003_admin_access_policies.sql.
