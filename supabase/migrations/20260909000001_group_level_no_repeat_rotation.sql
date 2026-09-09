-- Dinner with Jesus — group-level no-repeat dinner rotation
-- Date: 2026-09-09
-- Status: APPLIED TO PRODUCTION AND VERIFIED -- see
-- docs/DWJ_NO_REPEAT_ROTATION_DESIGN.md for the investigation/design
-- this implements. Verified via algorithm-level simulation (isolated
-- temp tables), integration tests against a throwaway group (5-way
-- concurrent burst, same-group multi-device, refresh/retry, guest
-- access, two-member prayer flow -- all cleaned up afterward), and a
-- real second-day production check on the Apple review account (a
-- genuinely different dinner was correctly selected on day 2, no
-- repeat of day 1).
-- Design doc: docs/DWJ_NO_REPEAT_ROTATION_DESIGN.md
--
-- WHY THIS EXISTS
-- get_or_create_tonight_session()'s dinner picker excluded dinners
-- present in verse_history for the group -- but verse_history is an
-- opt-in, per-user "I marked this discussed" log
-- (UNIQUE(user_id, dinner_verse_id), written only by TablePage.jsx's
-- explicit markDiscussed() action). Two real consequences, confirmed
-- against live production, not assumed: (1) a dinner nobody bothers to
-- mark discussed is never excluded and can repeat immediately; (2)
-- once every active dinner has at least one verse_history row for the
-- group (a near-certainty after one full pass through the library),
-- the exclusion query returns nothing forever after -- not just once
-- at a clean reshuffle boundary -- and the function silently falls
-- back to true random-with-replacement, permanently.
--
-- THE FIX
-- Use group_verse instead -- it already gets exactly one row per
-- group per day, unconditionally, with no opt-in step, so it's
-- already the real "what was this group shown" ledger. Add one
-- lightweight per-group cycle-boundary marker
-- (groups.rotation_cycle_started_at) so the exclusion query can ask
-- "not shown to this group SINCE THE CURRENT CYCLE BEGAN" instead of
-- "not shown to this group ever" -- and, when nothing unseen remains,
-- reset the marker and reselect in the same call, unfiltered by
-- definition. verse_history is untouched and keeps doing its actual
-- job (the personal "mark as discussed" checkbox and the
-- conversations-count stat) -- it is simply no longer consulted for
-- rotation correctness.
--
-- LIVE PRODUCTION WAS THE SOURCE OF TRUTH FOR THIS MIGRATION, NOT THE
-- MIGRATION FOLDER
-- The version of get_or_create_tonight_session() re-created below was
-- extracted directly from pg_proc on production (pg_get_functiondef)
-- immediately before writing this file -- confirmed to already differ
-- from every prior migration file that touches this function
-- (20260714000004 / 20260719000001 / 20260724000001 / 20260725000001
-- are all stale relative to what's actually live: production's
-- RETURNS TABLE and return SELECT list already include
-- absent_members, prayed_members, current_prayer_id, next_prayer_id,
-- and reuse `all_prayed` to mean "gv.rotation_advanced", none of which
-- appear in any of those four files). The ONLY block changed from
-- that live source below is the dinner-picker query -- every other
-- line (auth/membership/archived checks, timezone/date resolution,
-- prayer_order construction and self-heal, the resolve_current_turn
-- calls, the final SELECT and its exact column list/order) is
-- reproduced character-for-character from the live function.
-- complete_prayer_turn(), resolve_current_turn(), set_member_absent(),
-- and get_guest_table_by_invite_code() were all independently
-- inspected from pg_proc and confirmed to contain no dinner-selection
-- logic of their own -- none of them are touched by this migration.
--
-- SCOPE
-- This migration does NOT load the 354-dinner content library, does
-- NOT touch dinner_verses.category or its CHECK constraint, and does
-- NOT change any frontend code. The RPC's name, parameter, and return
-- shape are unchanged, so no client deploy is required for this to
-- take effect.
--
-- SAFE TO RE-RUN: `add column if not exists` and `create or replace
-- function` are both idempotent. The backfill UPDATE below is written
-- to be safe to re-run too (see its own comment).

begin;

-- ============================================================
-- SCHEMA CHANGE: groups.rotation_cycle_started_at
-- ============================================================
alter table public.groups
  add column if not exists rotation_cycle_started_at timestamptz not null default now();

comment on column public.groups.rotation_cycle_started_at is
  'Start of this group''s current no-repeat rotation cycle. '
  'get_or_create_tonight_session() excludes dinners already shown to '
  'this group (via group_verse.created_at) at or after this moment; '
  'when no active, unseen dinner remains, that function resets this '
  'to now() and reselects, beginning a fresh cycle in the same call. '
  'Backfilled to each existing group''s own created_at (see below) so '
  'a group''s entire real dinner history counts toward "already seen" '
  'from the moment this migration applies -- not reset to zero.';

