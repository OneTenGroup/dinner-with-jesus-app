-- Dinner with Jesus — Shared dinner-session repair
-- Date: 2026-07-15
-- Status: NOT APPLIED TO PRODUCTION. Part 4, follows the 3-part security
-- package. Review against docs/DWJ_SHARED_TABLE_FUNCTIONAL_AUDIT_2026-07-15.md
-- before applying.
--
-- WHAT THIS FIXES
-- Confirmed by code audit, not assumed: prayer-rotation state
-- (TablePage.jsx's prayerIdx/prayedCount) is 100% local React state,
-- randomly seeded per device on mount, and NEVER written to the
-- database. Every device independently guesses a starting "whose turn"
-- and independently advances it locally. Two family members on two
-- devices can and will see different people as "up to pray," and
-- nothing persists across refresh/reopen/another day.
--
-- Separately, and just as real: the PRAYER TEXT shown for a given
-- verse is chosen per-viewer from their own profile.faith_level
-- (TablePage.jsx's getPrayer()), while the discussion QUESTIONS for
-- the same verse are already correctly shown identically to everyone
-- (all 3 levels rendered together, gated only by whether the verse has
-- that level's text -- not by faith_level). So today, two people at
-- the same table can read a genuinely different prayer for the same
-- verse tonight. This migration does not touch faith_level itself
-- (that's a client-only render change, done alongside this migration --
-- see docs, Section 11) but the schema below is what makes a single,
-- server-persisted prayer choice possible per dinner.
--
-- WHAT THIS DOES NOT FIX
-- The "tonight" boundary is (and remains, in this migration)
-- current_date evaluated in the database's session timezone via
-- Postgres current_date, which is what TablePage.jsx's client-side
-- `new Date().toISOString().split('T')[0]` (UTC-based, not
-- per-device-local) already approximates today. No family/group
-- timezone setting exists anywhere in the schema (confirmed: no
-- timezone column on groups, profiles, or anywhere else). This
-- migration does not add one -- see the audit doc's Remaining Product
-- Decisions for why that's deliberately out of scope for this pass.
--
-- DESIGN CHOICE: extend group_verse, don't create a new table
-- group_verse (group_id, verse_date) is already a one-row-per-group-
-- per-day record with working RLS. Rather than introduce a new
-- "dinner_session" table (a second source of truth to keep in sync),
-- this migration adds prayer-rotation columns directly to the
-- existing row -- the smallest change that gives every group a single
-- canonical per-day record for verse AND prayer state together.
--
-- Also adds one column to `groups`: next_prayer_user_id, so rotation
-- continuity survives across days (who starts praying tomorrow is a
-- property of the group over time, not of any single day's session
-- row) and survives membership changes correctly (see the RPCs below).
--
-- ASSUMPTION NOT DIRECTLY VERIFIED AGAINST THE LIVE SCHEMA: this
-- migration's `on conflict (group_id, verse_date)` (in
-- get_or_create_tonight_session below) assumes a unique constraint or
-- index already exists on group_verse(group_id, verse_date). This is
-- inferred, not confirmed: every existing client-side implementation
-- of "lock tonight's verse" already calls
-- `.upsert(..., { onConflict: 'group_id,verse_date' })` against this
-- same target, and PostgREST's upsert errors at call time if no
-- matching constraint exists -- since that code path is already live,
-- the constraint almost certainly exists. Verify with:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.group_verse'::regclass and contype in ('u','p');
-- before applying. If it's missing, add it first:
--   alter table public.group_verse
--     add constraint group_verse_group_date_unique unique (group_id, verse_date);

begin;

-- ============================================================
-- SCHEMA CHANGES
-- ============================================================

-- prayer_order: a SNAPSHOT of member user_ids in rotation order,
-- captured once when tonight's session is created (get_or_create_
-- tonight_session below). Fixed for the rest of that dinner even if
-- membership changes mid-dinner -- satisfies "the current completed
-- dinner must not be rewritten retroactively."
alter table public.group_verse
  add column if not exists prayer_order uuid[] not null default '{}';

-- prayer_turns_completed: how many of tonight's prayer_order have
-- taken their turn so far (0..array_length(prayer_order, 1)). Whose
-- turn it is "now" is derived, not stored separately, so there is
-- exactly one number to keep consistent.
alter table public.group_verse
  add column if not exists prayer_turns_completed int not null default 0;

comment on column public.group_verse.prayer_order is
  'Snapshot of member profile ids, in rotation order, captured when '
  'this dinner session was created by get_or_create_tonight_session(). '
  'Fixed for the life of this row -- later membership changes affect '
  'future dinners (future rows), never this one.';

comment on column public.group_verse.prayer_turns_completed is
  'How many members in prayer_order have completed their turn tonight. '
  'Advanced only by complete_prayer_turn(), which is atomic and '
  'idempotent per turn -- never advanced by page load, refresh, or a '
  'second device independently.';

-- groups.next_prayer_user_id: who should be first in prayer_order the
-- NEXT time a session is created for this group. Updated by
-- complete_prayer_turn() only at the moment tonight's rotation fully
-- completes. Nullable, and set null automatically if that member is
-- later removed from the group (their profiles.group_id becomes null,
-- not their profiles row deleted -- see the ON DELETE SET NULL below,
-- which handles the case where a profile row itself is ever deleted,
-- and the RPCs additionally guard against "still referenced but no
-- longer a member" explicitly, since removal doesn't delete the row).
alter table public.groups
  add column if not exists next_prayer_user_id uuid references public.profiles(id) on delete set null;

comment on column public.groups.next_prayer_user_id is
  'Who starts the prayer rotation at the next dinner session created '
  'for this group. Set by complete_prayer_turn() when a dinner''s '
  'rotation finishes. If that person is no longer a member when the '
  'next session is created, get_or_create_tonight_session() falls back '
  'to the earliest-joined current member.';

-- ============================================================
-- RPC 1: get_or_create_tonight_session()
-- ============================================================
-- Replaces FOUR separately-maintained client-side implementations of
-- "lock tonight's verse" (HomePage.jsx, SettingsPage.jsx,
-- OnboardingPage.jsx, and TablePage.jsx's own loadVerse()), each of
-- which did a client-side check-then-upsert with no real atomicity:
-- two callers racing to be first could both pass the "does a row
-- exist yet" check, then both upsert, with the SECOND upsert silently
-- overwriting the first caller's verse pick (upsert's ON CONFLICT
-- updates the existing row rather than leaving the first writer's
-- value alone). This RPC uses `insert ... on conflict do nothing`,
-- under which only the first concurrent caller's insert actually
-- lands -- every other simultaneous caller's insert is a genuine no-op,
-- and they simply read back the row the first caller created. No
-- verse-flipping race is possible.
--
-- Also computes the "avoid repeating a verse" pool correctly for the
-- whole GROUP for the first time: the four client-side implementations
-- it replaces queried verse_history with no user filter at all, which
-- (before this security pass) accidentally spanned every user in the
-- database, and (after baseline RLS) now accidentally scopes to only
-- the calling user. Neither was "has this GROUP discussed this verse
-- before." Because this function is SECURITY DEFINER, it can correctly
-- join verse_history to profiles on group_id and ask exactly that
-- question -- a real correctness improvement enabled by moving this
-- logic server-side, not a new feature.
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
  prayer_level_1 text,
  prayer_order uuid[],
  prayer_turns_completed int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := current_date;
  v_picked_verse_id uuid;
  v_next_starter uuid;
  v_prayer_order uuid[];
  v_existing_id uuid;
  v_starter_pos int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and group_id = group_id_input
  ) then
    raise exception 'Not a member of this group';
  end if;

  -- Fast path: today's session already exists.
  select gv.id into v_existing_id
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

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
      -- explicit ordinality/order-by has no guaranteed row order and
      -- would risk silently scrambling the rotation.
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
      -- Every active verse has been discussed by this group before --
      -- fall back to any active verse rather than failing the dinner.
      select dv.id into v_picked_verse_id
      from public.dinner_verses dv
      where dv.active = true
      order by random()
      limit 1;
    end if;

    if v_picked_verse_id is null then
      raise exception 'No active verses available';
    end if;

    insert into public.group_verse (group_id, verse_date, dinner_verse_id, prayer_order, prayer_turns_completed)
    values (group_id_input, v_today, v_picked_verse_id, v_prayer_order, 0)
    on conflict (group_id, verse_date) do nothing;
    -- If this insert lost a race to a concurrent caller, ON CONFLICT DO
    -- NOTHING means it silently did nothing here -- the select below
    -- picks up whichever row actually landed, which is exactly the
    -- point: only one caller's verse pick ever becomes canonical.
  end if;

  return query
  select gv.id, gv.verse_date, gv.dinner_verse_id,
         dv.verse_ref, dv.category, dv.verse_text, dv.context_text,
         dv.question_level_1, dv.question_level_2, dv.question_level_3,
         dv.prayer_level_1,
         gv.prayer_order, gv.prayer_turns_completed
  from public.group_verse gv
  join public.dinner_verses dv on dv.id = gv.dinner_verse_id
  where gv.group_id = group_id_input and gv.verse_date = v_today;
end;
$$;

comment on function public.get_or_create_tonight_session(uuid) is
  'Atomically gets or creates the single canonical group_verse row for '
  'this group and today (insert ... on conflict do nothing, never '
  'upsert/overwrite). Replaces four separately-maintained client-side '
  'implementations of the same operation. Returns the full verse '
  'content and tonight''s prayer_order snapshot in one call.';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

-- ============================================================
-- RPC 2: complete_prayer_turn()
-- ============================================================
-- Replaces TablePage.jsx's local-only nextPrayer(). Advances
-- prayer_turns_completed by exactly one, but ONLY if the caller's
-- expected_turns_completed still matches the row's current value --
-- classic optimistic-concurrency compare-and-swap. If two devices
-- both believe "turn 2 just finished, advance to 3" and race, only the
-- first UPDATE to actually commit will find prayer_turns_completed = 2
-- true; the second finds it already 3, its WHERE clause matches zero
-- rows, and it receives back the current (already-advanced) state
-- instead of double-advancing. This is what makes "two devices press
-- the button nearly simultaneously" safe: the second press is a
-- correctly-recognized no-op, not a skipped person.
--
-- When the rotation fully completes for the night, this function also
-- sets groups.next_prayer_user_id so tomorrow's session starts with
-- the right person -- done in the same statement that completes the
-- last turn, so it happens exactly once, atomically, with the turn
-- completion itself.
-- Note on tomorrow's starter: tonight's prayer_order is always
-- constructed (in get_or_create_tonight_session) so the intended
-- starter is at position 1. So "who opens tomorrow" is always the
-- person at position 2 tonight (the rotation's duty-roster slot
-- advances by exactly one person per completed dinner, not back to
-- position 1) -- a constant relative to array length, not dependent on
-- how many turns were completed. array[2], or array[1] again if there
-- is only one member.
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
  v_today date := current_date;
  v_member_count int;
  v_order uuid[];
  v_new_completed int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and group_id = group_id_input
  ) then
    raise exception 'Not a member of this group';
  end if;

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

  -- Atomic, idempotent-per-turn compare-and-swap.
  update public.group_verse
  set prayer_turns_completed = expected_turns_completed + 1
  where group_id = group_id_input
    and verse_date = v_today
    and prayer_turns_completed = expected_turns_completed
    and expected_turns_completed < v_member_count
  returning prayer_turns_completed into v_new_completed;

  if v_new_completed is null then
    -- Someone else already advanced this exact turn (or it's already
    -- fully complete) -- read and return the current state rather than
    -- erroring. This is the no-op path for a near-simultaneous second tap.
    select gv.prayer_turns_completed into v_new_completed
    from public.group_verse gv
    where gv.group_id = group_id_input and gv.verse_date = v_today;
  elsif v_new_completed >= v_member_count then
    -- Rotation just completed for the night -- advance the duty-roster
    -- slot by exactly one position from tonight's starter (position 1)
    -- to position 2, so a different person opens next time. Only ever
    -- reached once per night, since the guarded UPDATE above only
    -- succeeds on the single call that carries turns_completed from
    -- v_member_count - 1 to v_member_count.
    update public.groups
    set next_prayer_user_id = v_order[(1 % v_member_count) + 1]
    where id = group_id_input;
  end if;

  return query
  select v_new_completed, v_new_completed >= v_member_count;
