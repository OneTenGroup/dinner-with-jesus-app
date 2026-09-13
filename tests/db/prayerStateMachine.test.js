// The prayer state machine scenario matrix, executed against the REAL
// shipping SQL in a real PostgreSQL (see harness.mjs for what that
// does and does not prove).
//
// Numbered scenarios map 1:1 to the required matrix. Scenarios marked
// [+] were added from the architecture rather than the original list.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, prayEveryTurn, GROUP_ID } from './harness.mjs'

let t
let ids

async function setup(count, opts = {}) {
  await t.seedDinners(opts.dinners ?? 12)
  ids = await t.seedGroup({ count, timezone: opts.timezone })
  await t.session()
  return ids
}

beforeEach(async () => { t = await createTestDb() })
afterEach(async () => { await t.close() })

describe('roster, order and fair starting rotation', () => {
  it('1. solo member: one turn, then the night is complete', async () => {
    const [a] = await setup(1)
    const s = await t.state()
    expect(s.current_prayer_id).toBe(a)
    expect(s.next_prayer_id).toBeNull()
    expect(s.pending_count).toBe(1)

    const res = await t.prayed(a)
    expect(res.recorded).toBe(true)
    expect(res.all_prayed).toBe(true)
    expect(res.current_prayer_id).toBeNull()
    expect(res.pending_count).toBe(0)

    // A one-member table starts with the same person tomorrow.
    expect((await t.group()).next_prayer_user_id).toBe(a)
  })

  it('2. two members: each prays exactly once, in order', async () => {
    const [a, b] = await setup(2)
    expect(await prayEveryTurn(t)).toEqual([a, b])
    expect((await t.state()).all_prayed).toBe(true)
    expect((await t.group()).next_prayer_user_id).toBe(b)
  })

  it('3. three members: one different person becomes current after each turn', async () => {
    const [a, b, c] = await setup(3)

    expect((await t.state()).current_prayer_id).toBe(a)
    let r = await t.prayed(a)
    expect([r.recorded, r.current_prayer_id, r.next_prayer_id]).toEqual([true, b, c])

    r = await t.prayed(b)
    expect([r.recorded, r.current_prayer_id, r.next_prayer_id]).toEqual([true, c, null])

    r = await t.prayed(c)
    expect(r.recorded).toBe(true)
    expect(r.all_prayed).toBe(true)
    expect(r.current_prayer_id).toBeNull()
    expect(r.prayed_members).toEqual([a, b, c])
  })

  it('4. larger group (8): everyone prays once, nobody repeats', async () => {
    const eight = await setup(8)
    const seq = await prayEveryTurn(t)
    expect(seq).toEqual(eight)
    expect(new Set(seq).size).toBe(8)
  })

  it('5. an entire rotation driven from ONE shared phone', async () => {
    // The caller stays member 1 for every single turn. No other member
    // ever authenticates, and none of them need to.
    const [a, b, c, d] = await setup(4)
    await t.actAs(a)
    const seq = await prayEveryTurn(t)
    expect(seq).toEqual([a, b, c, d])
    expect(t.currentActor).toBe(a)
    expect((await t.state()).all_prayed).toBe(true)
  })

  it('6. multiple devices: different members record different turns', async () => {
    const [a, b, c] = await setup(3)
    await t.actAs(c)
    expect((await t.prayed(a)).recorded).toBe(true)
    await t.actAs(b)
    expect((await t.prayed(b)).recorded).toBe(true)
    await t.actAs(a)
    expect((await t.prayed(c)).recorded).toBe(true)
    expect((await t.state()).all_prayed).toBe(true)
  })

  it('7/8/9. the current person never has to be involved at all', async () => {
    // Their app closed (7), never opened (8), or phone dead (9) are all
    // the same thing to the server: somebody else records the turn.
    const [a, b, c] = await setup(3)
    await t.actAs(a) // only member 1's device is ever used
    expect((await t.prayed(a)).recorded).toBe(true)
    expect((await t.prayed(b)).recorded).toBe(true) // b never authenticated
    expect((await t.prayed(c)).recorded).toBe(true) // c never authenticated
    expect((await t.state()).prayed_members).toEqual([a, b, c])
  })

  it('32. the starting person rotates fairly across consecutive dinners', async () => {
    const four = await setup(4)
    const starters = []

    for (let day = 0; day < 4; day++) {
      await t.setNow(`2026-09-${12 + day}T18:00:00Z`)
      const s = await t.session()
      starters.push(s.prayer_order[0])
      const seq = await prayEveryTurn(t)
      // Every eligible person still gets exactly one turn each night.
      expect(new Set(seq).size).toBe(4)
    }

    // The starting slot walks the table instead of sticking to
    // whoever happens to sort first by created_at.
    expect(starters).toEqual([four[0], four[1], four[2], four[3]])
  })

  it('33/34. nobody repeats and nobody is silently skipped, over many nights', async () => {
    const five = await setup(5, { dinners: 30 })
    for (let day = 0; day < 6; day++) {
      await t.setNow(`2026-09-${12 + day}T18:00:00Z`)
      await t.session()
      const seq = await prayEveryTurn(t)
      expect(seq.length).toBe(5)                 // nobody skipped
      expect(new Set(seq).size).toBe(5)          // nobody repeated
      expect([...seq].sort()).toEqual([...five].sort())
    }
  })
})