-- Backfill: existing groups must have their ENTIRE real history count
-- as "seen in the current cycle," not be reset to a blank slate.
-- ADD COLUMN's own DEFAULT now() (above) would otherwise leave every
-- pre-existing group's cycle starting at the migration's own apply
-- time -- LATER than all of their real historical group_verse rows --
-- which would make the new exclusion query see an empty "seen" set
-- for every existing group and let their most-recently-seen dinners
-- repeat immediately. Backfilling to the group's own created_at
-- predates all of its group_verse rows by construction (group_verse
-- rows can only be created after their group exists), so the fix is
-- exactly: use the group's birth as its first cycle's start.
-- Idempotent/safe to re-run: only backfills rows whose
-- rotation_cycle_started_at is still within a few minutes of this
-- migration's own execution (i.e. rows ADD COLUMN's default just set
-- moments ago) AND whose created_at is strictly earlier -- never a
-- value a live function may have already legitimately reset in the
-- meantime (which would necessarily be far newer than its group's own
-- created_at, so this WHERE clause leaves any such row untouched).
update public.groups
set rotation_cycle_started_at = created_at
where rotation_cycle_started_at > now() - interval '5 minutes'
  and created_at < now() - interval '5 minutes';

-- ============================================================
-- get_or_create_tonight_session() -- swap the picker's exclusion
-- source from verse_history to group_verse + rotation_cycle_started_at
-- ============================================================
-- Reproduced from the LIVE pg_get_functiondef() output (see the
-- header note above) with exactly one block changed: the dinner
-- picker. Every other line is unchanged from what is running in
-- production today.
create or replace function public.get_or_create_tonight_session(group_id_input uuid)
returns table(session_id uuid, verse_date date, dinner_verse_id uuid, verse_ref text, category text, verse_text text, context_text text, question_level_1 text, question_level_2 text, question_level_3 text, prayer_text text, prayer_order uuid[], prayer_turns_completed integer, absent_members uuid[], prayed_members uuid[], current_prayer_id uuid, next_prayer_id uuid, all_prayed boolean, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $function$
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
  v_cycle_started_at timestamptz;
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

    -- ---- CHANGED BLOCK: group-level, cycle-aware no-repeat picker ----
    -- Was: excluded dv.id present in verse_history for any member of
    -- the group (opt-in, per-user, never cycle-aware -- see the
    -- header note). Now: excludes dv.id present in THIS GROUP'S OWN
    -- group_verse rows created at or after its current cycle's start
    -- -- group_verse is written unconditionally by this very function
    -- every single day, so nothing opts out of being counted.
    select g.rotation_cycle_started_at into v_cycle_started_at
    from public.groups g where g.id = group_id_input;

    select dv.id into v_picked_verse_id
    from public.dinner_verses dv
    where dv.active = true
      and dv.id not in (
        select gv2.dinner_verse_id
        from public.group_verse gv2
        where gv2.group_id = group_id_input
          and gv2.dinner_verse_id is not null
          and gv2.created_at >= v_cycle_started_at
      )
    order by random()
    limit 1;

    if v_picked_verse_id is null then
      -- Every currently-active dinner has already been shown to this
      -- group during the current cycle. Begin a fresh cycle and
      -- reselect in the same call -- the reselect is unfiltered by
      -- construction, since no group_verse row can yet exist at or
      -- after the brand-new v_cycle_started_at.
      update public.groups
      set rotation_cycle_started_at = now()
      where id = group_id_input
      returning rotation_cycle_started_at into v_cycle_started_at;

      select dv.id into v_picked_verse_id
      from public.dinner_verses dv
      where dv.active = true
        and dv.id not in (
          select gv2.dinner_verse_id
          from public.group_verse gv2
          where gv2.group_id = group_id_input
            and gv2.dinner_verse_id is not null
            and gv2.created_at >= v_cycle_started_at
        )
      order by random()
      limit 1;
    end if;
    -- ---- END CHANGED BLOCK ----

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
$function$;

comment on function public.get_or_create_tonight_session(uuid) is
  'Atomically gets or creates the single canonical group_verse row for '
  'this group and today. Dinner selection excludes anything this group '
  'has already been shown during its current rotation cycle '
  '(group_verse since groups.rotation_cycle_started_at), and '
  'automatically begins a fresh cycle the moment no unseen active '
  'dinner remains (2026-09-09) -- previously excluded via the opt-in, '
  'non-cycle-aware verse_history table, which is no longer consulted '
  'here. Rejects archived groups. Returns full dinner content, '
  'identity-resolved current/next prayer turn, absent/prayed member '
  'state, and tonight''s prayer_order snapshot in one call.';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Forward-repair, not rollback, per this migration package's own
-- established convention (see 20260714000004_shared_dinner_session.sql's
-- closing note). If a problem is found:
--   1. Fix forward with another `create or replace function` --
--      idempotent, no data migration needed either direction, since
--      verse_history was never modified by this migration.
--   2. To fully revert to the pre-2026-09-09 picker, re-apply the
--      verse_history-based block from the live source captured in
--      this file's own header comment, leaving every other line (and
--      the new rotation_cycle_started_at column, which is then simply
--      unused and harmless) exactly as-is.
--   3. Do NOT drop groups.rotation_cycle_started_at once any deployed
--      function version depends on it -- an unused column is
--      harmless; a dropped column under a live function is not.
