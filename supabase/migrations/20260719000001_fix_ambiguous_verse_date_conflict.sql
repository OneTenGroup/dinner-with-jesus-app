-- Dinner with Jesus — fix production defect: "Could not load verse"
-- Date: 2026-07-19
-- Status: NOT YET APPLIED. Forward-repair via create-or-replace, per
-- this migration package's own convention (see the "FORWARD-REPAIR,
-- NOT ROLLBACK" note at the end of 20260714000004_shared_dinner_session.sql).
--
-- ROOT CAUSE (confirmed against production, not guessed)
-- get_or_create_tonight_session() declares `returns table(session_id
-- uuid, verse_date date, ...)`. PL/pgSQL implicitly creates a variable
-- named `verse_date` for that output column, scoped to the whole
-- function body. The function's own `insert ... on conflict (group_id,
-- verse_date) do nothing` then contains a BARE reference to
-- `verse_date` inside the ON CONFLICT column list -- and Postgres
-- cannot tell whether that means the table column or the same-named
-- PL/pgSQL variable. This is a well-documented PL/pgSQL pitfall
-- (see https://www.postgresql.org/docs/current/plpgsql-implementation.html#PLPGSQL-VAR-SUBST).
--
-- Confirmed via the actual production error (browser console + Network
-- tab, 2026-07-19): a 400 response to
-- rest/v1/rpc/get_or_create_tonight_session with Postgres error
-- `column reference "verse_date" is ambiguous`. Confirmed further by
-- querying production group_verse for Steve's family (group
-- f156b590-5458-48ff-a827-cde7aeecdd25): the most recent row is dated
-- 2026-07-16 (created 2026-07-16 00:48 UTC, BEFORE this code deployed
-- at 08:55 CDT that morning, via the pre-migration client path) --
-- meaning the buggy INSERT path has never once succeeded since this
-- function went live. Every day since, the first person to open the
-- table hits this exact statement (no existing row for the new day =
-- "fast path" is skipped, INSERT is attempted, ON CONFLICT ambiguity
-- fires) and gets "Could not load verse." The downstream 406s seen in
-- the same console session (HomePage.jsx/SettingsPage.jsx's
-- checkVerseLocked(), a direct `.eq('verse_date', today).single()`
-- lookup) are the same root cause surfacing a second way -- zero rows
-- exist for today because no session has successfully been created --
-- not a separate defect, and require no separate fix.
--
-- THE FIX
-- Reference the unique constraint BY NAME instead of by column list.
-- `on conflict on constraint <name>` is not subject to the same
-- ambiguity, since it isn't a bare-identifier expression position --
-- it's a constraint-name reference. Confirmed against production
-- (query 2 of the diagnostic pass) that the real constraint name is
-- group_verse_group_id_verse_date_key: `UNIQUE (group_id, verse_date)`.
--
-- Function signature and RETURNS TABLE shape are UNCHANGED -- this is
-- the only line that differs from 20260714000004_shared_dinner_session.sql.
-- No client code change is required; TablePage.jsx's existing
-- `session.verse_date` etc. field access is unaffected.
--
-- SAFE TO RE-RUN: create or replace function is idempotent, same as
-- every other function in this migration package. Touches no data,
-- no RLS policy, no other table.

begin;

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
    -- FIX (2026-07-19): was `on conflict (group_id, verse_date)` -- a
    -- bare column list, ambiguous against this function's own
    -- RETURNS TABLE `verse_date` output variable. Referencing the
    -- constraint by name avoids the ambiguity entirely.
    on conflict on constraint group_verse_group_id_verse_date_key do nothing
    returning id into v_existing_id;
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
  'tonight''s prayer_order snapshot in one call. '
  '2026-07-19: fixed an ambiguous-column bug in the ON CONFLICT clause '
  '(see 20260719000001_fix_ambiguous_verse_date_conflict.sql) that '
  'prevented any new session from ever being created after initial '
  'deploy -- unchanged signature/return shape, no client impact.';

revoke all on function public.get_or_create_tonight_session(uuid) from public;
revoke all on function public.get_or_create_tonight_session(uuid) from anon;
grant execute on function public.get_or_create_tonight_session(uuid) to authenticated;

commit;