describe('attendance (ABSENT)', () => {
  it('10. the current person marked Not Here hands the turn to the next eligible person', async () => {
    const [a, b, c] = await setup(3)
    const r = await t.setAbsent(a, true)
    expect(r.recorded).toBe(true)
    expect(r.current_prayer_id).toBe(b)
    expect(r.next_prayer_id).toBe(c)
    expect(r.all_prayed).toBe(false)
    // Attendance must never record a prayer.
    expect(r.prayed_members).toEqual([])
    expect(r.prayer_turns_completed).toBe(0)
  })

  it('11. a FUTURE person marked Not Here does not disturb the current turn', async () => {
    const [a, b, c] = await setup(3)
    const r = await t.setAbsent(c, true)
    expect(r.current_prayer_id).toBe(a)
    expect(r.next_prayer_id).toBe(b)

    expect((await t.prayed(a)).current_prayer_id).toBe(b)
    const last = await t.prayed(b)
    expect(last.all_prayed).toBe(true)     // c was absent, so the night closes
    expect(last.prayed_members).toEqual([a, b])
  })

  it('12. a person restored to present BEFORE their turn reclaims their exact spot', async () => {
    const [a, b, c] = await setup(3)
    await t.setAbsent(b, true)
    expect((await t.state()).current_prayer_id).toBe(a)
    await t.prayed(a)
    // With b absent, c would be up...
    expect((await t.state()).current_prayer_id).toBe(c)
    // ...but restoring b puts b back in front of c, their real position.
    const r = await t.setAbsent(b, false)
    expect(r.current_prayer_id).toBe(b)
    expect(r.next_prayer_id).toBe(c)
  })

  it('13a. restored after the rotation passed their position, while the night is still open', async () => {
    // This is the scalar-position bug that 2026-08-09 fixed; it must
    // stay fixed with passed_members in the picture. b is restored
    // while d is still PENDING, so the night has not closed and b
    // reclaims their real position -- ahead of d, not appended.
    const [a, b, c, d] = await setup(4)
    await t.setAbsent(b, true)
    await t.prayed(a)
    await t.prayed(c)                    // rotation has moved past b's slot
    expect((await t.state()).current_prayer_id).toBe(d)

    const r = await t.setAbsent(b, false)
    expect(r.current_prayer_id).toBe(b)  // b, not d
    expect(r.next_prayer_id).toBe(d)
    expect(r.all_prayed).toBe(false)
    expect((await t.prayed(b)).current_prayer_id).toBe(d)
    expect((await t.prayed(d)).all_prayed).toBe(true)
  })

  it('13b. restored after the night has CLOSED does not reopen it -- they start tomorrow instead', async () => {
    // With b absent, a and c praying removes the last PENDING member,
    // so the night legitimately completes (the long-standing rule:
    // a real completion that leaves nobody eligible closes the night).
    // Restoring b afterwards must not resurrect it. b is not skipped:
    // because tomorrow's starter is position 2 of tonight's order, b
    // is exactly who starts the next dinner.
    const [a, b, c] = await setup(3)
    await t.setAbsent(b, true)
    await t.prayed(a)
    const closing = await t.prayed(c)
    expect(closing.all_prayed).toBe(true)
    expect(closing.prayed_members).toEqual([a, c])

    const r = await t.setAbsent(b, false)
    expect(r.all_prayed).toBe(true)          // stays closed
    expect(r.current_prayer_id).toBeNull()
    expect((await t.prayed(b)).recorded).toBe(false)

    expect((await t.group()).next_prayer_user_id).toBe(b)
  })

  it('16. an already-prayed person later marked absent stays PRAYED and does not reopen', async () => {
    const [a, b, c] = await setup(3)
    await t.prayed(a)
    const r = await t.setAbsent(a, true)
    expect(r.prayed_members).toContain(a)   // the completed turn is permanent
    expect(r.absent_members).toEqual([a])
    expect(r.current_prayer_id).toBe(b)     // unchanged
    expect(r.prayer_turns_completed).toBe(1)

    await t.prayed(b)
    expect((await t.prayed(c)).all_prayed).toBe(true)
  })

  it('30. all but one person absent: the remaining person completes the night alone', async () => {
    const [a, b, c] = await setup(3)
    await t.setAbsent(a, true)
    await t.setAbsent(c, true)
    const s = await t.state()
    expect(s.current_prayer_id).toBe(b)
    expect(s.pending_count).toBe(1)
    const r = await t.prayed(b)
    expect(r.recorded).toBe(true)
    expect(r.all_prayed).toBe(true)
  })

  it('31a. EVERYONE absent with zero prayers never consumes the night (2026-08-08 incident)', async () => {
    const [a, b, c] = await setup(3)
    const before = (await t.group()).next_prayer_user_id
    for (const m of [a, b, c]) await t.setAbsent(m, true)

    const s = await t.state()
    expect(s.all_prayed).toBe(false)          // NOT complete
    expect(s.current_prayer_id).toBeNull()    // just nobody eligible
    expect(s.pending_count).toBe(0)
    expect((await t.row()).rotation_advanced).toBe(false)
    expect((await t.group()).next_prayer_user_id).toBe(before)

    // And anyone coming back is immediately eligible again.
    expect((await t.setAbsent(b, false)).current_prayer_id).toBe(b)
  })

  it('[+] marking absent is idempotent and reports recorded honestly', async () => {
    const [a] = await setup(3)
    expect((await t.setAbsent(a, true)).recorded).toBe(true)
    const again = await t.setAbsent(a, true)
    expect(again.recorded).toBe(true)            // end state matches the request
    expect(again.absent_members).toEqual([a])    // but no duplicate entry
  })
})

