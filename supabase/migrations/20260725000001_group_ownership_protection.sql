-- Dinner with Jesus — group ownership protection
-- Date: 2026-07-25
-- Status: NOT YET APPLIED.
--
-- WHAT THIS FIXES
-- useFamily.js's leaveGroup() currently does a plain client-side
-- `profiles.update({ group_id: null })`, permitted by the existing
-- profiles_update_own RLS policy regardless of role. Nothing prevents
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
--      owner is told to delete the table instead. A non-owner leaves
--      exactly as before.
--   2. transfer_group_ownership(group_id, new_owner_id) -- lets the
--      current owner hand ownership to another current member.
--   3. delete_group(group_id) -- lets a SOLE owner (no other members)
--      remove themselves and the table. Clears the caller's own
--      profiles.group_id first (which almost certainly has to happen
--      before any row-level delete could succeed anyway, since
--      profiles.group_id references groups(id)), then best-effort
--      hard-deletes the groups row. If historical group_verse/notes
--      rows still reference it via a foreign key this migration
--      package did not create (and has no confirmed cascade behavior
--      for -- that FK predates the versioned migration history), the
--      delete is caught and skipped rather than failing the whole
--      operation: the caller is still out, the table is still gone
--      from their view, and no history is lost. This matches this
--      codebase's existing "old rows are simply inert" pattern for
--      stale group_verse rows.
--
-- SAFE TO RE-RUN: create or replace function is idempotent, same as
-- every other function in this migration package. Touches no existing
-- data, no RLS policy, no other table structure.

begin;

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
  v_target_group uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id into v_owner_id from public.groups where id = group_id_input;
  if v_owner_id is null then
    raise exception 'Table not found';
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
  'owner and the target is an actual current member before touching '
  'groups.owner_id.';

revoke all on function public.transfer_group_ownership(uuid, uuid) from public;
revoke all on function public.transfer_group_ownership(uuid, uuid) from anon;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;

-- ============================================================
-- delete_group()
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
  v_member_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id into v_owner_id from public.groups where id = group_id_input;
  if v_owner_id is null then
    raise exception 'Table not found';
  end if;
  if v_owner_id is distinct from v_uid then
    raise exception 'Only the table owner can delete it';
  end if;

  select count(*) into v_member_count from public.profiles where group_id = group_id_input;
  if v_member_count > 1 then
    raise exception 'Transfer ownership or remove other members before deleting this table';
  end if;

  -- Clear the sole owner's own membership first -- profiles.group_id
  -- references groups(id), so a row-level delete below could not
  -- succeed while this still points at it regardless of any other
  -- history.
  update public.profiles set group_id = null where id = v_uid and group_id = group_id_input;

  -- Best-effort hard delete. If historical group_verse/notes rows
  -- still reference this group via a foreign key this migration
  -- package did not create and has no confirmed cascade behavior for,
  -- leave the now-ownerless, memberless row in place rather than fail
  -- the whole operation -- the caller is still out and the table is
  -- gone from their view either way, and no history is destroyed.
  begin
    delete from public.groups where id = group_id_input;
  exception when foreign_key_violation then
    null;
  end;

  return true;
end;
$$;

comment on function public.delete_group(uuid) is
  'Lets a SOLE owner (no other members) remove themselves and delete '
  'the table. Refuses if other members remain. Clears the caller''s '
  'own membership first, then best-effort hard-deletes the group row '
  '-- if a foreign key this migration did not create blocks the '
  'delete, the row is left inert (no history lost) rather than the '
  'whole operation failing.';

revoke all on function public.delete_group(uuid) from public;
revoke all on function public.delete_group(uuid) from anon;
grant execute on function public.delete_group(uuid) to authenticated;

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
-- 5. As a sole owner, call delete_group(group_id) -- caller's
--    profiles.group_id must become null; confirm whether the groups
--    row itself was deleted or left inert (check
--    select * from public.groups where id = '<group_id>';) -- both
--    outcomes are correct depending on whether historical data
--    referenced it.
