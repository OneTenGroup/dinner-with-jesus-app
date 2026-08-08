-- Dinner with Jesus — fix ambiguous column in the rewritten complete_prayer_turn()
-- Date: 2026-08-09
--
-- ROOT CAUSE (confirmed by direct reproduction, not assumed)
-- 20260809000001 rewrote complete_prayer_turn() and, in doing so,
-- reintroduced the exact same ambiguous-column bug class that
-- 20260724000003_fix_ambiguous_prayer_turns_completed.sql already fixed
-- once before: this function's RETURNS TABLE includes a column named
-- prayer_turns_completed, which PL/pgSQL exposes as an implicit output
-- variable of that same name -- so a BARE (unqualified) reference to
-- prayer_turns_completed inside the function body is ambiguous between
-- "the table column" and "the function's own output variable." The
-- rewrite's real-tap UPDATE statement qualified its SELECT with the gv
-- alias but not the UPDATE's SET/WHERE/RETURNING clauses, so every
-- real "We prayed together" tap failed with:
--   ERROR: column reference "prayer_turns_completed" is ambiguous
-- Confirmed directly: this migration's own test matrix caught it on
-- the very first real completion attempted after applying
-- 20260809000001, before anything else touched it.
--
-- THE FIX
-- Same pattern as the original 2026-07-24 fix: alias the UPDATE's
-- target table as gv and qualify every WHERE/RETURNING reference to
-- prayer_turns_completed with that alias. Pure syntax change -- no
-- other behavior differs from 20260809000001's version.

begin;

create or replace function public.complete_prayer_turn(group_id_input uuid, expected_turns_completed int)
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
      -- FIX (2026-08-09): target table aliased as gv and every
      -- WHERE/RETURNING reference qualified with it -- the prior bare
      -- `prayer_turns_completed` collided with this function's own
      -- RETURNS TABLE output variable of the same name (the identical
      -- PL/pgSQL pitfall fixed once before, in
      -- 20260724000003_fix_ambiguous_prayer_turns_completed.sql, for
      -- the pre-absence version of this same function).
      update public.group_verse gv
      set prayer_turns_completed = v_resolved_index + 1
      where gv.group_id = group_id_input
        and gv.verse_date = v_today
        and gv.prayer_turns_completed = v_completed_before
      returning gv.prayer_turns_completed into v_new_completed;

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
  'forward) -- atomic, race-safe via CAS on the raw counter, qualified '
  'against ambiguous-column collision with this function''s own '
  'RETURNS TABLE (2026-08-09 fix). Never touches absent_members. '
  'all_prayed / next_prayer_user_id advancement is only ever driven by '
  'this real counter reaching the full member count -- absence alone '
  'can never complete a night or consume a rotation turn.';

revoke all on function public.complete_prayer_turn(uuid, int) from public;
revoke all on function public.complete_prayer_turn(uuid, int) from anon;
grant execute on function public.complete_prayer_turn(uuid, int) to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. select prosrc from pg_proc where proname = 'complete_prayer_turn';
--    -- every WHERE/RETURNING reference to prayer_turns_completed must
--    -- be qualified with the gv. alias.
-- 2. Re-run the full test matrix from Phase 2 onward -- a real
--    "We prayed together" completion must succeed without error.