describe('declining (PASSED)', () => {
  it('14. the current person passes: not prayed, not absent, turn moves on', async () => {
    const [a, b, c] = await setup(3)
    const r = await t.pass(a)
    expect(r.recorded).toBe(true)
    expect(r.passed_members).toEqual([a])
    expect(r.prayed_members).toEqual([])          // never lies about prayer
    expect(r.absent_members).toEqual([])          // never lies about attendance
    expect(r.prayer_turns_completed).toBe(0)      // a pass is not a prayer
    expect(r.current_prayer_id).toBe(b)
    expect(r.next_prayer_id).toBe(c)
  })

  it('15. a passed person can be put back into the rotation and reclaims their spot', async () => {
    const [a, b, c] = await setup(3)
    await t.pass(a)
    expect((await t.state()).current_prayer_id).toBe(b)

    const restored = await t.setPassed(a, false)
    expect(restored.recorded).toBe(true)
    expect(restored.passed_members).toEqual([])
    expect(restored.current_prayer_id).toBe(a)    // exact original position
    expect(restored.next_prayer_id).toBe(b)
    expect((await t.prayed(a)).recorded).toBe(true)
    void c
  })

  it('[+] a pass closes the night when it removes the last PENDING member', async () => {
    const [a, b] = await setup(2)
    await t.prayed(a)
    const r = await t.pass(b)
    expect(r.recorded).toBe(true)
    expect(r.all_prayed).toBe(true)
    expect(r.prayed_members).toEqual([a])
    expect(r.passed_members).toEqual([b])
    // A pass still counts as taking your slot in the starting walk.
    expect((await t.group()).next_prayer_user_id).toBe(b)
  })

  it('31b. everyone passes: the night IS complete, because passing is deliberate', async () => {
    const [a, b, c] = await setup(3)
    await t.pass(a)
    await t.pass(b)
    const r = await t.pass(c)
    expect(r.all_prayed).toBe(true)
    expect(r.prayed_members).toEqual([])
    expect(r.passed_members).toEqual([a, b, c])
    expect(r.prayer_turns_completed).toBe(0)
  })

  it('[+] passed, absent and prayed are three distinct sets that never contaminate each other', async () => {
    const [a, b, c] = await setup(3)
    await t.prayed(a)
    await t.pass(b)
    const r = await t.setAbsent(c, true)
    expect(r.prayed_members).toEqual([a])
    expect(r.passed_members).toEqual([b])
    expect(r.absent_members).toEqual([c])

    // c was the last PENDING member, but an ABSENCE removed them --
    // and absence alone can never close a night. So the dinner stays
    // open and c is still owed their turn if they come back.
    expect(r.all_prayed).toBe(false)
    expect(r.current_prayer_id).toBeNull()
    expect(r.pending_count).toBe(0)
    expect((await t.row()).rotation_advanced).toBe(false)

    const back = await t.setAbsent(c, false)
    expect(back.current_prayer_id).toBe(c)
    expect((await t.prayed(c)).all_prayed).toBe(true)
  })

  it('[+] an already-prayed member can never be marked passed', async () => {
    const [a] = await setup(3)
    await t.prayed(a)
    const r = await t.setPassed(a, true)
    expect(r.recorded).toBe(false)
    expect(r.passed_members).toEqual([])
    expect(r.prayed_members).toEqual([a])
  })

  it('[+] a pass is idempotent and never duplicates', async () => {
    const [a] = await setup(3)
    await t.pass(a)
    const again = await t.pass(a)
    expect(again.recorded).toBe(false)   // nothing new was written
    expect(again.passed_members).toEqual([a])
  })

  it('[+] passes do not carry over to the next dinner', async () => {
    const [a, b] = await setup(2)
    await t.pass(a)
    await t.prayed(b)
    await t.setNow('2026-09-13T18:00:00Z')
    const s = await t.session()
    expect(s.passed_members).toEqual([])
    expect(s.absent_members).toEqual([])
    expect(s.prayed_members).toEqual([])
    expect(s.pending_count).toBe(2)
  })
})

