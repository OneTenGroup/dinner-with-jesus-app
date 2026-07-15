-- Dinner with Jesus — Admin access policies migration
-- Date: 2026-07-15
-- Status: NOT APPLIED TO PRODUCTION. Part 3 of 3. Review before running.
--
-- PREREQUISITES (must both be true before this is applied)
-- 1. supabase/migrations/20260714000001_security_primitives.sql has
--    been applied, so public.is_admin() exists.
-- 2. supabase/migrations/20260714000002_emergency_baseline_rls.sql has
--    been applied, so profiles/groups/dinner_verses/analytics/
--    announcements already have RLS enabled with correct baseline
--    (non-admin) policies. Applying this migration first, against
--    tables that still have RLS disabled, would create policies that
--    sit inert -- exactly the trap the original single-file draft of
--    this migration warned about.
-- 3. Steve's UUID has been directly confirmed against auth.users (see
--    part 1's comment on is_admin()). Do not apply this migration
--    until that confirmation has happened.
--
-- WHAT THIS MIGRATION DOES
-- Adds admin-only, additive permissive policies to the five tables
-- AdminPage.jsx actually reads/writes, scoped to is_admin(). Postgres
-- OR-combines permissive policies on the same table/command, so these
-- can only grant the admin account additional access -- they cannot
-- narrow or remove the baseline (non-admin) access granted by part 2.
-- Inspected against AdminPage.jsx's actual queries; no policy is added
-- that the page does not use.
--
-- SAFE TO RE-RUN: every create policy is preceded by a matching
-- drop policy if exists for that exact name. No pre-existing,
-- non-admin policy is ever touched by this file.
--
-- NO ROLLBACK THAT REOPENS ACCESS
-- If a specific admin policy needs correction, fix it with
-- drop policy if exists / create policy and re-test. To fully remove
-- admin access (e.g. Steve's UUID was wrong), re-run part 1's
-- is_admin() with the corrected UUID via create or replace function --
-- do not drop is_admin() while these policies still reference it.

begin;

-- profiles: AdminPage reads id/name/email/created_at/faith_level/
-- group_id/onboarding_complete for every user, and writes group_id to
-- null (remove from group) for any user.
drop policy if exists "admin_select_all_profiles" on public.profiles;
create policy "admin_select_all_profiles" on public.profiles
  for select using (public.is_admin());

drop policy if exists "admin_update_any_profile" on public.profiles;
create policy "admin_update_any_profile" on public.profiles
  for update using (public.is_admin());

-- groups: AdminPage reads every group and deletes any group.
drop policy if exists "admin_select_all_groups" on public.groups;
create policy "admin_select_all_groups" on public.groups
  for select using (public.is_admin());

drop policy if exists "admin_delete_any_group" on public.groups;
create policy "admin_delete_any_group" on public.groups
  for delete using (public.is_admin());

-- dinner_verses: AdminPage reads all verses and toggles `active`.
drop policy if exists "admin_select_all_dinner_verses" on public.dinner_verses;
create policy "admin_select_all_dinner_verses" on public.dinner_verses
  for select using (public.is_admin());

drop policy if exists "admin_update_dinner_verses" on public.dinner_verses;
create policy "admin_update_dinner_verses" on public.dinner_verses
  for update using (public.is_admin());

-- analytics: AdminPage reads up to 500 recent event rows across all users.
drop policy if exists "admin_select_all_analytics" on public.analytics;
create policy "admin_select_all_analytics" on public.analytics
  for select using (public.is_admin());

-- announcements: AdminPage reads, inserts, and updates (deactivates)
-- the global announcement banner. This is also where public write
-- access removed in part 2 is replaced, admin-only.
drop policy if exists "admin_select_announcements" on public.announcements;
create policy "admin_select_announcements" on public.announcements
  for select using (public.is_admin());

drop policy if exists "admin_insert_announcements" on public.announcements;
create policy "admin_insert_announcements" on public.announcements
  for insert with check (public.is_admin());

drop policy if exists "admin_update_announcements" on public.announcements;
create policy "admin_update_announcements" on public.announcements
  for update using (public.is_admin());

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. Sign in as Steve. Confirm supabase.rpc('is_admin') returns true
--    and the Admin Dashboard loads real data across all six tabs.
-- 2. Sign in as a non-admin authenticated user. Confirm
--    supabase.rpc('is_admin') returns false, the Admin Dashboard button
--    doesn't grant a working dashboard even if reached directly, and
--    direct admin-scoped table calls (e.g. select * from profiles as
--    a non-admin) return only what that user's OWN baseline policy
--    (part 2) allows -- their own row, nothing else.
