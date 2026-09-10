-- Dinner with Jesus — keep prayer rotation aligned with live membership
-- Date: 2026-09-10
--
-- WHY
-- prayer_order is a nightly UUID snapshot. The existing self-heal path
-- appends newly joined members, but deliberately never removes members
-- who leave the group. After an owner removes somebody, that departed
-- UUID can therefore remain current/next for the rest of the night.
-- The client no longer has a profile/name for it, so it renders as
-- "Someone" and the family must complete a phantom prayer turn.
--
-- THE FIX
-- Reconcile the current, unfinished dinner whenever profiles.group_id
-- changes. Preserve the established order of members still at the
-- table, append genuinely new members, and remove departed members
-- from prayer/attendance state. The update happens in the same database
-- transaction as join/leave/remove, so Realtime receives the corrected
-- group_verse row immediately. Completed dinners remain historical and
-- are never reopened or rewritten.

begin;

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

  -- No dinner yet, or the dinner already finished: there is no live
  -- rotation to reconcile. Never rewrite a completed historical row.
  if v_session_id is null or v_rotation_advanced then
    -- A future starter who is no longer a member must never be carried
    -- into the next dinner. The first remaining member is the safest
    -- deterministic fallback.
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

  -- Retain the established relative order for current members.
  select coalesce(array_agg(u.member_id order by u.ordinality), '{}'::uuid[])
  into v_retained
  from unnest(v_order) with ordinality as u(member_id, ordinality)
  where u.member_id = any(v_members);

  -- Append members who joined after tonight's row was created.
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

  -- Keep lock order consistent with complete_prayer_turn(): the live
  -- group_verse row is locked/updated before the groups row. This
  -- avoids a group -> session / session -> group deadlock during a
  -- simultaneous member removal and prayer completion.
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

  -- A permanent membership change may remove the final outstanding
  -- person after at least one real prayer. Close the dinner just as
  -- complete_prayer_turn() would; a membership change alone with zero
  -- prayers can never consume the nightly rotation.
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

comment on function public.reconcile_current_prayer_session(uuid) is
  'Internal trigger helper that keeps the current unfinished dinner''s '
  'prayer_order, absent_members, and prayed_members aligned with current '
  'group membership. Preserves the order of remaining members, appends '
  'new members, removes departed members, and never rewrites a completed '
  'dinner. Not executable by app roles directly.';

revoke all on function public.reconcile_current_prayer_session(uuid) from public;
revoke all on function public.reconcile_current_prayer_session(uuid) from anon;
revoke all on function public.reconcile_current_prayer_session(uuid) from authenticated;

create or replace function public.reconcile_prayer_rotation_on_group_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.group_id is not null and old.group_id is distinct from new.group_id then
    perform public.reconcile_current_prayer_session(old.group_id);
  end if;

  if new.group_id is not null and new.group_id is distinct from old.group_id then
    perform public.reconcile_current_prayer_session(new.group_id);
  end if;

  return new;
end;
$$;

comment on function public.reconcile_prayer_rotation_on_group_change() is
  'AFTER UPDATE trigger entry point for profiles.group_id changes. '
  'Reconciles both the group a member left and the group they joined.';

revoke all on function public.reconcile_prayer_rotation_on_group_change() from public;
revoke all on function public.reconcile_prayer_rotation_on_group_change() from anon;
revoke all on function public.reconcile_prayer_rotation_on_group_change() from authenticated;

drop trigger if exists reconcile_prayer_rotation_membership on public.profiles;
create trigger reconcile_prayer_rotation_membership
after update of group_id on public.profiles
for each row
when (old.group_id is distinct from new.group_id)
execute function public.reconcile_prayer_rotation_on_group_change();

-- Repair any current unfinished sessions that already contain a stale
-- departed member from before this trigger existed. This is idempotent
-- and touches neither completed dinners nor dinner content.
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

-- VERIFICATION
-- 1. Remove a member from a group with an unfinished current dinner.
--    The removed UUID must disappear immediately from prayer_order,
--    absent_members, prayed_members, current_prayer_id, and next_prayer_id.
-- 2. Join a member to a group with an unfinished current dinner. Their
--    UUID must be appended once to prayer_order without changing the
--    established order of existing members.
-- 3. Completed rows (rotation_advanced = true) must remain byte-identical.
-- 4. A membership change with zero real prayers must not set
--    rotation_advanced or advance groups.next_prayer_user_id.