describe('authoritative confirmation and races', () => {
  it('20. two devices completing the SAME turn: one records, the other is refused', async () => {
    const [a, b, c] = await setup(3)
    // Both devices resolved the same current person before either acted
    // -- the exact stale-read shape a lost race produces.
    const deviceOneSaw = (await t.state()).current_prayer_id
    const deviceTwoSaw = (await t.state()).current_prayer_id
    expect(deviceOneSaw).toBe(a)
    expect(deviceTwoSaw).toBe(a)

    const first = await t.prayed(deviceOneSaw)
    const second = await t.prayed(deviceTwoSaw)

    expect(first.recorded).toBe(true)
    expect(second.recorded).toBe(false)          // <- the whole point
    expect(second.prayed_members).toEqual([a])   // no duplicate
    expect(second.current_prayer_id).toBe(b)     // and it reports the truth
    expect(second.prayer_turns_completed).toBe(1)
    void c
  })

  it('21. double-tap on one device records exactly one turn', async () => {
    const [a, b] = await setup(3)
    const one = await t.prayed(a)
    const two = await t.prayed(a)
    expect(one.recorded).toBe(true)
    expect(two.recorded).toBe(false)
    expect(two.prayed_members).toEqual([a])
    expect(two.current_prayer_id).toBe(b)
  })

  it('22. a stale device completing an OLD current person changes nothing', async () => {
    const [a, b, c] = await setup(3)
    await t.prayed(a)
    await t.prayed(b)
    // Stale device still believes it is a's turn.
    const stale = await t.prayed(a)
    expect(stale.recorded).toBe(false)
    expect(stale.prayed_members).toEqual([a, b])
    expect(stale.current_prayer_id).toBe(c)
    expect(stale.all_prayed).toBe(false)
  })

  it('[+] a stale device passing an OLD current person changes nothing', async () => {
    const [a, b, c] = await setup(3)
    await t.prayed(a)
    const stale = await t.pass(a)
    expect(stale.recorded).toBe(false)
    expect(stale.passed_members).toEqual([])
    expect(stale.current_prayer_id).toBe(b)
    void c
  })

  it('23. mutation succeeds but the client loses the response: the retry is safe', async () => {
    const [a, b] = await setup(3)
    const landed = await t.prayed(a)   // committed; imagine the reply is lost
    expect(landed.recorded).toBe(true)

    // Client reconnects, re-reads authoritative state, and sees the
    // truth -- the write is not repeated and not lost.
    const authoritative = await t.state()
    expect(authoritative.prayed_members).toEqual([a])
    expect(authoritative.current_prayer_id).toBe(b)

    // And a blind retry of the same call is still a no-op.
    expect((await t.prayed(a)).recorded).toBe(false)
    expect((await t.state()).prayed_members).toEqual([a])
  })

  it('24. a mutation that fails before writing leaves no trace', async () => {
    const [a] = await setup(3)
    // Not a member of this table -> rejected by assert_prayer_member().
    await t.actAs('dddddddd-0000-4000-8000-000000000009')
    await expect(t.prayed(a)).rejects.toThrow(/Not a member of this group/)

    await t.actAs(a)
    const s = await t.state()
    expect(s.prayed_members).toEqual([])
    expect(s.current_prayer_id).toBe(a)
  })

  it('[+] an unauthenticated caller is rejected outright', async () => {
    const [a] = await setup(3)
    await t.db.exec(`set req.uid = ''`)
    await expect(t.prayed(a)).rejects.toThrow(/Not authenticated/)
  })

  it('[+] a null or mismatched expected id never records a turn', async () => {
    const [a, b] = await setup(3)
    expect((await t.prayed(null)).recorded).toBe(false)
    expect((await t.prayed(b)).recorded).toBe(false)   // b is not up yet
    expect((await t.state()).prayed_members).toEqual([])
    expect((await t.state()).current_prayer_id).toBe(a)
  })

  it('[+] a tap after the night has closed reports the truth and mutates nothing', async () => {
    const [a, b] = await setup(2)
    await prayEveryTurn(t)
    const late = await t.prayed(a)
    expect(late.recorded).toBe(false)
    expect(late.all_prayed).toBe(true)
    expect(late.current_prayer_id).toBeNull()
    expect(late.prayed_members).toEqual([a, b])
  })
})

