-- PRODUCTION VERIFICATION for 20260912000001.
--
-- Exercises the REAL live production functions against throwaway
-- groups/profiles, then guarantees zero residue: the whole thing runs
-- in one transaction which is ALWAYS aborted by a final RAISE, so
-- nothing is ever committed -- no cleanup step that could be forgotten
-- or fail halfway. The final exception message carries the results.
--
-- auth.uid() is driven by request.jwt.claims, so every call below goes
-- through the same authentication and membership checks a real device
-- does, including assert_prayer_member().
do $$
declare
  gA uuid := '0a000000-0000-4000-8000-00000000000a';
  gB uuid := '0b000000-0000-4000-8000-00000000000b';
  gC uuid := '0c000000-0000-4000-8000-00000000000c';
  m1 uuid := '0e000000-0000-4000-8000-000000000001';
  m2 uuid := '0e000000-0000-4000-8000-000000000002';
  m3 uuid := '0e000000-0000-4000-8000-000000000003';
  n1 uuid := '0f000000-0000-4000-8000-000000000001';
  n2 uuid := '0f000000-0000-4000-8000-000000000002';
  n3 uuid := '0f000000-0000-4000-8000-000000000003';
  p1 uuid := '0d000000-0000-4000-8000-000000000001';
  p2 uuid := '0d000000-0000-4000-8000-000000000002';
  log text := '';
  s record;
  r record;
  starter uuid;
  pass_count int;

  procedure_failed text := null;
