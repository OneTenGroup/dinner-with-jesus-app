-- Dinner with Jesus — Security primitives / compatibility migration
-- Date: 2026-07-15
-- Status: NOT APPLIED TO PRODUCTION. Part 1 of 3. Review before running.
--
-- WHAT THIS MIGRATION DOES
-- Adds narrowly-scoped functions (is_admin() and five operation-oriented
-- RPCs, the last covering the family_table view -- see section 6) that
-- the repaired client will call instead of querying tables/views
-- directly. It does NOT enable RLS, does NOT drop or narrow any existing
-- policy or view grant, and does NOT restrict any table or view
-- currently reachable via PostgREST. Every relation this migration's
-- functions touch is exactly as open after this migration as before it
-- -- the actual access restriction (including revoking direct access to
-- the family_table view) happens in part 2.
--
-- WHY THIS IS SPLIT OUT FROM BASELINE RLS
-- The client currently reads/writes `groups`, `profiles`, and
-- `dinner_verses` directly for invite-code lookups, guest-table access,
-- and member removal/display. If RLS were tightened on those tables
-- before the client is updated to call these RPCs instead, those flows
-- would break in production immediately: invite-code joining, the
-- unauthenticated guest table view, group-owner member removal, and
-- same-group member-name display. Applying this migration alone changes
-- nothing about what's currently accessible — it only makes the safe
-- replacement functions available, so the client can be updated and
-- tested against them BEFORE any table access is tightened. See
-- docs/DWJ_SECURITY_REMEDIATION_RUNBOOK_2026-07-14.md for the full
-- staged rollout order.
--
-- SAFE TO RE-RUN: every statement below is idempotent (create or
-- replace function; drop-then-create for nothing here, since no
-- policies are touched; revoke/grant are naturally idempotent).

begin;

