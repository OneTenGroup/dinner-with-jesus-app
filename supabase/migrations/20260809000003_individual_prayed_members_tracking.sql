-- Dinner with Jesus — individual prayed_members tracking
-- Date: 2026-08-09
--
-- WHY (confirmed by direct trace, not assumed -- see chat record)
-- prayer_turns_completed as a scalar count cannot distinguish "this
-- slot was skipped because the member was absent" from "this member
-- actually prayed" once a LATER real completion has to jump past an
-- absent member's position in one CAS step. Concretely: A prays
-- (completed 0->1); B is marked absent; C prays for real -- the
-- resolver has to skip B's slot to find C, so the scalar jumps
-- straight from 1 to 3, silently "spending" B's un-prayed slot. If B
-- then returns present, resolving from completed=3 finds nothing (past
-- the end of the array) -- B is locked out for the night even though,
-- individually, only A and C ever actually prayed. This is not
-- fixable by patching the scalar model; it needs to track WHO actually
-- prayed, not just HOW MANY.
--
-- THE FIX
-- group_verse.prayed_members: a new nightly array recording the actual
-- member ids who completed a real prayer turn tonight -- the
-- individual-identity counterpart to absent_members. "Current turn" is
-- now resolved as: the first member in the PERMANENT prayer_order who
-- is in neither absent_members nor prayed_members. prayer_order itself
-- is still never edited by anything in this file. prayer_turns_completed
-- is kept as a column (nothing else in this codebase needs to stop
-- referencing it), but it is now purely DERIVED -- always written as
-- array_length(prayed_members, 1) in the same statement that appends
-- to prayed_members, so it can never diverge from the thing that
-- actually determines correctness. It is no longer read by any
-- control-flow logic in these functions.
--
-- "Do not reopen a completed night" is implemented by gating on
-- rotation_advanced, not by re-deriving completion from prayed_members
-- on every read: rotation_advanced is set exactly once, by
-- complete_prayer_turn(), the moment no eligible (present, not yet
-- prayed) member remains -- and it deliberately stays true regardless
-- of who is marked present afterward. Before rotation_advanced fires,
-- current_prayer_id is always freshly resolved from the permanent
-- order + live attendance + live prayed_members, so a returning absent
-- member immediately reclaims their exact spot if the family hasn't
-- moved past it yet -- and does nothing once it has.
--
-- complete_prayer_turn()'s second parameter changes from
-- expected_turns_completed int to expected_current_prayer_id uuid --
-- the client now confirms WHO it believes is up, not how many turns
-- have passed. Idempotency against rapid/double taps comes from the
-- UPDATE's own WHERE clause refusing to append a member_id that's
-- already in prayed_members, independent of any race on the scalar.

begin;

-- ============================================================
-- SCHEMA: group_verse.prayed_members
-- ============================================================
alter table public.group_verse
  add column if not exists prayed_members uuid[] not null default '{}';

comment on column public.group_verse.prayed_members is
  'Member ids who have ACTUALLY completed a real prayer turn tonight -- '
  'the individual-identity counterpart to absent_members. Defaults to '
  'empty on every new group_verse row. prayer_order is never edited '
  'because of this column; only used to resolve who is currently '
  'eligible (see resolve_current_turn()).';

-- ============================================================
-- HELPER: resolve_current_turn()
-- ============================================================
-- Pure, stateless: the first member in the PERMANENT prayer_order who
-- is neither currently absent nor has already really prayed tonight.
-- Returns NULL if no such member remains (either everyone unprayed is
-- currently absent, or everyone has genuinely prayed). Whether that
-- NULL means "closed for the night" vs. "temporarily nobody present"
-- is decided by the caller via rotation_advanced, not by this
-- function -- this function only ever answers "who, right now, is up."
create or replace function public.resolve_current_turn(
  p_prayer_order uuid[],
  p_absent_members uuid[],
  p_prayed_members uuid[]
)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_len int := coalesce(array_length(p_prayer_order, 1), 0);
  v_i int := 1;
begin
  while v_i <= v_len loop
    if not (p_prayer_order[v_i] = any(p_prayed_members))
       and not (p_prayer_order[v_i] = any(p_absent_members)) then
      return p_prayer_order[v_i];
    end if;
    v_i := v_i + 1;
  end loop;
  return null;
end;
$$;

comment on function public.resolve_current_turn(uuid[], uuid[], uuid[]) is
  'Returns the first member of the permanent prayer_order who is '
  'neither currently absent nor has already really prayed tonight, or '
  'NULL if none remains. Purely computed from identity sets, never a '
  'scalar position -- this is what lets a returning absent member '
  'reclaim their exact spot regardless of how many OTHER members '
  'prayed while they were away.';

