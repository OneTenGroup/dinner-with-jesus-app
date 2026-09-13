// The client side of the prayer state machine.
//
// The table owns the rotation; Supabase is authoritative. This module
// exists so that "authoritative" is something the client actually
// ENFORCES rather than just intends, and so the enforcement is
// testable without a DOM (see prayerSession.test.js).
//
// Three rules it implements, each of which was previously violated:
//
// 1. NEVER ANNOUNCE AN UNCONFIRMED TRANSITION. The old TablePage.jsx
//    announced "<name> prayed. <name> is up next" whenever
//    complete_prayer_turn() returned without throwing -- but that RPC
//    returns normally when its CAS guard REFUSES the write, and it did
//    not return prayed_members, so a stale device could not tell the
//    difference. Every mutation here is followed by an authoritative
//    re-read and an explicit membership check before any success is
//    reported.
//
// 2. REALTIME IS AN OPTIMISATION, NOT AUTHORITY. A postgres_changes
//    payload carries the raw row only, so it is interpreted with the
//    same resolution logic the server uses. When the channel errors,
//    times out, or closes -- or the phone simply locks between two
//    prayers -- correctness comes from a resync read, not from the
//    channel recovering.
//
// 3. ONE STABLE SUBSCRIPTION PER DINNER. The old effect re-subscribed
//    to a channel named group_verse:<group_id> whenever sessionId went
//    null -> value, tearing down and re-creating the SAME topic in one
//    tick; an in-flight leave could then kill the fresh join while
//    .subscribe() still reported success, silently deafening that
//    device for the rest of the night. createPrayerChannel() gives
//    every subscription instance its own unique topic so a leave can
//    never race a join.

export const PRAYER_STATE = {
  PRAYED: 'prayed',
  PASSED: 'passed',
  ABSENT: 'absent',
  PENDING: 'pending'
}

export const OUTCOME = {
  // The mutation wrote what we asked it to.
  RECORDED: 'recorded',
  // Already true before we asked: a double tap, or a retry after a
  // lost response. Benign -- the table is in the state the user wanted.
  ALREADY: 'already_recorded',
  // The server refused: our view was stale, or the night is closed.
  // NEVER report success for this.
  REFUSED: 'refused',
  // The call itself failed. Nothing is known to have changed.
  FAILED: 'failed'
}

const EMPTY = Object.freeze([])

function arr(v) {
  return Array.isArray(v) ? v : EMPTY
}

// Member ids are uuids. Realtime payloads and RPC responses have both
// been observed to differ in case, and an id that only differs by case
// is the same person -- comparing raw strings would silently strand a
// rotation on someone who is already in prayed_members.
function sameId(a, b) {
  return typeof a === 'string' && typeof b === 'string'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b
}

function includesId(list, id) {
  return arr(list).some(x => sameId(x, id))
}

/**
 * The first member of the frozen roster who is PENDING -- in none of
 * prayed / passed / absent. Mirrors public.resolve_current_turn(), and
 * is only needed for interpreting a raw Realtime row, since every RPC
 * already returns the server's own resolved values.
 */
export function resolveCurrentTurn(prayerOrder, absentMembers, prayedMembers, passedMembers) {
  for (const id of arr(prayerOrder)) {
    if (!includesId(prayedMembers, id) &&
        !includesId(passedMembers, id) &&
        !includesId(absentMembers, id)) {
      return id
    }
  }
  return null
}

/**
 * Which of the four states a member is in. Precedence is
 * PRAYED > PASSED > ABSENT > PENDING, matching the migration: a
 * completed turn is a permanent fact about tonight, so someone who
 * prayed and then stepped away still reads as having prayed.
 */
export function memberPrayerState(memberId, state) {
  if (includesId(state?.prayedMembers, memberId)) return PRAYER_STATE.PRAYED
  if (includesId(state?.passedMembers, memberId)) return PRAYER_STATE.PASSED
  if (includesId(state?.absentMembers, memberId)) return PRAYER_STATE.ABSENT
  return PRAYER_STATE.PENDING
}

function pendingCountFrom(order, absent, prayed, passed) {
  return arr(order).filter(id =>
    !includesId(prayed, id) && !includesId(passed, id) && !includesId(absent, id)
  ).length
}

/**
 * Normalise any prayer-bearing RPC row into one canonical shape. All
 * of get_or_create_tonight_session / get_prayer_session_state /
 * complete_prayer_turn / pass_prayer_turn / set_member_passed /
 * set_member_absent return these same prayer columns.
 */
export function normalizePrayerState(row) {
  if (!row) return null
  return {
    sessionId: row.session_id ?? null,
    prayerOrder: arr(row.prayer_order),
    absentMembers: arr(row.absent_members),
    prayedMembers: arr(row.prayed_members),
    passedMembers: arr(row.passed_members),
    prayerTurnsCompleted: row.prayer_turns_completed ?? 0,
    currentPrayerId: row.current_prayer_id ?? null,
    nextPrayerId: row.next_prayer_id ?? null,
    allPrayed: !!row.all_prayed,
    pendingCount: row.pending_count ?? 0,
    // get_prayer_session_state() is the only one that reports this; the
    // others are only ever called when a session already exists.
    sessionExists: row.session_exists === undefined ? true : !!row.session_exists
  }
}

