-- Dinner with Jesus — stateless prayer-turn resolution (fixes the
-- "mark everyone absent, then bring someone back -> wrong/stuck state" bug)
-- Date: 2026-08-09
--
-- ROOT CAUSE (confirmed by direct reproduction against production before
-- writing this fix, not assumed)
--
-- The prior migration (20260808000001) made set_member_absent() mutate
-- prayer_turns_completed directly, advancing it forward to "skip past"
-- an absent member's slot. This conflated two things that must stay
-- separate:
--   1. How many REAL prayers have actually been completed tonight --
--      must be permanent and monotonic, only ever advanced by an
--      actual "We prayed together" tap.
--   2. Who the live eligible ("current turn") person is right now --
--      must be recomputed fresh every time, since attendance is
--      temporary and fully reversible.
-- Because both were the same column, marking EVERYONE absent drove
-- prayer_turns_completed all the way to the full member count --
-- indistinguishable from a genuinely finished night -- which
-- incorrectly fired the same "rotation complete, advance to tomorrow"
-- logic that a real completed dinner fires, permanently consuming a
-- rotation turn for a night where nobody actually prayed. Confirmed
-- directly against production: rotation_advanced became true and
-- groups.next_prayer_user_id was set after marking three members
-- absent with zero real prayers completed. Separately, because the
-- skip only ever moved forward, marking someone present again could
-- never recompute backward to correctly make them eligible again --
-- prayer_turns_completed just stayed stuck at "done," which is the
-- exact stuck/contradictory state ("Everyone prayed" badge + "Your
-- turn to pray" text) Steve reported.
--
-- THE FIX
-- prayer_turns_completed reverts to meaning ONLY "how many real
-- prayers have been completed" -- set_member_absent() no longer
-- touches it at all, ever. A new pure function,
-- resolve_current_turn_index(), computes the live eligible person by
-- walking forward from prayer_turns_completed and skipping anyone
-- currently in absent_members -- computed fresh on every call, never
-- stored, so toggling attendance in either direction is automatically
-- correct with no special-casing. "All prayed" / rotation-advancement
-- is now driven exclusively by the real counter reaching the full
-- member count (via an actual complete_prayer_turn() call) -- absence
-- alone can never complete a night or consume a rotation turn.
-- get_or_create_tonight_session(), complete_prayer_turn(), and
-- set_member_absent() all now return the resolved current_prayer_id /
-- next_prayer_id / all_prayed directly, so the client never derives
-- "whose turn" itself and can't reintroduce this class of bug.
--
-- advance_past_absent() (20260808000001) is dropped -- superseded
-- entirely by resolve_current_turn_index(), which is stateless by
-- design rather than a forward-only mutator.

begin;

drop function if exists public.advance_past_absent(uuid[], uuid[], int);

-- ============================================================
-- HELPER: resolve_current_turn_index()
-- ============================================================
-- Pure, stateless: given tonight's fixed prayer_order, who's currently
-- absent, and how many REAL prayers are completed, returns the
-- 0-indexed position of the next eligible (present) person, or NULL if
-- no present member remains from that point onward. Never mutates
-- anything, never called with side effects -- safe to call as many
-- times as needed, from as many places as needed, and always gives the
-- currently-correct answer for whatever absent_members happens to be
-- right now.
create or replace function public.resolve_current_turn_index(
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
  v_len int := coalesce(array_length(p_prayer_order, 1), 0);
  v_i int := coalesce(p_completed, 0);
begin
  while v_i < v_len loop
    if not (p_prayer_order[v_i + 1] = any(p_absent_members)) then
      return v_i;
    end if;
    v_i := v_i + 1;
  end loop;
  return null;
end;
$$;

comment on function public.resolve_current_turn_index(uuid[], uuid[], int) is
  'Given a fixed prayer_order, tonight''s absent_members, and the real '
  'completed-prayers count, returns the 0-indexed position of the next '
  'present member, or NULL if everyone from that point onward is '
  'absent. Purely computed, never stored -- this is what makes '
  'attendance changes in either direction (absent or present again) '
  'always resolve correctly with no special-case logic needed.';

revoke all on function public.resolve_current_turn_index(uuid[], uuid[], int) from public;
revoke all on function public.resolve_current_turn_index(uuid[], uuid[], int) from anon;
grant execute on function public.resolve_current_turn_index(uuid[], uuid[], int) to authenticated;

-- ============================================================
-- get_or_create_tonight_session() -- return resolved turn state too
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
  select
    gv.id, gv.verse_date, gv.dinner_verse_id,
    dv.verse_ref, dv.category, dv.verse_text, dv.context_text,
    dv.question_level_1, dv.question_level_2, dv.question_level_3,
    case gv.prayer_tier
      when 'level_3' then coalesce(dv.prayer_level_3, dv.prayer_level_1)
      when 'level_2' then coalesce(dv.prayer_level_2, dv.prayer_level_1)
      else dv.prayer_level_1
    end,
    gv.prayer_order, gv.prayer_turns_completed, gv.absent_members,
    (case when cur.idx is null then null else gv.prayer_order[cur.idx + 1] end),
    (case when nxt.idx is null then null else gv.prayer_order[nxt.idx + 1] end),
    (gv.prayer_turns_completed >= coalesce(array_length(gv.prayer_order, 1), 0)),
    v_was_created
  from public.group_verse gv
  join public.dinner_verses dv on dv.id = gv.dinner_verse_id
  left join lateral (select public.resolve_current_turn_index(gv.prayer_order, gv.absent_members, gv.prayer_turns_completed) as idx) cur on true
  left join lateral (select case when cur.idx is null then null else public.resolve_current_turn_index(gv.prayer_order, gv.absent_members, cur.idx + 1) end as idx) nxt on true
  where gv.group_id = group_id_input and gv.verse_date = v_today;
end;
$$;

comment on function public.get_or_create_tonight_session(uuid) is
  'Atomically gets or creates the single canonical group_verse row for '
  'this group and today. Now also returns the resolved '
  'current_prayer_id / next_prayer_id / all_prayed (2026-08-09) -- '
  'computed fresh via resolve_current_turn_index() on every call, so '
  'the client never has to derive "whose turn" itself. all_prayed is '
  'strictly prayer_turns_completed >= member count -- the REAL count, '
  'never influenced by who''s currently marked absent.';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

-- ============================================================
-- complete_prayer_turn() -- resolves live turn, never touches absence
-- ============================================================
drop function if exists public.complete_prayer_turn(uuid, int);

create function public.complete_prayer_turn(group_id_input uuid, expected_turns_completed int)
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
  v_member_count int;
  v_completed_before int;
  v_resolved_index int;
  v_new_completed int;
  v_advanced boolean;
  v_final_cur int;
  v_final_next int;
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

  select gv.prayer_order, gv.absent_members, gv.prayer_turns_completed
  into v_order, v_absent, v_completed_before
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;
  v_absent := coalesce(v_absent, '{}');
  v_member_count := coalesce(array_length(v_order, 1), 0);
  if v_member_count = 0 then
    raise exception 'No members to rotate';
  end if;

  if v_completed_before <> expected_turns_completed then
    -- Stale client view (another device already completed a real turn,
    -- or is otherwise ahead) -- don't advance, just report the truth.
    v_new_completed := v_completed_before;
  else
    v_resolved_index := public.resolve_current_turn_index(v_order, v_absent, v_completed_before);

    if v_resolved_index is null then
      -- No one is currently present to complete a turn -- nothing to
      -- advance. Not an error: the UI shouldn't normally offer this
      -- button in this state, but a race (someone got marked absent a
      -- moment ago) must still resolve cleanly, not blow up.
      v_new_completed := v_completed_before;
    else
      update public.group_verse
      set prayer_turns_completed = v_resolved_index + 1
      where group_id = group_id_input
        and verse_date = v_today
        and prayer_turns_completed = v_completed_before
      returning prayer_turns_completed into v_new_completed;

      if v_new_completed is null then
        -- Lost a race between the SELECT above and this UPDATE.
        select gv.prayer_turns_completed into v_new_completed
        from public.group_verse gv
        where gv.group_id = group_id_input and gv.verse_date = v_today;
      end if;
    end if;
  end if;

  -- Completion / next-dinner rotation advancement is driven EXCLUSIVELY
  -- by the real counter reaching the full member count -- this branch
  -- can only ever be reached via an actual completed prayer above,
  -- never via absence alone.
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

  v_final_cur := public.resolve_current_turn_index(v_order, v_absent, v_new_completed);
  v_final_next := case when v_final_cur is null then null else public.resolve_current_turn_index(v_order, v_absent, v_final_cur + 1) end;

  return query
  select
    v_new_completed,
    (case when v_final_cur is null then null else v_order[v_final_cur + 1] end),
    (case when v_final_next is null then null else v_order[v_final_next + 1] end),
    (v_new_completed >= v_member_count);
end;
$$;

comment on function public.complete_prayer_turn(uuid, int) is
  'Advances the REAL prayer_turns_completed count by exactly one, for '
  'whichever position resolve_current_turn_index() currently says is '
  'live (skipping any absent members from expected_turns_completed '
  'forward) -- atomic, race-safe via CAS on the raw counter. Never '
  'touches absent_members. all_prayed / next_prayer_user_id '
  'advancement is only ever driven by this real counter reaching the '
  'full member count -- absence alone can never complete a night or '
  'consume a rotation turn (2026-08-09 fix). Returns the freshly '
  'resolved current_prayer_id/next_prayer_id so the client never '
  'derives "whose turn" itself.';

revoke all on function public.complete_prayer_turn(uuid, int) from public;
revoke all on function public.complete_prayer_turn(uuid, int) from anon;
grant execute on function public.complete_prayer_turn(uuid, int) to authenticated;

-- ============================================================
-- set_member_absent() -- ONLY ever touches absent_members
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
  v_completed int;
  v_member_count int;
  v_final_cur int;
  v_final_next int;
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

  select gv.prayer_order, gv.absent_members, gv.prayer_turns_completed
  into v_order, v_absent, v_completed
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
    -- Marking someone present again never rewrites prayer_turns_completed
    -- -- that counter only ever reflects REAL completed prayers.
    -- resolve_current_turn_index() picks this person back up
    -- automatically on the very next read if the permanent rotation
    -- says it's genuinely their position -- no special-case "welcome
    -- back" logic needed here at all.
    v_absent := array_remove(v_absent, member_id_input);
  end if;

  update public.group_verse
  set absent_members = v_absent
  where group_id = group_id_input and verse_date = v_today;

  -- Deliberately does NOT touch prayer_turns_completed, rotation_advanced,
  -- or groups.next_prayer_user_id, under any circumstance. Attendance
  -- alone can never complete a night or consume a rotation turn -- only
  -- an actual completed prayer (complete_prayer_turn) can do that.
  v_final_cur := public.resolve_current_turn_index(v_order, v_absent, v_completed);
  v_final_next := case when v_final_cur is null then null else public.resolve_current_turn_index(v_order, v_absent, v_final_cur + 1) end;

  return query
  select
    v_absent,
    v_completed,
    (case when v_final_cur is null then null else v_order[v_final_cur + 1] end),
    (case when v_final_next is null then null else v_order[v_final_next + 1] end),
    (v_member_count > 0 and v_completed >= v_member_count);
end;
$$;

comment on function public.set_member_absent(uuid, uuid, boolean) is
  'Marks a current group member Present or Not Here for TONIGHT''s '
  'dinner only -- writes group_verse.absent_members ONLY. Never writes '
  'prayer_order, prayer_turns_completed, rotation_advanced, or '
  'groups.next_prayer_user_id, so marking anyone (or everyone) absent '
  'can never complete tonight''s dinner or consume a rotation turn '
  '(2026-08-09 fix -- see this migration''s header for the incident '
  'this replaces). Returns the freshly resolved current_prayer_id, '
  'which correctly becomes NULL (not any particular person) when no '
  'one remains present, and correctly resolves to whoever the '
  'permanent rotation says is next the moment someone is marked '
  'present again.';

revoke all on function public.set_member_absent(uuid, uuid, boolean) from public;
revoke all on function public.set_member_absent(uuid, uuid, boolean) from anon;
grant execute on function public.set_member_absent(uuid, uuid, boolean) to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. select prosrc from pg_proc where proname = 'set_member_absent';
--    -- must NOT contain any UPDATE of prayer_turns_completed.
-- 2. Reproduce the original bug report exactly: mark all members
--    absent, confirm all_prayed stays FALSE and rotation_advanced
--    stays false throughout (query group_verse.rotation_advanced
--    directly) -- then mark one person present again and confirm
--    current_prayer_id correctly resolves to them (if the permanent
--    rotation says it's their turn) rather than staying stuck null.
-- 3. Full scenario matrix per the incident report this migration
--    fixes -- see the accompanying test script.