begin
  -- Act as a real authenticated user for everything below.
  perform set_config('request.jwt.claims', json_build_object('sub', m1)::text, true);
  perform set_config('request.jwt.claim.sub', m1::text, true);

  if auth.uid() <> m1 then
    raise exception 'FAIL: auth.uid() shim did not take effect (got %)', auth.uid();
  end if;

  -- groups.owner_id references auth.users, so the throwaway members
  -- need auth rows. Safe: the final RAISE aborts this transaction, so
  -- these are never committed either -- no auth.users residue, unlike
  -- the orphan left behind by an earlier signUp probe.
  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, u.id,
         'authenticated', 'authenticated',
         'zz-verify-' || u.id || '@invalid.test', now(), now()
  from (values (m1),(m2),(m3),(n1),(n2),(n3),(p1),(p2)) as u(id);

  -- ---------- GROUP A: clean three-person rotation ----------
  insert into public.groups (id, name, owner_id, timezone, invite_code)
  values (gA, 'ZZ Verify A', m1, 'America/Chicago', 'ZZVERA');
  -- The auth.users inserts above already created these profile rows
  -- via the handle_new_user trigger, so they are updated, not inserted.
  update public.profiles set name = 'ZZ One',   group_id = gA, created_at = now() - interval '3 min' where id = m1;
  update public.profiles set name = 'ZZ Two',   group_id = gA, created_at = now() - interval '2 min' where id = m2;
  update public.profiles set name = 'ZZ Three', group_id = gA, created_at = now() - interval '1 min' where id = m3;

  select * into s from public.get_or_create_tonight_session(gA);
  if not s.was_created then raise exception 'FAIL A0: session not created'; end if;
  if s.prayer_order <> array[m1,m2,m3] then raise exception 'FAIL A0: roster % ', s.prayer_order; end if;
  if s.current_prayer_id <> m1 or s.next_prayer_id <> m2 then
    raise exception 'FAIL A0: current/next % / %', s.current_prayer_id, s.next_prayer_id;
  end if;
  if s.pending_count <> 3 or s.passed_members <> '{}'::uuid[] or s.all_prayed then
    raise exception 'FAIL A0: pending/passed/all %/%/%', s.pending_count, s.passed_members, s.all_prayed;
  end if;
  log := log || ' [A0 session+roster+current OK]';

  -- Turn 1, recorded by m1's device.
  select * into r from public.complete_prayer_turn(gA, m1);
  if not r.recorded or r.current_prayer_id <> m2 or r.next_prayer_id <> m3
     or r.prayed_members <> array[m1] or r.prayer_turns_completed <> 1 or r.all_prayed then
    raise exception 'FAIL A1: %', row_to_json(r);
  end if;
  log := log || ' [A1 one-turn advance OK]';

  -- Double tap: must NOT record again, must NOT duplicate.
  select * into r from public.complete_prayer_turn(gA, m1);
  if r.recorded or r.prayed_members <> array[m1] or r.current_prayer_id <> m2 then
    raise exception 'FAIL A2 double-tap: %', row_to_json(r);
  end if;
  log := log || ' [A2 double-tap refused, no duplicate OK]';

  -- Stale device naming a future person: must NOT record.
  select * into r from public.complete_prayer_turn(gA, m3);
  if r.recorded or r.current_prayer_id <> m2 or r.prayed_members <> array[m1] then
    raise exception 'FAIL A3 stale: %', row_to_json(r);
  end if;
  log := log || ' [A3 stale tap refused OK]';

  -- A DIFFERENT member's device records the next turn (m2 never acts).
  perform set_config('request.jwt.claims', json_build_object('sub', m3)::text, true);
  perform set_config('request.jwt.claim.sub', m3::text, true);
  select * into r from public.complete_prayer_turn(gA, m2);
  if not r.recorded or r.current_prayer_id <> m3 then
    raise exception 'FAIL A4 second device: %', row_to_json(r);
  end if;
  log := log || ' [A4 second device / shared phone OK]';

  -- Refresh mid-rotation must preserve the current person exactly.
  select * into s from public.get_or_create_tonight_session(gA);
  if s.was_created or s.current_prayer_id <> m3 or s.prayed_members <> array[m1,m2] then
    raise exception 'FAIL A5 refresh: %', row_to_json(s);
  end if;
  log := log || ' [A5 refresh preserves current OK]';

  -- Final turn closes the night.
  select * into r from public.complete_prayer_turn(gA, m3);
  if not r.recorded or not r.all_prayed or r.current_prayer_id is not null
     or r.next_prayer_id is not null or r.prayed_members <> array[m1,m2,m3]
     or r.pending_count <> 0 then
    raise exception 'FAIL A6 completion: %', row_to_json(r);
  end if;
  log := log || ' [A6 completion OK]';

  -- Nobody repeated: exactly three distinct entries.
  if (select count(*) from unnest(r.prayed_members)) <> 3
     or (select count(distinct x) from unnest(r.prayed_members) x) <> 3 then
    raise exception 'FAIL A7 duplicates: %', r.prayed_members;
  end if;
  log := log || ' [A7 no repeats OK]';

  -- Completion persists across a reload, and a late tap cannot reopen.
  select * into s from public.get_or_create_tonight_session(gA);
  if not s.all_prayed or s.current_prayer_id is not null then
    raise exception 'FAIL A8 persistence: %', row_to_json(s);
  end if;
  select * into r from public.complete_prayer_turn(gA, m1);
  if r.recorded or not r.all_prayed then
    raise exception 'FAIL A8 late tap: %', row_to_json(r);
  end if;
  log := log || ' [A8 completion persists, no reopen OK]';

  -- Fair starter: tomorrow begins with position 2 of tonight's order.
  select g.next_prayer_user_id into starter from public.groups g where g.id = gA;
  if starter <> m2 then raise exception 'FAIL A9 next starter %', starter; end if;
  log := log || ' [A9 fair next starter OK]';

  -- ---------- GROUP B: PASS and NOT HERE, kept distinct ----------
  perform set_config('request.jwt.claims', json_build_object('sub', n1)::text, true);
  perform set_config('request.jwt.claim.sub', n1::text, true);

  insert into public.groups (id, name, owner_id, timezone, invite_code)
  values (gB, 'ZZ Verify B', n1, 'America/Chicago', 'ZZVERB');
  update public.profiles set name = 'ZZ Alpha', group_id = gB, created_at = now() - interval '3 min' where id = n1;
  update public.profiles set name = 'ZZ Beta',  group_id = gB, created_at = now() - interval '2 min' where id = n2;
  update public.profiles set name = 'ZZ Gamma', group_id = gB, created_at = now() - interval '1 min' where id = n3;

  perform public.get_or_create_tonight_session(gB);

  -- NOT HERE on the current person: hands the turn on, records no
  -- prayer, and cannot close the night.
  select * into r from public.set_member_absent(gB, n1, true);
  if not r.recorded or r.absent_members <> array[n1] or r.current_prayer_id <> n2
     or r.prayed_members <> '{}'::uuid[] or r.passed_members <> '{}'::uuid[]
     or r.all_prayed or r.prayer_turns_completed <> 0 then
    raise exception 'FAIL B1 not-here: %', row_to_json(r);
  end if;
  log := log || ' [B1 NOT HERE distinct OK]';

  -- Restore to present: reclaims their exact original position.
  select * into r from public.set_member_absent(gB, n1, false);
  if not r.recorded or r.absent_members <> '{}'::uuid[] or r.current_prayer_id <> n1 then
    raise exception 'FAIL B2 restore: %', row_to_json(r);
  end if;
  log := log || ' [B2 restore present OK]';

  -- PASS on the current person: recorded as PASSED only -- not a
  -- prayer, not an absence, and no turn counted.
  select * into r from public.pass_prayer_turn(gB, n1);
  if not r.recorded or r.passed_members <> array[n1]
     or r.prayed_members <> '{}'::uuid[] or r.absent_members <> '{}'::uuid[]
     or r.prayer_turns_completed <> 0 or r.current_prayer_id <> n2 or r.all_prayed then
    raise exception 'FAIL B3 pass: %', row_to_json(r);
  end if;
  log := log || ' [B3 PASS distinct from PRAYED and ABSENT OK]';

  -- A passed member can be put back into the rotation.
  select * into r from public.set_member_passed(gB, n1, false);
  if not r.recorded or r.passed_members <> '{}'::uuid[] or r.current_prayer_id <> n1 then
    raise exception 'FAIL B4 un-pass: %', row_to_json(r);
  end if;
  log := log || ' [B4 passed member restored OK]';

  -- Stale pass must not record.
  select * into r from public.pass_prayer_turn(gB, n3);
  if r.recorded or r.passed_members <> '{}'::uuid[] then
    raise exception 'FAIL B5 stale pass: %', row_to_json(r);
  end if;
  log := log || ' [B5 stale pass refused OK]';

  -- Mixed finish: one prays, one passes, one is absent -> the pass
  -- closes the night; prayed and passed stay separate.
  select * into r from public.complete_prayer_turn(gB, n1);
  if not r.recorded then raise exception 'FAIL B6a: %', row_to_json(r); end if;
  select * into r from public.set_member_absent(gB, n3, true);
  if r.all_prayed then raise exception 'FAIL B6b absence closed night: %', row_to_json(r); end if;
  select * into r from public.pass_prayer_turn(gB, n2);
  if not r.recorded or not r.all_prayed or r.prayed_members <> array[n1]
     or r.passed_members <> array[n2] or r.absent_members <> array[n3]
     or r.prayer_turns_completed <> 1 then
    raise exception 'FAIL B6c mixed finish: %', row_to_json(r);
  end if;
  log := log || ' [B6 mixed prayed/passed/absent finish OK]';

  -- Read-only resync agrees with the mutation's own view.
  select * into s from public.get_prayer_session_state(gB);
  if not s.session_exists or not s.all_prayed or s.current_prayer_id is not null
     or s.prayed_members <> array[n1] or s.passed_members <> array[n2] then
    raise exception 'FAIL B7 resync: %', row_to_json(s);
  end if;
  log := log || ' [B7 read-only resync OK]';

  -- ---------- GROUP C: starting-person rotation ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p1)::text, true);
  perform set_config('request.jwt.claim.sub', p1::text, true);

  insert into public.groups (id, name, owner_id, timezone, invite_code)
  values (gC, 'ZZ Verify C', p1, 'America/Chicago', 'ZZVERC');
  update public.profiles set name = 'ZZ Uno', group_id = gC, created_at = now() - interval '2 min' where id = p1;
  update public.profiles set name = 'ZZ Dos', group_id = gC, created_at = now() - interval '1 min' where id = p2;

  -- Set the future starter only AFTER both members exist. Setting it
  -- earlier is not a product bug but an unrealistic fixture: the
  -- reconcile trigger correctly refuses to carry a future starter who
  -- is not (yet) a member, and would reset it to the first member.
  -- In production this value is only ever written when a dinner closes,
  -- by which point every member already exists.
  update public.groups set next_prayer_user_id = p2 where id = gC;

  select * into s from public.get_or_create_tonight_session(gC);
  -- next_prayer_user_id was p2, so tonight's order starts with p2 --
  -- the starting slot really does move between dinners rather than
  -- always following profiles.created_at.
  if s.prayer_order <> array[p2,p1] or s.current_prayer_id <> p2 then
    raise exception 'FAIL C1 starter rotation: %', row_to_json(s);
  end if;
  log := log || ' [C1 starting person rotates OK]';

  -- The 354-dinner no-repeat picker still chose a real, active dinner.
  if s.dinner_verse_id is null
     or not exists (select 1 from public.dinner_verses dv
                    where dv.id = s.dinner_verse_id and dv.active) then
    raise exception 'FAIL C2 dinner picker: %', s.dinner_verse_id;
  end if;
  log := log || ' [C2 no-repeat picker still works OK]';

  -- A non-member is refused outright.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', m1)::text, true);
    perform set_config('request.jwt.claim.sub', m1::text, true);
    perform public.complete_prayer_turn(gC, p2);
    procedure_failed := 'FAIL C3: non-member was allowed to record a turn';
  exception when others then
    if sqlerrm not like '%Not a member of this group%' then
      procedure_failed := 'FAIL C3: wrong error: ' || sqlerrm;
    end if;
  end;
  if procedure_failed is not null then raise exception '%', procedure_failed; end if;
  log := log || ' [C3 non-member refused OK]';

  select count(*) into pass_count
  from public.group_verse where group_id in (gA, gB, gC);
  log := log || ' [' || pass_count || ' throwaway dinners created, all rolled back]';

  -- ALWAYS abort. This is the cleanup: nothing above is ever committed.
  raise exception 'VERIFICATION_PASSED -->%', log;
end $$;
