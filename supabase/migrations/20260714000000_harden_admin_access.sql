-- Dinner with Jesus — Admin access hardening
-- Date: 2026-07-14
-- Author: prepared by Claude Code during the post-launch repair pass (fix/dwj-post-launch-p1)
-- Status: NOT APPLIED TO PRODUCTION. Review before running.
--
-- WHY THIS EXISTS
-- The app's admin dashboard (src/pages/AdminPage.jsx) was gated only by a
-- hardcoded user-ID comparison in client-side JavaScript. That check has been
-- removed from the client (see App.jsx / AdminPage.jsx in this same branch)
-- and replaced with a call to the is_admin() function this migration creates.
-- Until this migration is applied, that client-side call will fail (the
-- function won't exist yet) and the app will correctly deny admin access to
-- everyone, including the real admin — this is a fail-closed, not fail-open,
-- state. Apply this migration BEFORE deploying the updated client code, or
-- the admin dashboard will be inaccessible until you do.
--
-- WHAT THIS AUDIT COULD NOT VERIFY
-- No production Supabase credentials, CLI access, or dashboard access were
-- available in the environment this repair pass ran in. This migration was
-- written from the application's client-side query patterns only (see
-- src/pages/AdminPage.jsx) — NOT from the actual current RLS policies, which
-- remain unknown. Do not assume this migration is complete; it only ADDS the
-- specific admin-only access the dashboard needs. It does not attempt to
-- rewrite, replace, or guess at any existing policy on these tables.
--
-- WHY THIS IS LOW-RISK TO APPLY
-- Postgres evaluates multiple permissive RLS policies on the same table and
-- command with OR — adding a new admin-only permissive policy cannot remove
-- or narrow any access your existing policies already grant to normal users.
-- The one exception is `ENABLE ROW LEVEL SECURITY`: if a table currently has
-- RLS disabled, enabling it with no other policies present would deny ALL
-- access to that table for everyone until a normal-user policy also exists.
-- Before running this migration, confirm (via the Supabase dashboard's
-- Authentication > Policies view, or `select relrowsecurity from pg_class
-- where relname = 'profiles'` etc.) that each table below already has RLS
-- enabled with working policies for ordinary users. If a table does NOT
-- have RLS enabled yet, do not blindly enable it here — that needs its own
-- reviewed migration with normal-user policies included, not this one.

begin;

-- 1. is_admin(): a single source of truth for "is this the app's admin".
--    SECURITY DEFINER so it can be called from RLS policies and from the
--    client via supabase.rpc('is_admin') regardless of the caller's own
--    row-level permissions. It reveals nothing except a boolean.
create or replace function public.is_admin(check_uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select check_uid = '28356e7e-067c-49a8-81a2-095576c432a7'::uuid;
$$;

comment on function public.is_admin(uuid) is
  'Returns true only for the app''s single admin account. Used by RLS policies '
  'and by the client (supabase.rpc(''is_admin'')) to replace the old client-only '
  'hardcoded-UUID check. If you ever need more than one admin, replace the '
  'hardcoded comparison with a lookup against a dedicated admin table/role '
  'instead of adding more UUIDs to this function.';

-- Let any authenticated client call is_admin() to check their own status —
-- the function itself only ever answers true/false about the caller, so
-- this does not expose anything.
grant execute on function public.is_admin(uuid) to authenticated;

-- 2. Admin-only additive policies for the tables AdminPage.jsx reads/writes.
--    Each of these is a NEW permissive policy alongside whatever policies
--    already exist — it grants the admin account access, it does not take
--    access away from anyone else. Review column/table names against your
--    actual schema before applying; they were inferred from
--    src/pages/AdminPage.jsx's queries, not from the live database.

-- profiles: AdminPage reads id/name/email/created_at/faith_level/group_id/
-- onboarding_complete for every user, and writes group_id to null (remove
-- from group) for any user.
create policy "admin_select_all_profiles" on public.profiles
  for select using (public.is_admin());

create policy "admin_update_any_profile" on public.profiles
  for update using (public.is_admin());

-- groups: AdminPage reads every group and deletes any group.
create policy "admin_select_all_groups" on public.groups
  for select using (public.is_admin());

create policy "admin_delete_any_group" on public.groups
  for delete using (public.is_admin());

-- dinner_verses: AdminPage reads all verses and toggles `active`.
create policy "admin_select_all_dinner_verses" on public.dinner_verses
  for select using (public.is_admin());

create policy "admin_update_dinner_verses" on public.dinner_verses
  for update using (public.is_admin());

-- analytics: AdminPage reads up to 500 recent event rows across all users.
create policy "admin_select_all_analytics" on public.analytics
  for select using (public.is_admin());

-- announcements: AdminPage reads, inserts, and updates (deactivates) the
-- global announcement banner.
create policy "admin_select_announcements" on public.announcements
  for select using (public.is_admin());

create policy "admin_insert_announcements" on public.announcements
  for insert with check (public.is_admin());

create policy "admin_update_announcements" on public.announcements
  for update using (public.is_admin());

commit;

-- After applying, verify with a NON-admin authenticated session that these
-- tables still reject broad reads (e.g. `select * from profiles` should
-- return only what that user's own existing policies already allowed, not
-- every row) — see docs/DWJ_POST_LAUNCH_REPAIR_P1_2026-07-14.md, Phase 1,
-- for the exact verification this repair pass could not perform itself.