/**
 * Interpret a raw group_verse row from a Realtime postgres_changes
 * payload. The payload has no server-computed current/next/all_prayed
 * fields, so they are derived here with the same rules the server uses.
 */
export function prayerStateFromRow(row) {
  if (!row) return null
  const order = arr(row.prayer_order)
  const absent = arr(row.absent_members)
  const prayed = arr(row.prayed_members)
  const passed = arr(row.passed_members)
  const allPrayed = !!row.rotation_advanced

  // Once the night is closed it exposes no current or next turn, ever
  // -- exactly as derive_prayer_state() does server-side.
  const current = allPrayed ? null : resolveCurrentTurn(order, absent, prayed, passed)
  const next = (allPrayed || current === null)
    ? null
    : resolveCurrentTurn(order, absent, [...prayed, current], passed)

  return {
    sessionId: row.id ?? null,
    prayerOrder: order,
    absentMembers: absent,
    prayedMembers: prayed,
    passedMembers: passed,
    prayerTurnsCompleted: row.prayer_turns_completed ?? prayed.length,
    currentPrayerId: current,
    nextPrayerId: next,
    allPrayed,
    pendingCount: pendingCountFrom(order, absent, prayed, passed),
    sessionExists: true
  }
}

/**
 * Was the transition we asked for actually true in the authoritative
 * state? `set` names which identity set the member should now be in,
 * or should now be OUT of when `expected` is false.
 */
function confirmMembership(state, memberId, set, expected = true) {
  const list = state?.[set]
  return includesId(list, memberId) === expected
}

/**
 * Coordinates every prayer mutation as: mutate -> authoritative
 * re-read -> confirm the transition -> only then report an outcome.
 *
 * `rpc(name, args)` must resolve to Supabase's `{ data, error }`.
 */
export function createPrayerCoordinator({ rpc, groupId }) {
  if (typeof rpc !== 'function') throw new Error('createPrayerCoordinator needs an rpc function')

  // What THIS device last brought about. Needed because "the member is
  // in the set" is not on its own proof that this call achieved
  // anything: after a legitimate turn, a STALE device tapping that
  // same person would also find them in prayed_members and would
  // wrongly be told it had just recorded their prayer -- the precise
  // false-success the whole module exists to prevent. Only a duplicate
  // of an action this device itself already achieved is benign.
  let lastAchieved = null

  function matchesLastAchieved(memberId, set, expected) {
    return !!lastAchieved &&
      sameId(lastAchieved.memberId, memberId) &&
      lastAchieved.set === set &&
      lastAchieved.expected === expected
  }

  function remember(memberId, set, expected) {
    lastAchieved = { memberId, set, expected }
  }

  async function call(name, args) {
    const { data, error } = await rpc(name, { group_id_input: groupId, ...args })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw new Error(`${name} returned no row`)
    return row
  }

  /** Read-only authoritative state. Creates nothing. */
  async function resync() {
    return normalizePrayerState(await call('get_prayer_session_state', {}))
  }

  /**
   * Runs a mutation, then ALWAYS re-reads authoritative state and
   * confirms the transition before deciding what happened. `recorded`
   * from the RPC is used only to tell RECORDED from ALREADY -- never
   * to decide success on its own.
   */
  async function mutate({ name, args, memberId, set, expected = true }) {
    let mutationRow
    try {
      mutationRow = await call(name, args)
    } catch (err) {
      // The write may or may not have landed (a dropped response looks
      // identical to a failure from here). Resync so the UI is at least
      // truthful, and report FAILED rather than guessing.
      let state = null
      try { state = await resync() } catch { /* offline; keep the last known state */ }
      // If the state we were aiming for is now true, this device
      // probably did cause it and simply lost the reply. Remember it,
      // so the user's natural next move -- tap again -- reads as their
      // own duplicate rather than as someone else beating them to it.
      if (state && confirmMembership(state, memberId, set, expected)) {
        remember(memberId, set, expected)
      }
      return { outcome: OUTCOME.FAILED, state, memberId, error: err }
    }

    // Step 2: authoritative re-read. Deliberately a separate call --
    // the mutation's own return value is not treated as proof.
    let state
    try {
      state = await resync()
    } catch {
      // Resync failed; fall back to the mutation's own returned state,
      // which is still server-computed, but do not upgrade the outcome
      // beyond what it can prove.
      state = normalizePrayerState(mutationRow)
    }

    // Step 3: confirm. The transition must actually be true in the
    // authoritative state before any success is reported.
    if (!confirmMembership(state, memberId, set, expected)) {
      return { outcome: OUTCOME.REFUSED, state, memberId }
    }

    if (mutationRow.recorded) {
      remember(memberId, set, expected)
      return { outcome: OUTCOME.RECORDED, state, memberId }
    }

    // The server wrote nothing. Benign only if this device already
    // achieved this exact transition itself; otherwise our view was
    // stale and we must not take credit for someone else's turn.
    return {
      outcome: matchesLastAchieved(memberId, set, expected)
        ? OUTCOME.ALREADY
        : OUTCOME.REFUSED,
      state,
      memberId
    }
  }

  return {
    /**
     * get_or_create_tonight_session(): the one call allowed to create
     * tonight's dinner. Returns both the dinner content and the state.
     */
    async loadSession() {
      const row = await call('get_or_create_tonight_session', {})
      return {
        state: normalizePrayerState(row),
        wasCreated: !!row.was_created,
        verse: {
          id: row.dinner_verse_id,
          verse_ref: row.verse_ref,
          category: row.category,
          verse_text: row.verse_text,
          context_text: row.context_text,
          question_level_1: row.question_level_1,
          question_level_2: row.question_level_2,
          question_level_3: row.question_level_3,
          prayer_level_1: row.prayer_text
        },
        verseDate: row.verse_date
      }
    },

    resync,

    /** "We prayed together" for whoever the caller believes is up. */
    completeTurn(expectedCurrentId) {
      return mutate({
        name: 'complete_prayer_turn',
        args: { expected_current_prayer_id: expectedCurrentId },
        memberId: expectedCurrentId,
        set: 'prayedMembers'
      })
    },

    /** "Pass for tonight" for whoever the caller believes is up. */
    passTurn(expectedCurrentId) {
      return mutate({
        name: 'pass_prayer_turn',
        args: { expected_current_prayer_id: expectedCurrentId },
        memberId: expectedCurrentId,
        set: 'passedMembers'
      })
    },

    /** "Not here tonight" / back at the table. */
    setAbsent(memberId, absent) {
      return mutate({
        name: 'set_member_absent',
        args: { member_id_input: memberId, absent },
        memberId,
        set: 'absentMembers',
        expected: absent
      })
    },

    /** Put someone who passed back into tonight's rotation. */
    restorePassed(memberId) {
      return mutate({
        name: 'set_member_passed',
        args: { member_id_input: memberId, passed: false },
        memberId,
        set: 'passedMembers',
        expected: false
      })
    },

    applyRealtimeRow: prayerStateFromRow
  }
}

