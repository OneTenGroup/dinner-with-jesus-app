-- Dinner with Jesus — Shared dinner-session repair
-- Date: 2026-07-15 (revised same day: family timezone + 4am cutoff,
-- explicit prayer_tier, rotation_advanced safety flag)
-- Status: NOT APPLIED TO PRODUCTION. Part of the staged rollout --
-- apply in the SAME early "primitives" phase as
-- 20260714000001_security_primitives.sql, before baseline RLS. See
-- docs/DWJ_SHARED_TABLE_FUNCTIONAL_AUDIT_2026-07-15.md, Section 7, for
-- the full combined deployment order.
--
-- WHAT THIS FIXES
-- Confirmed by code audit, not assumed: prayer-rotation state
-- (TablePage.jsx's prayerIdx/prayedCount) was 100% local React state,
-- randomly seeded per device on mount, and never written to the
-- database. Two family members on two devices could see different
-- people as "up to pray," with nothing persisting across refresh,
-- reopen, or the next day.
--
-- Separately, and just as real: the PRAYER TEXT shown for a given
-- verse was chosen per-viewer from their own profile.faith_level,
-- while discussion QUESTIONS for the same verse were already shown
-- identically to everyone. This revision makes the canonical prayer
-- an explicit, stored, session-level identifier (prayer_tier) rather
-- than a literal hardcoded inside a single function's SELECT list --
-- so it's visible directly on the row, and both the authenticated
-- client path (this file) and the guest path
-- (20260714000001_security_primitives.sql's
-- get_guest_table_by_invite_code) read the SAME stored value instead
-- of two independent hardcoded literals that could silently diverge
-- if one were ever edited without the other.
--
-- THIS REVISION ALSO FIXES THE DAY-BOUNDARY PROBLEM
-- The original version of this migration used bare Postgres
-- current_date (the database session's timezone, effectively UTC on a
-- standard Supabase project) to key "tonight." That was already
-- consistent across devices (no per-device divergence), but did not
-- match any real family's local evening -- a US family eating dinner
-- after roughly 4-8pm local time could see "tonight" roll to
-- "tomorrow" mid-dinner, since UTC midnight lands in the middle of a
-- US evening. This revision adds a per-group IANA timezone and
-- defines the canonical dinner day as running 4:00 AM through 3:59 AM
-- the following local day -- computed once, server-side, inside these
-- functions -- so a late dinner never rolls into a new session at
-- midnight, and no client independently computes this date.
--
-- DESIGN CHOICE: extend group_verse and groups, don't create new tables
-- group_verse (group_id, verse_date) is already a one-row-per-group-
-- per-day record with working RLS; groups is already the one row per
-- family. Rather than introduce new tables (a second source of truth
-- to keep in sync), this migration adds columns to both.
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

-- ---- groups: family/table timezone ----

-- Validates an IANA timezone name by attempting to actually use it.
-- Postgres has no built-in "is this a real zone name" boolean, so this
-- is the standard pattern: try the operation, catch failure, return
-- false rather than propagating the error. Used as a CHECK constraint
-- below so no arbitrary/unvalidated text can ever be stored, from any
-- code path (client insert, client update, or a future RPC) --
-- enforced by Postgres itself, not by client-side care.
create or replace function public.is_valid_iana_timezone(tz text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

comment on function public.is_valid_iana_timezone(text) is
  'Returns true only if tz is a timezone name Postgres actually '
  'recognizes. Used by groups_timezone_valid below so no unvalidated '
  'timezone text can be stored via any code path.';

-- Existing groups need a safe backfill. America/Chicago is used ONLY
-- as the migration fallback for rows with no better information --
-- documented here explicitly per instruction, not silently chosen.
-- ADD COLUMN ... DEFAULT ... NOT NULL backfills existing rows with the
-- default in a single efficient statement (Postgres 11+) and applies
-- the same default to all pre-existing rows, which is exactly the
-- "safe backfill" this needs -- no separate UPDATE required.
alter table public.groups
  add column if not exists timezone text not null default 'America/Chicago';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'groups_timezone_valid' and conrelid = 'public.groups'::regclass
  ) then
    alter table public.groups
      add constraint groups_timezone_valid check (public.is_valid_iana_timezone(timezone));
  end if;
end $$;

comment on column public.groups.timezone is
  'IANA timezone identifier (e.g. America/Chicago) used to resolve '
  '"tonight" for this family/table -- never each member''s own device '
  'timezone. Defaults to America/Chicago for existing rows created '
  'before this column existed (documented migration fallback, not a '
  'product decision about where most families live) and for new '
  'groups if client-side timezone detection fails. Set from the owner '
  'device''s detected timezone at group-creation time where available '
  '(see src/hooks/useFamily.js createGroup()), and editable by the '
  'owner afterward (see SettingsPage.jsx).';

-- ---- group_verse: explicit shared-content identifiers ----

alter table public.group_verse
  add column if not exists prayer_order uuid[] not null default '{}';
alter table public.group_verse
  add column if not exists prayer_turns_completed int not null default 0;

-- Explicit, stored identifier for which prayer tier is canonical for
-- this dinner -- was previously an implicit hardcoded literal
-- (dv.prayer_level_1) inside this function's own SELECT list. Storing
-- it on the row makes the invariant visible directly in the data, and
-- lets get_guest_table_by_invite_code() (a different function, in a
-- different migration file) read the SAME value instead of carrying
-- its own independent hardcoded literal that could silently diverge.
-- Only 'level_1' is used today (no group-level faith setting exists
-- to base anything else on -- see the audit doc's Remaining Product
-- Decisions), but the column is a real identifier, not a placeholder,
-- so a future per-group tier decision doesn't require a schema change.
alter table public.group_verse
  add column if not exists prayer_tier text not null default 'level_1';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'group_verse_prayer_tier_valid' and conrelid = 'public.group_verse'::regclass
  ) then
    alter table public.group_verse
      add constraint group_verse_prayer_tier_valid check (prayer_tier in ('level_1', 'level_2', 'level_3'));
  end if;
