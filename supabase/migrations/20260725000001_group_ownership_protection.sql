-- Dinner with Jesus — group ownership protection
-- Date: 2026-07-25
-- Status: NOT YET APPLIED. Revised before first application (see
-- REVISION note below) -- safe to edit in place since no version of
-- this file has ever been applied to any database.
--
-- WHAT THIS FIXES
-- useFamily.js's leaveGroup() previously did a plain client-side
-- `profiles.update({ group_id: null })`, permitted by the existing
-- profiles_update_own RLS policy regardless of role. Nothing prevented
-- a group's owner from leaving -- a sole owner leaving orphans the
-- table (groups.owner_id still points at someone no longer a member,
-- and nobody else can manage it); an owner of a multi-member table
-- leaving does the same to everyone left behind, with no ownership
-- transfer ever happening.
--
-- THIS MIGRATION ADDS THREE RPCs, replacing the client's direct
-- profiles.group_id write for leaving:
--   1. leave_group() -- blocks the owner from leaving at all. A
--      multi-member owner is told to transfer ownership first; a sole
--      owner is told to delete/archive the table instead. A
--      non-owner leaves exactly as before.
--   2. transfer_group_ownership(group_id, new_owner_id) -- lets the
--      current owner hand ownership to another current member.
--   3. delete_group(group_id) -- lets a SOLE owner (no other members)
--      remove themselves and retire the table. See REVISION below for
--      how this actually works.
--
-- ============================================================
-- REVISION (same day, before first application): archival, not
-- best-effort hard delete
-- ============================================================
-- The first draft of delete_group() attempted a real `delete from
-- groups`, catching foreign_key_violation and swallowing it if
-- historical group_verse/notes rows blocked the delete -- but still
-- unconditionally returned true either way. That is a real correctness
-- bug: on the swallowed-exception path, owner_id and invite_code are
-- left completely untouched, so the table remains fully live and
-- joinable with its original owner while the UI falsely reports
-- successful deletion. Caught in review before this file was ever
-- applied to any database -- no production impact, but the original
-- approach is replaced entirely rather than patched, per the "return
-- success only after the operation actually succeeds" requirement.
--
-- delete_group() now does deterministic archival instead:
--   1. groups gets a new nullable archived_at timestamptz column.
--   2. The caller must be the sole member and current owner (same
--      guard as before).
--   3. The invite_code is rotated to a fresh, never-shared value and
--      archived_at is set to now() in ONE update statement, checked
--      via `returning archived_at into ...` -- if that update somehow
--      doesn't apply, the function raises an exception rather than
--      returning true. Only after this is confirmed does the caller's
--      own profiles.group_id get cleared.
--   4. Every RPC that can join a table, create a dinner session, or
--      look up a table by invite code (join_group_by_invite_code,
--      get_guest_table_by_invite_code, get_or_create_tonight_session,
--      complete_prayer_turn, transfer_group_ownership) is re-created
--      here to also reject any group with archived_at is not null --
--      belt-and-suspenders alongside the rotated invite_code, in case
--      any future code path reaches a group by id rather than by
--      code.
--   5. group_verse, notes, and verse_history rows are never touched by
--      any of this -- historical content is preserved exactly as it
--      was, permanently, whether or not the table is later archived.
--   6. auth.users and every other profiles column are never touched --
--      the account and personal settings survive archival completely
--      intact. Archiving a table only ever changes the groups row
--      itself and the (ex-)owner's own profiles.group_id.
--
-- SAFE TO RE-RUN: create or replace function is idempotent, same as
-- every other function in this migration package; `add column if not
-- exists` is idempotent. Forward-only -- no rollback script, matching
-- this migration package's established convention.

begin;

-- ============================================================
-- groups.archived_at
-- ============================================================
alter table public.groups
  add column if not exists archived_at timestamptz;

comment on column public.groups.archived_at is
  'Set once, by delete_group(), when a sole owner retires their table. '
  'A non-null value means this group is permanently inactive: it can '
  'no longer be joined, looked up by invite code, or used to create a '
  'new dinner session -- enforced by every relevant RPC, not just by '
  'client behavior. Historical group_verse/notes/verse_history rows '
  'that reference an archived group are never touched and remain '
  'fully readable.';