revoke all on function public.resolve_current_turn(uuid[], uuid[], uuid[]) from public;
revoke all on function public.resolve_current_turn(uuid[], uuid[], uuid[]) from anon;
grant execute on function public.resolve_current_turn(uuid[], uuid[], uuid[]) to authenticated;

-- Old scalar-position resolver is superseded entirely -- no code path
-- in this file uses it anymore.
drop function if exists public.resolve_current_turn_index(uuid[], uuid[], int);

-- ============================================================
-- get_or_create_tonight_session() -- resolve via identity, not scalar
-- ============================================================
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
  prayed_members uuid[],
  current_prayer_id uuid,
  next_prayer_id uuid,
  all_prayed boolean,
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
  v_final_order uuid[];
  v_final_absent uuid[];
  v_final_prayed uuid[];
  v_final_rotation_advanced boolean;
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

  select g.timezone, g.archived_at into v_tz, v_archived from public.groups g where g.id = group_id_input;
  if v_archived is not null then
    raise exception 'This table has been deleted';
  end if;
  v_tz := coalesce(v_tz, 'America/Chicago');
  v_today := public.canonical_dinner_date(v_tz);

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

    -- absent_members and prayed_members deliberately not set here --
    -- both default to '{}', meaning every new dinner starts with
    -- everyone present and nobody having prayed yet.
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

  select gv.prayer_order, gv.absent_members, gv.prayed_members, gv.rotation_advanced
  into v_final_order, v_final_absent, v_final_prayed, v_final_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  v_final_cur := case when v_final_rotation_advanced then null
    else public.resolve_current_turn(v_final_order, v_final_absent, v_final_prayed) end;
  v_final_next := case when v_final_rotation_advanced or v_final_cur is null then null
    else public.resolve_current_turn(v_final_order, v_final_absent, v_final_prayed || v_final_cur) end;

  return query
  select
    gv.id, gv.verse_date, gv.dinner_verse_id,
    dv.verse_ref, dv.category, dv.verse_text, dv.context_text,
    dv.question_level_1, dv.question_level_2, dv.question_level_3,
    case gv.prayer_tier
      when 'level_3' then coalesce(dv.prayer_level_3, dv.prayer_level_1)
      when 'level_2' then coalesce(dv.prayer_level_2, dv.prayer_level_1)
      else dv.prayer_level_1
    end,
    gv.prayer_order,
    coalesce(array_length(gv.prayed_members, 1), 0),
    gv.absent_members, gv.prayed_members,
    v_final_cur,
    v_final_next,
    gv.rotation_advanced,
    v_was_created
  from public.group_verse gv
  join public.dinner_verses dv on dv.id = gv.dinner_verse_id
  where gv.group_id = group_id_input and gv.verse_date = v_today;
end;
$$;

comment on function public.get_or_create_tonight_session(uuid) is
  'Atomically gets or creates the single canonical group_verse row for '
  'this group and today. current_prayer_id / next_prayer_id / '
  'all_prayed are resolved from prayer_order + absent_members + '
  'prayed_members (2026-08-09) -- identity-based, not a scalar '
  'position, so a returning absent member always resolves correctly. '
  'all_prayed is exactly rotation_advanced: once true it stays true '
  'for the night regardless of who becomes present again, so a '
  'completed dinner is never reopened.';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

-- ============================================================
-- complete_prayer_turn() -- confirm WHO, not how many
-- ============================================================
drop function if exists public.complete_prayer_turn(uuid, int);
drop function if exists public.complete_prayer_turn(uuid, uuid);

