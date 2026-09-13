// Subscription lifecycle and pure-helper coverage.
//
// The state machine itself is tested against real PostgreSQL in
// tests/db/. What is left here is the Realtime channel contract, which
// has no database component at all -- and which is where a real
// production failure lived: a channel that reported SUBSCRIBED while
// being torn down, on a device that then never learned about another
// phone's prayers for the rest of the night.
import { describe, it, expect, vi } from 'vitest'
import {
  createPrayerChannel,
  createPrayerCoordinator,
  prayerStateFromRow,
  memberPrayerState,
  resolveCurrentTurn,
  normalizePrayerState,
  describeOutcome,
  PRAYER_STATE,
  OUTCOME
} from './prayerSession.js'

const A = '11111111-0000-4000-8000-000000000001'
const B = '22222222-0000-4000-8000-000000000002'
const C = '33333333-0000-4000-8000-000000000003'

/** Minimal stand-in for supabase's realtime client. */
function fakeSupabase() {
  const channels = []
  return {
    channels,
    removed: [],
    channel(topic) {
      const handlers = []
      const ch = {
        topic,
        handlers,
        statusCallback: null,
        on(_event, filter, cb) { handlers.push({ filter, cb }); return ch },
        subscribe(cb) { ch.statusCallback = cb; return ch }
      }
      channels.push(ch)
      return ch
    },
    removeChannel(ch) { this.removed.push(ch.topic) }
  }
}

function emit(ch, event, row) {
  for (const h of ch.handlers) {
    if (h.filter.event === event) h.cb({ new: row })
  }
}

describe('createPrayerChannel', () => {
  it('gives every subscription a unique topic, so a leave can never race a join', () => {
    // The old code named the channel group_verse:<group_id>. When the
    // effect re-ran (sessionId going null -> value), it removed and
    // re-created the SAME topic in one tick, and the in-flight leave
    // could tear down the fresh join while .subscribe() still reported
    // success -- deafening that device silently.
    const supabase = fakeSupabase()
    const first = createPrayerChannel({ supabase, groupId: 'g1', onRow() {} })
    const second = createPrayerChannel({ supabase, groupId: 'g1', onRow() {} })

    expect(first.topic).not.toBe(second.topic)
    expect(first.topic).toContain('g1')
    expect(new Set(supabase.channels.map(c => c.topic)).size).toBe(2)
  })

  it('subscribes to this group only', () => {
    const supabase = fakeSupabase()
    createPrayerChannel({ supabase, groupId: 'g7', onRow() {} })
    const ch = supabase.channels[0]
    expect(ch.handlers.every(h => h.filter.filter === 'group_id=eq.g7')).toBe(true)
    expect(ch.handlers.map(h => h.filter.event).sort()).toEqual(['INSERT', 'UPDATE'])
  })

  it('forwards UPDATE rows to onRow', () => {
    const supabase = fakeSupabase()
    const onRow = vi.fn()
    createPrayerChannel({ supabase, groupId: 'g1', onRow })
    emit(supabase.channels[0], 'UPDATE', { id: 's1', prayer_order: [A] })
    expect(onRow).toHaveBeenCalledWith({ id: 's1', prayer_order: [A] })
  })

  it('treats a new dinner row as "reload everything", not a patch', () => {
    // A 4am rollover or another device opening tonight's table first
    // means the verse content may be stale too, so patching the row in
    // would leave the screen showing yesterday's dinner.
    const supabase = fakeSupabase()
    const onRow = vi.fn()
    const onNeedsResync = vi.fn()
    createPrayerChannel({ supabase, groupId: 'g1', onRow, onNeedsResync })
    emit(supabase.channels[0], 'INSERT', { id: 's2' })
    expect(onRow).not.toHaveBeenCalled()
    expect(onNeedsResync).toHaveBeenCalledWith('insert')
  })

  it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])(
    'asks for a resync when the channel reports %s',
    status => {
      // The old .subscribe() took no status callback at all, so a dead
      // channel was indistinguishable from a healthy quiet one.
      const supabase = fakeSupabase()
      const onNeedsResync = vi.fn()
      createPrayerChannel({ supabase, groupId: 'g1', onRow() {}, onNeedsResync })
      supabase.channels[0].statusCallback(status)
      expect(onNeedsResync).toHaveBeenCalledWith(status)
    }
  )

  it('does not ask for a resync while the channel is healthy', () => {
    const supabase = fakeSupabase()
    const onNeedsResync = vi.fn()
    createPrayerChannel({ supabase, groupId: 'g1', onRow() {}, onNeedsResync })
    supabase.channels[0].statusCallback('SUBSCRIBED')
    expect(onNeedsResync).not.toHaveBeenCalled()
  })

  it('goes silent after unsubscribe, so a late event cannot revive a torn-down screen', () => {
    const supabase = fakeSupabase()
    const onRow = vi.fn()
    const onNeedsResync = vi.fn()
    const sub = createPrayerChannel({ supabase, groupId: 'g1', onRow, onNeedsResync })

    sub.unsubscribe()
    emit(supabase.channels[0], 'UPDATE', { id: 's1' })
    supabase.channels[0].statusCallback('CHANNEL_ERROR')

    expect(supabase.removed).toEqual([sub.topic])
    expect(onRow).not.toHaveBeenCalled()
    expect(onNeedsResync).not.toHaveBeenCalled()
  })
})

