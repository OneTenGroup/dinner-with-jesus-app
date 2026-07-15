-- Dinner with Jesus — Admin access hardening
-- Date: 2026-07-14 (revised)
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
--
-- REVISION NOTE (2026-07-15) — is_admin() signature hardened
-- The original draft of this function was:
--   is_admin(check_uid uuid default auth.uid()) ... security definer
-- That accepted a caller-supplied uuid argument. The RLS policies below only
-- ever call is_admin() with no argument, so the parameter was never
-- exercised in practice — but since `authenticated` had EXECUTE on it, any
-- signed-in user could have called `select is_admin('<someone-elses-uuid>')`
-- directly (e.g. via supabase.rpc('is_admin', { check_uid: ... })) and
-- gotten a true/false answer about an arbitrary UUID. That doesn't grant
-- access to anything by itself (RLS policies here never pass a caller-
-- controlled uid into is_admin()), but it's unnecessary attack surface for
-- a function whose only job is "is the CALLER the admin" — so it has been
-- removed. is_admin() now takes no argument, reads auth.uid() directly, and
-- runs SECURITY INVOKER (not DEFINER) since a literal auth.uid() comparison
-- needs no elevated privilege — SECURITY DEFINER was never required here.

begin;

-- 1. is_admin(): a single source of truth for "is the calling user the
--    app's single admin". No parameters — auth.uid() is the only identity
--    source, so it can only ever answer "am I the admin", never "is this
--    other uuid the admin". SECURITY INVOKER (the default, stated
--    explicitly) since it does nothing that requires elevated privilege.
--    search_path is locked to empty so it can't be redirected by a
--    session-level search_path change; auth.uid() is schema-qualified so
--    this needs no other schema access.
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid() = '28356e7e-067c-49a8-81a2-095576c432a7'::uuid;
$$;

comment on function public.is_admin() is
  'Returns true only when the CALLING user is the app''s single admin '
  'account. Takes no argument by design — auth.uid() is the only identity '
  'source, so it cannot be asked about another user''s uuid. Used by RLS '
  'policies and by the client (supabase.rpc(''is_admin'')) to replace the '
  'old client-only hardcoded-UUID check. If you ever need more than one '
  'admin, replace the hardcoded comparison with a lookup against a '
  'dedicated admin table/role instead of adding more UUIDs here.';

-- Explicit deny/allow: PUBLIC and anon get nothing; only authenticated
-- callers may execute it. The function only ever answers true/false about
-- the caller's own identity, so this does not expose anything to them.
revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- 2. Admin-only additive policies for the tables AdminPage.jsx reads/writes.
--    Each of these is a NEW permissive policy alongside whatever policies
--    already exist — it grants the admin account access, it does not take
--    access away from anyone else. Review column/table names against your
--    actual schema before applying; they were inferred from
--    src/pages/AdminPage.jsx's queries, not from the live database.
--
--    Each policy is dropped first (if present) so this migration can be
--    re-run after a partial failure without erroring on "policy already
--    exists" — see the rollback file's own note on why CREATE POLICY has
--    no IF NOT EXISTS in Postgres. This does not touch any pre-existing,
--    non-admin policy of the same table — only policies with these exact
--    admin_* names are ever dropped or recreated here.

-- profiles: AdminPage reads id/name/email/created_at/faith_level/group_id/
-- onboarding_complete for every user, and writes group_id to null (remove
-- from group) for any user.
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

-- announcements: AdminPage reads, inserts, and updates (deactivates) the
-- global announcement banner.
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

-- After applying, verify with a NON-admin authenticated session that these
-- tables still reject broad reads (e.g. `select * from profiles` should
-- return only what that user's own existing policies already allowed, not
-- every row) — see docs/DWJ_POST_LAUNCH_REPAIR_P1_2026-07-14.md, Phase 1,
-- for the exact verification this repair pass could not perform itself.
--
-- Idempotency: create/replace function, the revoke/grant statements, and
-- the drop-then-create policy pairs above are all safe to re-run. Running
-- this migration twice is a no-op the second time (aside from re-issuing
-- the same grants/policies), not an error and not a duplicate-policy state.
