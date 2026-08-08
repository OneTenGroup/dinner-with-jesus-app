-- Dinner with Jesus — harden set_member_absent() against the
-- read-then-write race on absent_members
-- Date: 2026-08-09
--
-- WHY
-- set_member_absent() computed its new absent_members array from a
-- SELECT done earlier in the same function, then wrote that array back
-- with a plain UPDATE ... SET absent_members = <value computed earlier>.
-- Two devices toggling attendance for two DIFFERENT members at close to
-- the same instant could both read the same starting array before
-- either had committed, each compute a single-element change on top of
-- that same starting point, and then each blindly overwrite the whole
-- column -- the second UPDATE to commit would stomp the first one's
-- change even though neither transaction did anything wrong on its own.
-- (Live concurrency testing during the prayed_members work did not
-- happen to trigger this window, but the pattern is real and this is
-- the same class of bug already fixed once in this file for
-- prayed_members' CAS-guarded append.)
--
-- THE FIX
-- Fold the read and the write into a single UPDATE whose SET expression
-- references the target row's OWN column (gv.absent_members) rather
-- than a value read earlier in the function. Postgres evaluates that
-- expression against the row as it exists at the moment this statement
-- acquires the row's lock -- if a concurrent UPDATE to the same row is
-- already in flight, this one waits for it to commit and then computes
-- its CASE against the now-current (post-commit) array, never a stale
-- snapshot. This makes the toggle atomic at the database level:
--   - Two devices toggling DIFFERENT members concurrently: each device's
--     single-element change is applied on top of whatever the other
--     already committed -- both changes survive.
--   - Two devices toggling the SAME member concurrently: whichever
--     UPDATE commits second sees the first's result already applied
--     (member already present/absent) and its CASE branch is a no-op or
--     idempotent re-application -- deterministic by commit order, never
--     a duplicate entry, never corrupted state.
--
-- prayer_order, prayed_members, and rotation_advanced are still only
-- ever READ here, never written -- this migration changes nothing about
-- how they're computed or when rotation_advanced is set. The one
-- behavioral refinement is that they're now read via this same UPDATE's
-- RETURNING (the row's true state at the exact moment of this write)
-- instead of an earlier, separate SELECT -- strictly closes a tiny
-- staleness window against a concurrent complete_prayer_turn(), doesn't
-- change any of the already-verified resolution logic itself.

begin;

create or replace function public.set_member_absent(
  group_id_input uuid,
  member_id_input uuid,
  absent boolean
)
returns table(
  absent_members uuid[],
  prayer_turns_completed int,
  current_prayer_id uuid,
  next_prayer_id uuid,
  all_prayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_archived timestamptz;
  v_today date;
  v_order uuid[];
  v_absent uuid[];
  v_prayed uuid[];
  v_rotation_advanced boolean;
  v_final_cur uuid;
  v_final_next uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and group_id = group_id_input
  ) then
    raise exception 'Not a member of this group';
  end if;

  if not exists (
    select 1 from public.profiles where id = member_id_input and group_id = group_id_input
  ) then
    raise exception 'That person is not a member of this table';
  end if;

  select g.timezone, g.archived_at into v_tz, v_archived from public.groups g where g.id = group_id_input;
  if v_archived is not null then
    raise exception 'This table has been deleted';
  end if;
  v_tz := coalesce(v_tz, 'America/Chicago');
  v_today := public.canonical_dinner_date(v_tz);

  -- Atomic, race-safe toggle: the CASE is evaluated against
  -- gv.absent_members as it exists at the moment this UPDATE acquires
  -- the row lock, not against a value read earlier -- see comment
  -- block above for exactly what this closes.
  update public.group_verse gv
  set absent_members = case
    when absent then
      case when member_id_input = any(gv.absent_members) then gv.absent_members
           else gv.absent_members || member_id_input end
    else
      array_remove(gv.absent_members, member_id_input)
    end
  where gv.group_id = group_id_input and gv.verse_date = v_today
  returning gv.prayer_order, gv.absent_members, gv.prayed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_rotation_advanced;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;
  v_absent := coalesce(v_absent, '{}');
  v_prayed := coalesce(v_prayed, '{}');

  -- Deliberately does NOT touch prayed_members, prayer_turns_completed,
  -- rotation_advanced, or groups.next_prayer_user_id, under any
  -- circumstance. Attendance alone can never complete a night, consume
  -- a rotation turn, or reopen one already closed.
  v_final_cur := case when v_rotation_advanced then null else public.resolve_current_turn(v_order, v_absent, v_prayed) end;
  v_final_next := case when v_rotation_advanced or v_final_cur is null then null
    else public.resolve_current_turn(v_order, v_absent, v_prayed || v_final_cur) end;

  return query
  select
    v_absent,
    coalesce(array_length(v_prayed, 1), 0),
    v_final_cur,
    v_final_next,
    v_rotation_advanced;
end;
$$;

comment on function public.set_member_absent(uuid, uuid, boolean) is
  'Marks a current group member Present or Not Here for TONIGHT''s '
  'dinner only -- writes group_verse.absent_members ONLY, never '
  'prayer_order, prayed_members, prayer_turns_completed, '
  'rotation_advanced, or groups.next_prayer_user_id. The toggle itself '
  'is a single atomic UPDATE whose SET expression reads the row''s own '
  'current absent_members (2026-08-09) -- immune to the lost-update '
  'race a separate read-then-write would have under concurrent '
  'devices toggling attendance. current_prayer_id is resolved fresh '
  'from the permanent order + live absent_members + live '
  'prayed_members -- a member returning present immediately reclaims '
  'their exact spot if the family hasn''t prayed past it yet, and is '
  'correctly excluded (not reopening anything) if rotation_advanced is '
  'already true.';

revoke all on function public.set_member_absent(uuid, uuid, boolean) from public;
revoke all on function public.set_member_absent(uuid, uuid, boolean) from anon;
grant execute on function public.set_member_absent(uuid, uuid, boolean) to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. Two concurrent set_member_absent calls for TWO DIFFERENT members
--    must both land (neither lost).
-- 2. Two concurrent set_member_absent calls for the SAME member must
--    not corrupt absent_members (no duplicate entries either way).
-- 3. Full prayer-rotation regression: everything verified in
--    20260809000003 must still pass unchanged.