describe('resolveCurrentTurn', () => {
  it('returns the first member who is neither prayed, passed nor absent', () => {
    expect(resolveCurrentTurn([A, B, C], [], [], [])).toBe(A)
    expect(resolveCurrentTurn([A, B, C], [], [A], [])).toBe(B)
  })

  it('skips absent and passed members alike', () => {
    expect(resolveCurrentTurn([A, B, C], [A], [], [B])).toBe(C)
    expect(resolveCurrentTurn([A, B, C], [B], [A], [])).toBe(C)
  })

  it('lets a member reclaim their exact spot once they are no longer excluded', () => {
    expect(resolveCurrentTurn([A, B, C], [B], [A], [])).toBe(C)
    expect(resolveCurrentTurn([A, B, C], [], [A], [])).toBe(B)
  })

  it('returns null when nobody is eligible, and for an empty roster', () => {
    expect(resolveCurrentTurn([A, B], [B], [A], [])).toBeNull()
    expect(resolveCurrentTurn([A, B], [], [], [A, B])).toBeNull()
    expect(resolveCurrentTurn([], [], [], [])).toBeNull()
  })

  it('tolerates missing arrays rather than throwing on a partial payload', () => {
    expect(resolveCurrentTurn([A, B], undefined, undefined, undefined)).toBe(A)
    expect(resolveCurrentTurn(undefined, [], [], [])).toBeNull()
  })
})

describe('prayerStateFromRow', () => {
  it('derives current, next and pending from a raw row', () => {
    const s = prayerStateFromRow({
      id: 's1', prayer_order: [A, B, C],
      absent_members: [], prayed_members: [A], passed_members: [],
      rotation_advanced: false
    })
    expect(s.currentPrayerId).toBe(B)
    expect(s.nextPrayerId).toBe(C)
    expect(s.pendingCount).toBe(2)
    expect(s.allPrayed).toBe(false)
  })

  it('exposes no turn at all once rotation_advanced is set', () => {
    const s = prayerStateFromRow({
      id: 's1', prayer_order: [A, B],
      absent_members: [], prayed_members: [A, B], passed_members: [],
      rotation_advanced: true
    })
    expect(s.allPrayed).toBe(true)
    expect(s.currentPrayerId).toBeNull()
    expect(s.nextPrayerId).toBeNull()
  })

  it('distinguishes "nobody present" from "everyone prayed"', () => {
    // Both have no current person; only one of them is complete. The
    // old client could not tell these apart and showed "your turn to
    // pray" for both.
    const nobodyHere = prayerStateFromRow({
      id: 's1', prayer_order: [A, B],
      absent_members: [A, B], prayed_members: [], passed_members: [],
      rotation_advanced: false
    })
    expect(nobodyHere.currentPrayerId).toBeNull()
    expect(nobodyHere.allPrayed).toBe(false)
    expect(nobodyHere.pendingCount).toBe(0)
  })

  it('returns null for a missing row', () => {
    expect(prayerStateFromRow(null)).toBeNull()
  })
})

