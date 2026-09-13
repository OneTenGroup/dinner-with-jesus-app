// Real-Postgres harness for the prayer state machine.
//
// WHY THIS EXISTS
// The previous prayer regression suite (src/lib/prayerRotation.test.js)
// hand-wrote a JavaScript re-implementation of the SQL contract and
// asserted against that. It passed while production was broken,
// because a re-implementation can only ever prove that the test author
// and the test agree -- never that the shipped SQL is correct.
//
// This harness instead boots a real PostgreSQL (PGlite, Postgres
// compiled to WASM, in-process) and applies
// supabase/migrations/20260912000001_prayer_state_machine_hardening.sql
// VERBATIM -- byte for byte, grants included, no filtering or
// rewriting. Every assertion in prayerStateMachine.test.js therefore
// executes the exact plpgsql that ships to production.
//
// WHAT IT DOES NOT PROVE
//  - It is not production. Production's live pg_proc has historically
//    been ahead of this migration folder, so the migration carries a
//    PRE-APPLY REQUIREMENT to diff the live definitions first.
//  - PGlite is a single connection, so two genuinely concurrent
//    transactions blocking on the same row lock cannot be staged. The
//    concurrency scenarios here are therefore written as SEQUENTIAL
//    INTERLEAVINGS: each simulated device resolves state, then acts on
//    the state it resolved, which is exactly the stale-read shape that
//    a lost race produces. The FOR UPDATE lock and the "not already
//    recorded" guard are what make the real concurrent case degenerate
//    into this one.
//  - RLS is not exercised. Every function under test is SECURITY
//    DEFINER and does its own membership check via
//    assert_prayer_member(), which IS exercised.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
export const MIGRATION_PATH = join(
  REPO, 'supabase', 'migrations',
  '20260912000001_prayer_state_machine_hardening.sql'
)

// The pre-migration world this migration lands on. Mirrors the shape
// production reached at 2026-09-10: the same columns, defaults, unique
// constraint and helper functions the migration's bodies reference.
// passed_members is deliberately ABSENT so the migration's own
// `add column if not exists` is what creates it.
const FIXTURE_SCHEMA = `
-- Roles the migration's grant/revoke statements target, so the
-- migration can be applied verbatim instead of filtered.
create role anon;
create role authenticated;

create schema if not exists auth;

-- Stand-in for Supabase's auth.uid(). Tests set req.uid to act as a
-- specific member, which is how assert_prayer_member() is exercised.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('req.uid', true), '')::uuid
$$;

create table public.profiles (
  id uuid primary key,
  name text,
  group_id uuid,
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key,
  name text not null default 'Test Table',
  invite_code text,
  owner_id uuid,
  timezone text not null default 'America/Chicago',
  archived_at timestamptz,
  next_prayer_user_id uuid,
  rotation_cycle_started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.dinner_verses (
  id uuid primary key,
  active boolean not null default true,
  verse_ref text,
  category text,
  verse_text text,
  context_text text,
  question_level_1 text,
  question_level_2 text,
  question_level_3 text,
  prayer_level_1 text,
  prayer_level_2 text,
  prayer_level_3 text
);

create table public.group_verse (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  verse_date date not null,
  dinner_verse_id uuid,
  prayer_order uuid[] not null default '{}',
  prayer_turns_completed int not null default 0,
  absent_members uuid[] not null default '{}',
  prayed_members uuid[] not null default '{}',
  prayer_tier text not null default 'level_1',
  timezone_used text not null default 'America/Chicago',
  rotation_advanced boolean not null default false,
  created_at timestamptz not null default now(),
  constraint group_verse_group_id_verse_date_key unique (group_id, verse_date)
);

-- The REAL canonical_dinner_date arithmetic (group timezone, 4am
-- cutoff) from 20260714000004, with one testability change: the
-- instant it reads can be pinned via the test.now setting. The
-- timezone conversion and the 4-hour cutoff are untouched, so the
-- date-boundary scenarios genuinely exercise that logic rather than a
-- simplified stand-in.
create or replace function public.canonical_dinner_date(tz text)
returns date language sql stable set search_path = '' as $$
  select ((coalesce(
            nullif(current_setting('test.now', true), '')::timestamptz,
            now()
          ) at time zone tz) - interval '4 hours')::date;
$$;

-- The AFTER UPDATE trigger entry point from 20260910000001. The
-- migration under test replaces reconcile_current_prayer_session(),
-- which this calls, but not this wrapper or the trigger itself.
create or replace function public.reconcile_prayer_rotation_on_group_change()
returns trigger language plpgsql security definer set search_path = '' as $$
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

-- Pre-migration reconcile_current_prayer_session(). Present only so
-- the trigger above has a target while the fixture is being built; the
-- migration replaces it. Kept minimal on purpose -- no test asserts
-- against this version.
create or replace function public.reconcile_current_prayer_session(group_id_input uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  return;
end;
$$;

drop trigger if exists reconcile_prayer_rotation_membership on public.profiles;
create trigger reconcile_prayer_rotation_membership
after update of group_id on public.profiles
for each row
when (old.group_id is distinct from new.group_id)
execute function public.reconcile_prayer_rotation_on_group_change();
`

export const GROUP_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
export const SECOND_GROUP_ID = 'bbbbbbbb-0000-4000-8000-000000000002'

function uuidFor(prefix, n) {
  const hex = `00000000000${n}`.slice(-12)
  return `${prefix}-0000-4000-8000-${hex}`
}

/**
 * Boot a fresh database, apply the migration verbatim, and return a
 * small API for driving dinners through the real RPCs.
 */