end $$;

-- Snapshot of which timezone was actually used to compute this row's
-- verse_date, captured at creation. If the owner changes the group's
-- timezone later, historical sessions stay correctly attributed to
-- whatever timezone was active when they were created -- the next
-- NEW session (a new date, under the new timezone) is what actually
-- changes, never this one, retroactively.
alter table public.group_verse
  add column if not exists timezone_used text not null default 'America/Chicago';

-- Explicit, auditable idempotency guard for "the rotation for this
-- specific dinner has already been advanced to groups.next_prayer_
-- user_id." complete_prayer_turn() below is already atomic via a
-- compare-and-swap on prayer_turns_completed, but this makes the
-- guarantee visible directly on the row (a session invariant, not
-- just inferable from turns_completed reaching the array length) and
-- provides a second, independent guard in the same statement that
-- writes to groups.next_prayer_user_id.
alter table public.group_verse
  add column if not exists rotation_advanced boolean not null default false;

comment on column public.group_verse.prayer_order is
  'Snapshot of member profile ids, in rotation order, captured when '
  'this dinner session was created. Fixed for the life of this row.';
comment on column public.group_verse.prayer_turns_completed is
  'How many members in prayer_order have completed their turn '
  'tonight. Advanced only by complete_prayer_turn(), atomically.';
comment on column public.group_verse.prayer_tier is
  'Which dinner_verses.prayer_level_N column is canonical for this '
  'dinner -- stored once at creation, read by every device and by the '
  'guest RPC, never re-derived per viewer.';
comment on column public.group_verse.timezone_used is
  'The groups.timezone value that was active when this row''s '
  'verse_date was computed. Frozen at creation -- later timezone '
  'changes affect only future sessions.';