end;
$$;

comment on function public.complete_prayer_turn(uuid, int) is
  'Advances tonight''s prayer rotation by exactly one turn, atomically '
  'and idempotently: a caller passes the turn count they believe is '
  'current, and the advance only happens if that''s still true when the '
  'row is locked. A second device racing to complete the same turn '
  'gets back the current (unchanged) state instead of double-advancing '
  'and skipping a person. Returns only prayer_turns_completed and '
  'all_prayed -- the client derives whose turn is current/next by '
  'indexing into the prayer_order array it already holds from '
  'get_or_create_tonight_session(). Sets groups.next_prayer_user_id '
  'exactly once, at the moment the rotation completes for the night, '
  'to the member one position after tonight''s starter.';

revoke all on function public.complete_prayer_turn(uuid, int) from public;
revoke all on function public.complete_prayer_turn(uuid, int) from anon;
grant execute on function public.complete_prayer_turn(uuid, int) to authenticated;

commit;

-- ============================================================
-- IDEMPOTENCY / RE-RUN NOTE
-- ============================================================
-- `add column if not exists` and `create or replace function` are both
-- safe to re-run. This migration does not touch any RLS policy from
-- parts 2/3 -- group_verse's existing group_verse_select_member /
-- group_verse_insert_member / group_verse_update_member policies
-- (20260714000002_emergency_baseline_rls.sql) already cover the new
-- columns, since RLS policies apply at the row level, not per-column.
--
-- FORWARD-REPAIR, NOT ROLLBACK
-- If a bug is found in either RPC after this is applied, fix it with
-- `create or replace function ...` and re-test the specific scenario
-- from docs/DWJ_SHARED_TABLE_FUNCTIONAL_AUDIT_2026-07-15.md's test
-- matrix. Do not drop the new columns once the repaired client depends
-- on them -- that would silently revert every group to the old
-- per-device-random prayer behavior with no error, which is worse than
-- an explicit failure.
