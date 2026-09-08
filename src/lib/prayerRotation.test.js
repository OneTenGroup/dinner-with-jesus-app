import { describe, it, expect } from 'vitest'
import { resolveCurrentTurn } from './prayerRotation'

// ============================================================
// Part 1: resolveCurrentTurn() -- the actual client function, imported
// directly (not re-implemented), so a change to the real code is what
// gets tested here, not a copy that could silently drift from it.
// ============================================================
describe('resolveCurrentTurn (client mirror of public.resolve_current_turn)', () => {
  it('returns the first member who is neither prayed nor absent', () => {
    expect(resolveCurrentTurn(['A', 'B', 'C'], [], [])).toBe('A')
    expect(resolveCurrentTurn(['A', 'B', 'C'], [], ['A'])).toBe('B')
  })

  it('skips absent members', () => {
    expect(resolveCurrentTurn(['A', 'B', 'C'], ['A'], [])).toBe('B')
  })

  it('lets a returning member reclaim their exact spot if not yet prayed past', () => {
    // A prayed, B was absent then returns present, C never touched -- B
    // must be current again, not skipped to C.
    expect(resolveCurrentTurn(['A', 'B', 'C'], [], ['A'])).toBe('B')
  })

  it('returns null when everyone remaining is prayed or absent', () => {
    expect(resolveCurrentTurn(['A', 'B', 'C'], ['B'], ['A', 'C'])).toBeNull()
    expect(resolveCurrentTurn(['A', 'B', 'C'], [], ['A', 'B', 'C'])).toBeNull()
  })

  it('returns null for an empty prayer_order', () => {
    expect(resolveCurrentTurn([], [], [])).toBeNull()
  })
})

// ============================================================
// Part 2: full state-machine contract mirror.
//
// This is a faithful port of the LIVE SQL (see
// supabase/migrations/20260809000003_individual_prayed_members_tracking.sql
// and 20260809000004_atomic_set_member_absent.sql) for
// get_or_create_tonight_session / complete_prayer_turn / set_member_absent.
// It exists because those three functions only live in Postgres --
// this suite is what pins down the CONTRACT they must keep. If a future
// migration changes their behavior, update this mirror in the same
// change, and re-verify with the migration's own "VERIFICATION
// REQUIRED" checklist (pg_proc inspection against the live DB) -- this
// suite is a regression net for the intended behavior, not a
// substitute for that manual check.
//
// This exists because self-heal prayer_order logic was silently
// dropped by a later `create or replace function` once already
// (20260716000001 -> dropped by 20260719000001 -> restored by
// 20260724000001, unnoticed for 5 days) -- a case a test suite over
// this exact contract would have caught immediately.
// ============================================================
class FakeGroupVerseDb {
  constructor(memberIds) {
    this.members = [...memberIds]
    this.groups = { next_prayer_user_id: null }
    this.sessions = new Map()
  }

  addMember(id) {
    this.members.push(id)
  }

  getOrCreateTonightSession(date) {
    let row = this.sessions.get(date)
    if (!row) {
      let order = [...this.members]
      const starter = this.groups.next_prayer_user_id
      if (starter !== null && order.includes(starter)) {
        const pos = order.indexOf(starter)
        order = order.slice(pos).concat(order.slice(0, pos))
      }
      row = { prayer_order: order, absent_members: [], prayed_members: [], rotation_advanced: false }
      this.sessions.set(date, row)
    } else {
      const turnsCompleted = row.prayed_members.length
      const currentOrder = row.prayer_order
      const currentMembers = [...this.members]
      if (currentOrder.length === 0 && turnsCompleted === 0) {
        row.prayer_order = currentMembers
      } else if (turnsCompleted < currentOrder.length) {
        const missing = currentMembers.filter((m) => !currentOrder.includes(m))
        if (missing.length > 0) row.prayer_order = currentOrder.concat(missing)
      }
    }
    const cur = row.rotation_advanced ? null : resolveCurrentTurn(row.prayer_order, row.absent_members, row.prayed_members)
    const next = row.rotation_advanced || cur === null ? null : resolveCurrentTurn(row.prayer_order, row.absent_members, [...row.prayed_members, cur])
    return {
      prayer_order: row.prayer_order,
      absent_members: row.absent_members,
      prayed_members: row.prayed_members,
      current_prayer_id: cur,
      next_prayer_id: next,
      all_prayed: row.rotation_advanced,
    }
  }

  completePrayerTurn(date, expectedCurrentPrayerId) {
    const row = this.sessions.get(date)
    if (!row) throw new Error('No dinner session started yet')
    const order = row.prayer_order
    const memberCount = order.length
    if (memberCount === 0) throw new Error('No members to rotate')

    let newPrayed = row.prayed_members
    if (!row.rotation_advanced) {
      const actualCurrent = resolveCurrentTurn(order, row.absent_members, row.prayed_members)
      if (actualCurrent !== null && expectedCurrentPrayerId !== null && actualCurrent === expectedCurrentPrayerId && !row.prayed_members.includes(actualCurrent)) {
        row.prayed_members = [...row.prayed_members, actualCurrent]
        newPrayed = row.prayed_members
      }
    }

    let finalCur = row.rotation_advanced ? null : resolveCurrentTurn(order, row.absent_members, newPrayed)

    if (!row.rotation_advanced && finalCur === null) {
      row.rotation_advanced = true
      this.groups.next_prayer_user_id = memberCount === 1 ? order[0] : order[1]
    }

    const finalNext = row.rotation_advanced || finalCur === null ? null : resolveCurrentTurn(order, row.absent_members, [...newPrayed, finalCur])

    return {
      prayer_turns_completed: newPrayed.length,
      current_prayer_id: row.rotation_advanced ? null : finalCur,
      next_prayer_id: finalNext,
      all_prayed: row.rotation_advanced,
    }
  }