create function public.complete_prayer_turn(group_id_input uuid, expected_current_prayer_id uuid)
returns table(
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
  v_actual_current uuid;
  v_new_prayed uuid[];
  v_advanced boolean;
  v_final_cur uuid;
  v_final_next uuid;
  v_member_count int;
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

  select gv.prayer_order, gv.absent_members, gv.prayed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;
  v_absent := coalesce(v_absent, '{}');
  v_prayed := coalesce(v_prayed, '{}');
  v_member_count := coalesce(array_length(v_order, 1), 0);
  if v_member_count = 0 then
    raise exception 'No members to rotate';
  end if;

  -- Once the night is closed, it stays closed -- never reopened by a
  -- late tap, regardless of who's present now.
  if v_rotation_advanced then
    v_new_prayed := v_prayed;
  else
    v_actual_current := public.resolve_current_turn(v_order, v_absent, v_prayed);

    if v_actual_current is null or expected_current_prayer_id is null
       or v_actual_current <> expected_current_prayer_id then
      -- Nothing eligible right now, or the caller's view is stale
      -- (raced, or absence/prayed state changed since they loaded) --
      -- report the truth, mutate nothing.
      v_new_prayed := v_prayed;
    else
      -- CAS guard is "not already recorded", not a scalar match -- a
      -- concurrent duplicate tap for the SAME person simply finds
      -- zero rows to update and falls through to reading back the
      -- (unchanged-by-it) true state. No duplicate ever recorded.
      update public.group_verse gv
      set prayed_members = gv.prayed_members || v_actual_current,
          prayer_turns_completed = coalesce(array_length(gv.prayed_members, 1), 0) + 1
      where gv.group_id = group_id_input
        and gv.verse_date = v_today
        and not (v_actual_current = any(gv.prayed_members))
      returning gv.prayed_members into v_new_prayed;

      if v_new_prayed is null then
        select gv.prayed_members into v_new_prayed
        from public.group_verse gv
        where gv.group_id = group_id_input and gv.verse_date = v_today;
      end if;
    end if;
  end if;

  v_final_cur := case when v_rotation_advanced then null else public.resolve_current_turn(v_order, v_absent, v_new_prayed) end;

  -- Completion is driven exclusively by "no eligible present-and-unprayed
  -- member remains" as a DIRECT CONSEQUENCE of a real completion above --
  -- never by an absence toggle alone (that happens only in set_member_absent,
  -- which never reaches this branch).
  if not v_rotation_advanced and v_final_cur is null then
    update public.group_verse
    set rotation_advanced = true
    where group_id = group_id_input and verse_date = v_today and rotation_advanced = false
    returning true into v_advanced;

    if v_advanced then
      update public.groups
      set next_prayer_user_id = v_order[(1 % v_member_count) + 1]
      where id = group_id_input;
      v_rotation_advanced := true;
    end if;
  end if;

  v_final_next := case when v_rotation_advanced or v_final_cur is null then null
    else public.resolve_current_turn(v_order, v_absent, v_new_prayed || v_final_cur) end;

  return query
  select
    coalesce(array_length(v_new_prayed, 1), 0),
    (case when v_rotation_advanced then null else v_final_cur end),
    v_final_next,
    v_rotation_advanced;
end;
$$;

comment on function public.complete_prayer_turn(uuid, uuid) is
  'Records that expected_current_prayer_id ACTUALLY, individually '
  'completed their prayer turn tonight (2026-08-09 -- second parameter '
  'changed from a scalar expected count to the specific member id the '
  'caller believes is current). Idempotent against rapid/double taps '
  'via a "not already recorded" UPDATE guard, not a scalar CAS. '
  'rotation_advanced fires exactly once, the moment no eligible '
  'present-and-unprayed member remains as a direct result of a real '
  'completion, and never reopens once set -- a returning absent member '
  'can never resurrect a night that has already closed.';

revoke all on function public.complete_prayer_turn(uuid, uuid) from public;
revoke all on function public.complete_prayer_turn(uuid, uuid) from anon;
grant execute on function public.complete_prayer_turn(uuid, uuid) to authenticated;

-- ============================================================
-- set_member_absent() -- resolve via identity, still touches ONLY absent_members
-- ============================================================
drop function if exists public.set_member_absent(uuid, uuid, boolean);

create function public.set_member_absent(
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

  select gv.prayer_order, gv.absent_members, gv.prayed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;
  v_absent := coalesce(v_absent, '{}');
  v_prayed := coalesce(v_prayed, '{}');

  if absent then
    if not (member_id_input = any(v_absent)) then
      v_absent := v_absent || member_id_input;
    end if;
  else
    v_absent := array_remove(v_absent, member_id_input);
  end if;

  update public.group_verse
  set absent_members = v_absent
  where group_id = group_id_input and verse_date = v_today;

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
  'rotation_advanced, or groups.next_prayer_user_id. current_prayer_id '
  'is resolved fresh from the permanent order + live absent_members + '
  'live prayed_members (2026-08-09) -- a member returning present '
  'immediately reclaims their exact spot if the family hasn''t prayed '
  'past it yet, and is correctly excluded (not reopening anything) if '
  'rotation_advanced is already true.';

revoke all on function public.set_member_absent(uuid, uuid, boolean) from public;
revoke all on function public.set_member_absent(uuid, uuid, boolean) from anon;
grant execute on function public.set_member_absent(uuid, uuid, boolean) to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. select prosrc from pg_proc where proname = 'complete_prayer_turn';
--    -- second parameter must be expected_current_prayer_id uuid, not int.
-- 2. Reproduce the exact reported gap: A prays, B absent, C prays,
--    B returns present -- B must become current_prayer_id (not locked
--    out), since rotation has not advanced yet.
-- 3. Full scenario matrix -- see accompanying test script.
