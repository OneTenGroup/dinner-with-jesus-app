-- Dinner with Jesus — restore self-healing prayer_order, on top of the
-- ON CONFLICT constraint-name fix
-- Date: 2026-07-24
-- Status: NOT YET APPLIED. Forward-repair via create-or-replace, per
-- this migration package's own convention.
--
-- ROOT CAUSE (confirmed by reading the file history, not guessed)
-- 20260716000001_self_heal_stale_prayer_order.sql added an `else`
-- branch to get_or_create_tonight_session()'s "existing row" path that
-- (a) rebuilds an empty prayer_order left behind by the pre-repair
-- client, and (b) appends any current group member missing from an
-- in-progress prayer_order (e.g. someone who joined after tonight's
-- rotation was built) without disturbing turns already completed.
--
-- 20260719000001_fix_ambiguous_verse_date_conflict.sql, three days
-- later, fixed a real and separate bug (the bare `verse_date` reference
-- in `on conflict (group_id, verse_date)` being ambiguous against the
-- function's own RETURNS TABLE column of the same name). But its
-- `create or replace function` body was written from
-- 20260714000004_shared_dinner_session.sql's ORIGINAL text, not from
-- 20260716000001's already-live self-heal version -- `create or
-- replace` fully replaces a function's body, it does not merge, so
-- applying 20260719000001 after 20260716000001 silently deleted the
-- self-heal `else` branch entirely. Confirmed by diffing the two
-- files: 20260719000001 declares none of v_current_order,
-- v_turns_completed, v_current_members, v_missing, and its
-- `if v_existing_id is null then ... end if;` has no `else` at all.
--
-- Net effect on production, if both migrations were applied in
-- filename order (2026-07-16 then 2026-07-19), as their timestamps
-- direct: the ambiguous-column bug is fixed, but the self-heal
-- behavior is gone -- any group whose today's row ends up with an
-- empty or incomplete prayer_order (old-client leftover, or a member
-- joining mid-rotation) is back to the original bug this self-heal
-- migration existed to fix: every viewer sees the generic "Your turn
-- to pray" instead of a name, or a late joiner is never added to
-- tonight's rotation even though the row hasn't finished.
--
-- THE FIX
-- Re-apply 20260716000001's self-heal `else` branch on top of
-- 20260719000001's constraint-by-name ON CONFLICT clause. This is the
-- union of both prior fixes, not a new behavior change. Function
-- signature and RETURNS TABLE shape are unchanged.
--
-- SAFE TO RE-RUN: create or replace function is idempotent, same as
-- every other function in this migration package. Touches no data, no
-- RLS policy, no other table. Safe to apply even if 20260719000001 was
-- never applied to production (this is a strict superset of it).

begin;

create or replace function public.get_or_create_tonight_session(group_id_input uuid)
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
  was_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
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

  select g.timezone into v_tz from public.groups g where g.id = group_id_input;
  v_tz := coalesce(v_tz, 'America/Chicago');
  v_today := public.canonical_dinner_date(v_tz);

  -- Fast path: today's session already exists.
  select gv.id into v_existing_id
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  v_was_created := v_existing_id is null;

  if v_existing_id is null then
    -- Build tonight's prayer_order snapshot: current members ordered by
    -- join date, rotated so groups.next_prayer_user_id (if set and
    -- still a current member) goes first.
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

    -- Pick a verse this GROUP hasn't discussed before, if possible.
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
    -- Constraint-by-name, not a bare column list -- avoids the
    -- ambiguity against this function's own RETURNS TABLE verse_date
    -- output variable (2026-07-19 fix, preserved here).
    on conflict on constraint group_verse_group_id_verse_date_key do nothing
    returning id into v_existing_id;
    v_was_created := v_existing_id is not null;
  else
    -- Existing row: self-heal a stale/incomplete prayer_order rather
    -- than blindly trusting whatever is already stored (2026-07-16
    -- fix, restored here after it was accidentally dropped by the
    -- 2026-07-19 create-or-replace above).
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
         gv.prayer_order, gv.prayer_turns_completed, v_was_created
  from public.group_verse gv
  join public.dinner_verses dv on dv.id = gv.dinner_verse_id
  where gv.group_id = group_id_input and gv.verse_date = v_today;
end;
$$;

comment on function public.get_or_create_tonight_session(uuid) is
  'Atomically gets or creates the single canonical group_verse row for '
  'this group and today (today defined by the group''s own timezone '
  'and a 4am local cutoff, never a client-computed date). Returns the '
  'full verse content, the canonical prayer text (per the row''s '
  'stored prayer_tier, never the viewer''s own faith_level), and '
  'tonight''s prayer_order snapshot in one call. Self-heals a stale or '
  'incomplete prayer_order on an already-existing row (2026-07-16 '
  'patch, restored 2026-07-24 after being accidentally dropped by the '
  '2026-07-19 ON CONFLICT fix) without disturbing an in-progress '
  'rotation. ON CONFLICT resolved by constraint name, not column list '
  '(2026-07-19 fix).';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. Confirm the live function body actually contains the self-heal
--    branch again:
--      select prosrc from pg_proc where proname = 'get_or_create_tonight_session';
--    -- must contain 'self-heal' / the v_current_order / v_missing logic.
-- 2. select id, group_id, verse_date, prayer_order, prayer_turns_completed
--    from public.group_verse
--    where verse_date >= current_date - 3
--    order by verse_date desc;
--    -- Look for any row with prayer_turns_completed = 0 and an empty
--    -- prayer_order -- confirm it self-heals to a non-empty array the
--    -- next time that group's Table screen loads.
-- 3. Add a member to a group with an in-progress (not yet completed)
--    prayer rotation, reload the Table screen as an existing member,
--    and confirm the new member is appended to prayer_order without
--    disturbing prayer_turns_completed or already-completed turns.
-- 4. Re-run the full multi-device prayer rotation acceptance test
--    (see verification report) after applying.
