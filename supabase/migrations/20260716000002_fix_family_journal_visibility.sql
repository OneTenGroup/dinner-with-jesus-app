-- Dinner with Jesus — Fix family journal visibility (post-00002 regression)
-- Date: 2026-07-16
-- Status: NOT APPLIED TO PRODUCTION. Review before running.
--
-- ROOT CAUSE
-- 20260714000002_emergency_baseline_rls.sql enabled RLS on public.notes
-- but deliberately left its 4 pre-existing policies untouched, on the
-- stated assumption that "select/insert/update/delete, all
-- user_id = auth.uid()" were "already correctly written." That's true
-- for the PERSONAL journal (family_id is null) but wrong for the
-- FAMILY journal (family_id = group.id, written by TablePage.jsx's
-- dinner-flow save): a user_id = auth.uid() SELECT policy only ever
-- lets the original author see a row, regardless of family_id. Before
-- that migration, RLS was off entirely, so the table was fully open --
-- insecure, but it accidentally made shared entries visible to every
-- member. The moment RLS turned on with only author-scoped policies in
-- place, every family journal entry became invisible to everyone but
-- its author. Confirmed live in production today: one member's family
-- note did not appear for a second member of the same group.
--
-- WHAT THIS MIGRATION DOES
-- Adds new policies alongside the existing 4 -- does not touch or
-- replace them, so personal-journal behavior (family_id is null) is
-- completely unaffected:
--
--   1. notes_select_family_member (SELECT, permissive): any CURRENT
--      member of the group (profiles.group_id match, same pattern as
--      group_verse's own policies -- the live groups/group_verse
--      model, not the unused parallel families table) can see a note
--      whose family_id is that group. OR-combined with the existing
--      user_id = auth.uid() policy, so an author can still always see
--      their own personal notes too.
--   2. notes_delete_family_member (DELETE, permissive): same scope --
--      matches documented intended behavior that any current member
--      can remove a shared family-table note, not just its author.
--   3. notes_insert_family_id_scoped (INSERT, RESTRICTIVE): a note's
--      family_id must be null or the inserting user's own current
--      group. Added as RESTRICTIVE (not permissive) specifically so it
--      narrows the existing permissive insert policy (whose exact name
--      wasn't re-derived here, so it's left untouched) rather than
--      trying to replace it -- Postgres ANDs all restrictive policies
--      together with the permissive set, so this closes the
--      cross-family-write gap without needing to know or guess that
--      policy's literal name. Closes "could a user write into a family
--      journal they don't belong to," a real gap independent of
--      today's visibility bug.
--
-- No UPDATE policy is added -- no client code updates notes (only
-- insert/delete), matching this whole migration package's existing
-- principle of never granting access broader than what the client
-- actually uses.
--
-- SAFE TO RE-RUN: every CREATE POLICY is preceded by a matching
-- DROP POLICY IF EXISTS for that exact name.

begin;

drop policy if exists "notes_select_family_member" on public.notes;
create policy "notes_select_family_member" on public.notes
  for select using (
    family_id is not null
    and family_id = (select p.group_id from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "notes_delete_family_member" on public.notes;
create policy "notes_delete_family_member" on public.notes
  for delete using (
    family_id is not null
    and family_id = (select p.group_id from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "notes_insert_family_id_scoped" on public.notes;
create policy "notes_insert_family_id_scoped" on public.notes
  as restrictive
  for insert
  with check (
    family_id is null
    or family_id = (select p.group_id from public.profiles p where p.id = auth.uid())
  );

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. select policyname, cmd, permissive
--    from pg_policies
--    where schemaname = 'public' and tablename = 'notes'
--    order by cmd, policyname;
--    -- Confirm 7 policies total now: the original 4 (unchanged) plus
--    -- these 3 new ones, with notes_insert_family_id_scoped showing
--    -- permissive = 'RESTRICTIVE'.
-- 2. In the app: the second account should now see the first account's
--    family journal entry after refresh. Both accounts should be able
--    to see and delete it. Personal journal entries should remain
--    exactly as private as before -- confirm the OTHER account still
--    cannot see a personal-tab entry.