describe('persistence: refresh, reopen, sessions, dates', () => {
  it('17. refreshing between every turn never changes the outcome', async () => {
    const [a, b, c] = await setup(3)
    // A "refresh" is a fresh get_or_create_tonight_session() call.
    let s = await t.session()
    expect(s.current_prayer_id).toBe(a)
    await t.prayed(a)

    s = await t.session()
    expect(s.current_prayer_id).toBe(b)
    expect(s.was_created).toBe(false)      // never creates a second dinner
    await t.prayed(b)

    s = await t.session()
    expect(s.current_prayer_id).toBe(c)
    await t.prayed(c)

    s = await t.session()
    expect(s.all_prayed).toBe(true)
    expect(s.current_prayer_id).toBeNull()
  })

  it('18. backgrounding and re-foregrounding between turns is a no-op', async () => {
    const [a, b] = await setup(3)
    await t.prayed(a)
    // Foreground resync uses the read-only state RPC, which must not
    // create anything or change anything.
    const rowBefore = await t.row()
    const resync = await t.state()
    const rowAfter = await t.row()
    expect(resync.current_prayer_id).toBe(b)
    expect(rowAfter).toEqual(rowBefore)
  })

  it('19. realtime failure changes nothing server-side; the resync read is authoritative', async () => {
    const [a, b, c] = await setup(3)
    // Device A acts while device B's channel is dead and receives no
    // events at all.
    await t.prayed(a)
    await t.prayed(b)
    // Device B finally resyncs by polling the authoritative read once.
    const s = await t.state()
    expect(s.prayed_members).toEqual([a, b])
    expect(s.current_prayer_id).toBe(c)
    expect(s.session_exists).toBe(true)
  })

  it('27. prayer complete, then the app is reopened: it stays complete', async () => {
    const [a, b] = await setup(2)
    await prayEveryTurn(t)
    for (let reopen = 0; reopen < 3; reopen++) {
      const s = await t.session()
      expect(s.all_prayed).toBe(true)
      expect(s.current_prayer_id).toBeNull()
      expect(s.prayed_members).toEqual([a, b])
    }
    // Restoring everyone to present cannot resurrect a closed night.
    await t.setAbsent(a, true)
    const restored = await t.setAbsent(a, false)
    expect(restored.all_prayed).toBe(true)
    expect(restored.current_prayer_id).toBeNull()
  })

  it('28. an unfinished previous dinner does not bleed into the new one', async () => {
    const [a, b, c] = await setup(3)
    await t.setNow('2026-09-12T18:00:00Z')
    const day1 = await t.session()
    await t.prayed(day1.current_prayer_id)      // only one of three prays
    const unfinished = await t.row()
    expect(unfinished.rotation_advanced).toBe(false)

    await t.setNow('2026-09-13T18:00:00Z')
    const day2 = await t.session()
    expect(day2.was_created).toBe(true)
    expect(day2.session_id).not.toBe(day1.session_id)
    expect(day2.prayed_members).toEqual([])
    expect(day2.pending_count).toBe(3)

    // The abandoned night is left exactly as it was, and because it
    // never closed it never advanced the starter -- so the same person
    // starts again rather than losing their turn.
    const stillThere = await t.rowFor(unfinished.verse_date)
    expect(stillThere.rotation_advanced).toBe(false)
    expect(stillThere.prayed_members).toEqual(unfinished.prayed_members)
    expect(day2.prayer_order[0]).toBe(a)
    void b; void c
  })

  it('29. the dinner date turns over at 4am local, not midnight', async () => {
    await setup(2, { timezone: 'America/Chicago' })
    // 03:30 local on the 13th is still the 12th's dinner.
    await t.setNow('2026-09-13T08:30:00Z')       // 03:30 CDT
    const late = await t.session()
    // 04:30 local on the 13th is a new dinner.
    await t.setNow('2026-09-13T09:30:00Z')       // 04:30 CDT
    const next = await t.session()

    expect(String(late.verse_date)).not.toBe(String(next.verse_date))
    expect(next.was_created).toBe(true)
  })

  it('[+] two groups on the same night never see each other\'s prayer state', async () => {
    const [a, b] = await setup(2)
    const other = 'bbbbbbbb-0000-4000-8000-000000000002'
    await t.db.query(
      `insert into public.groups (id, name, owner_id, rotation_cycle_started_at, created_at)
       values ($1, 'Other', $2, now() - interval '30 days', now() - interval '30 days')`,
      [other, 'eeeeeeee-0000-4000-8000-000000000001']
    )
    await t.db.query(
      `insert into public.profiles (id, name, group_id) values ($1, 'Other1', $2)`,
      ['eeeeeeee-0000-4000-8000-000000000001', other]
    )
    await t.actAs('eeeeeeee-0000-4000-8000-000000000001')
    await t.session(other)
    await t.prayed('eeeeeeee-0000-4000-8000-000000000001', other)

    await t.actAs(a)
    const mine = await t.state()
    expect(mine.prayed_members).toEqual([])
    expect(mine.current_prayer_id).toBe(a)
    void b
  })

  it('[+] get_prayer_session_state reports honestly when no dinner exists yet', async () => {
    await t.seedDinners(3)
    ids = await t.seedGroup({ count: 2 })
    const s = await t.state()          // no session() call first
    expect(s.session_exists).toBe(false)
    expect(s.session_id).toBeNull()
    expect(s.current_prayer_id).toBeNull()
    expect(s.all_prayed).toBe(false)
    // And it did not create one.
    expect(await t.row()).toBeUndefined()
  })
})

