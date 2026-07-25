-- Dinner with Jesus — fix production defect: "We prayed together" never saves
-- Date: 2026-07-24
-- Status: NOT YET APPLIED. Forward-repair via create-or-replace, per
-- this migration package's own convention.
--
-- ROOT CAUSE
-- complete_prayer_turn() declares `returns table(prayer_turns_completed
-- int, all_prayed boolean)`. PL/pgSQL implicitly creates a variable
-- named prayer_turns_completed for that output column, scoped to the
-- whole function body -- the exact same mechanism that broke
-- get_or_create_tonight_session()'s verse_date reference, fixed on
-- 2026-07-19 (see 20260719000001_fix_ambiguous_verse_date_conflict.sql
-- for the general pattern and the PostgreSQL doc reference). That fix
-- was never generalized to this sibling function.
--
-- The function's own UPDATE statement contains two BARE references to
-- prayer_turns_completed -- one in the WHERE clause, one in RETURNING
-- -- which Postgres cannot disambiguate between the table column and
-- the same-named PL/pgSQL variable, raising "column reference
-- prayer_turns_completed is ambiguous" on every single call. Unlike
-- the verse_date bug (which only fired on the once-per-day "create a
-- new session" path), this fires unconditionally -- confirmed by
-- production device testing 2026-07-24: "We prayed together" failed
-- with the client's generic save-error toast on every attempt, on
-- multiple devices, for an existing, otherwise-healthy session
-- (prayer_turns_completed = 0, order_length = 4, no stale/orphaned
-- state -- ruled out by the same day's launch-verification query).
--
-- THE FIX
-- Alias the UPDATE's target table as gv and qualify every WHERE/
-- RETURNING reference to prayer_turns_completed (and the other
-- group_verse columns in the same clause, for consistency and to rule
-- out the same class of bug recurring) with that alias. Pure syntax
-- change -- no behavior, signature, or RETURNS TABLE shape differs
-- from 20260714000004_shared_dinner_session.sql's original. No client
-- code change required.
--
-- SAFE TO RE-RUN: create or replace function is idempotent, same as
-- every other function in this migration package. Touches no data, no
-- RLS policy, no other table.

begin;

create or replace function public.complete_prayer_turn(group_id_input uuid, expected_turns_completed int)
returns table(
  prayer_turns_completed int,
  all_prayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_today date;
  v_member_count int;
  v_order uuid[];
  v_new_completed int;
  v_advanced boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and group_id = group_id_input
  ) then
    raise exception 'Not a member of this group';
  end if;

  select g.timezone into v_tz from public.groups g where g.id = group_id_input;
  v_tz := coalesce(v_tz, 'America/Chicago');
  v_today := public.canonical_dinner_date(v_tz);

  select gv.prayer_order into v_order
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;

  v_member_count := array_length(v_order, 1);
  if v_member_count is null or v_member_count = 0 then
    raise exception 'No members to rotate';
  end if;

  -- FIX (2026-07-24): target table aliased as gv and every WHERE/
  -- RETURNING reference qualified with it -- the prior bare
  -- `prayer_turns_completed` collided with this function's own
  -- RETURNS TABLE output variable of the same name (identical
  -- PL/pgSQL pitfall to the 2026-07-19 verse_date fix), causing
  -- "column reference is ambiguous" on every call, unconditionally.
  update public.group_verse gv
  set prayer_turns_completed = expected_turns_completed + 1
  where gv.group_id = group_id_input
    and gv.verse_date = v_today
    and gv.prayer_turns_completed = expected_turns_completed
    and expected_turns_completed < v_member_count
  returning gv.prayer_turns_completed into v_new_completed;

  if v_new_completed is null then
    -- Someone else already advanced this exact turn (or it's already
    -- fully complete) -- read and return the current state rather than
    -- erroring. No-op path for a near-simultaneous second tap.
    select gv.prayer_turns_completed into v_new_completed
    from public.group_verse gv
    where gv.group_id = group_id_input and gv.verse_date = v_today;
  elsif v_new_completed >= v_member_count then
    -- Rotation just completed for the night. rotation_advanced is
    -- neither a RETURNS TABLE column nor a declared variable here, so
    -- this statement was never ambiguous -- left as-is.
    update public.group_verse
    set rotation_advanced = true
    where group_id = group_id_input and verse_date = v_today and rotation_advanced = false
    returning true into v_advanced;

    if v_advanced then
      update public.groups
      set next_prayer_user_id = v_order[(1 % v_member_count) + 1]
      where id = group_id_input;
    end if;
  end if;

  return query
  select v_new_completed, v_new_completed >= v_member_count;
end;
$$;

comment on function public.complete_prayer_turn(uuid, int) is
  'Advances tonight''s prayer rotation by exactly one turn, atomically '
  'and idempotently. Only fires on an explicit call -- never because a '
  'new date began, a page loaded, someone refreshed, or someone opened '
  'the prayer section. Sets groups.next_prayer_user_id exactly once '
  'per session, guarded by both the turns_completed compare-and-swap '
  'and the separate rotation_advanced flag, at the moment the rotation '
  'completes for the night. 2026-07-24: fixed an ambiguous-column bug '
  'in the UPDATE''s WHERE/RETURNING clauses (bare prayer_turns_completed '
  'colliding with this function''s own RETURNS TABLE output variable of '
  'the same name) that prevented every call from succeeding -- '
  'unchanged signature/return shape, no client impact.';

revoke all on function public.complete_prayer_turn(uuid, int) from public;
revoke all on function public.complete_prayer_turn(uuid, int) from anon;
grant execute on function public.complete_prayer_turn(uuid, int) to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. In the app, tap "We prayed together" on both test devices.
--    Confirm it succeeds and advances to the next person, with no
--    "That didn't save" error.
-- 2. select group_id, verse_date, prayer_order, prayer_turns_completed,
--    rotation_advanced
--    from public.group_verse
--    where verse_date = current_date;
--    -- confirm prayer_turns_completed actually incremented for the
--    -- group that was just tested.
-- 3. Re-run the two-device prayer rotation acceptance test in full
--    (steps 1-8 from the launch-verification test script) end to end.
