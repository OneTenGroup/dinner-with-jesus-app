-- Dinner with Jesus — Self-heal stale/incomplete prayer_order
-- Date: 2026-07-16
-- Status: NOT APPLIED TO PRODUCTION. Review before running.
--
-- ROOT CAUSE
-- A real multi-device test today found both viewers in a group seeing
-- the generic "Your turn to pray" instead of a name. Diagnosis: this
-- group's group_verse row for today was almost certainly created by
-- the OLD, pre-repair client (the one live in production until this
-- afternoon's deploy), whose lockVerseForGroup() only ever upserted
-- verse_date/dinner_verse_id -- it never touched prayer_order at all,
-- so the column sat at its schema default, '{}' (empty array). Once
-- the repaired client deployed and called get_or_create_tonight_
-- session(), the RPC's "fast path" (today's row already exists) simply
-- returned that pre-existing row as-is -- it never recomputes
-- prayer_order once a row for the date already exists, so it had no
-- way to notice or repair the empty array left behind by the old
-- client. With prayerOrder.length === 0, TablePage.jsx's
-- currentPrayerId resolves to null for every viewer, hence the
-- generic fallback text instead of a name -- identically for everyone,
-- since every device reads the same shared row.
--
-- This is a one-day transition-window gap, not a design flaw in the
-- rotation logic itself: any group whose today's session was first
-- created by the new client (or any day going forward, once no old
-- client remains in the wild) was never affected.
--
-- WHAT THIS MIGRATION DOES
-- Replaces get_or_create_tonight_session() with the same function,
-- adding self-healing to the existing-row ("fast path") branch only --
-- the create branch (a brand new row) is untouched:
--
--   1. If prayer_order is empty AND prayer_turns_completed = 0 (nobody
--      has prayed yet -- the only state consistent with an empty
--      order), rebuild it fresh from the group's current members, the
--      same ordering the create branch already uses.
--   2. Otherwise, if rotation hasn't finished (prayer_turns_completed
--      is less than the order's length), append any current member who
--      is missing from the existing order -- e.g. someone who joined
--      the group after tonight's order was built. Existing entries are
--      never reordered or removed, so an in-progress rotation with
--      real completed turns is never disturbed.
--   3. If rotation has already completed for the night, the row is
--      left untouched.
--
-- SAFE TO RE-RUN: CREATE OR REPLACE of the same function; no new
-- objects, no data migration statement outside the function body
-- itself (which only ever runs at call time, scoped to the specific
-- row being fetched).
--
-- NO ROLLBACK NEEDED IN THE USUAL SENSE: this only changes future
-- behavior of the RPC. To revert, CREATE OR REPLACE with the version
-- from 20260714000004_shared_dinner_session.sql.

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
      -- Rotate the array so v_next_starter is first, using plain array
      -- slicing (1-indexed, inclusive bounds) -- deliberately not a
      -- row_number()-over-unnest reshuffle, since unnest with no
      -- explicit ordinality/order-by has no guaranteed row order.
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
    on conflict (group_id, verse_date) do nothing
    returning id into v_existing_id;
    v_was_created := v_existing_id is not null;
  else
    -- Existing row: self-heal a stale/incomplete prayer_order rather
    -- than blindly trusting whatever is already stored. See this
    -- migration's header comment for the exact rationale/cases.
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
  'patch) without disturbing an in-progress rotation.';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. select id, group_id, verse_date, prayer_order, prayer_turns_completed
--    from public.group_verse
--    where verse_date = current_date
--    order by verse_date desc;
--    -- Confirm the affected group's row now has a non-empty
--    -- prayer_order containing every current member.
-- 2. In the app (both accounts), reload the Table screen and confirm a
--    real name now shows for "___'s turn to pray" instead of the
--    generic fallback.
-- 3. Confirm prayer_turns_completed and any already-recorded rotation
--    progress is unchanged for any group where prayer had already
--    started tonight.
