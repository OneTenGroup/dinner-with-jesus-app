-- ROLLBACK for 20260912000001_prayer_state_machine_hardening.sql
-- Date: 2026-09-12
--
-- This directory is NOT part of the migration sequence. The Supabase
-- CLI only applies supabase/migrations/*.sql, so nothing in here runs
-- automatically. Apply it by hand, deliberately, only if the hardened
-- prayer state machine has to be withdrawn.
--
-- ============================================================
-- WHAT THIS RESTORES
-- ============================================================
-- Restores get_or_create_tonight_session(), complete_prayer_turn(),
-- set_member_absent(), resolve_current_turn() and
-- reconcile_current_prayer_session() to their 2026-09-10 state (the
-- combination of 20260909000001 + 20260809000003/4 + 20260910000001),
-- and drops the functions introduced on 2026-09-12.
--
-- ============================================================
-- READ THIS BEFORE RUNNING
-- ============================================================
-- 1. DEPLOY THE OLD CLIENT FIRST. The 2026-09-12 client calls
--    get_prayer_session_state() and pass_prayer_turn() and reads
--    `recorded`. Dropping those while that client is live breaks
--    prayer for every user. Roll the frontend back, confirm it is
--    serving, and only then run this.
--
-- 2. passed_members IS DELIBERATELY NOT DROPPED. Dropping it destroys
--    real family data (who chose not to pray) and cannot be undone.
--    The restored functions simply ignore the column, which is inert
--    and harmless. Any member who had PASSED tonight becomes PENDING
--    again under the old resolver and will be offered a turn once
--    more -- the least-bad behaviour available, and the reason to
--    roll back between dinners rather than during one.
--    If the column must eventually go, do it as a separate, reviewed
--    migration once no client reads it:
--      alter table public.group_verse drop column passed_members;
--
-- 3. The old three-set resolve_current_turn(uuid[],uuid[],uuid[]) is
--    restored as the real implementation, so the 4-argument overload
--    must be dropped first (otherwise the 3-argument wrapper would
--    recurse into a function this script is about to remove).
--
-- 4. Re-verify afterward with the queries at the bottom.

begin;

-- ------------------------------------------------------------
-- 1. Restore the original three-set resolver
-- ------------------------------------------------------------
-- Dropped first: the 2026-09-12 3-arg version is a wrapper that
-- delegates to the 4-arg form, and the 4-arg form is going away.
drop function if exists public.resolve_current_turn(uuid[], uuid[], uuid[]);
drop function if exists public.resolve_current_turn(uuid[], uuid[], uuid[], uuid[]);

create function public.resolve_current_turn(
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

revoke all on function public.resolve_current_turn(uuid[], uuid[], uuid[]) from public;
revoke all on function public.resolve_current_turn(uuid[], uuid[], uuid[]) from anon;
grant execute on function public.resolve_current_turn(uuid[], uuid[], uuid[]) to authenticated;

-- ------------------------------------------------------------
-- 2. Restore get_or_create_tonight_session() (20260909000001)
-- ------------------------------------------------------------
drop function if exists public.get_or_create_tonight_session(uuid);

create function public.get_or_create_tonight_session(group_id_input uuid)
returns table(
  session_id uuid, verse_date date, dinner_verse_id uuid, verse_ref text,
  category text, verse_text text, context_text text, question_level_1 text,
  question_level_2 text, question_level_3 text, prayer_text text,
  prayer_order uuid[], prayer_turns_completed integer, absent_members uuid[],
  prayed_members uuid[], current_prayer_id uuid, next_prayer_id uuid,
  all_prayed boolean, was_created boolean
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

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Restore complete_prayer_turn() (20260809000003)
-- ------------------------------------------------------------
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

  if v_rotation_advanced then
    v_new_prayed := v_prayed;
  else
    v_actual_current := public.resolve_current_turn(v_order, v_absent, v_prayed);

    if v_actual_current is null or expected_current_prayer_id is null
       or v_actual_current <> expected_current_prayer_id then
      v_new_prayed := v_prayed;
    else
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

revoke all on function public.complete_prayer_turn(uuid, uuid) from public;
revoke all on function public.complete_prayer_turn(uuid, uuid) from anon;
grant execute on function public.complete_prayer_turn(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. Restore set_member_absent() (20260809000004)
-- ------------------------------------------------------------
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

revoke all on function public.set_member_absent(uuid, uuid, boolean) from public;
revoke all on function public.set_member_absent(uuid, uuid, boolean) from anon;
grant execute on function public.set_member_absent(uuid, uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 5. Restore reconcile_current_prayer_session() (20260910000001)
-- ------------------------------------------------------------
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
  v_rotation_advanced boolean;
  v_members uuid[];
  v_retained uuid[];
  v_missing uuid[];
  v_new_order uuid[];
  v_new_absent uuid[];
  v_new_prayed uuid[];
  v_current uuid;
  v_member_count int;
  v_next_starter uuid;
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

  select gv.id, gv.prayer_order, gv.absent_members, gv.prayed_members, gv.rotation_advanced
  into v_session_id, v_order, v_absent, v_prayed, v_rotation_advanced
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today
  for update;

  if v_session_id is null or v_rotation_advanced then
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

  select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
  into v_retained
  from unnest(v_order) with ordinality as u(member_id, ordinality)
  where u.member_id = any(v_members);

  select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
  into v_missing
  from unnest(v_members) with ordinality as u(member_id, ordinality)
  where not (u.member_id = any(v_retained));

  v_new_order := v_retained || v_missing;

  select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
  into v_new_absent
  from unnest(v_absent) with ordinality as u(member_id, ordinality)
  where u.member_id = any(v_members);

  select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
  into v_new_prayed
  from unnest(v_prayed) with ordinality as u(member_id, ordinality)
  where u.member_id = any(v_members);

  update public.group_verse gv
  set prayer_order = v_new_order,
      absent_members = v_new_absent,
      prayed_members = v_new_prayed,
      prayer_turns_completed = coalesce(array_length(v_new_prayed, 1), 0)
  where gv.id = v_session_id;

  update public.groups g
  set next_prayer_user_id = case
    when coalesce(array_length(v_members, 1), 0) = 0 then null
    else v_members[1]
  end
  where g.id = group_id_input
    and g.next_prayer_user_id is not null
    and not (g.next_prayer_user_id = any(v_members));

  v_member_count := coalesce(array_length(v_new_order, 1), 0);
  v_current := public.resolve_current_turn(v_new_order, v_new_absent, v_new_prayed);

  if v_member_count > 0
     and v_current is null
     and coalesce(array_length(v_new_prayed, 1), 0) > 0 then
    update public.group_verse gv
    set rotation_advanced = true
    where gv.id = v_session_id and gv.rotation_advanced = false;

    v_next_starter := case
      when v_member_count = 1 then v_new_order[1]
      else v_new_order[2]
    end;

    update public.groups g
    set next_prayer_user_id = v_next_starter
    where g.id = group_id_input;
  end if;
end;
$$;

revoke all on function public.reconcile_current_prayer_session(uuid) from public;
revoke all on function public.reconcile_current_prayer_session(uuid) from anon;
revoke all on function public.reconcile_current_prayer_session(uuid) from authenticated;

-- ------------------------------------------------------------
-- 6. Drop the 2026-09-12 additions
-- ------------------------------------------------------------
-- Dropped last, so nothing restored above is ever momentarily
-- pointing at a function that no longer exists.
drop function if exists public.get_prayer_session_state(uuid);
drop function if exists public.pass_prayer_turn(uuid, uuid);
drop function if exists public.set_member_passed(uuid, uuid, boolean);
drop function if exists public.close_dinner_if_complete(uuid, date);
drop function if exists public.derive_prayer_state(uuid[], uuid[], uuid[], uuid[], boolean);
drop function if exists public.assert_prayer_member(uuid);

-- group_verse.passed_members is intentionally left in place -- see
-- note 2 in the header. It is inert once the functions above are gone.

commit;

-- ============================================================
-- POST-ROLLBACK VERIFICATION
-- ============================================================
-- 1. The 2026-09-12 functions are gone:
--      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('get_prayer_session_state','pass_prayer_turn',
--          'set_member_passed','close_dinner_if_complete',
--          'derive_prayer_state','assert_prayer_member');
--    Must be empty.
-- 2. The restored signatures are back:
--      select p.proname, pg_get_function_identity_arguments(p.oid),
--             pg_get_function_result(p.oid)
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('resolve_current_turn','complete_prayer_turn',
--          'set_member_absent','get_or_create_tonight_session')
--      order by p.proname;
--    resolve_current_turn must appear ONCE, with three arguments.
-- 3. Walk one real dinner end to end in the rolled-back client before
--    calling the rollback done.