export async function createTestDb() {
  const db = await PGlite.create()
  await db.exec(FIXTURE_SCHEMA)

  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8')
  // Applied verbatim. If this throws, the migration itself is invalid
  // SQL and every scenario below is meaningless -- which is the point.
  await db.exec(migrationSql)

  let actingAs = null

  const api = {
    db,
    migrationSql,

    /** Act as this member id for subsequent RPC calls. */
    async actAs(id) {
      actingAs = id
      await db.exec(`set req.uid = '${id}'`)
    },

    /** Pin the clock so dinner-date boundaries can be tested. */
    async setNow(iso) {
      if (iso === null) {
        await db.exec(`set test.now = ''`)
      } else {
        await db.exec(`set test.now = '${iso}'`)
      }
    },

    /**
     * Create a group with `count` members, in a deterministic
     * created_at order so prayer_order is predictable.
     * Returns the member ids in that order.
     */
    async seedGroup({ count, groupId = GROUP_ID, timezone = 'America/Chicago' } = {}) {
      const ids = Array.from({ length: count }, (_, i) => uuidFor('aaaaaaaa', i + 1))
      await db.query(
        `insert into public.groups (id, name, owner_id, timezone, rotation_cycle_started_at, created_at)
         values ($1, 'Test Table', $2, $3, now() - interval '30 days', now() - interval '30 days')`,
        [groupId, ids[0], timezone]
      )
      for (let i = 0; i < ids.length; i++) {
        await db.query(
          `insert into public.profiles (id, name, group_id, created_at)
           values ($1, $2, $3, now() - interval '30 days' + ($4 || ' seconds')::interval)`,
          [ids[i], `Member${i + 1}`, groupId, String(i)]
        )
      }
      await api.actAs(ids[0])
      return ids
    },

    /** Add `count` active dinners to the library. */
    async seedDinners(count = 10) {
      for (let i = 0; i < count; i++) {
        await db.query(
          `insert into public.dinner_verses
             (id, active, verse_ref, category, verse_text, context_text,
              question_level_1, prayer_level_1)
           values ($1, true, $2, 'test', 'text', 'context', 'q1', 'p1')`,
          [uuidFor('cccccccc', i + 1), `Ref ${i + 1}`]
        )
      }
    },

    /** Add a brand-new member to the group (joins mid-dinner). */
    async addMember(n, groupId = GROUP_ID) {
      const id = uuidFor('aaaaaaaa', n)
      await db.query(
        `insert into public.profiles (id, name, group_id, created_at)
         values ($1, $2, $3, now())`,
        [id, `Member${n}`, groupId]
      )
      return id
    },

    /** Remove a member from the group, firing the reconcile trigger. */
    async removeMember(id) {
      await db.query(`update public.profiles set group_id = null where id = $1`, [id])
    },

    async rpc(name, args) {
      const keys = Object.keys(args)
      const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
      const res = await db.query(
        `select * from public.${name}(${params})`,
        keys.map(k => args[k])
      )
      return res.rows[0]
    },

    session(groupId = GROUP_ID) {
      return api.rpc('get_or_create_tonight_session', { group_id_input: groupId })
    },
    state(groupId = GROUP_ID) {
      return api.rpc('get_prayer_session_state', { group_id_input: groupId })
    },
    prayed(expected, groupId = GROUP_ID) {
      return api.rpc('complete_prayer_turn', {
        group_id_input: groupId, expected_current_prayer_id: expected
      })
    },
    pass(expected, groupId = GROUP_ID) {
      return api.rpc('pass_prayer_turn', {
        group_id_input: groupId, expected_current_prayer_id: expected
      })
    },
    setPassed(member, passed, groupId = GROUP_ID) {
      return api.rpc('set_member_passed', {
        group_id_input: groupId, member_id_input: member, passed
      })
    },
    setAbsent(member, absent, groupId = GROUP_ID) {
      return api.rpc('set_member_absent', {
        group_id_input: groupId, member_id_input: member, absent
      })
    },

    /** Raw row, for asserting on what was actually persisted. */
    async row(groupId = GROUP_ID) {
      const res = await db.query(
        `select gv.* from public.group_verse gv
         where gv.group_id = $1
         order by gv.verse_date desc limit 1`,
        [groupId]
      )
      return res.rows[0]
    },

    async rowFor(verseDate, groupId = GROUP_ID) {
      const res = await db.query(
        `select gv.* from public.group_verse gv
         where gv.group_id = $1 and gv.verse_date = $2`,
        [groupId, verseDate]
      )
      return res.rows[0]
    },

    async group(groupId = GROUP_ID) {
      const res = await db.query(`select * from public.groups where id = $1`, [groupId])
      return res.rows[0]
    },

    get currentActor() { return actingAs },

    close() { return db.close() }
  }

  return api
}

/**
 * Run a whole dinner to completion by having ONE caller record every
 * turn -- the "one phone passed around the table" flow. Returns the
 * ordered list of member ids that were recorded as having prayed.
 */
export async function prayEveryTurn(t, groupId = GROUP_ID) {
  const order = []
  // Bounded so a resolver bug becomes a failed assertion rather than a
  // hung test.
  for (let guard = 0; guard < 50; guard++) {
    const s = await t.state(groupId)
    if (s.all_prayed || s.current_prayer_id === null) break
    const res = await t.prayed(s.current_prayer_id, groupId)
    if (!res.recorded) throw new Error(`turn for ${s.current_prayer_id} was not recorded`)
    order.push(s.current_prayer_id)
  }
  return order
}