-- ============================================================
-- leave_group()
-- ============================================================
create or replace function public.leave_group()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_owner_id uuid;
  v_member_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id into v_group_id from public.profiles where id = v_uid;
  if v_group_id is null then
    raise exception 'You are not in a table';
  end if;

  select owner_id into v_owner_id from public.groups where id = v_group_id;

  if v_owner_id = v_uid then
    select count(*) into v_member_count from public.profiles where group_id = v_group_id;
    if v_member_count > 1 then
      raise exception 'Transfer ownership to another member before leaving this table.';
    else
      raise exception 'You are the only person at this table. Delete the table instead of leaving.';
    end if;
  end if;

  update public.profiles set group_id = null where id = v_uid;
  return true;
end;
$$;

comment on function public.leave_group() is
  'Removes the caller from their current group. Refuses if the caller '
  'is the owner -- a multi-member owner must transfer_group_ownership() '
  'first, a sole owner must delete_group() instead. Prevents orphaning '
  'a table by simply leaving it.';

revoke all on function public.leave_group() from public;
revoke all on function public.leave_group() from anon;
grant execute on function public.leave_group() to authenticated;

-- ============================================================
-- transfer_group_ownership()
-- ============================================================
create or replace function public.transfer_group_ownership(group_id_input uuid, new_owner_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_archived timestamptz;
  v_target_group uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id, archived_at into v_owner_id, v_archived from public.groups where id = group_id_input;
  if v_owner_id is null then
    raise exception 'Table not found';
  end if;
  if v_archived is not null then
    raise exception 'This table has been deleted';
  end if;
  if v_owner_id is distinct from v_uid then
    raise exception 'Only the current owner can transfer ownership';
  end if;
  if new_owner_id = v_uid then
    raise exception 'Already the owner';
  end if;

  select group_id into v_target_group from public.profiles where id = new_owner_id;
  if v_target_group is distinct from group_id_input then
    raise exception 'That person is not a member of this table';
  end if;

  update public.groups set owner_id = new_owner_id where id = group_id_input;
  return true;
end;
$$;

comment on function public.transfer_group_ownership(uuid, uuid) is
  'Lets the current owner of group_id_input hand ownership to another '
  'current member (new_owner_id). Verifies the caller is the existing '
  'owner, the group is not archived, and the target is an actual '
  'current member before touching groups.owner_id.';

revoke all on function public.transfer_group_ownership(uuid, uuid) from public;
revoke all on function public.transfer_group_ownership(uuid, uuid) from anon;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;

-- ============================================================
-- delete_group() -- deterministic archival
-- ============================================================
create or replace function public.delete_group(group_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_archived timestamptz;
  v_member_count int;
  v_confirmed_archived_at timestamptz;
  v_new_code text := '';
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id, archived_at into v_owner_id, v_archived from public.groups where id = group_id_input;
  if v_owner_id is null then
    raise exception 'Table not found';
  end if;
  if v_archived is not null then
    raise exception 'This table has already been deleted';
  end if;
  if v_owner_id is distinct from v_uid then
    raise exception 'Only the table owner can delete it';
  end if;

  select count(*) into v_member_count from public.profiles where group_id = group_id_input;
  if v_member_count > 1 then
    raise exception 'Transfer ownership or remove other members before deleting this table';
  end if;

  -- Rotate the invite code to a fresh, never-shared value in the same
  -- statement that sets archived_at -- belt-and-suspenders alongside
  -- every join/session RPC below also checking archived_at directly,
  -- in case a future code path ever looks a group up by id rather
  -- than by code. Collision odds are the same 32^6 keyspace already
  -- accepted by every other invite-code generator in this codebase
  -- (see the INVITE-CODE ENTROPY NOTE in
  -- 20260714000001_security_primitives.sql) -- not newly introduced
  -- here, not worsened by this change.
  for i in 1..6 loop
    v_new_code := v_new_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  end loop;

  update public.groups
  set archived_at = now(),
      invite_code = v_new_code
  where id = group_id_input and archived_at is null
  returning archived_at into v_confirmed_archived_at;

  -- Only report success, and only detach the caller, once the archive
  -- write is actually confirmed -- never on an assumed or best-effort
  -- basis. group_verse, notes, and verse_history rows referencing this
  -- group are completely untouched by this function; the table's
  -- history is permanent regardless of archival.
  if v_confirmed_archived_at is null then
    raise exception 'Could not archive this table -- please try again';
  end if;

  update public.profiles set group_id = null where id = v_uid and group_id = group_id_input;

  return true;
end;
$$;

comment on function public.delete_group(uuid) is
  'Lets a SOLE owner (no other members) permanently archive their '
  'table: rotates invite_code and sets archived_at in one confirmed '
  'update, then clears the caller''s own group_id -- only after the '
  'archive write is verified to have actually applied. Never deletes '
  'group_verse/notes/verse_history rows, never touches auth.users or '
  'any other profiles column. An archived group can never be '
  'rejoined, looked up by its (now-rotated) invite code, or used to '
  'create a new dinner session -- see join_group_by_invite_code(), '
  'get_guest_table_by_invite_code(), get_or_create_tonight_session(), '
  'and complete_prayer_turn() below, all re-created to check '
  'archived_at is null.';

revoke all on function public.delete_group(uuid) from public;
revoke all on function public.delete_group(uuid) from anon;
grant execute on function public.delete_group(uuid) to authenticated;

-- ============================================================
-- join_group_by_invite_code() -- reject archived groups
-- ============================================================
-- Originally defined in 20260714000001_security_primitives.sql
-- (already applied to production). Re-created here, forward-repair
-- style, adding only the archived_at check -- every other line is
-- unchanged from the live version.
create or replace function public.join_group_by_invite_code(invite_code_input text)
returns table(group_id uuid, group_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_group_id uuid;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_code := upper(trim(invite_code_input));
  if v_code !~ '^[A-Z0-9]{6}$' then
    raise exception 'Invalid invite code';
  end if;

  select g.id, g.name into v_group_id, v_group_name
  from public.groups g
  where g.invite_code = v_code
    and g.archived_at is null;

  if v_group_id is null then
    raise exception 'Invite code not found';
  end if;

  update public.profiles
  set group_id = v_group_id
  where id = v_uid;

  return query select v_group_id, v_group_name;
end;
$$;

comment on function public.join_group_by_invite_code(text) is
  'Looks up a group by exact invite code and joins the calling user to '
  'it. Excludes archived groups -- an archived table''s old invite code '
  'is also rotated away, so this is a second, independent guard, not '
  'the only one. Same "not found" message either way, no enumeration '
  'hint about whether a code is unknown, malformed, or archived.';

revoke all on function public.join_group_by_invite_code(text) from public;
revoke all on function public.join_group_by_invite_code(text) from anon;
grant execute on function public.join_group_by_invite_code(text) to authenticated;

-- ============================================================
-- get_guest_table_by_invite_code() -- reject archived groups
-- ============================================================
-- Superseding version lives in 20260714000004_shared_dinner_session.sql
-- (already applied). Re-created here, adding only the archived_at
-- check -- every other line (timezone/4am-cutoff/prayer_tier
-- resolution) is unchanged from the live version.
create or replace function public.get_guest_table_by_invite_code(invite_code_input text)
returns table(
  group_name text,
  verse_ref text,
  category text,
  verse_text text,
  context_text text,
  question_level_1 text,
  question_level_2 text,
  prayer_level_1 text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_code text;
  v_group_id uuid;
  v_group_name text;
  v_tz text;
  v_today date;
  v_dinner_verse_id uuid;
  v_prayer_tier text;
begin
  v_code := upper(trim(invite_code_input));
  if v_code !~ '^[A-Z0-9]{6}$' then
    return; -- zero rows: malformed code treated identically to "not found"
  end if;

  select g.id, g.name, g.timezone into v_group_id, v_group_name, v_tz
  from public.groups g
  where g.invite_code = v_code
    and g.archived_at is null;

  if v_group_id is null then
    return; -- zero rows: no such code (unknown, malformed, or archived)
  end if;

  v_tz := coalesce(v_tz, 'America/Chicago');
  v_today := public.canonical_dinner_date(v_tz);

  select gv.dinner_verse_id, gv.prayer_tier into v_dinner_verse_id, v_prayer_tier
  from public.group_verse gv
  where gv.group_id = v_group_id
    and gv.verse_date = v_today;

  if v_dinner_verse_id is null then
    return query select v_group_name, null::text, null::text, null::text,
                        null::text, null::text, null::text, null::text;
    return;
  end if;

  return query
  select v_group_name, dv.verse_ref, dv.category, dv.verse_text, dv.context_text,
         dv.question_level_1, dv.question_level_2,
         case coalesce(v_prayer_tier, 'level_1')
           when 'level_3' then coalesce(dv.prayer_level_3, dv.prayer_level_1)
           when 'level_2' then coalesce(dv.prayer_level_2, dv.prayer_level_1)
           else dv.prayer_level_1
         end
  from public.dinner_verses dv
  where dv.id = v_dinner_verse_id;
end;
$$;

comment on function public.get_guest_table_by_invite_code(text) is
  'Server-side guest-table lookup by exact invite code. Excludes '
  'archived groups (second independent guard alongside the rotated '
  'invite_code). Otherwise identical to the version in '
  '20260714000004_shared_dinner_session.sql.';

revoke all on function public.get_guest_table_by_invite_code(text) from public;
grant execute on function public.get_guest_table_by_invite_code(text) to anon, authenticated;

-- ============================================================
-- get_or_create_tonight_session() -- reject archived groups
-- ============================================================
-- Latest version lives in
-- 20260724000001_restore_self_heal_after_conflict_fix.sql (self-heal +
-- constraint-by-name ON CONFLICT fix). Re-created here, adding only
-- the archived_at check right after the membership check -- every
-- other line is unchanged.
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
         gv.prayer_order, gv.prayer_turns_completed, v_was_created
  from public.group_verse gv
  join public.dinner_verses dv on dv.id = gv.dinner_verse_id
  where gv.group_id = group_id_input and gv.verse_date = v_today;
end;
$$;

comment on function public.get_or_create_tonight_session(uuid) is
  'Atomically gets or creates the single canonical group_verse row for '
  'this group and today. Rejects archived groups outright (2026-07-25) '
  '-- an archived table can never create a new dinner session. '
  'Otherwise identical to '
  '20260724000001_restore_self_heal_after_conflict_fix.sql''s version '
  '(self-heal + ON CONFLICT constraint-by-name fix).';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

-- ============================================================
-- complete_prayer_turn() -- reject archived groups
-- ============================================================
-- Latest version lives in
-- 20260724000003_fix_ambiguous_prayer_turns_completed.sql (qualified
-- WHERE/RETURNING fix). Re-created here, adding only the archived_at
-- check -- every other line is unchanged.
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

  select gv.prayer_order into v_order
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  if v_order is null then
    raise exception 'No dinner session started yet';
  end if;

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
    select gv.prayer_turns_completed into v_new_completed
    from public.group_verse gv
    where gv.group_id = group_id_input and gv.verse_date = v_today;
  elsif v_new_completed >= v_member_count then
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
  'Advances tonight''s prayer rotation by exactly one turn, atomically '
  'and idempotently. Rejects archived groups outright (2026-07-25) -- '
  'moot in ordinary use (an archived group has no members and no '
  'active session) but kept as a direct guard for defense in depth. '
  'Otherwise identical to '
  '20260724000003_fix_ambiguous_prayer_turns_completed.sql''s version.';

revoke all on function public.complete_prayer_turn(uuid, int) from public;
revoke all on function public.complete_prayer_turn(uuid, int) from anon;
grant execute on function public.complete_prayer_turn(uuid, int) to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. As a non-owner member, call leave_group() -- must succeed exactly
--    as the old direct update did.
-- 2. As the owner of a multi-member table, call leave_group() -- must
--    raise 'Transfer ownership to another member before leaving this
--    table.'
-- 3. As the owner of a solo table, call leave_group() -- must raise
--    'You are the only person at this table. Delete the table instead
--    of leaving.'
-- 4. As the owner, call transfer_group_ownership(group_id, <a current
--    member's id>) -- groups.owner_id must update; the old owner can
--    then successfully call leave_group().
-- 5. As a sole owner with at least one prior dinner session, call
--    delete_group(group_id):
--      select archived_at, invite_code from public.groups where id = '<group_id>';
--    -- archived_at must be non-null, invite_code must differ from the
--    -- original.
--      select count(*) from public.group_verse where group_id = '<group_id>';
--      select count(*) from public.notes where family_id = '<group_id>';
--    -- both must be UNCHANGED from before archival -- history
--    -- preserved.
-- 6. Attempt to join the archived group with its OLD invite code
--    (join_group_by_invite_code) -- must raise 'Invite code not found'.
-- 7. Attempt get_or_create_tonight_session(<archived group id>) as
--    someone still (incorrectly) pointing group_id at it -- must raise
--    'This table has been deleted'.