comment on column public.group_verse.rotation_advanced is
  'True once this dinner''s prayer rotation has advanced '
  'groups.next_prayer_user_id for the next session. Set exactly once, '
  'inside the same atomic statement that performs that advance.';

-- ---- groups: rotation continuity ----

alter table public.groups
  add column if not exists next_prayer_user_id uuid references public.profiles(id) on delete set null;

comment on column public.groups.next_prayer_user_id is
  'Who starts the prayer rotation at the next dinner session created '
  'for this group. Set by complete_prayer_turn() when a dinner''s '
  'rotation finishes -- and ONLY then, never by session creation, a '
  'page load, a refresh, or a new calendar day arriving with no '
  'session created. If a day is skipped entirely (no session ever '
  'created for it), this value is simply never touched, so the '
  'designated person keeps their turn for whenever the family next '
  'opens the app.';

-- ============================================================
-- HELPER: canonical_dinner_date()
-- ============================================================
-- Single source of truth for "what calendar day is 'tonight' in this
-- family's timezone, using a 4:00 AM local cutoff." Used by every
-- function below and by the guest RPC in
-- 20260714000001_security_primitives.sql, so the day-boundary rule
-- exists in exactly one place, not duplicated per function.
--
-- 4:00 AM cutoff, precisely: subtracting 4 hours from local "now"
-- before taking the date means the calendar day doesn't roll over
-- until 4:00 AM local time. At 3:59:59 AM, "now - 4h" is still
-- 23:59:59 the PREVIOUS day -> still last night's dinner day. At
-- exactly 4:00:00 AM, "now - 4h" becomes 00:00:00 THAT day -> a new
-- dinner day begins. This is what prevents a family eating dinner at
-- 7-9pm local time from ever seeing "tonight" become "tomorrow"
-- mid-meal, regardless of which side of any particular midnight
-- their clock happens to be on.
create or replace function public.canonical_dinner_date(tz text)
returns date
language sql
stable
set search_path = ''
as $$
  select ((now() at time zone tz) - interval '4 hours')::date;
$$;

comment on function public.canonical_dinner_date(text) is
  'The canonical "dinner day" for timezone tz, using a 4:00 AM local '
  'cutoff (a dinner day runs 4:00 AM through 3:59 AM the following '
  'local day). Computed server-side; no client independently '
  'calculates this date.';

revoke all on function public.canonical_dinner_date(text) from public;
grant execute on function public.canonical_dinner_date(text) to anon, authenticated;

-- Thin, read-only wrapper so HomePage.jsx/SettingsPage.jsx's
-- checkVerseLocked() (a lightweight "has tonight's verse been set
-- yet" display check, run before the owner decides whether to tap
-- "Set tonight's verse") can know which date to look up in
-- group_verse without either (a) independently computing it
-- client-side, which is exactly what this whole migration exists to
-- prevent, or (b) calling get_or_create_tonight_session() just to
-- check, which would create a session as a side effect of merely
-- viewing the Home/Settings screen -- changing the deliberate
-- "owner sets the verse first, then invites" flow that exists today.
-- This does neither: it only tells the caller what date "tonight" is.
create or replace function public.get_canonical_dinner_date_for_group(group_id_input uuid)
returns date
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.profiles where id = v_uid and group_id = group_id_input
  ) then
    raise exception 'Not a member of this group';
  end if;
  select g.timezone into v_tz from public.groups g where g.id = group_id_input;
  return public.canonical_dinner_date(coalesce(v_tz, 'America/Chicago'));
end;
$$;

comment on function public.get_canonical_dinner_date_for_group(uuid) is
  'Read-only: returns today''s canonical dinner date for this group '
  '(timezone + 4am cutoff) without creating a session. Lets the '
  'client check whether tonight''s verse is already set without '
  'computing the date itself and without the side effect of creating '
  'one just by checking.';

revoke all on function public.get_canonical_dinner_date_for_group(uuid) from public;
revoke all on function public.get_canonical_dinner_date_for_group(uuid) from anon;
grant execute on function public.get_canonical_dinner_date_for_group(uuid) to authenticated;

