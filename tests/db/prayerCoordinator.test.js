// The client coordination layer, driven against the REAL SQL.
//
// This is the test the previous suite did not have. prayerRotation
// tests only ever checked a pure helper; nothing exercised the
// sequence TablePage.jsx actually performs -- mutate, authoritatively
// refresh, confirm the transition, and only then render or announce
// anything. That missing coverage is exactly where the production bug
// lived: the UI announced prayers that the database had refused.
//
// createPrayerCoordinator() is wired here to the same PGlite database
// the scenario matrix uses, so every assertion crosses the real
// plpgsql. A thin wrapper lets transport faults (lost responses,
// offline resyncs) be injected without faking the server's logic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, GROUP_ID } from './harness.mjs'
import {
  createPrayerCoordinator,
  prayerStateFromRow,
  memberPrayerState,
  describeOutcome,
  resolveCurrentTurn,
  OUTCOME,
  PRAYER_STATE
} from '../../src/lib/prayerSession.js'

let t
let ids
let coordinator
let faults

/** Supabase-shaped rpc backed by the real database. */
function makeRpc(testDb) {
  return async function rpc(name, args) {
    if (faults.failNext) {
      const mode = faults.failNext
      faults.failNext = null
      if (mode === 'before') {
        // Never reached the server.
        return { data: null, error: new Error('network unreachable') }
      }
      if (mode === 'after') {
        // The write COMMITTED and the response was lost on the way
        // back -- indistinguishable from a failure, from the client.
        await runRpc(testDb, name, args)
        return { data: null, error: new Error('socket closed') }
      }
    }
    if (faults.failResync && name === 'get_prayer_session_state') {
      faults.failResync = false
      return { data: null, error: new Error('resync offline') }
    }
    try {
      return { data: [await runRpc(testDb, name, args)], error: null }
    } catch (err) {
      return { data: null, error: err }
    }
  }
}

async function runRpc(testDb, name, args) {
  const keys = Object.keys(args)
  const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  const res = await testDb.db.query(
    `select * from public.${name}(${params})`,
    keys.map(k => args[k])
  )
  return res.rows[0]
}

const nameFor = id => {
  const i = ids.indexOf(id)
  return i === -1 ? 'Someone' : `Member${i + 1}`
}

async function setup(count = 3) {
  await t.seedDinners(10)
  ids = await t.seedGroup({ count })
  coordinator = createPrayerCoordinator({ rpc: makeRpc(t), groupId: GROUP_ID })
  await coordinator.loadSession()
  return ids
}

beforeEach(async () => {
  t = await createTestDb()
  faults = { failNext: null, failResync: false }
})
afterEach(async () => { await t.close() })