-- ============================================================
-- 1. is_admin() — zero-argument admin identity check
-- ============================================================
-- No caller-supplied UID. auth.uid() is the only identity source, so
-- this can only ever answer "am I the admin", never "is this other
-- UUID the admin". SECURITY INVOKER (not DEFINER) since a literal
-- auth.uid() comparison needs no elevated privilege.
--
-- *** STEVE'S UUID IS VERIFIED (2026-07-15). ***
-- select id, email, created_at from auth.users
-- where id = '28356e7e-067c-49a8-81a2-095576c432a7';
-- returned steve@onetengroup.ai, confirmed by Steve directly. This was
-- the same UUID previously hardcoded in App.jsx as ADMIN_USER_ID, but
-- it is not trusted on that basis -- it's trusted because it was
-- independently confirmed against auth.users. This blocker is resolved.
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
  'account (steve@onetengroup.ai, verified against auth.users '
  '2026-07-15). Zero-argument by design -- auth.uid() is the only '
  'identity source.';

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- ============================================================
-- 2. join_group_by_invite_code() — replaces direct groups SELECT
-- ============================================================
-- Currently useFamily.js's joinGroup() runs
--   supabase.from('groups').select('id, name').eq('invite_code', code)
-- directly against the table. Once groups has real RLS, an authenticated
-- user has no standing SELECT access to a group they don't yet belong
-- to, so this lookup must move server-side into a function that can see
-- the row it needs without granting the client a general "read any
-- group by any filter" policy (which would let anyone enumerate every
-- invite_code in the table).
--
-- Exact-code match only. Returns at most one row. Updates only the
-- calling user's own profiles.group_id -- never anyone else's, never
-- any other profiles column.
create or replace function public.join_group_by_invite_code(invite_code_input text)
returns table(group_id uuid, group_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_group_id uuid;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_code := upper(trim(invite_code_input));
  -- Format check only (6 alphanumeric characters, matching the app's
  -- generator alphabet minus visually-ambiguous characters). Not a
  -- security boundary by itself -- the exact-match lookup below is.
  if v_code !~ '^[A-Z0-9]{6}$' then
    raise exception 'Invalid invite code';
  end if;

  select g.id, g.name into v_group_id, v_group_name
  from public.groups g
  where g.invite_code = v_code;

  if v_group_id is null then
    raise exception 'Invite code not found';
  end if;

  update public.profiles
  set group_id = v_group_id
  where id = v_uid;

  return query select v_group_id, v_group_name;
end;
$$;

comment on function public.join_group_by_invite_code(text) is
  'Looks up a group by exact invite code and joins the calling user to '
  'it. Server-side lookup so authenticated users never need a standing '
  'SELECT policy on groups.invite_code, which would allow enumerating '
  'every group''s code. Updates only the caller''s own profiles.group_id.';

revoke all on function public.join_group_by_invite_code(text) from public;
revoke all on function public.join_group_by_invite_code(text) from anon;
grant execute on function public.join_group_by_invite_code(text) to authenticated;

-- ============================================================
-- 3. get_guest_table_by_invite_code() — replaces direct guest lookup
-- ============================================================
-- GuestTablePage.jsx is the app's one deliberately unauthenticated
-- route (App.jsx checks window.location.pathname.startsWith('/table/')
-- BEFORE the `if (!user) return <AuthPage/>` gate). It currently reads
-- `groups`, then `group_verse`, then `dinner_verses` directly with the
-- anon key. Granting anon a standing SELECT on any of those tables to
-- support this would let anyone enumerate every group/invite_code/
-- verse-of-the-day pairing in the database, not just the one they were
-- given. This function performs the same three-step lookup server-side
-- and returns only the fields the guest screen actually renders --
-- never owner_id, invite_code, member data, or any other table's
-- content.
--
-- Returns zero rows if the code doesn't match any group (same "not
-- found" outcome regardless of whether the code is malformed or simply
-- unknown -- no enumeration hint either way). Returns one row with
-- verse_ref = null if the group exists but hasn't locked tonight's
-- verse yet, matching the client's existing "verse not set" message.
create or replace function public.get_guest_table_by_invite_code(invite_code_input text)
returns table(
  group_name text,
  verse_ref text,
  category text,
  verse_text text,
  context_text text,
  question_level_1 text,
  question_level_2 text,
  prayer_level_1 text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_code text;
  v_group_id uuid;
  v_group_name text;
  v_dinner_verse_id uuid;
begin
  v_code := upper(trim(invite_code_input));
  if v_code !~ '^[A-Z0-9]{6}$' then
    return; -- zero rows: malformed code treated identically to "not found"
  end if;

  select g.id, g.name into v_group_id, v_group_name
  from public.groups g
  where g.invite_code = v_code;

  if v_group_id is null then
    return; -- zero rows: no such code, no further hint given
  end if;

  select gv.dinner_verse_id into v_dinner_verse_id
  from public.group_verse gv
  where gv.group_id = v_group_id
    and gv.verse_date = current_date;

  if v_dinner_verse_id is null then
    return query select v_group_name, null::text, null::text, null::text,
                        null::text, null::text, null::text, null::text;
    return;
  end if;

  return query
  select v_group_name, dv.verse_ref, dv.category, dv.verse_text, dv.context_text,
         dv.question_level_1, dv.question_level_2, dv.prayer_level_1
  from public.dinner_verses dv
  where dv.id = v_dinner_verse_id;
end;
$$;

comment on function public.get_guest_table_by_invite_code(text) is
  'Server-side guest-table lookup by exact invite code. Returns only the '
  'fields GuestTablePage.jsx renders (group name + tonight''s verse '
  'content) -- never owner_id, invite_code, member/profile data, notes, '
  'or analytics. Zero rows for any code that does not match, so an '
  'invalid guess is indistinguishable from a well-formed-but-unknown '
  'code.';

revoke all on function public.get_guest_table_by_invite_code(text) from public;
-- Granted to anon AND authenticated: unauthenticated guest access is a
-- confirmed, load-bearing product requirement (App.jsx routes
-- /table/:inviteCode to this page before the auth gate), not a
-- speculative feature.
grant execute on function public.get_guest_table_by_invite_code(text) to anon, authenticated;

-- ============================================================
-- 4. remove_group_member() — replaces cross-user profiles UPDATE
-- ============================================================
-- useFamily.js's removeMember() currently has a group owner directly
-- UPDATE another user's profiles row (`.eq('id', memberId)`). Once
-- profiles has real RLS (own-row-only), no policy permits this, and a
-- bare "owner can update group members' rows" policy would be unsafe
-- regardless -- RLS controls row visibility, not which columns change,
-- so it would let an owner edit a member's email or name too, not just
-- remove them. This function verifies ownership server-side and
-- touches only the target's group_id column.
create or replace function public.remove_group_member(member_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_group uuid;
  v_target_group uuid;
  v_owner_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if member_id_input = v_uid then
    raise exception 'Cannot remove yourself with this operation';
  end if;

  select group_id into v_caller_group from public.profiles where id = v_uid;
  if v_caller_group is null then
    raise exception 'You are not in a group';
  end if;

  select owner_id into v_owner_id from public.groups where id = v_caller_group;
  if v_owner_id is distinct from v_uid then
    raise exception 'Only the group owner can remove members';
  end if;

  select group_id into v_target_group from public.profiles where id = member_id_input;
  if v_target_group is distinct from v_caller_group then
    raise exception 'That member is not in your group';
  end if;

  if member_id_input = v_owner_id then
    raise exception 'Cannot remove the group owner';
  end if;

  update public.profiles set group_id = null where id = member_id_input;
  return true;
end;
$$;

comment on function public.remove_group_member(uuid) is
  'Lets a group owner remove another member by nulling that member''s '
  'group_id. Verifies the caller owns the target''s current group before '
  'touching anything. Touches only group_id -- never email, name, '
  'faith_level, or any other profiles column. Refuses to remove the '
  'owner or the caller themselves.';

revoke all on function public.remove_group_member(uuid) from public;
revoke all on function public.remove_group_member(uuid) from anon;
grant execute on function public.remove_group_member(uuid) to authenticated;

-- ============================================================
-- 5. get_my_group_members() — replaces same-group profiles SELECT
-- ============================================================
-- HomePage.jsx's member chips and SettingsPage.jsx's member list both
-- currently read `profiles` filtered by `group_id`, which requires a
-- policy letting any group member SELECT every column of every other
-- member's profile row -- including email. This function returns only
-- id + name for members of the CALLER's own current group.
create or replace function public.get_my_group_members()
returns table(id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name
  from public.profiles p
  where p.group_id is not null
    and p.group_id = (select pr.group_id from public.profiles pr where pr.id = auth.uid());
$$;

comment on function public.get_my_group_members() is
  'Returns id + display name only (never email or other profile fields) '
  'for every member of the CALLING user''s own current group. Used for '
  'member-chip and member-list display so profiles never needs a '
  'same-group SELECT policy.';

revoke all on function public.get_my_group_members() from public;
revoke all on function public.get_my_group_members() from anon;
grant execute on function public.get_my_group_members() to authenticated;

-- ============================================================
-- 6. get_my_family_table() — replaces direct public.family_table SELECT
-- ============================================================
-- public.family_table is a view (owner: postgres, no security_invoker
-- option) joining families + family_members + prayer_rotation. Because
-- it has no security_invoker, it runs with the VIEW OWNER's privileges
-- regardless of who queries it -- it does not inherit the caller's RLS
-- restrictions on the underlying tables. Any role granted SELECT on
-- this view can see every family's invite_code, every member's
-- user_id/display_name/role/prayer_order, and the prayer rotation
-- state for every family, not just their own.
--
-- A security_invoker view was considered and rejected: family_members'
-- existing SELECT policy (kept, correctly scoped, in part 2 of this
-- package) is `user_id = auth.uid()` -- a caller may only see their
-- OWN membership row, not fellow members'. A security_invoker
-- recreation of family_table would inherit that restriction and return
-- only one row (the caller's own), not the full family roster the view
-- is clearly meant to provide. That does not match the view's intended
-- purpose, so per this migration's own decision rule (security_invoker
-- only when the underlying policies already produce the intended
-- visibility), the correct fix is: revoke all direct access to the
-- view (done in part 2 of this package, where family_table's access is
-- actually restricted) and replace it with this narrow RPC, which
-- looks up the caller's family server-side and returns only that
-- family's roster.
--
-- No client code anywhere in src/ currently queries `family_table`,
-- `families`, `family_members`, or `prayer_rotation` directly
-- (confirmed by grep) -- this RPC has no current caller to update. It
-- exists so that if/when this parallel data model becomes active
-- product surface, a safe access path is already in place rather than
-- someone reaching for the raw view.
create or replace function public.get_my_family_table()
returns table(
  family_id uuid,
  family_name text,
  invite_code text,
  user_id uuid,
  display_name text,
  role text,
  prayer_order int,
  prayer_current_idx int
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_family_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select fm.family_id into v_family_id
  from public.family_members fm
  where fm.user_id = v_uid
  limit 1;

  if v_family_id is null then
    return; -- zero rows: caller isn't in a family
  end if;

  return query
  select f.id, f.name, f.invite_code, fm.user_id, fm.display_name, fm.role,
         fm.prayer_order, pr.current_idx
  from public.families f
  join public.family_members fm on fm.family_id = f.id
  left join public.prayer_rotation pr on pr.family_id = f.id
  where f.id = v_family_id;
end;
$$;

comment on function public.get_my_family_table() is
  'Server-side replacement for direct SELECT on the postgres-owned '
  'view public.family_table (which has no security_invoker and would '
  'otherwise return every family''s data to any caller granted access '
  'to it). Returns only the roster of the CALLING user''s own family -- '
  'invite_code, member ids/display names/roles/prayer order, and '
  'prayer rotation state -- never another family''s rows.';

revoke all on function public.get_my_family_table() from public;
revoke all on function public.get_my_family_table() from anon;
grant execute on function public.get_my_family_table() to authenticated;

-- NOTE ON COLUMN TYPES: prayer_order and prayer_current_idx are
-- declared `int` based on their names and the view definition alone --
-- this repair pass has no live schema access to confirm the actual
-- column types of family_members.prayer_order or
-- prayer_rotation.current_idx. Verify these against
-- information_schema.columns before applying; adjust the RETURNS
-- TABLE types to match exactly if they differ (e.g. smallint, numeric).

commit;

-- ============================================================
-- INVITE-CODE ENTROPY NOTE (informational, not fixed by this migration)
-- ============================================================
-- Invite codes are generated client-side (useFamily.js, OnboardingPage.jsx)
-- using Math.random() over a 32-character alphabet at 6 characters:
-- 32^6 ~= 1.07 billion combinations. Math.random() is not a CSPRNG, and
-- the keyspace, while large, is a bearer token with no rate limiting
-- visible anywhere in this codebase. This migration does not change
-- code-generation -- it only prevents the code SPACE from being read
-- wholesale via a direct table policy. Recommend a follow-up (not part
-- of this emergency pass): switch to crypto.getRandomValues() and add
-- rate limiting on join_group_by_invite_code() / get_guest_table_by_
-- invite_code() attempts, since both are now the sole choke points for
-- code-guessing after this migration -- a natural place to add it later.
--
-- FORWARD-REPAIR, NOT ROLLBACK
-- If a function here needs correction after this migration is applied,
-- fix it with `create or replace function ...` (safe, does not require
-- dropping first) and re-test. Do not drop these functions once
-- migrations 2/3 exist in production -- both depend on is_admin(), and
-- the repaired client depends on all four RPCs; dropping them without
-- also reverting the client and re-opening the tables they replaced
-- would break every join/guest/member-removal/member-display flow in
-- production.