-- ============================================================
-- RPC 1: get_or_create_tonight_session()
-- ============================================================
-- Replaces FOUR separately-maintained client-side implementations of
-- "lock tonight's verse" (HomePage.jsx, SettingsPage.jsx,
-- OnboardingPage.jsx, and TablePage.jsx's own loadVerse()), each of
-- which did a client-side check-then-upsert with no real atomicity.
-- This RPC uses `insert ... on conflict do nothing`, under which only
-- the first concurrent caller's insert actually lands.
--
-- Also computes the "avoid repeating a verse" pool correctly for the
-- whole GROUP: joins verse_history to profiles on group_id inside this
-- SECURITY DEFINER function, which ordinary RLS-scoped client queries
-- cannot do.
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
  v_today date;
  v_picked_verse_id uuid;
  v_next_starter uuid;
  v_prayer_order uuid[];
  v_existing_id uuid;
  v_starter_pos int;
  v_was_created boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and group_id = group_id_input
  ) then
    raise exception 'Not a member of this group';
  end if;

  select g.timezone into v_tz from public.groups g where g.id = group_id_input;
  v_tz := coalesce(v_tz, 'America/Chicago');
  v_today := public.canonical_dinner_date(v_tz);

  -- Fast path: today's session already exists.
  select gv.id into v_existing_id
  from public.group_verse gv
  where gv.group_id = group_id_input and gv.verse_date = v_today;

  v_was_created := v_existing_id is null;

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
      -- explicit ordinality/order-by has no guaranteed row order.
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
    on conflict (group_id, verse_date) do nothing
    returning id into v_existing_id;
    -- RETURNING only yields a row for an INSERT that actually happened
    -- -- ON CONFLICT DO NOTHING rows are never returned. So v_existing_id
    -- staying null here (distinct from the pre-insert check above) means
    -- this specific call lost a concurrent race to another caller's
    -- insert, not that nothing exists -- v_was_created is corrected for
    -- that below, giving an exact "did MY call create this" signal
    -- rather than an approximate "did I see one already" signal.
    v_was_created := v_existing_id is not null;
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
  'this group and today (today defined by the group''s own timezone '
  'and a 4am local cutoff, never a client-computed date). Returns the '
  'full verse content, the canonical prayer text (per the row''s '
  'stored prayer_tier, never the viewer''s own faith_level), and '
  'tonight''s prayer_order snapshot in one call.';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

-- ============================================================
-- RPC 2: complete_prayer_turn()
-- ============================================================
-- Replaces TablePage.jsx's local-only nextPrayer(). Advances
-- prayer_turns_completed by exactly one, only if the caller's
-- expected_turns_completed still matches the row's current value --
-- optimistic-concurrency compare-and-swap. A second device racing to
-- complete the same turn gets back the current (unchanged) state
-- instead of double-advancing and skipping a person.
--
-- Tomorrow's starter: tonight's prayer_order is always constructed
-- (above) so the intended starter is at position 1. "Who opens
-- tomorrow" is always the person at position 2 tonight -- the
-- rotation's duty-roster slot advances by exactly one person per
-- COMPLETED dinner, not reset to position 1, and not touched at all
-- for an incomplete dinner (see rotation_advanced below).
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

  select g.timezone into v_tz from public.groups g where g.id = group_id_input;
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

  -- Atomic, idempotent-per-turn compare-and-swap. Never fires because
  -- of a new date, a page load, a refresh, or opening the prayer
  -- section -- only an explicit call from the "We prayed together"
  -- action reaches this statement at all.
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
    -- erroring. No-op path for a near-simultaneous second tap.
    select gv.prayer_turns_completed into v_new_completed
    from public.group_verse gv
    where gv.group_id = group_id_input and gv.verse_date = v_today;
  elsif v_new_completed >= v_member_count then
    -- Rotation just completed for the night. Second, explicit,
    -- auditable idempotency guard here (rotation_advanced = false) in
    -- addition to the turns_completed compare-and-swap above -- this
    -- statement can only ever match and fire once per session row,
    -- and it's the only place in this migration that writes
    -- groups.next_prayer_user_id.
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
  'and idempotently. Only fires on an explicit call -- never because a '
  'new date began, a page loaded, someone refreshed, or someone opened '
  'the prayer section. Sets groups.next_prayer_user_id exactly once '
  'per session, guarded by both the turns_completed compare-and-swap '
  'and the separate rotation_advanced flag, at the moment the rotation '
  'completes for the night. An incomplete dinner (never reaches full '
  'completion) never touches next_prayer_user_id at all, so it does '
  'not consume a turn -- the same designated person opens the next '
  'session, whenever that is created.';

