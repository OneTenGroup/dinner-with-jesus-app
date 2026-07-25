-- Dinner with Jesus — self-service account deletion
-- Date: 2026-07-26
-- Status: NOT YET APPLIED.
--
-- WHY THIS EXISTS
-- Apple App Review Guideline 5.1.1(v) requires that any app supporting
-- account creation must also let a user delete their account from
-- within the app itself -- an email-request process with manual,
-- up-to-30-day turnaround (the current public/delete-account.html
-- flow) does not satisfy this and is a near-certain rejection reason
-- for the iOS submission. This migration adds the missing self-service
-- path; the email flow is left in place as a fallback for anyone
-- locked out of their account, not removed.
--
-- WHAT delete_own_account() DOES
-- 1. If the caller owns a group with other members, ownership is
--    auto-transferred to the next-longest-tenured other member (by
--    profiles.created_at) -- deleting your own account must never be
--    blocked on a manual "transfer ownership first" step the way the
--    Settings-page "Delete this table" flow intentionally requires for
--    a *table*. This is a deliberate, narrower exception for this one
--    call path.
-- 2. If the caller is a SOLE owner, their table is archived exactly
--    like delete_group() (invite_code rotated, archived_at set) --
--    history (group_verse/notes) is preserved, never destroyed.
-- 3. The caller is detached from their group either way.
-- 4. Only then is `delete from auth.users where id = auth.uid()`
--    executed. This ordering matters: groups.owner_id references
--    auth.users(id) ON DELETE CASCADE, so deleting the auth.users row
--    while the caller still owned a group would cascade-delete that
--    group (and, via group_verse.group_id ON DELETE CASCADE, its
--    entire dinner-session history) -- steps 1-3 guarantee the caller
--    never still owns anything by the time this line runs.
-- 5. profiles (ON DELETE CASCADE from auth.users), notes (ON DELETE
--    CASCADE from profiles), and verse_history (ON DELETE CASCADE from
--    auth.users) are removed automatically by their existing foreign
--    keys -- no separate delete statements needed or written here.
--    notes.user_id's cascade is keyed on WHO WROTE the note, not which
--    journal it was posted to -- a note the deleted user wrote to a
--    shared FAMILY journal is removed along with their personal notes,
--    same as it always would have been under the pre-existing
--    public/delete-account.html policy text ("your journal entries and
--    reflections" are listed as deleted there too). Confirmed by
--    disposable-account testing: other members' notes in the same
--    family journal are never touched, only the deleted user's own.
--
-- SECURITY DEFINER is required here specifically because ordinary
-- authenticated roles have no grant to write to auth.users at all --
-- this function runs as its definer (applied via migration, not by an
-- end user), which does. auth.uid() is the only identity source, so
-- this can only ever delete the CALLING user's own account, never
-- another user's.
--
-- SAFE TO RE-RUN: create or replace function is idempotent, same as
-- every other function in this migration package.

begin;

create or replace function public.delete_own_account()
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
  v_next_owner uuid;
  v_new_code text := '';
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id into v_group_id from public.profiles where id = v_uid;

  if v_group_id is not null then
    select owner_id into v_owner_id from public.groups where id = v_group_id;

    if v_owner_id = v_uid then
      select count(*) into v_member_count from public.profiles where group_id = v_group_id;

      if v_member_count > 1 then
        -- Auto-transfer to the next-longest-tenured other member so
        -- account deletion is never blocked on a manual group-admin step.
        select id into v_next_owner
        from public.profiles
        where group_id = v_group_id and id <> v_uid
        order by created_at
        limit 1;

        update public.groups set owner_id = v_next_owner where id = v_group_id;
      else
        -- Sole owner: archive the table (same mechanism as delete_group()
        -- in 20260725000001_group_ownership_protection.sql) so history is
        -- preserved and the old invite code can never be reused.
        --
        -- owner_id is ALSO cleared here (delete_group() never does this,
        -- since that flow never deletes the caller's own auth.users row).
        -- This function does delete auth.users below, in the SAME call --
        -- groups.owner_id references auth.users(id) ON DELETE CASCADE, so
        -- leaving owner_id pointing at the very account about to be
        -- deleted would cascade-delete this "archived" row (and, via
        -- group_verse.group_id ON DELETE CASCADE, its entire dinner
        -- history) the instant the delete below runs -- silently undoing
        -- the archive and destroying exactly what it exists to preserve.
        -- Confirmed by disposable-account testing before this migration
        -- was ever applied to any database: the pre-fix version passed
        -- every other assertion but left the archived solo-owner test
        -- group (and its group_verse/notes) completely deleted, not
        -- archived. owner_id is nullable (confirmed), so this is safe.
        for i in 1..6 loop
          v_new_code := v_new_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        end loop;

        update public.groups
        set archived_at = now(), invite_code = v_new_code, owner_id = null
        where id = v_group_id and archived_at is null;
      end if;
    end if;

    update public.profiles set group_id = null where id = v_uid;
  end if;

  -- Cascades to profiles, notes (via profiles), and verse_history
  -- automatically. The caller owns nothing by this point (see above),
  -- so no group is at risk of an unintended cascade delete here.
  delete from auth.users where id = v_uid;

  return true;
end;
$$;

comment on function public.delete_own_account() is
  'Self-service account deletion for Apple App Review Guideline 5.1.1(v). '
  'Auto-transfers or archives any group the caller owns (never blocks on '
  'a manual step), detaches the caller, then deletes their own auth.users '
  'row -- profiles/notes/verse_history cascade automatically. Can only '
  'ever delete the CALLING user''s own account (auth.uid() is the only '
  'identity source).';

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. As a plain member (no group or non-owner), call delete_own_account()
--    -- auth.users row for that id must be gone; select from profiles/
--    notes/verse_history for that id must all return zero rows.
-- 2. As the owner of a multi-member table, call delete_own_account() --
--    the table's owner_id must have moved to another existing member,
--    group_verse/notes for that table must be untouched, and only the
--    caller's own account/profile/notes/history must be gone.
-- 3. As a sole owner, call delete_own_account() -- the group must show
--    archived_at set and a rotated invite_code, group_verse/notes counts
--    for that group unchanged, and the caller's account fully gone.
-- 4. Confirm in all three cases that no OTHER user's account, profile,
--    or data was touched.