describe('membership changes mid-dinner', () => {
  it('25. a member who joins mid-dinner is NOT inserted into tonight\'s rotation', async () => {
    const [a, b, c] = await setup(3)
    await t.prayed(a)                     // the dinner has now started
    const late = await t.addMember(9)

    const s = await t.session()           // the join path + a reload
    expect(s.prayer_order).toEqual([a, b, c])
    expect(s.prayer_order).not.toContain(late)
    expect(s.current_prayer_id).toBe(b)

    await t.prayed(b)
    expect((await t.prayed(c)).all_prayed).toBe(true)
  })

  it('25b. a member who joins BEFORE the dinner has any activity is included', async () => {
    const [a, b] = await setup(2)
    const late = await t.addMember(9)     // nobody has prayed/passed/left yet
    const s = await t.session()
    expect(s.prayer_order).toEqual([a, b, late])
    expect(s.pending_count).toBe(3)
    expect(await prayEveryTurn(t)).toEqual([a, b, late])
  })

  it('26. a member removed mid-dinner is dropped from the live roster immediately', async () => {
    const [a, b, c] = await setup(3)
    await t.prayed(a)
    expect((await t.state()).current_prayer_id).toBe(b)

    await t.removeMember(b)               // fires the reconcile trigger

    const s = await t.state()
    expect(s.prayer_order).toEqual([a, c])
    expect(s.prayer_order).not.toContain(b)
    expect(s.current_prayer_id).toBe(c)   // never stuck on a departed member
    expect(s.all_prayed).toBe(false)
  })

  it('26b. removing the LAST pending member closes the night (a real prayer had happened)', async () => {
    const [a, b] = await setup(2)
    await t.prayed(a)
    await t.removeMember(b)
    const s = await t.state()
    expect(s.all_prayed).toBe(true)
    expect(s.current_prayer_id).toBeNull()
    expect(s.prayer_order).toEqual([a])
  })

  it('26c. a membership change with ZERO prayers never consumes the night', async () => {
    const [a, b] = await setup(2)
    const before = (await t.group()).next_prayer_user_id
    await t.removeMember(b)
    const s = await t.state()
    expect(s.all_prayed).toBe(false)
    expect(s.current_prayer_id).toBe(a)
    expect((await t.group()).next_prayer_user_id).toBe(before)
  })

  it('[+] a departed member is purged from all three identity sets', async () => {
    const [a, b, c] = await setup(3)
    await t.pass(a)
    await t.setAbsent(b, true)
    await t.removeMember(a)
    await t.removeMember(b)

    const row = await t.row()
    expect(row.passed_members).toEqual([])
    expect(row.absent_members).toEqual([])
    expect(row.prayer_order).toEqual([c])
    expect(row.prayer_turns_completed).toBe(0)
  })

  it('[+] a completed dinner is never rewritten by a later membership change', async () => {
    const [a, b] = await setup(2)
    await prayEveryTurn(t)
    const before = await t.row()
    await t.removeMember(b)
    const after = await t.rowFor(before.verse_date)
    expect(after.prayer_order).toEqual(before.prayer_order)
    expect(after.prayed_members).toEqual(before.prayed_members)
    expect(after.rotation_advanced).toBe(true)
    void a
  })
})