revoke all on function public.complete_prayer_turn(uuid, int) from public;
revoke all on function public.complete_prayer_turn(uuid, int) from anon;
grant execute on function public.complete_prayer_turn(uuid, int) to authenticated;

-- ============================================================
-- RPC 3 (upgrade): get_guest_table_by_invite_code()
-- ============================================================
-- This function was first created in
-- 20260714000001_security_primitives.sql, in a simpler form that used
-- bare Postgres current_date and a hardcoded 'prayer_level_1' literal
-- -- deliberately, since that file must not forward-reference
-- public.canonical_dinner_date() or public.groups.timezone, neither of
-- which existed yet at that point in the deployment. Both now exist
-- (defined earlier in this same file), so this create-or-replace
-- upgrades it to resolve "tonight" via the group's own timezone + 4am
-- cutoff and to read the session's stored prayer_tier -- the exact
-- same two inputs get_or_create_tonight_session() uses for permanent
-- members above. A guest can now never see a different verse, dinner
-- date, or prayer than the family whose table they're visiting.
-- Same signature, same grants, same "zero rows for anything that
-- doesn't match" behavior as the original -- only the date and prayer
-- resolution logic changes.
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
  where g.invite_code = v_code;

  if v_group_id is null then
    return; -- zero rows: no such code, no further hint given
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
  'Server-side guest-table lookup by exact invite code -- upgraded '
  'version (see 20260714000001_security_primitives.sql for the '
  'original). Resolves "tonight" via the group''s own timezone + 4am '
  'cutoff and reads the session''s stored prayer_tier, identical to '
  'what permanent members see via get_or_create_tonight_session(). '
  'Returns only the fields GuestTablePage.jsx renders -- never '
  'owner_id, invite_code, member/profile data, notes, or analytics.';

-- Grants unchanged from the original definition, restated for clarity
-- since create-or-replace does not alter existing grants -- these are
-- redundant with what 20260714000001_security_primitives.sql already
-- set, included here only so this file is fully self-describing.
revoke all on function public.get_guest_table_by_invite_code(text) from public;
grant execute on function public.get_guest_table_by_invite_code(text) to anon, authenticated;

commit;

-- ============================================================
-- IDEMPOTENCY / RE-RUN NOTE
-- ============================================================
-- `add column if not exists`, the guarded `do $$ ... $$` constraint
-- blocks, and `create or replace function` are all safe to re-run.
-- This migration does not touch any RLS policy from the security
-- package -- group_verse's and groups' existing policies
-- (20260714000002_emergency_baseline_rls.sql) already cover the new
-- columns, since RLS policies apply at the row level, not per-column.
--
-- FORWARD-REPAIR, NOT ROLLBACK
-- If a bug is found in any function here after this is applied, fix
-- it with `create or replace function ...` and re-test the specific
-- scenario from docs/DWJ_SHARED_TABLE_FUNCTIONAL_AUDIT_2026-07-15.md's
-- test matrix. Do not drop the new columns once the repaired client
-- depends on them -- that would silently revert every group to the
-- old per-device-random prayer behavior with no error.
