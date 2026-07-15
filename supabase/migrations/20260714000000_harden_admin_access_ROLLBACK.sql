-- Rollback for 20260714000000_harden_admin_access.sql
-- Date: 2026-07-14 (revised 2026-07-15 for the zero-argument is_admin() signature)
-- Run this to fully remove everything the hardening migration added, in
-- reverse order. This does not touch or restore any pre-existing policy —
-- it only removes what that migration created, returning these tables to
-- whatever state they were in before it ran.

begin;

drop policy if exists "admin_update_announcements" on public.announcements;
drop policy if exists "admin_insert_announcements" on public.announcements;
drop policy if exists "admin_select_announcements" on public.announcements;

drop policy if exists "admin_select_all_analytics" on public.analytics;

drop policy if exists "admin_update_dinner_verses" on public.dinner_verses;
drop policy if exists "admin_select_all_dinner_verses" on public.dinner_verses;

drop policy if exists "admin_delete_any_group" on public.groups;
drop policy if exists "admin_select_all_groups" on public.groups;

drop policy if exists "admin_update_any_profile" on public.profiles;
drop policy if exists "admin_select_all_profiles" on public.profiles;

revoke execute on function public.is_admin() from authenticated;
drop function if exists public.is_admin();

commit;

-- Note: rolling this back while the updated client code (App.jsx /
-- AdminPage.jsx calling supabase.rpc('is_admin')) is still deployed will
-- make the admin dashboard inaccessible to everyone, including the real
-- admin, until either this migration is re-applied or the client is
-- reverted to a prior commit. That is the safe (fail-closed) failure mode.
--
-- Signature note: this rollback targets is_admin() (zero-argument). If you
-- are rolling back a database that still has the earlier, superseded
-- is_admin(uuid) draft applied instead (it should not — that draft was
-- never applied to production, only ever committed to this branch as a
-- file), use `drop function if exists public.is_admin(uuid);` instead.
