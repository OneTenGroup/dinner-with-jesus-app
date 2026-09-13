-- Dinner with Jesus — prayer state machine hardening
-- Date: 2026-09-12
--
-- NOT YET APPLIED TO PRODUCTION. See the PRE-APPLY REQUIREMENT below.
--
-- ============================================================
-- PRE-APPLY REQUIREMENT (do not skip)
-- ============================================================
-- This migration DROPs and re-creates get_or_create_tonight_session(),
-- complete_prayer_turn(), and set_member_absent() (their RETURNS TABLE
-- shapes change, so `create or replace` alone cannot work). Production
-- has repeatedly been AHEAD of this migration folder, so before
-- applying, capture the live definitions and diff them against the
-- bodies below:
--
--   select p.proname, pg_get_functiondef(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('get_or_create_tonight_session',
--                       'complete_prayer_turn', 'set_member_absent',
--                       'resolve_current_turn',
--                       'reconcile_current_prayer_session')
--   order by p.proname;
--
-- The non-prayer logic below (auth/membership/archived checks,
-- timezone/date resolution, the cycle-aware dinner picker, the final
-- content SELECT) is reproduced from 20260909000001, which was itself
-- extracted from live pg_proc. If the live definitions contain
-- anything not represented below, port it FORWARD into this file
-- before applying -- do not apply and lose it.
--
-- Rollback: supabase/rollback/20260912000001_prayer_state_machine_hardening_rollback.sql
--
-- ============================================================
-- WHY
-- ============================================================
-- Prayer rotation has been an ongoing production problem. The RPC
-- layer's identity-based resolution was correct, but the overall state
-- machine had four structural gaps that made it unreliable in real
-- family use:
--
-- 1. NO WAY TO DECLINE. A member who did not want to pray could only
--    be marked Not Here (a lie about attendance) or have a prayer
--    recorded for them (a lie about prayer). Families hit this every
--    night, and the workaround corrupted the very state that drives
--    the rotation. Fixed by adding a genuine PASSED state.
--
-- 2. THE CLIENT COULD NOT TELL A RECORDED TURN FROM A REFUSED ONE.
--    complete_prayer_turn() returned an identical row shape whether it
--    appended to prayed_members or hit its CAS guard and mutated
--    nothing, and it did not return prayed_members at all. A stale
--    device therefore announced "<name> prayed. <name> is up next"
--    for a turn that was never recorded. Fixed by returning `recorded`
--    plus the full authoritative member sets, so the caller can
--    confirm the transition instead of inferring it from the absence
--    of an exception.
--
-- 3. TONIGHT'S ROSTER WAS NOT STABLE. prayer_order is documented as a
--    snapshot, but the self-heal branch appended any group member
--    missing from it on every single load. A member joining the group
--    mid-dinner was silently inserted into a rotation already in
--    progress, and different devices could observe different rosters
--    depending on when they loaded. Fixed by freezing the roster as
--    soon as the dinner has actually started (see ROSTER FREEZE).
--
-- 4. NO READ-ONLY WAY TO RESYNC. The only way to re-read authoritative
--    prayer state was get_or_create_tonight_session(), which creates a
--    session as a side effect and returns the full dinner content. A
--    client recovering from a dropped realtime channel or returning
--    from the background had no cheap, side-effect-free way to ask
--    "what is true right now". Fixed by get_prayer_session_state().
--
-- ============================================================
-- THE STATE MACHINE
-- ============================================================
-- Every member of tonight's frozen roster resolves to exactly one
-- state, computed from three identity sets on the group_verse row:
--
--   PRAYED   member is in prayed_members
--   PASSED   member is in passed_members
--   ABSENT   member is in absent_members
--   PENDING  member is in none of the above
--
-- ELIGIBILITY is always "PENDING": current_prayer_id is the first
-- member of the frozen prayer_order who is in none of the three sets.
-- This stays identity-based, never a scalar position -- that is what
-- lets a member who returns (un-absent, un-passed) reclaim their exact
-- spot, and what makes every device that reads the row agree.
--
-- A member may appear in more than one set only in the one legitimate
-- case of a member who prayed and then left the table (PRAYED +
-- ABSENT). Eligibility is unaffected (either set excludes them). For
-- DISPLAY the precedence is PRAYED > PASSED > ABSENT > PENDING: a
-- completed turn is a permanent fact about tonight, so the table keeps
-- crediting it even after that person steps away.
--
-- COMPLETION. The night closes (rotation_advanced = true, all_prayed =
-- true) exactly when zero PENDING members remain AND at least one
-- member actually PRAYED or PASSED. The second condition is load-
-- bearing: it is what stops "mark everybody Not Here" from consuming
-- a night nobody prayed at (the 2026-08-08 production incident).
-- Attendance changes alone can therefore never close a night, never
-- consume a rotation turn, and never reopen one -- only the two
-- deliberate acts (prayed / passed) can close it. Once closed it
-- stays closed for the night regardless of who becomes present again.
--
-- ROSTER FREEZE. prayer_order is captured when the dinner row is
-- created and is frozen the moment the dinner has any activity at all
-- (anyone PRAYED, PASSED, or ABSENT). Before that first activity the
-- dinner has not really started and the roster still tracks
-- membership, so a family finishing signup at the table is not
-- excluded from their own first dinner. After it, a new group member
-- is NOT inserted into a rotation already under way -- they join
-- tomorrow's. Departure is the one exception and is handled in the
-- opposite direction by reconcile_current_prayer_session(): a member
-- who LEAVES is removed from the live roster immediately even mid-
-- dinner, because leaving them in strands the rotation on a person who
-- no longer exists to the client ("Someone"), which is precisely the
-- stuck-turn failure this whole package exists to eliminate.
--
-- FAIR STARTING ROTATION (unchanged, deliberately). At creation,
-- prayer_order is the group's members ordered by profiles.created_at
-- and then rotated so that groups.next_prayer_user_id sits at position
-- 1. When a night closes, next_prayer_user_id becomes position 2 of
-- tonight's order, so tomorrow starts with the person after tonight's
-- starter and the starting slot walks the whole table over successive
-- dinners. Passing does not forfeit a member's place in that walk.
-- This migration does not change any of it.

begin;

-- ============================================================
-- SCHEMA: group_verse.passed_members
-- ============================================================
alter table public.group_verse
  add column if not exists passed_members uuid[] not null default '{}';

comment on column public.group_verse.passed_members is
  'Member ids who are present tonight but have chosen NOT to pray -- '
  'the third identity set alongside prayed_members and '
  'absent_members (2026-09-12). Deliberately separate from both: '
  'recording a pass as a prayer lies about prayer, and recording it as '
  'absence lies about attendance and silently lets the member be '
  'restored into the rotation by an attendance toggle. Defaults to '
  'empty on every new dinner, so a pass never carries over. Does not '
  'count toward prayer_turns_completed.';

-- ============================================================
-- HELPER: resolve_current_turn() -- now four identity sets
-- ============================================================
-- The 4-argument form is the real resolver. The pre-existing
-- 3-argument form is retained as a thin wrapper so that any live
-- caller or client mirror built against the 2026-08-09 signature keeps
-- working unchanged while the deploy rolls out.
create or replace function public.resolve_current_turn(
  p_prayer_order uuid[],
  p_absent_members uuid[],
  p_prayed_members uuid[],
  p_passed_members uuid[]
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
    if not (p_prayer_order[v_i] = any(coalesce(p_prayed_members, '{}'::uuid[])))
       and not (p_prayer_order[v_i] = any(coalesce(p_passed_members, '{}'::uuid[])))
       and not (p_prayer_order[v_i] = any(coalesce(p_absent_members, '{}'::uuid[]))) then
      return p_prayer_order[v_i];
    end if;
    v_i := v_i + 1;
  end loop;
  return null;
end;
$$;

comment on function public.resolve_current_turn(uuid[], uuid[], uuid[], uuid[]) is
  'Returns the first member of the frozen prayer_order who is PENDING '
  '-- in none of prayed_members, passed_members, or absent_members -- '
  'or NULL if none remains. Purely computed from identity sets, never '
  'a scalar position, which is what lets a member who returns or '
  'un-passes reclaim their exact spot. Whether a NULL means "the night '
  'is closed" or "nobody is eligible right now" is decided by the '
  'caller via rotation_advanced, never by this function.';

create or replace function public.resolve_current_turn(
  p_prayer_order uuid[],
  p_absent_members uuid[],
  p_prayed_members uuid[]
)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select public.resolve_current_turn(
    p_prayer_order, p_absent_members, p_prayed_members, '{}'::uuid[]
  );
$$;

comment on function public.resolve_current_turn(uuid[], uuid[], uuid[]) is
  'Backward-compatible wrapper for the pre-2026-09-12 three-set '
  'signature. Delegates to the four-set form with no passed members. '
  'Retained so a mid-deploy client or any live caller built against '
  'the old signature keeps resolving correctly.';

revoke all on function public.resolve_current_turn(uuid[], uuid[], uuid[], uuid[]) from public;
revoke all on function public.resolve_current_turn(uuid[], uuid[], uuid[], uuid[]) from anon;
grant execute on function public.resolve_current_turn(uuid[], uuid[], uuid[], uuid[]) to authenticated;
revoke all on function public.resolve_current_turn(uuid[], uuid[], uuid[]) from public;
revoke all on function public.resolve_current_turn(uuid[], uuid[], uuid[]) from anon;
grant execute on function public.resolve_current_turn(uuid[], uuid[], uuid[]) to authenticated;

-- ============================================================
-- HELPER: derive_prayer_state()
-- ============================================================
-- Single definition of the derived view of a dinner's prayer state, so
-- that every RPC below returns values computed by the SAME code rather
-- than by hand-copied CASE expressions that can drift apart. That
-- drift is the specific maintenance hazard which produced the
-- 2026-07-19 regression in this codebase.
create or replace function public.derive_prayer_state(
  p_prayer_order uuid[],
  p_absent_members uuid[],
  p_prayed_members uuid[],
  p_passed_members uuid[],
  p_rotation_advanced boolean
)
returns table(
  current_prayer_id uuid,
  next_prayer_id uuid,
  all_prayed boolean,
  pending_count int
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_order uuid[] := coalesce(p_prayer_order, '{}'::uuid[]);
  v_absent uuid[] := coalesce(p_absent_members, '{}'::uuid[]);
  v_prayed uuid[] := coalesce(p_prayed_members, '{}'::uuid[]);
  v_passed uuid[] := coalesce(p_passed_members, '{}'::uuid[]);
  v_cur uuid;
  v_next uuid;
  v_pending int := 0;
  v_i int := 1;
begin
  while v_i <= coalesce(array_length(v_order, 1), 0) loop
    if not (v_order[v_i] = any(v_prayed))
       and not (v_order[v_i] = any(v_passed))
       and not (v_order[v_i] = any(v_absent)) then
      v_pending := v_pending + 1;
    end if;
    v_i := v_i + 1;
  end loop;

  if coalesce(p_rotation_advanced, false) then
    -- A closed night exposes no current or next turn, ever.
    return query select null::uuid, null::uuid, true, v_pending;
    return;
  end if;

  v_cur := public.resolve_current_turn(v_order, v_absent, v_prayed, v_passed);
  v_next := case
    when v_cur is null then null
    else public.resolve_current_turn(v_order, v_absent, v_prayed || v_cur, v_passed)
  end;

  return query select v_cur, v_next, false, v_pending;
end;
$$;

comment on function public.derive_prayer_state(uuid[], uuid[], uuid[], uuid[], boolean) is
  'The single source of truth for a dinner''s DERIVED prayer state: '
  'current turn, next turn, all_prayed, and how many PENDING members '
  'remain. Every prayer RPC returns values from this function so they '
  'cannot drift apart.';

revoke all on function public.derive_prayer_state(uuid[], uuid[], uuid[], uuid[], boolean) from public;
revoke all on function public.derive_prayer_state(uuid[], uuid[], uuid[], uuid[], boolean) from anon;
grant execute on function public.derive_prayer_state(uuid[], uuid[], uuid[], uuid[], boolean) to authenticated;

-- ============================================================
-- HELPER: close_dinner_if_complete()
-- ============================================================
-- Shared completion gate, called ONLY by the deliberate prayer acts
-- (complete_prayer_turn / pass_prayer_turn / set_member_passed(true)).
-- Never called from any attendance path, which is what preserves the
-- 2026-08-08 guarantee that marking people Not Here can neither
-- complete a night nor consume a rotation turn.
create or replace function public.close_dinner_if_complete(
  group_id_input uuid,
  p_verse_date date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid[];
  v_absent uuid[];
  v_prayed uuid[];
  v_passed uuid[];
  v_rotation_advanced boolean;
  v_pending int;
  v_member_count int;
  v_advanced boolean;
begin
  select gv.prayer_order, gv.absent_members, gv.prayed_members,
         gv.passed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_passed, v_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = p_verse_date;

  if v_rotation_advanced then
    return true;
  end if;

  v_member_count := coalesce(array_length(v_order, 1), 0);
  if v_member_count = 0 then
    return false;
  end if;

  select d.pending_count into v_pending
  from public.derive_prayer_state(v_order, v_absent, v_prayed, v_passed, false) d;

  -- Zero PENDING is necessary but NOT sufficient. At least one member
  -- must have actually prayed or passed, otherwise "everyone marked
  -- Not Here" would silently consume tonight's rotation.
  if v_pending > 0 then
    return false;
  end if;
  if coalesce(array_length(v_prayed, 1), 0) = 0
     and coalesce(array_length(v_passed, 1), 0) = 0 then
    return false;
  end if;

  update public.group_verse
  set rotation_advanced = true
  where group_id = group_id_input
    and verse_date = p_verse_date
    and rotation_advanced = false
  returning true into v_advanced;

  if coalesce(v_advanced, false) then
    -- Tomorrow starts with the person after tonight's starter, so the
    -- starting slot walks the whole table across dinners.
    update public.groups
    set next_prayer_user_id = v_order[(1 % v_member_count) + 1]
    where id = group_id_input;
  end if;

  return true;
end;
$$;

comment on function public.close_dinner_if_complete(uuid, date) is
  'Closes tonight''s dinner (rotation_advanced = true) and advances '
  'groups.next_prayer_user_id exactly once, if and only if zero '
  'PENDING members remain AND at least one member actually prayed or '
  'passed. Returns the resulting rotation_advanced. Called only from '
  'the deliberate prayer acts, never from an attendance change.';

revoke all on function public.close_dinner_if_complete(uuid, date) from public;
revoke all on function public.close_dinner_if_complete(uuid, date) from anon;
revoke all on function public.close_dinner_if_complete(uuid, date) from authenticated;

-- ============================================================
-- HELPER: assert_prayer_member() -- shared auth/membership guard
-- ============================================================
-- Every prayer RPC performed the identical five checks (authenticated,
-- caller is a member, group exists, group not archived, resolve the
-- canonical dinner date). Hoisted so all of them cannot drift.
--
-- NOTE the product rule this encodes: ANY active member of the table
-- may record the current turn. The caller does NOT have to be the
-- person whose turn it is. One phone passed around the table is a
-- fully supported way to run a whole dinner, and a member who never
-- opens the app is never a blocker.
create or replace function public.assert_prayer_member(group_id_input uuid)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_archived timestamptz;
  v_exists boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and group_id = group_id_input
  ) then
    raise exception 'Not a member of this group';
  end if;

  select true, g.timezone, g.archived_at
  into v_exists, v_tz, v_archived
  from public.groups g
  where g.id = group_id_input;

  if not coalesce(v_exists, false) then
    raise exception 'This table does not exist';
  end if;
  if v_archived is not null then
    raise exception 'This table has been deleted';
  end if;

  return public.canonical_dinner_date(coalesce(v_tz, 'America/Chicago'));
end;
$$;

comment on function public.assert_prayer_member(uuid) is
  'Shared guard for every prayer RPC: requires an authenticated caller '
  'who is a member of a live (non-archived) group, and returns that '
  'group''s canonical dinner date. Any active member may act on the '
  'current turn -- the caller need not be the person whose turn it is, '
  'so one shared phone can run an entire dinner.';

revoke all on function public.assert_prayer_member(uuid) from public;
revoke all on function public.assert_prayer_member(uuid) from anon;
grant execute on function public.assert_prayer_member(uuid) to authenticated;

-- ============================================================
-- get_prayer_session_state() -- read-only authoritative resync
-- ============================================================
-- The cheap, side-effect-free "what is true right now" read. This is
-- what the client calls to confirm a mutation actually landed, and to
-- recover after a realtime channel error / timeout / close or a
-- return from the background. It deliberately does NOT create a
-- session and does NOT join dinner content: a resync must never be
-- able to invent tonight's dinner, and must stay light enough to call
-- on every foreground.
create or replace function public.get_prayer_session_state(group_id_input uuid)
returns table(
  session_id uuid,
  verse_date date,
  prayer_order uuid[],
  absent_members uuid[],
  prayed_members uuid[],
  passed_members uuid[],
  prayer_turns_completed int,
  current_prayer_id uuid,
  next_prayer_id uuid,
  all_prayed boolean,
  pending_count int,
  session_exists boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.assert_prayer_member(group_id_input);
  v_row public.group_verse;
  v_state record;
begin
  select gv.* into v_row
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  if v_row.id is null then
    -- No dinner tonight yet. Report that honestly rather than
    -- fabricating one -- only get_or_create_tonight_session() may
    -- create a session.
    return query select
      null::uuid, v_today, '{}'::uuid[], '{}'::uuid[], '{}'::uuid[],
      '{}'::uuid[], 0, null::uuid, null::uuid, false, 0, false;
    return;
  end if;

  select * into v_state
  from public.derive_prayer_state(
    v_row.prayer_order, v_row.absent_members, v_row.prayed_members,
    v_row.passed_members, v_row.rotation_advanced
  );

  return query select
    v_row.id,
    v_row.verse_date,
    v_row.prayer_order,
    v_row.absent_members,
    v_row.prayed_members,
    v_row.passed_members,
    coalesce(array_length(v_row.prayed_members, 1), 0),
    v_state.current_prayer_id,
    v_state.next_prayer_id,
    v_state.all_prayed,
    v_state.pending_count,
    true;
end;
$$;

comment on function public.get_prayer_session_state(uuid) is
  'Read-only authoritative prayer state for tonight''s dinner. Creates '
  'nothing and returns session_exists = false when no dinner row '
  'exists yet. Used by the client to CONFIRM that a mutation actually '
  'landed, and to resync after realtime failure or a return from the '
  'background.';

revoke all on function public.get_prayer_session_state(uuid) from public;
revoke all on function public.get_prayer_session_state(uuid) from anon;
grant execute on function public.get_prayer_session_state(uuid) to authenticated;

-- ============================================================
-- get_or_create_tonight_session() -- + passed_members, frozen roster
-- ============================================================
-- Dropped and re-created because RETURNS TABLE gains passed_members
-- and pending_count. Everything outside the prayer state machine --
-- the auth/membership/archived checks, timezone/date resolution,
-- prayer_order construction and starter rotation, the cycle-aware
-- no-repeat dinner picker, and the final content SELECT -- is
-- reproduced from 20260909000001 (itself extracted from live pg_proc)
-- and is UNCHANGED. The 354-dinner library, no-repeat rotation, and
-- guest behaviour are all untouched by this migration.
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
  passed_members uuid[],
  current_prayer_id uuid,
  next_prayer_id uuid,
  all_prayed boolean,
  pending_count int,
  was_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.assert_prayer_member(group_id_input);
  v_tz text;
  v_picked_verse_id uuid;
  v_next_starter uuid;
  v_prayer_order uuid[];
  v_existing_id uuid;
  v_starter_pos int;
  v_was_created boolean;
  v_current_order uuid[];
  v_current_members uuid[];
  v_missing uuid[];
  v_heal_absent uuid[];
  v_heal_prayed uuid[];
  v_heal_passed uuid[];
  v_has_activity boolean;
  v_final_order uuid[];
  v_final_absent uuid[];
  v_final_prayed uuid[];
  v_final_passed uuid[];
  v_final_rotation_advanced boolean;
  v_state record;
  v_cycle_started_at timestamptz;
begin
  select coalesce(g.timezone, 'America/Chicago') into v_tz
  from public.groups g where g.id = group_id_input;

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

    -- ---- Group-level, cycle-aware no-repeat picker (2026-09-09) ----
    -- Reproduced unchanged. Excludes dinners already shown to THIS
    -- group since its current cycle began, and begins a fresh cycle
    -- in the same call once nothing unseen remains.
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
    -- ---- END picker ----

    if v_picked_verse_id is null then
      raise exception 'No active verses available';
    end if;

    -- absent_members, prayed_members and passed_members deliberately
    -- not set here -- all three default to '{}', so every new dinner
    -- starts with everyone present, nobody having prayed, and nobody
    -- having passed.
    insert into public.group_verse
      (group_id, verse_date, dinner_verse_id, prayer_order, prayer_turns_completed, prayer_tier, timezone_used, rotation_advanced)
    values
      (group_id_input, v_today, v_picked_verse_id, v_prayer_order, 0, 'level_1', v_tz, false)
    on conflict on constraint group_verse_group_id_verse_date_key do nothing
    returning id into v_existing_id;
    v_was_created := v_existing_id is not null;
  else
    -- ROSTER FREEZE (2026-09-12). The old behaviour appended every
    -- group member missing from prayer_order on EVERY load, which
    -- inserted a mid-dinner joiner into a rotation already under way
    -- and let two devices observe two different rosters. Now the
    -- roster only tracks membership while the dinner has had no
    -- activity at all; the first prayer, pass, or absence freezes it.
    select gv.prayer_order, gv.absent_members, gv.prayed_members, gv.passed_members
    into v_current_order, v_heal_absent, v_heal_prayed, v_heal_passed
    from public.group_verse gv
    where gv.id = v_existing_id;

    select coalesce(array_agg(p.id order by p.created_at, p.id), '{}')
    into v_current_members
    from public.profiles p
    where p.group_id = group_id_input;

    v_has_activity :=
      coalesce(array_length(v_heal_prayed, 1), 0) > 0
      or coalesce(array_length(v_heal_passed, 1), 0) > 0
      or coalesce(array_length(v_heal_absent, 1), 0) > 0;

    if not v_has_activity then
      if coalesce(array_length(v_current_order, 1), 0) = 0 then
        -- Structurally empty roster (a row from before prayer_order
        -- existed, or a group that had no members at creation).
        -- Repairing this is not the same as adding a late joiner.
        update public.group_verse
        set prayer_order = v_current_members
        where id = v_existing_id;
      else
        select coalesce(array_agg(m), '{}') into v_missing
        from unnest(v_current_members) as m
        where m <> all(v_current_order);

        if coalesce(array_length(v_missing, 1), 0) > 0 then
          update public.group_verse
          set prayer_order = v_current_order || v_missing
          where id = v_existing_id;
        end if;
      end if;
    end if;
  end if;

  select gv.prayer_order, gv.absent_members, gv.prayed_members,
         gv.passed_members, gv.rotation_advanced
  into v_final_order, v_final_absent, v_final_prayed,
       v_final_passed, v_final_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  select * into v_state
  from public.derive_prayer_state(
    v_final_order, v_final_absent, v_final_prayed,
    v_final_passed, v_final_rotation_advanced
  );

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
    gv.absent_members, gv.prayed_members, gv.passed_members,
    v_state.current_prayer_id,
    v_state.next_prayer_id,
    v_state.all_prayed,
    v_state.pending_count,
    v_was_created
  from public.group_verse gv
  join public.dinner_verses dv on dv.id = gv.dinner_verse_id
  where gv.group_id = group_id_input and gv.verse_date = v_today;
end;
$$;

comment on function public.get_or_create_tonight_session(uuid) is
  'Atomically gets or creates the single canonical group_verse row for '
  'this group and today. Dinner selection excludes anything this group '
  'has already been shown during its current rotation cycle '
  '(group_verse since groups.rotation_cycle_started_at) and '
  'automatically begins a fresh cycle once no unseen active dinner '
  'remains (2026-09-09, unchanged). Returns full dinner content plus '
  'the complete prayer state machine: the frozen roster, all three '
  'identity sets, and the derived current/next turn. Tonight''s roster '
  'is frozen as soon as the dinner has any activity (2026-09-12), so a '
  'member who joins the group mid-dinner is not inserted into a '
  'rotation already under way.';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

-- ============================================================
-- complete_prayer_turn() -- now reports whether it RECORDED anything
-- ============================================================
-- Dropped and re-created: the return shape gains the authoritative
-- member sets and, critically, `recorded`. The old shape made a
-- refused CAS indistinguishable from a successful one, which is what
-- let the UI announce prayers that were never written.
drop function if exists public.complete_prayer_turn(uuid, int);
drop function if exists public.complete_prayer_turn(uuid, uuid);

create function public.complete_prayer_turn(
  group_id_input uuid,
  expected_current_prayer_id uuid
)
returns table(
  prayer_order uuid[],
  absent_members uuid[],
  prayed_members uuid[],
  passed_members uuid[],
  prayer_turns_completed int,
  current_prayer_id uuid,
  next_prayer_id uuid,
  all_prayed boolean,
  pending_count int,
  recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.assert_prayer_member(group_id_input);
  v_order uuid[];
  v_absent uuid[];
  v_prayed uuid[];
  v_passed uuid[];
  v_rotation_advanced boolean;
  v_actual_current uuid;
  v_new_prayed uuid[];
  v_recorded boolean := false;
  v_state record;
begin
  -- FOR UPDATE makes resolve-then-append a serialized critical
  -- section. Two devices completing the same turn at the same instant
  -- now queue rather than both resolving against the same pre-write
  -- snapshot; the loser re-resolves and finds the turn already taken.
  select gv.prayer_order, gv.absent_members, gv.prayed_members,
         gv.passed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_passed, v_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today
  for update;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;
  if coalesce(array_length(v_order, 1), 0) = 0 then
    raise exception 'No members to rotate';
  end if;

  -- Once the night is closed it stays closed. A late tap reports the
  -- truth and mutates nothing.
  if not v_rotation_advanced then
    v_actual_current := public.resolve_current_turn(v_order, v_absent, v_prayed, v_passed);

    if v_actual_current is not null
       and expected_current_prayer_id is not null
       and v_actual_current = expected_current_prayer_id then
      -- The guard is "not already recorded", so a duplicate tap for
      -- the same person can never produce a duplicate entry.
      update public.group_verse gv
      set prayed_members = gv.prayed_members || v_actual_current,
          prayer_turns_completed = coalesce(array_length(gv.prayed_members, 1), 0) + 1
      where gv.group_id = group_id_input
        and gv.verse_date = v_today
        and not (v_actual_current = any(gv.prayed_members))
      returning gv.prayed_members into v_new_prayed;

      v_recorded := v_new_prayed is not null;
    end if;
  end if;

  if v_recorded then
    -- Only a real completion may close the night.
    perform public.close_dinner_if_complete(group_id_input, v_today);
  end if;

  -- Always report the row as it actually stands now, whether or not
  -- this call changed anything.
  select gv.prayer_order, gv.absent_members, gv.prayed_members,
         gv.passed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_passed, v_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  select * into v_state
  from public.derive_prayer_state(v_order, v_absent, v_prayed, v_passed, v_rotation_advanced);

  return query select
    v_order, v_absent, v_prayed, v_passed,
    coalesce(array_length(v_prayed, 1), 0),
    v_state.current_prayer_id, v_state.next_prayer_id,
    v_state.all_prayed, v_state.pending_count,
    v_recorded;
end;
$$;

comment on function public.complete_prayer_turn(uuid, uuid) is
  'Records that expected_current_prayer_id ACTUALLY prayed tonight, if '
  'and only if the server''s own identity-based resolution still '
  'agrees that is who is up. Returns `recorded` (2026-09-12) so the '
  'caller can never mistake a refused or stale CAS for a successful '
  'one -- the defect that let the UI announce prayers that were never '
  'written -- along with the full authoritative state. Idempotent '
  'against duplicate taps. Any member of the table may call this for '
  'whoever''s turn it is.';

revoke all on function public.complete_prayer_turn(uuid, uuid) from public;
revoke all on function public.complete_prayer_turn(uuid, uuid) from anon;
grant execute on function public.complete_prayer_turn(uuid, uuid) to authenticated;

-- ============================================================
-- pass_prayer_turn() -- the current member declines, honestly
-- ============================================================
-- Dropped first so this migration stays safe to re-run (a plain
-- `create function` would fail the second time).
drop function if exists public.pass_prayer_turn(uuid, uuid);

create function public.pass_prayer_turn(
  group_id_input uuid,
  expected_current_prayer_id uuid
)
returns table(
  prayer_order uuid[],
  absent_members uuid[],
  prayed_members uuid[],
  passed_members uuid[],
  prayer_turns_completed int,
  current_prayer_id uuid,
  next_prayer_id uuid,
  all_prayed boolean,
  pending_count int,
  recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.assert_prayer_member(group_id_input);
  v_order uuid[];
  v_absent uuid[];
  v_prayed uuid[];
  v_passed uuid[];
  v_rotation_advanced boolean;
  v_actual_current uuid;
  v_new_passed uuid[];
  v_recorded boolean := false;
  v_state record;
begin
  select gv.prayer_order, gv.absent_members, gv.prayed_members,
         gv.passed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_passed, v_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today
  for update;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;
  if coalesce(array_length(v_order, 1), 0) = 0 then
    raise exception 'No members to rotate';
  end if;

  if not v_rotation_advanced then
    v_actual_current := public.resolve_current_turn(v_order, v_absent, v_prayed, v_passed);

    if v_actual_current is not null
       and expected_current_prayer_id is not null
       and v_actual_current = expected_current_prayer_id then
      update public.group_verse gv
      set passed_members = gv.passed_members || v_actual_current
      where gv.group_id = group_id_input
        and gv.verse_date = v_today
        and not (v_actual_current = any(gv.passed_members))
        and not (v_actual_current = any(gv.prayed_members))
      returning gv.passed_members into v_new_passed;

      v_recorded := v_new_passed is not null;
    end if;
  end if;

  if v_recorded then
    -- A pass is a deliberate act, so it may close the night. An
    -- attendance change still cannot.
    perform public.close_dinner_if_complete(group_id_input, v_today);
  end if;

  select gv.prayer_order, gv.absent_members, gv.prayed_members,
         gv.passed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_passed, v_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  select * into v_state
  from public.derive_prayer_state(v_order, v_absent, v_prayed, v_passed, v_rotation_advanced);

  return query select
    v_order, v_absent, v_prayed, v_passed,
    coalesce(array_length(v_prayed, 1), 0),
    v_state.current_prayer_id, v_state.next_prayer_id,
    v_state.all_prayed, v_state.pending_count,
    v_recorded;
end;
$$;

comment on function public.pass_prayer_turn(uuid, uuid) is
  'Records that the current member is present but has chosen NOT to '
  'pray tonight (2026-09-12), writing passed_members ONLY -- never '
  'prayed_members (which would lie about prayer) and never '
  'absent_members (which would lie about attendance). CAS-guarded on '
  'the resolved current turn and idempotent, exactly like '
  'complete_prayer_turn(), and reports `recorded` the same way. A pass '
  'never counts toward prayer_turns_completed and never forfeits that '
  'member''s place in the starting-person rotation.';

revoke all on function public.pass_prayer_turn(uuid, uuid) from public;
revoke all on function public.pass_prayer_turn(uuid, uuid) from anon;
grant execute on function public.pass_prayer_turn(uuid, uuid) to authenticated;

-- ============================================================
-- set_member_passed() -- explicit toggle, incl. un-pass / restore
-- ============================================================
-- pass_prayer_turn() is the CAS-guarded button for the person whose
-- turn it is. This is the un-guarded toggle used to put a passed
-- member back into the rotation ("actually, I will pray"), and to
-- pass a specific member directly. Writes passed_members ONLY.
-- Dropped first, same re-runnability reason as pass_prayer_turn().
drop function if exists public.set_member_passed(uuid, uuid, boolean);

create function public.set_member_passed(
  group_id_input uuid,
  member_id_input uuid,
  passed boolean
)
returns table(
  prayer_order uuid[],
  absent_members uuid[],
  prayed_members uuid[],
  passed_members uuid[],
  prayer_turns_completed int,
  current_prayer_id uuid,
  next_prayer_id uuid,
  all_prayed boolean,
  pending_count int,
  recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.assert_prayer_member(group_id_input);
  v_order uuid[];
  v_absent uuid[];
  v_prayed uuid[];
  v_passed uuid[];
  v_rotation_advanced boolean;
  v_recorded boolean := false;
  v_state record;
begin
  if not exists (
    select 1 from public.profiles
    where id = member_id_input and group_id = group_id_input
  ) then
    raise exception 'That person is not a member of this table';
  end if;

  -- Atomic, race-safe toggle: the CASE is evaluated against
  -- gv.passed_members as it exists when this UPDATE takes the row
  -- lock, never against a value read earlier -- the same pattern
  -- 20260809000004 established for absent_members. A member who has
  -- already prayed can never be marked passed.
  update public.group_verse gv
  set passed_members = case
    when passed then
      case when member_id_input = any(gv.passed_members)
             or member_id_input = any(gv.prayed_members)
           then gv.passed_members
           else gv.passed_members || member_id_input end
    else
      array_remove(gv.passed_members, member_id_input)
    end
  where gv.group_id = group_id_input and gv.verse_date = v_today
  returning gv.prayer_order, gv.absent_members, gv.prayed_members,
            gv.passed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_passed, v_rotation_advanced;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;

  v_recorded := (member_id_input = any(v_passed)) = passed;

  if passed and v_recorded then
    perform public.close_dinner_if_complete(group_id_input, v_today);

    select gv.prayer_order, gv.absent_members, gv.prayed_members,
           gv.passed_members, gv.rotation_advanced
    into v_order, v_absent, v_prayed, v_passed, v_rotation_advanced
    from public.group_verse gv
    where gv.group_id = group_id_input and gv.verse_date = v_today;
  end if;

  select * into v_state
  from public.derive_prayer_state(v_order, v_absent, v_prayed, v_passed, v_rotation_advanced);

  return query select
    v_order, v_absent, v_prayed, v_passed,
    coalesce(array_length(v_prayed, 1), 0),
    v_state.current_prayer_id, v_state.next_prayer_id,
    v_state.all_prayed, v_state.pending_count,
    v_recorded;
end;
$$;

comment on function public.set_member_passed(uuid, uuid, boolean) is
  'Explicit passed_members toggle for a specific member (2026-09-12). '
  'passed = false is how a member who passed is put back into '
  'tonight''s rotation -- they reclaim their exact original position, '
  'because eligibility is resolved by identity and prayer_order is '
  'never rewritten. Cannot mark an already-prayed member as passed. '
  'Writes passed_members ONLY.';

revoke all on function public.set_member_passed(uuid, uuid, boolean) from public;
revoke all on function public.set_member_passed(uuid, uuid, boolean) from anon;
grant execute on function public.set_member_passed(uuid, uuid, boolean) to authenticated;

-- ============================================================
-- set_member_absent() -- unchanged semantics, fuller return
-- ============================================================
-- Dropped and re-created only because the return shape now matches
-- every other prayer RPC. The atomic single-UPDATE toggle from
-- 20260809000004 is reproduced exactly, and this function still
-- writes absent_members ONLY -- it can never complete a night,
-- consume a rotation turn, or reopen one.
drop function if exists public.set_member_absent(uuid, uuid, boolean);

create function public.set_member_absent(
  group_id_input uuid,
  member_id_input uuid,
  absent boolean
)
returns table(
  prayer_order uuid[],
  absent_members uuid[],
  prayed_members uuid[],
  passed_members uuid[],
  prayer_turns_completed int,
  current_prayer_id uuid,
  next_prayer_id uuid,
  all_prayed boolean,
  pending_count int,
  recorded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.assert_prayer_member(group_id_input);
  v_order uuid[];
  v_absent uuid[];
  v_prayed uuid[];
  v_passed uuid[];
  v_rotation_advanced boolean;
  v_recorded boolean;
  v_state record;
begin
  if not exists (
    select 1 from public.profiles
    where id = member_id_input and group_id = group_id_input
  ) then
    raise exception 'That person is not a member of this table';
  end if;

  update public.group_verse gv
  set absent_members = case
    when absent then
      case when member_id_input = any(gv.absent_members) then gv.absent_members
           else gv.absent_members || member_id_input end
    else
      array_remove(gv.absent_members, member_id_input)
    end
  where gv.group_id = group_id_input and gv.verse_date = v_today
  returning gv.prayer_order, gv.absent_members, gv.prayed_members,
            gv.passed_members, gv.rotation_advanced
  into v_order, v_absent, v_prayed, v_passed, v_rotation_advanced;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;

  v_recorded := (member_id_input = any(v_absent)) = absent;

  -- Deliberately does NOT call close_dinner_if_complete(), and does
  -- NOT touch prayed_members, passed_members, prayer_turns_completed,
  -- rotation_advanced or groups.next_prayer_user_id under any
  -- circumstance. Attendance alone can never complete a night.
  select * into v_state
  from public.derive_prayer_state(v_order, v_absent, v_prayed, v_passed, v_rotation_advanced);

  return query select
    v_order, v_absent, v_prayed, v_passed,
    coalesce(array_length(v_prayed, 1), 0),
    v_state.current_prayer_id, v_state.next_prayer_id,
    v_state.all_prayed, v_state.pending_count,
    v_recorded;
end;
$$;

comment on function public.set_member_absent(uuid, uuid, boolean) is
  'Marks a member Present or Not Here for TONIGHT only -- writes '
  'group_verse.absent_members ONLY, never prayer_order, '
  'prayed_members, passed_members, prayer_turns_completed, '
  'rotation_advanced or groups.next_prayer_user_id. The toggle is a '
  'single atomic UPDATE against the row''s own current value '
  '(20260809000004), immune to the lost-update race between two '
  'devices. A member marked present again reclaims their exact spot '
  'if the table has not prayed past it, and reopens nothing once the '
  'night is closed.';

revoke all on function public.set_member_absent(uuid, uuid, boolean) from public;
revoke all on function public.set_member_absent(uuid, uuid, boolean) from anon;
grant execute on function public.set_member_absent(uuid, uuid, boolean) to authenticated;

-- ============================================================
-- reconcile_current_prayer_session() -- + passed_members
-- ============================================================
-- Unchanged in purpose (keep the live roster aligned with real
-- membership so a departed member can never strand the rotation on a
-- person the client cannot even name). Updated to filter the new
-- passed_members set and to close a completed night through the shared
-- gate rather than its own copy of that logic.
create or replace function public.reconcile_current_prayer_session(group_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_session_id uuid;
  v_order uuid[];
  v_absent uuid[];
  v_prayed uuid[];
  v_passed uuid[];
  v_rotation_advanced boolean;
  v_members uuid[];
  v_retained uuid[];
  v_missing uuid[];
  v_new_order uuid[];
  v_new_absent uuid[];
  v_new_prayed uuid[];
  v_new_passed uuid[];
  v_has_activity boolean;
begin
  select coalesce(g.timezone, 'America/Chicago')
  into v_tz
  from public.groups g
  where g.id = group_id_input and g.archived_at is null;

  if v_tz is null then
    return;
  end if;

  select coalesce(array_agg(p.id order by p.created_at, p.id), '{}'::uuid[])
  into v_members
  from public.profiles p
  where p.group_id = group_id_input;

  v_today := public.canonical_dinner_date(v_tz);

  select gv.id, gv.prayer_order, gv.absent_members, gv.prayed_members,
         gv.passed_members, gv.rotation_advanced
  into v_session_id, v_order, v_absent, v_prayed, v_passed, v_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today
  for update;

  -- No dinner yet, or the dinner already finished: there is no live
  -- rotation to reconcile. Never rewrite a completed historical row.
  if v_session_id is null or v_rotation_advanced then
    -- A future starter who is no longer a member must never be carried
    -- into the next dinner.
    update public.groups g
    set next_prayer_user_id = case
      when coalesce(array_length(v_members, 1), 0) = 0 then null
      else v_members[1]
    end
    where g.id = group_id_input
      and g.next_prayer_user_id is not null
      and not (g.next_prayer_user_id = any(v_members));

    return;
  end if;

  v_order := coalesce(v_order, '{}'::uuid[]);
  v_absent := coalesce(v_absent, '{}'::uuid[]);
  v_prayed := coalesce(v_prayed, '{}'::uuid[]);
  v_passed := coalesce(v_passed, '{}'::uuid[]);

  v_has_activity :=
    coalesce(array_length(v_prayed, 1), 0) > 0
    or coalesce(array_length(v_passed, 1), 0) > 0
    or coalesce(array_length(v_absent, 1), 0) > 0;

  -- Retain the established relative order for members still here.
  select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
  into v_retained
  from unnest(v_order) with ordinality as u(member_id, ordinality)
  where u.member_id = any(v_members);

  -- Appending genuinely new members is only correct while the dinner
  -- has not started. Once it has, the roster is frozen and a new
  -- member joins tomorrow's rotation instead (2026-09-12).
  if v_has_activity then
    v_missing := '{}'::uuid[];
  else
    select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
    into v_missing
    from unnest(v_members) with ordinality as u(member_id, ordinality)
    where not (u.member_id = any(v_retained));
  end if;

  v_new_order := v_retained || v_missing;

  select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
  into v_new_absent
  from unnest(v_absent) with ordinality as u(member_id, ordinality)
  where u.member_id = any(v_members);

  select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
  into v_new_prayed
  from unnest(v_prayed) with ordinality as u(member_id, ordinality)
  where u.member_id = any(v_members);

  select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
  into v_new_passed
  from unnest(v_passed) with ordinality as u(member_id, ordinality)
  where u.member_id = any(v_members);

  update public.group_verse gv
  set prayer_order = v_new_order,
      absent_members = v_new_absent,
      prayed_members = v_new_prayed,
      passed_members = v_new_passed,
      prayer_turns_completed = coalesce(array_length(v_new_prayed, 1), 0)
  where gv.id = v_session_id;

  -- Keep lock order consistent with complete_prayer_turn(): the live
  -- group_verse row is locked/updated before the groups row, which
  -- avoids a deadlock during a simultaneous member removal and prayer
  -- completion.
  update public.groups g
  set next_prayer_user_id = case
    when coalesce(array_length(v_members, 1), 0) = 0 then null
    else v_members[1]
  end
  where g.id = group_id_input
    and g.next_prayer_user_id is not null
    and not (g.next_prayer_user_id = any(v_members));

  -- Removing the last outstanding member after at least one real
  -- prayer or pass finishes the dinner. The shared gate enforces the
  -- "somebody actually prayed or passed" condition, so a membership
  -- change alone can still never consume a night.
  perform public.close_dinner_if_complete(group_id_input, v_today);
end;
$$;

comment on function public.reconcile_current_prayer_session(uuid) is
  'Internal trigger helper that keeps the current unfinished dinner''s '
  'prayer_order and its three identity sets aligned with real group '
  'membership. Removes departed members immediately (a departed member '
  'left in place strands the rotation on a person the client cannot '
  'name). Appends new members ONLY while the dinner has had no '
  'activity -- once it has, tonight''s roster is frozen (2026-09-12). '
  'Never rewrites a completed dinner. Not executable by app roles.';

revoke all on function public.reconcile_current_prayer_session(uuid) from public;
revoke all on function public.reconcile_current_prayer_session(uuid) from anon;
revoke all on function public.reconcile_current_prayer_session(uuid) from authenticated;

-- The AFTER UPDATE trigger on profiles.group_id from 20260910000001 is
-- unchanged and still points at reconcile_prayer_rotation_on_group_change(),
-- which calls the function replaced above. Nothing to re-create here.

-- ============================================================
-- Repair pass: align any live unfinished dinner with the new gate
-- ============================================================
-- Idempotent, and touches neither completed dinners nor any dinner
-- content. This is what clears a currently-stuck rotation in
-- production at apply time.
do $$
declare
  v_group_id uuid;
begin
  for v_group_id in
    select g.id from public.groups g where g.archived_at is null
  loop
    perform public.reconcile_current_prayer_session(v_group_id);
  end loop;
end;
$$;

commit;

-- ============================================================
-- VERIFICATION (run after applying)
-- ============================================================
-- 1. passed_members exists on group_verse and defaults to '{}':
--      select column_name, column_default, is_nullable
--      from information_schema.columns
--      where table_name = 'group_verse' and column_name = 'passed_members';
-- 2. All seven prayer functions exist with the expected signatures:
--      select p.proname, pg_get_function_identity_arguments(p.oid)
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('resolve_current_turn','derive_prayer_state',
--          'close_dinner_if_complete','assert_prayer_member',
--          'get_prayer_session_state','get_or_create_tonight_session',
--          'complete_prayer_turn','pass_prayer_turn','set_member_passed',
--          'set_member_absent')
--      order by p.proname;
-- 3. No completed dinner was rewritten by the repair pass:
--      select count(*) from public.group_verse
--      where rotation_advanced = true
--        and prayer_turns_completed <> coalesce(array_length(prayed_members,1),0);
--    Must be 0.
-- 4. No live dinner has an unnameable member stranded in its roster:
--      select gv.id, gv.group_id
--      from public.group_verse gv
--      where gv.rotation_advanced = false
--        and exists (
--          select 1 from unnest(gv.prayer_order) as m
--          where m not in (select id from public.profiles where group_id = gv.group_id)
--        );
--    Must be empty.