/**
 * Human-readable result of a prayer mutation. Kept beside the
 * coordinator so the "never claim an unconfirmed prayer" rule and the
 * wording that depends on it cannot drift apart.
 */
export function describeOutcome({ outcome, state, memberId, action }, nameFor) {
  const who = nameFor(memberId)
  const verb = action === 'pass' ? 'passed for tonight' : 'prayed'

  if (outcome === OUTCOME.FAILED) {
    return "That didn't save. Tap it again when you're ready."
  }
  if (outcome === OUTCOME.REFUSED) {
    // The defining case: say nothing that implies the turn was taken.
    if (state?.allPrayed) return "Tonight's prayers are already complete. 🙏"
    if (state?.currentPrayerId) {
      return `Someone else already moved the table on — ${nameFor(state.currentPrayerId)} is up now.`
    }
    return 'The table has moved on. Nobody is marked present right now.'
  }
  if (state?.allPrayed) {
    return 'Everyone has had their turn tonight. 🙏'
  }
  if (state?.currentPrayerId) {
    return `${who} ${verb}. ${nameFor(state.currentPrayerId)} is up next. 🙏`
  }
  return `${who} ${verb}. No one else is marked present right now.`
}

let channelSeq = 0

/**
 * One stable Realtime subscription per dinner, with failure reported
 * instead of swallowed.
 *
 * The topic includes a per-instance nonce so that tearing one
 * subscription down and standing another up can never collide on the
 * same topic -- the race that could leave .subscribe() reporting
 * SUBSCRIBED on a channel the server had already torn down.
 *
 * `onNeedsResync(reason)` fires whenever the channel cannot be trusted.
 * It is the caller's job to do an authoritative read; this module
 * never polls.
 */
export function createPrayerChannel({ supabase, groupId, onRow, onNeedsResync }) {
  const topic = `prayer:${groupId}:${++channelSeq}`
  let closed = false

  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'group_verse', filter: `group_id=eq.${groupId}` },
      payload => { if (!closed) onRow?.(payload?.new) }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'group_verse', filter: `group_id=eq.${groupId}` },
      // A new dinner row appearing (the 4am rollover, or another device
      // opening tonight's table first) means this screen's whole
      // session may be stale -- content included -- so ask for a full
      // reload rather than patching the row in.
      () => { if (!closed) onNeedsResync?.('insert') }
    )
    .subscribe(status => {
      if (closed) return
      // The old code passed no status callback at all, so a dead
      // channel was indistinguishable from a healthy silent one.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onNeedsResync?.(status)
      }
    })

  return {
    topic,
    unsubscribe() {
      closed = true
      supabase.removeChannel(channel)
    }
  }
}