describe('mutate -> authoritative refresh -> confirm', () => {
  it('a genuine turn is confirmed and reports the real next person', async () => {
    const [a, b, c] = await setup(3)
    const res = await coordinator.completeTurn(a)

    expect(res.outcome).toBe(OUTCOME.RECORDED)
    expect(res.state.prayedMembers).toEqual([a])
    expect(res.state.currentPrayerId).toBe(b)
    expect(res.state.nextPrayerId).toBe(c)
    expect(describeOutcome({ ...res, action: 'pray' }, nameFor))
      .toBe('Member1 prayed. Member2 is up next. 🙏')
  })

  it('NEVER announces a prayer the database refused (the production bug)', async () => {
    const [a, b, c] = await setup(3)
    await coordinator.completeTurn(a)
    await coordinator.completeTurn(b)

    // A device that never saw those two turns still believes it is a's
    // turn. The old client announced "Member1 prayed. Member2 is up
    // next" here, for a write that never happened.
    const stale = await coordinator.completeTurn(a)

    expect(stale.outcome).toBe(OUTCOME.REFUSED)
    expect(stale.state.prayedMembers).toEqual([a, b])   // unchanged
    expect(stale.state.currentPrayerId).toBe(c)

    const message = describeOutcome({ ...stale, action: 'pray' }, nameFor)
    expect(message).not.toMatch(/Member1 prayed/)
    expect(message).toBe('Someone else already moved the table on — Member3 is up now.')
  })

  it('a double tap is benign and reports ALREADY, not success and not an error', async () => {
    const [a, b] = await setup(3)
    const first = await coordinator.completeTurn(a)
    const second = await coordinator.completeTurn(a)

    expect(first.outcome).toBe(OUTCOME.RECORDED)
    // The second tap's expected id is stale the instant the first
    // lands, so the server refuses it -- and because a IS in
    // prayed_members, the confirmation step still passes.
    expect(second.outcome).toBe(OUTCOME.ALREADY)
    expect(second.state.prayedMembers).toEqual([a])
    expect(second.state.currentPrayerId).toBe(b)
  })

  it('a tap after the night closed never re-announces an old turn', async () => {
    const [a, b] = await setup(2)
    await coordinator.completeTurn(a)
    const closing = await coordinator.completeTurn(b)
    expect(closing.state.allPrayed).toBe(true)
    expect(describeOutcome({ ...closing, action: 'pray' }, nameFor))
      .toBe('Everyone has had their turn tonight. 🙏')

    // A late tap naming a's long-finished turn is a stale view, not a
    // duplicate of what this device last did.
    const late = await coordinator.completeTurn(a)
    expect(late.outcome).toBe(OUTCOME.REFUSED)
    expect(late.state.prayedMembers).toEqual([a, b])
    expect(describeOutcome({ ...late, action: 'pray' }, nameFor))
      .toBe("Tonight's prayers are already complete. 🙏")

    // Double-tapping the turn this device just completed stays benign.
    const doubleTap = await coordinator.completeTurn(b)
    expect(doubleTap.outcome).toBe(OUTCOME.ALREADY)
  })

  it('two devices completing the same turn: only the winner claims it', async () => {
    const [a, b] = await setup(3)
    const deviceOne = createPrayerCoordinator({ rpc: makeRpc(t), groupId: GROUP_ID })
    const deviceTwo = createPrayerCoordinator({ rpc: makeRpc(t), groupId: GROUP_ID })

    const seenByBoth = (await deviceOne.resync()).currentPrayerId
    expect(seenByBoth).toBe(a)

    const first = await deviceOne.completeTurn(seenByBoth)
    const second = await deviceTwo.completeTurn(seenByBoth)

    expect(first.outcome).toBe(OUTCOME.RECORDED)
    // Device two did not cause this and must not say it did.
    expect(second.outcome).toBe(OUTCOME.REFUSED)
    expect(second.state.prayedMembers).toEqual([a])   // no double count
    expect(second.state.currentPrayerId).toBe(b)
    expect(describeOutcome({ ...second, action: 'pray' }, nameFor))
      .not.toMatch(/Member1 prayed/)
  })
})

describe('transport faults', () => {
  it('a mutation that never reached the server reports FAILED and changes nothing', async () => {
    const [a] = await setup(3)
    faults.failNext = 'before'

    const res = await coordinator.completeTurn(a)
    expect(res.outcome).toBe(OUTCOME.FAILED)
    expect(res.state.prayedMembers).toEqual([])
    expect(res.state.currentPrayerId).toBe(a)
    expect(describeOutcome({ ...res, action: 'pray' }, nameFor))
      .toBe("That didn't save. Tap it again when you're ready.")
  })

  it('a mutation that COMMITTED but lost its response self-heals on the next action', async () => {
    const [a, b] = await setup(3)
    faults.failNext = 'after'

    const lost = await coordinator.completeTurn(a)
    // The client cannot know it landed, so it must not claim success...
    expect(lost.outcome).toBe(OUTCOME.FAILED)
    // ...but the resync inside the failure path still shows the truth.
    expect(lost.state.prayedMembers).toEqual([a])
    expect(lost.state.currentPrayerId).toBe(b)

    // And the user's natural response -- tap again -- is safe.
    const retry = await coordinator.completeTurn(a)
    expect(retry.outcome).toBe(OUTCOME.ALREADY)
    expect(retry.state.prayedMembers).toEqual([a])   // never duplicated
  })

  it('when the resync read itself fails, the outcome is not over-claimed', async () => {
    const [a, b] = await setup(3)
    faults.failResync = true

    const res = await coordinator.completeTurn(a)
    // Falls back to the mutation's own server-computed row, which is
    // enough to confirm a landed in prayed_members.
    expect(res.outcome).toBe(OUTCOME.RECORDED)
    expect(res.state.currentPrayerId).toBe(b)
  })

  it('an offline resync after an offline mutation still reports FAILED without inventing state', async () => {
    const [a] = await setup(3)
    faults.failNext = 'before'
    faults.failResync = true

    const res = await coordinator.completeTurn(a)
    expect(res.outcome).toBe(OUTCOME.FAILED)
    expect(res.state).toBeNull()
  })
})

