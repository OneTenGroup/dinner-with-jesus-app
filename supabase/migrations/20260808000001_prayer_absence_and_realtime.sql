-- Dinner with Jesus — per-dinner absence + realtime cross-device sync
-- Date: 2026-08-08
--
-- WHAT THIS FIXES (two related problems, fixed together on purpose)
--
-- 1. ROOT CAUSE OF "rotation still broken": no realtime propagation to
--    already-open devices. This was found and explicitly deferred in
--    docs/DWJ_SHARED_TABLE_FUNCTIONAL_AUDIT_2026-07-15.md ("a device
--    must refetch to see another member's advance... a genuinely
--    separate, larger change"). The underlying prayer_order /
--    prayer_turns_completed logic was already correct and race-safe --
--    confirmed again by direct re-read, not assumed. The only thing
--    missing is telling other open devices that the shared row changed
--    at all. Fixed here by adding public.group_verse to the
--    supabase_realtime publication -- existing RLS
--    (group_verse_select_member) already restricts who can see which
--    row, so this does not widen access, only propagates changes to
--    devices already entitled to read them.
--
-- 2. "Not Here / Absent" for one dinner, without losing a long-term
--    rotation slot. Design decision: prayer_order (the permanent
--    per-night snapshot, built from full family membership) is NEVER
--    edited to remove an absent member -- that snapshot is what
--    determines who starts the NEXT dinner (see
--    20260714000004_shared_dinner_session.sql's next_prayer_user_id
--    logic), so shrinking it would permanently cost the absent person
--    their place in line. Instead, a new group_verse.absent_members
--    column records who's out for TONIGHT only, and
--    prayer_turns_completed -- the live "how far have we gotten"
--    pointer -- is made to auto-skip over absent members' slots. The
--    array itself, and therefore everyone's long-term position, is
--    never touched.
--
-- Column is on group_verse (one row per group per night), not
-- profiles, specifically so it resets to "everyone present" by default
-- on the next dinner's fresh row -- no explicit reset logic needed.

begin;

-- ============================================================
-- SCHEMA: group_verse.absent_members
-- ============================================================
alter table public.group_verse
  add column if not exists absent_members uuid[] not null default '{}';

comment on column public.group_verse.absent_members is
  'Member ids marked Not Here for THIS dinner only. Defaults to empty '
  'on every new group_verse row, so absence never carries over to the '
  'next dinner. prayer_order itself is never edited because of this -- '
  'see advance_past_absent() and the header of this migration.';

-- ============================================================
-- HELPER: advance_past_absent()
-- ============================================================
-- Pure function, no table access: given tonight's fixed prayer_order,
-- who's currently marked absent, and how many turns are completed so
-- far, returns the completed-count you'd have after auto-skipping any
-- consecutive absent members starting at the current position. Used by
-- both complete_prayer_turn() (after a real tap) and
-- set_member_absent() (the moment someone is marked absent, in case
-- it's already their turn) so the two call sites can't drift out of
-- sync with each other.
create or replace function public.advance_past_absent(
  p_prayer_order uuid[],
  p_absent_members uuid[],
  p_completed int
)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_completed int := coalesce(p_completed, 0);
  v_len int := coalesce(array_length(p_prayer_order, 1), 0);
begin
  while v_completed < v_len and p_prayer_order[v_completed + 1] = any(p_absent_members) loop
    v_completed := v_completed + 1;
  end loop;
  return v_completed;
end;
$$;

comment on function public.advance_past_absent(uuid[], uuid[], int) is
  'Given a fixed prayer_order, tonight''s absent_members, and the '
  'current completed-turns count, returns the count after skipping '
  'forward over any consecutive absent slots. Never edits prayer_order '
  'itself -- only advances the live pointer. Shared by '
  'complete_prayer_turn() and set_member_absent() so both stay '
  'consistent.';

revoke all on function public.advance_past_absent(uuid[], uuid[], int) from public;
revoke all on function public.advance_past_absent(uuid[], uuid[], int) from anon;
grant execute on function public.advance_past_absent(uuid[], uuid[], int) to authenticated;

-- ============================================================
-- get_or_create_tonight_session() -- add absent_members to output
-- ============================================================
-- Return shape is changing (one new output column), so this requires
-- DROP + CREATE rather than CREATE OR REPLACE. Every other line is
-- carried over unchanged from the live version in
-- 20260725000001_group_ownership_protection.sql (self-heal, ON
-- CONFLICT by constraint name, archived-group rejection) -- confirmed
-- against that file directly before writing this, not from memory.
drop function if exists public.get_or_create_tonight_session(uuid);

create function public.get_or_create_tonight_session(group_id_input uuid)
returns table(
  session_id uuid,
  verse_date date,
  dinner_verse_id uuid,
  verse_ref text,
  category text,
  verse_text text,
  context_text text,
  question_level_1 text,
  question_level_2 text,
  question_level_3 text,
  prayer_text text,
  prayer_order uuid[],
  prayer_turns_completed int,
  absent_members uuid[],
  was_created boolean
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
  v_picked_verse_id uuid;
  v_next_starter uuid;
  v_prayer_order uuid[];
  v_existing_id uuid;
  v_starter_pos int;
  v_was_created boolean;
  v_current_order uuid[];
  v_turns_completed int;
  v_current_members uuid[];
  v_missing uuid[];
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and group_id = group_id_input
  ) then
    raise exception 'Not a member of this group';
  end if;

  select g.timezone, g.archived_at into v_tz, v_archived from public.groups g where g.id = group_id_input;
  if v_archived is not null then
    raise exception 'This table has been deleted';
  end if;
  v_tz := coalesce(v_tz, 'America/Chicago');
  v_today := public.canonical_dinner_date(v_tz);

  -- Fast path: today's session already exists.
  select gv.id into v_existing_id
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  v_was_created := v_existing_id is null;

  if v_existing_id is null then
    select array_agg(p.id order by p.created_at, p.id)
    into v_prayer_order
    from public.profiles p
    where p.group_id = group_id_input;

    v_prayer_order := coalesce(v_prayer_order, '{}');

    select g.next_prayer_user_id into v_next_starter
    from public.groups g
    where g.id = group_id_input;

    if v_next_starter is not null and v_next_starter = any(v_prayer_order) then
      v_starter_pos := array_position(v_prayer_order, v_next_starter);
      v_prayer_order := v_prayer_order[v_starter_pos:array_length(v_prayer_order, 1)]
                         || v_prayer_order[1:v_starter_pos - 1];
    end if;

    select dv.id into v_picked_verse_id
    from public.dinner_verses dv
    where dv.active = true
      and dv.id not in (
        select vh.dinner_verse_id
        from public.verse_history vh
        join public.profiles p on p.id = vh.user_id
        where p.group_id = group_id_input
      )
    order by random()
    limit 1;

    if v_picked_verse_id is null then
      select dv.id into v_picked_verse_id
      from public.dinner_verses dv
      where dv.active = true
      order by random()
      limit 1;
    end if;

    if v_picked_verse_id is null then
      raise exception 'No active verses available';
    end if;

    -- absent_members deliberately not set here -- defaults to '{}',
    -- meaning every new dinner starts with everyone present, exactly
    -- as required ("next dinner, default back to present").
    insert into public.group_verse
      (group_id, verse_date, dinner_verse_id, prayer_order, prayer_turns_completed, prayer_tier, timezone_used, rotation_advanced)
    values
      (group_id_input, v_today, v_picked_verse_id, v_prayer_order, 0, 'level_1', v_tz, false)
    on conflict on constraint group_verse_group_id_verse_date_key do nothing
    returning id into v_existing_id;
    v_was_created := v_existing_id is not null;
  else
    select gv.prayer_order, gv.prayer_turns_completed
    into v_current_order, v_turns_completed
    from public.group_verse gv
    where gv.id = v_existing_id;

    select array_agg(p.id order by p.created_at, p.id)
    into v_current_members
    from public.profiles p
    where p.group_id = group_id_input;
    v_current_members := coalesce(v_current_members, '{}');

    if coalesce(array_length(v_current_order, 1), 0) = 0 and coalesce(v_turns_completed, 0) = 0 then
      update public.group_verse
      set prayer_order = v_current_members
      where id = v_existing_id;
    elsif coalesce(v_turns_completed, 0) < coalesce(array_length(v_current_order, 1), 0) then
      select array_agg(m) into v_missing
      from unnest(v_current_members) as m
      where m <> all(v_current_order);

      if v_missing is not null and array_length(v_missing, 1) > 0 then
        update public.group_verse
        set prayer_order = v_current_order || v_missing
        where id = v_existing_id;
      end if;
    end if;
  end if;

  return query
  select gv.id, gv.verse_date, gv.dinner_verse_id,
         dv.verse_ref, dv.category, dv.verse_text, dv.context_text,
         dv.question_level_1, dv.question_level_2, dv.question_level_3,
         case gv.prayer_tier
           when 'level_3' then coalesce(dv.prayer_level_3, dv.prayer_level_1)
           when 'level_2' then coalesce(dv.prayer_level_2, dv.prayer_level_1)
           else dv.prayer_level_1
         end,
         gv.prayer_order, gv.prayer_turns_completed, gv.absent_members, v_was_created
  from public.group_verse gv
  join public.dinner_verses dv on dv.id = gv.dinner_verse_id
  where gv.group_id = group_id_input and gv.verse_date = v_today;
end;
$$;

comment on function public.get_or_create_tonight_session(uuid) is
  'Atomically gets or creates the single canonical group_verse row for '
  'this group and today. Now also returns absent_members (2026-08-08) '
  'so every device can render who is marked Not Here tonight. '
  'prayer_turns_completed returned here is always already skip-adjusted '
  'past any absent members'' slots -- see advance_past_absent() -- so '
  'the client''s existing prayer_order[prayer_turns_completed] lookup '
  'needs no separate absence-aware logic of its own. Otherwise '
  'identical to the version in 20260725000001_group_ownership_protection.sql.';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

-- ============================================================
-- complete_prayer_turn() -- auto-skip absent slots after a real tap
-- ============================================================
-- Return shape (prayer_turns_completed int, all_prayed boolean) is
-- UNCHANGED, so this stays a straight CREATE OR REPLACE. Only addition:
-- after a real tap successfully advances the count by one (the existing
-- CAS, untouched), also skip forward over any now-current absent
-- slots before computing all_prayed / returning. The no-op race path
-- (v_new_completed is null, someone else already advanced) is also
-- unchanged -- it already reads back whatever the current true value
-- is, which by construction is always already skip-adjusted, since
-- every writer of this column runs it through advance_past_absent().
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
  v_archived timestamptz;
  v_today date;
  v_member_count int;
  v_order uuid[];
  v_absent uuid[];
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

  select g.timezone, g.archived_at into v_tz, v_archived from public.groups g where g.id = group_id_input;
  if v_archived is not null then
    raise exception 'This table has been deleted';
  end if;
  v_tz := coalesce(v_tz, 'America/Chicago');
  v_today := public.canonical_dinner_date(v_tz);

  select gv.prayer_order, gv.absent_members into v_order, v_absent
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;
  v_absent := coalesce(v_absent, '{}');

  v_member_count := array_length(v_order, 1);
  if v_member_count is null or v_member_count = 0 then
    raise exception 'No members to rotate';
  end if;

  update public.group_verse gv
  set prayer_turns_completed = expected_turns_completed + 1
  where gv.group_id = group_id_input
    and gv.verse_date = v_today
    and gv.prayer_turns_completed = expected_turns_completed
    and expected_turns_completed < v_member_count
  returning gv.prayer_turns_completed into v_new_completed;

  if v_new_completed is null then
    -- Someone else already advanced this exact turn (a real tap on
    -- another device, or an absence-triggered skip via
    -- set_member_absent) -- read back the current, already-skip-
    -- adjusted state rather than erroring.
    select gv.prayer_turns_completed into v_new_completed
    from public.group_verse gv
    where gv.group_id = group_id_input and gv.verse_date = v_today;
  else
    -- Real tap succeeded. Auto-skip any consecutive absent slots that
    -- are now current, so the next thing every device shows is always
    -- a present member (or "all done") -- never a phantom absent name.
    v_new_completed := public.advance_past_absent(v_order, v_absent, v_new_completed);
    if v_new_completed <> expected_turns_completed + 1 then
      update public.group_verse
      set prayer_turns_completed = v_new_completed
      where group_id = group_id_input and verse_date = v_today;
    end if;
  end if;

  if v_new_completed >= v_member_count then
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
  'Advances tonight''s prayer rotation by exactly one real turn, '
  'atomically and idempotently, then auto-skips any now-current absent '
  'slots (2026-08-08) so the next displayed turn is always a present '
  'member. next_prayer_user_id is still computed from the full, '
  'never-shrunk prayer_order, so an absent member''s long-term rotation '
  'position is never affected by tonight''s skip. Otherwise identical '
  'to the version in 20260725000001_group_ownership_protection.sql.';

revoke all on function public.complete_prayer_turn(uuid, int) from public;
revoke all on function public.complete_prayer_turn(uuid, int) from anon;
grant execute on function public.complete_prayer_turn(uuid, int) to authenticated;

-- ============================================================
-- set_member_absent() -- mark/unmark a member Not Here for tonight
-- ============================================================
create or replace function public.set_member_absent(
  group_id_input uuid,
  member_id_input uuid,
  absent boolean
)
returns table(
  absent_members uuid[],
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
  v_archived timestamptz;
  v_today date;
  v_order uuid[];
  v_absent uuid[];
  v_member_count int;
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

  -- The person being marked absent must also be a current member of
  -- THIS group -- prevents toggling absence for someone in a different
  -- family, and is meaningless (and refused) for someone already
  -- removed from the group entirely.
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

  select gv.prayer_order, gv.absent_members into v_order, v_absent
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;
  v_absent := coalesce(v_absent, '{}');
  v_member_count := coalesce(array_length(v_order, 1), 0);

  if absent then
    if not (member_id_input = any(v_absent)) then
      v_absent := v_absent || member_id_input;
    end if;
  else
    -- Marking someone present again does not rewind
    -- prayer_turns_completed -- if their slot was already auto-skipped
    -- while they were marked absent, they simply don't get that exact
    -- slot back tonight (their permanent rotation position next time
    -- is untouched either way, since prayer_order itself never
    -- changes). Un-marking only stops any FUTURE skip from applying
    -- to a slot of theirs that hasn't been reached yet.
    v_absent := array_remove(v_absent, member_id_input);
  end if;

  update public.group_verse
  set absent_members = v_absent
  where group_id = group_id_input and verse_date = v_today;

  -- If it's currently this person's turn (or the current turn is now
  -- otherwise absent), skip forward immediately -- don't make the rest
  -- of the family wait for a "We prayed together" tap just to get past
  -- someone who isn't there.
  select gv.prayer_turns_completed into v_new_completed
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  v_new_completed := public.advance_past_absent(v_order, v_absent, v_new_completed);

  update public.group_verse
  set prayer_turns_completed = v_new_completed
  where group_id = group_id_input and verse_date = v_today;

  if v_member_count > 0 and v_new_completed >= v_member_count then
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

  return query select v_absent, v_new_completed, (v_member_count > 0 and v_new_completed >= v_member_count);
end;
$$;

comment on function public.set_member_absent(uuid, uuid, boolean) is
  'Marks a current group member Present or Not Here for TONIGHT''s '
  'dinner only -- writes group_verse.absent_members, never '
  'prayer_order, so long-term rotation position is never affected. If '
  'marking someone absent lands on their current turn, immediately '
  'auto-skips past it via advance_past_absent() rather than waiting '
  'for a prayer tap. absent_members always resets to empty on the next '
  'day''s fresh group_verse row.';

revoke all on function public.set_member_absent(uuid, uuid, boolean) from public;
revoke all on function public.set_member_absent(uuid, uuid, boolean) from anon;
grant execute on function public.set_member_absent(uuid, uuid, boolean) to authenticated;

-- ============================================================
-- REALTIME: propagate group_verse changes to already-open devices
-- ============================================================
-- The actual fix for "rotation still looks broken" -- see this
-- migration's header. group_verse's own RLS (group_verse_select_member,
-- from 20260714000002_emergency_baseline_rls.sql) already restricts
-- SELECT to current members of the same group; adding this table to
-- the realtime publication propagates changes only to sessions already
-- entitled to read the row, it does not widen access.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_verse'
  ) then
    alter publication supabase_realtime add table public.group_verse;
  end if;
end $$;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. select prosrc from pg_proc where proname = 'get_or_create_tonight_session';
--    -- confirm absent_members appears in both the RETURNS TABLE and the final SELECT.
-- 2. select schemaname, tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'group_verse';
--    -- must return exactly one row.
-- 3. Two-device (or two-tab) test: Family A, 3 members. Complete member 1's
--    turn on device 1 -- device 2, already sitting on the Table screen,
--    must update to show member 2 as current WITHOUT reloading.
-- 4. Mark member 2 absent while it is member 2's turn -- prayer_turns_completed
--    must auto-advance to point at member 3, on every open device, without
--    anyone tapping "We prayed together".
-- 5. Complete the whole rotation with member 2 absent, then start a new
--    dinner the next day -- member 2 must appear back in prayer_order in
--    their original position, marked present by default (absent_members
--    reset to '{}').