describe('invariants that must hold no matter what', () => {
  it('[+] prayer_turns_completed always equals array_length(prayed_members)', async () => {
    const [a, b, c] = await setup(3)
    const check = async () => {
      const row = await t.row()
      expect(row.prayer_turns_completed).toBe(row.prayed_members.length)
    }
    await check()
    await t.prayed(a); await check()
    await t.pass(b); await check()          // a pass must not bump the count
    await t.setAbsent(c, true); await check()
    await t.setAbsent(c, false); await check()
    await t.prayed(c); await check()
  })

  it('[+] a closed night never exposes a current or next turn', async () => {
    const [a, b] = await setup(2)
    await prayEveryTurn(t)
    for (const s of [await t.state(), await t.session()]) {
      expect(s.all_prayed).toBe(true)
      expect(s.current_prayer_id).toBeNull()
      expect(s.next_prayer_id).toBeNull()
    }
    void a; void b
  })

  it('[+] next_prayer_id is always the person who becomes current after this turn', async () => {
    const five = await setup(5)
    for (let i = 0; i < 4; i++) {
      const s = await t.state()
      const predictedNext = s.next_prayer_id
      const after = await t.prayed(s.current_prayer_id)
      expect(after.current_prayer_id).toBe(predictedNext)
    }
    void five
  })

  it('[+] the 3-argument resolve_current_turn wrapper still matches the 4-argument form', async () => {
    // Guards the mid-deploy window, where an old client may still be
    // calling the pre-2026-09-12 signature.
    const [a, b, c] = await setup(3)
    const r = await t.db.query(
      `select public.resolve_current_turn($1::uuid[], $2::uuid[], $3::uuid[]) as three,
              public.resolve_current_turn($1::uuid[], $2::uuid[], $3::uuid[], '{}'::uuid[]) as four`,
      [[a, b, c], [a], []]
    )
    expect(r.rows[0].three).toBe(b)
    expect(r.rows[0].four).toBe(b)
  })

  it('[+] the migration is idempotent: applying it twice is harmless', async () => {
    const [a, b] = await setup(2)
    await t.prayed(a)
    await t.db.exec(t.migrationSql)      // verbatim, a second time
    const s = await t.state()
    expect(s.prayed_members).toEqual([a])
    expect(s.current_prayer_id).toBe(b)
    expect((await t.prayed(b)).all_prayed).toBe(true)
  })

  it('[+] an archived table rejects every prayer mutation', async () => {
    const [a] = await setup(2)
    await t.db.query(`update public.groups set archived_at = now() where id = $1`, [GROUP_ID])
    await expect(t.prayed(a)).rejects.toThrow(/deleted/)
    await expect(t.pass(a)).rejects.toThrow(/deleted/)
    await expect(t.setAbsent(a, true)).rejects.toThrow(/deleted/)
    await expect(t.state()).rejects.toThrow(/deleted/)
  })

  it('[+] a non-member of the table can never be marked absent or passed', async () => {
    await setup(2)
    const outsider = 'dddddddd-0000-4000-8000-000000000009'
    await expect(t.setAbsent(outsider, true)).rejects.toThrow(/not a member of this table/i)
    await expect(t.setPassed(outsider, true)).rejects.toThrow(/not a member of this table/i)
  })
})