describe('pass and restore through the coordinator', () => {
  it('passing is confirmed, and never recorded as a prayer', async () => {
    const [a, b, c] = await setup(3)
    const res = await coordinator.passTurn(a)

    expect(res.outcome).toBe(OUTCOME.RECORDED)
    expect(res.state.passedMembers).toEqual([a])
    expect(res.state.prayedMembers).toEqual([])
    expect(res.state.absentMembers).toEqual([])
    expect(res.state.prayerTurnsCompleted).toBe(0)
    expect(res.state.currentPrayerId).toBe(b)
    expect(describeOutcome({ ...res, action: 'pass' }, nameFor))
      .toBe('Member1 passed for tonight. Member2 is up next. 🙏')
    void c
  })

  it('a stale pass is refused without claiming anything', async () => {
    const [a, b] = await setup(3)
    await coordinator.completeTurn(a)
    const stale = await coordinator.passTurn(a)
    expect(stale.outcome).toBe(OUTCOME.REFUSED)
    expect(stale.state.passedMembers).toEqual([])
    expect(stale.state.currentPrayerId).toBe(b)
  })

  it('restoring a passed member is confirmed by ABSENCE from passed_members', async () => {
    const [a, b] = await setup(3)
    await coordinator.passTurn(a)
    const restored = await coordinator.restorePassed(a)

    expect(restored.outcome).toBe(OUTCOME.RECORDED)
    expect(restored.state.passedMembers).toEqual([])
    expect(restored.state.currentPrayerId).toBe(a)   // exact spot back
    expect(restored.state.nextPrayerId).toBe(b)
  })

  it('marking absent and present are both confirmed against the real set', async () => {
    const [a, b] = await setup(3)
    const away = await coordinator.setAbsent(a, true)
    expect(away.outcome).toBe(OUTCOME.RECORDED)
    expect(away.state.absentMembers).toEqual([a])
    expect(away.state.currentPrayerId).toBe(b)

    const back = await coordinator.setAbsent(a, false)
    expect(back.outcome).toBe(OUTCOME.RECORDED)
    expect(back.state.absentMembers).toEqual([])
    expect(back.state.currentPrayerId).toBe(a)
  })
})