  setMemberAbsent(date, memberId, absent) {
    const row = this.sessions.get(date)
    if (!row) throw new Error('No dinner session started yet')
    if (absent) {
      if (!row.absent_members.includes(memberId)) row.absent_members = [...row.absent_members, memberId]
    } else {
      row.absent_members = row.absent_members.filter((m) => m !== memberId)
    }
    const finalCur = row.rotation_advanced ? null : resolveCurrentTurn(row.prayer_order, row.absent_members, row.prayed_members)
    const finalNext = row.rotation_advanced || finalCur === null ? null : resolveCurrentTurn(row.prayer_order, row.absent_members, [...row.prayed_members, finalCur])
    return {
      absent_members: row.absent_members,
      prayer_turns_completed: row.prayed_members.length,
      current_prayer_id: finalCur,
      next_prayer_id: finalNext,
      all_prayed: row.rotation_advanced,
    }
  }
}

describe('prayer rotation state machine (mirrors the live SQL contract)', () => {
  it('rotates the nightly starter in a clean round robin across many fully-completed nights', () => {
    const [A, B, C, D] = ['A', 'B', 'C', 'D']
    const db = new FakeGroupVerseDb([A, B, C, D])
    const starters = []
    for (let day = 1; day <= 12; day++) {
      const date = `day${day}`
      const session = db.getOrCreateTonightSession(date)
      starters.push(session.current_prayer_id)
      let cur = session.current_prayer_id
      let guard = 0
      while (cur !== null && guard++ < 10) {
        cur = db.completePrayerTurn(date, cur).current_prayer_id
      }
    }
    expect(starters).toEqual([A, B, C, D, A, B, C, D, A, B, C, D])
  })

  it('lets a member who returns present before the night closes reclaim their spot', () => {
    const [A, B, C] = ['A', 'B', 'C']
    const db = new FakeGroupVerseDb([A, B, C])
    const date = 'night'
    db.getOrCreateTonightSession(date)
    expect(db.completePrayerTurn(date, A).current_prayer_id).toBe('B')
    db.setMemberAbsent(date, B, true)
    expect(db.getOrCreateTonightSession(date).current_prayer_id).toBe('C')
    // C is NOT the last eligible member yet in this scenario (B is
    // still absent but the night is not closing on C's completion --
    // that's covered by the next test); here B returns first.
    const back = db.setMemberAbsent(date, B, false)
    expect(back.current_prayer_id).toBe('B')
  })

  it('closes the night once no eligible present-and-unprayed member remains, even with an absentee skipped', () => {
    const [A, B, C] = ['A', 'B', 'C']
    const db = new FakeGroupVerseDb([A, B, C])
    const date = 'night'
    db.getOrCreateTonightSession(date)
    db.completePrayerTurn(date, A)
    db.setMemberAbsent(date, B, true)
    const r = db.completePrayerTurn(date, C)
    expect(r.all_prayed).toBe(true)
    // Tomorrow starts with B (next after A) -- absence does not skip
    // the duty roster, only tonight's individual turn.
    expect(db.groups.next_prayer_user_id).toBe(B)
  })

  it('never completes the night or consumes a rotation turn from marking everyone absent with zero real prayers (the 2026-08-08 production incident)', () => {
    const [A, B, C] = ['A', 'B', 'C']
    const db = new FakeGroupVerseDb([A, B, C])
    const date = 'night'
    db.getOrCreateTonightSession(date)
    db.setMemberAbsent(date, A, true)
    db.setMemberAbsent(date, B, true)
    const allAbsent = db.setMemberAbsent(date, C, true)
    expect(allAbsent.all_prayed).toBe(false)
    expect(allAbsent.current_prayer_id).toBeNull()

    db.setMemberAbsent(date, A, false)
    db.setMemberAbsent(date, B, false)
    const allBack = db.setMemberAbsent(date, C, false)
    expect(allBack.current_prayer_id).toBe(A)
    expect(db.groups.next_prayer_user_id).toBeNull()
  })

  it('appends a member who joins mid-rotation to tonight\'s live prayer_order', () => {
    const [A, B, C, D] = ['A', 'B', 'C', 'D']
    const db = new FakeGroupVerseDb([A, B, C])
    const date = 'night'
    db.getOrCreateTonightSession(date)
    db.completePrayerTurn(date, A)
    db.addMember(D)
    const s = db.getOrCreateTonightSession(date)
    expect(s.prayer_order).toContain(D)
  })

  it('does not let a genuinely skipped (never-opened-to-completion) night consume the next starter\'s turn', () => {
    const [A, B, C] = ['A', 'B', 'C']
    const db = new FakeGroupVerseDb([A, B, C])
    let s = db.getOrCreateTonightSession('d1')
    let cur = s.current_prayer_id
    while (cur !== null) cur = db.completePrayerTurn('d1', cur).current_prayer_id
    expect(db.groups.next_prayer_user_id).toBe(B)

    db.getOrCreateTonightSession('d2') // family opens the app but never finishes tonight
    const d3 = db.getOrCreateTonightSession('d3')
    expect(d3.current_prayer_id).toBe(B)
  })
})