describe('memberPrayerState', () => {
  const state = {
    prayedMembers: [A], passedMembers: [B], absentMembers: [C, A]
  }

  it('classifies each of the four states', () => {
    expect(memberPrayerState(A, state)).toBe(PRAYER_STATE.PRAYED)   // prayed beats absent
    expect(memberPrayerState(B, state)).toBe(PRAYER_STATE.PASSED)
    expect(memberPrayerState(C, state)).toBe(PRAYER_STATE.ABSENT)
    expect(memberPrayerState('other', state)).toBe(PRAYER_STATE.PENDING)
  })

  it('does not throw on a missing state', () => {
    expect(memberPrayerState(A, null)).toBe(PRAYER_STATE.PENDING)
  })
})

describe('normalizePrayerState', () => {
  it('fills in every field from a partial row without inventing membership', () => {
    const s = normalizePrayerState({ session_id: 's1', prayer_order: [A] })
    expect(s.prayerOrder).toEqual([A])
    expect(s.prayedMembers).toEqual([])
    expect(s.passedMembers).toEqual([])
    expect(s.allPrayed).toBe(false)
    expect(s.sessionExists).toBe(true)
  })

  it('respects an explicit session_exists = false', () => {
    expect(normalizePrayerState({ session_exists: false }).sessionExists).toBe(false)
  })

  it('returns null for nothing', () => {
    expect(normalizePrayerState(undefined)).toBeNull()
  })
})

describe('describeOutcome', () => {
  const nameFor = id => ({ [A]: 'Steve', [B]: 'Mandy' }[id] || 'Someone')

  it('never claims a prayer for a refused mutation', () => {
    const msg = describeOutcome({
      outcome: OUTCOME.REFUSED,
      state: { allPrayed: false, currentPrayerId: B },
      memberId: A,
      action: 'pray'
    }, nameFor)
    expect(msg).not.toMatch(/Steve prayed/)
    expect(msg).toBe('Someone else already moved the table on — Mandy is up now.')
  })

  it('says the night is finished when a refusal is because it closed', () => {
    expect(describeOutcome({
      outcome: OUTCOME.REFUSED,
      state: { allPrayed: true, currentPrayerId: null },
      memberId: A, action: 'pray'
    }, nameFor)).toBe("Tonight's prayers are already complete. 🙏")
  })

  it('reports a transport failure as a retryable save problem', () => {
    expect(describeOutcome({
      outcome: OUTCOME.FAILED, state: null, memberId: A, action: 'pray'
    }, nameFor)).toBe("That didn't save. Tap it again when you're ready.")
  })

  it('names the right verb for a pass', () => {
    expect(describeOutcome({
      outcome: OUTCOME.RECORDED,
      state: { allPrayed: false, currentPrayerId: B },
      memberId: A, action: 'pass'
    }, nameFor)).toBe('Steve passed for tonight. Mandy is up next. 🙏')
  })

  it('handles a recorded turn that leaves nobody present', () => {
    expect(describeOutcome({
      outcome: OUTCOME.RECORDED,
      state: { allPrayed: false, currentPrayerId: null },
      memberId: A, action: 'pray'
    }, nameFor)).toBe('Steve prayed. No one else is marked present right now.')
  })
})

describe('createPrayerCoordinator argument handling', () => {
  it('refuses to be built without an rpc function', () => {
    expect(() => createPrayerCoordinator({ groupId: 'g1' })).toThrow(/rpc function/)
  })

  it('passes group_id_input on every call', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ session_exists: true }], error: null })
    const c = createPrayerCoordinator({ rpc, groupId: 'g9' })
    await c.resync()
    expect(rpc).toHaveBeenCalledWith('get_prayer_session_state', { group_id_input: 'g9' })
  })

  it('surfaces an rpc error from loadSession rather than rendering an empty table', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('boom') })
    const c = createPrayerCoordinator({ rpc, groupId: 'g9' })
    await expect(c.loadSession()).rejects.toThrow('boom')
  })
})