describe('the Realtime mirror agrees with the server', () => {
  it('interpreting a raw row matches get_prayer_session_state exactly', async () => {
    const [a, b, c, d] = await setup(4)
    // Walk the dinner through a deliberately messy sequence and check
    // the JS interpretation against the SQL at every single step.
    const steps = [
      () => coordinator.completeTurn(a),
      () => coordinator.setAbsent(c, true),
      () => coordinator.passTurn(b),
      () => coordinator.setAbsent(c, false),
      () => coordinator.completeTurn(c),
      () => coordinator.completeTurn(d)
    ]

    for (const step of steps) {
      await step()
      const authoritative = await coordinator.resync()
      const fromRow = prayerStateFromRow(await t.row())
      expect(fromRow.currentPrayerId).toBe(authoritative.currentPrayerId)
      expect(fromRow.nextPrayerId).toBe(authoritative.nextPrayerId)
      expect(fromRow.allPrayed).toBe(authoritative.allPrayed)
      expect(fromRow.pendingCount).toBe(authoritative.pendingCount)
      expect(fromRow.prayedMembers).toEqual(authoritative.prayedMembers)
      expect(fromRow.passedMembers).toEqual(authoritative.passedMembers)
      expect(fromRow.absentMembers).toEqual(authoritative.absentMembers)
    }
  })

  it('agrees with the server across exhaustive absent/prayed/passed combinations', async () => {
    // Property check over every partition of a 4-member roster into the
    // three identity sets. This is what stops the JS mirror drifting
    // from resolve_current_turn() the way the SQL itself drifted in
    // July -- a drift no hand-written example set would have caught.
    const order = ['11111111-0000-4000-8000-000000000001',
                   '22222222-0000-4000-8000-000000000002',
                   '33333333-0000-4000-8000-000000000003',
                   '44444444-0000-4000-8000-000000000004']
    let checked = 0
    for (let mask = 0; mask < 4 ** 4; mask++) {
      const absent = [], prayed = [], passed = []
      for (let i = 0; i < 4; i++) {
        const slot = Math.floor(mask / 4 ** i) % 4
        if (slot === 1) prayed.push(order[i])
        else if (slot === 2) passed.push(order[i])
        else if (slot === 3) absent.push(order[i])
      }
      const sql = await t.db.query(
        `select public.resolve_current_turn($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[]) as cur,
                (select pending_count from public.derive_prayer_state(
                   $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], false)) as pending`,
        [order, absent, prayed, passed]
      )
      expect(resolveCurrentTurn(order, absent, prayed, passed)).toBe(sql.rows[0].cur)
      const js = prayerStateFromRow({
        id: 'x', prayer_order: order, absent_members: absent,
        prayed_members: prayed, passed_members: passed, rotation_advanced: false
      })
      expect(js.pendingCount).toBe(sql.rows[0].pending)
      checked++
    }
    expect(checked).toBe(256)
  })

  it('a closed night in a raw row exposes no current or next turn', async () => {
    const [a, b] = await setup(2)
    await coordinator.completeTurn(a)
    await coordinator.completeTurn(b)
    const fromRow = prayerStateFromRow(await t.row())
    expect(fromRow.allPrayed).toBe(true)
    expect(fromRow.currentPrayerId).toBeNull()
    expect(fromRow.nextPrayerId).toBeNull()
  })

  it('an uppercase uuid in a payload resolves to the same person', async () => {
    // Realtime payloads and RPC responses have differed in case before;
    // a naive string compare would strand the rotation on someone who
    // has already prayed.
    const [a, b] = await setup(3)
    await coordinator.completeTurn(a)
    const row = await t.row()
    const shouty = {
      ...row,
      prayed_members: row.prayed_members.map(x => x.toUpperCase()),
      prayer_order: row.prayer_order.map(x => x.toUpperCase())
    }
    const state = prayerStateFromRow(shouty)
    expect(state.currentPrayerId.toLowerCase()).toBe(b)
    expect(memberPrayerState(a, state)).toBe(PRAYER_STATE.PRAYED)
  })
})

describe('per-member display state', () => {
  it('classifies all four states, with PRAYED winning over a later absence', async () => {
    const [a, b, c, d] = await setup(4)
    await coordinator.completeTurn(a)
    await coordinator.setAbsent(a, true)   // prayed, then stepped away
    await coordinator.passTurn(b)
    await coordinator.setAbsent(c, true)
    const state = await coordinator.resync()

    expect(memberPrayerState(a, state)).toBe(PRAYER_STATE.PRAYED)
    expect(memberPrayerState(b, state)).toBe(PRAYER_STATE.PASSED)
    expect(memberPrayerState(c, state)).toBe(PRAYER_STATE.ABSENT)
    expect(memberPrayerState(d, state)).toBe(PRAYER_STATE.PENDING)
    expect(state.currentPrayerId).toBe(d)
  })
})
