import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../hooks/useFamily'
import { supabase } from '../lib/supabase'
import { track } from '../lib/analytics'
import ChurchCTA from '../components/ChurchCTA'

// Church/group CTA eligibility: local-only, no backend. Never shown
// before a family's 3rd completed dinner, at most once every 14 days,
// and never again once permanently dismissed.
const CHURCH_CTA_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000
const CHURCH_CTA_MIN_DINNERS = 3

function isChurchCTAEligible() {
  try {
    if (localStorage.getItem('dwj_church_cta_dismissed_forever') === 'true') return false
    const count = Number(localStorage.getItem('dwj_table_leaves_count') || '0') + 1
    localStorage.setItem('dwj_table_leaves_count', String(count))
    if (count < CHURCH_CTA_MIN_DINNERS) return false
    const lastShown = Number(localStorage.getItem('dwj_church_cta_last_shown') || '0')
    return Date.now() - lastShown > CHURCH_CTA_COOLDOWN_MS
  } catch {
    return false // localStorage unavailable (private browsing, etc.) -- never obstruct the exit path
  }
}

const BLESSINGS = [
  "Go now — and carry what happened at this table into the rest of your night. I'll be here tomorrow. Same time. Same table. Don't be late. 🙏",
  "You showed up. That matters more than you know. The conversation you just had — I was in the middle of it. See you tomorrow. 🙏",
  "This is why the table exists. Not the food. Not the routine. This — what just happened between you. Bring it with you. 🙏",
  "Well done. You came, you sat, you talked. That's the whole thing. I'll have something new for you tomorrow. 🙏",
  "Every dinner at this table is a stone in the foundation. Keep building. I'm not going anywhere. 🙏",
  "You made time for what matters. That's not small. That's everything. See you tomorrow. 🙏",
]

export default function TablePage({ onLeaveTable }) {
  const { user } = useAuth()
  const { group, members, memberProfiles } = useFamily()

  const [verse, setVerse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteTarget, setNoteTarget] = useState('both')
  const [toast, setToast] = useState('')
  const [showBlessing, setShowBlessing] = useState(false)
  const [blessing, setBlessing] = useState('')
  const [showChurchCTA, setShowChurchCTA] = useState(false)
  const [showPrayerOverlay, setShowPrayerOverlay] = useState(false)
  // prayerOrder + prayerTurnsCompleted come from the shared group_verse
  // row (via get_or_create_tonight_session / complete_prayer_turn) --
  // never generated or advanced locally. Every member's device resolves
  // the same "whose turn" from the same two values.
  const [prayerOrder, setPrayerOrder] = useState([])
  const [prayerTurnsCompleted, setPrayerTurnsCompleted] = useState(0)
  const [markingPrayer, setMarkingPrayer] = useState(false)
  const [discussed, setDiscussed] = useState(false)
  const [markingDiscussed, setMarkingDiscussed] = useState(false)
  const savedTargetsRef = useRef(new Set()) // tracks which targets already saved this draft, so a retry after a partial failure doesn't duplicate

  // id -> display name, built from the same get_my_group_members() data
  // useFamily() already loads -- prayer_order stores ids, not names, so
  // two members who happen to share a first name can't be confused.
  const nameById = new Map((memberProfiles || []).map(p => [p.id, p.name]))
  const nameFor = id => nameById.get(id) || 'Someone'

  useEffect(() => {
    loadVerse()
  }, [group?.id])

  async function loadVerse() {
    // The render below already requires a group before showing any verse
    // content (see the `if (!group) return ...` guard further down), so
    // there is nothing to load until group.id is known.
    if (!group?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // get_or_create_tonight_session() is the single source of truth for
      // "tonight's dinner" -- atomically gets the existing shared session
      // for this group+date, or creates it once if none exists yet (see
      // 20260714000004_shared_dinner_session.sql). Every member's device
      // calling this converges on the same verse, questions, prayer, and
      // prayer_order -- never a separate pick per device.
      const { data, error: rpcError } = await supabase.rpc('get_or_create_tonight_session', {
        group_id_input: group.id
      })
      if (rpcError) throw rpcError
      const session = data?.[0]
      if (!session) {
        setError('Could not load verse. Please try again.')
        setLoading(false)
        return
      }

      setVerse({
        id: session.dinner_verse_id,
        verse_ref: session.verse_ref,
        category: session.category,
        verse_text: session.verse_text,
        context_text: session.context_text,
        question_level_1: session.question_level_1,
        question_level_2: session.question_level_2,
        question_level_3: session.question_level_3,
        // session.prayer_text is already resolved server-side from the
        // session's stored prayer_tier -- the exact same value every
        // member and every guest receives for this dinner.
        prayer_level_1: session.prayer_text
      })
      setPrayerOrder(session.prayer_order || [])
      setPrayerTurnsCompleted(session.prayer_turns_completed || 0)
      track('verse_loaded', { verse_ref: session.verse_ref })

      const orderLen = (session.prayer_order || []).length
      if (orderLen > 0 && (session.prayer_turns_completed || 0) >= orderLen) {
        showToast("Your family already completed tonight's dinner. 🙏")
      }

      // session.verse_date is the canonical dinner date the RPC already
      // computed server-side (group timezone + 4am cutoff) -- used here
      // instead of a client-computed date, so this check can't drift
      // from what the RPC considers "tonight."
      const { data: historyData } = await supabase
        .from('verse_history')
        .select('id')
        .eq('dinner_verse_id', session.dinner_verse_id)
        .eq('user_id', user.id)
        .gte('discussed_at', session.verse_date)
        .single()
      setDiscussed(!!historyData)
    } catch (err) {
      console.error('[table:loadVerse]', err?.message)
      setError('Could not load verse. Please try again.')
    }
    setLoading(false)
  }

  async function markDiscussed() {
    if (!verse || discussed || markingDiscussed) return // prevent double submission
    setMarkingDiscussed(true)
    try {
      const { error } = await supabase.from('verse_history').upsert({
        dinner_verse_id: verse.id,
        user_id: user.id,
        discussed_at: new Date().toISOString()
      }, { onConflict: 'dinner_verse_id,user_id' })
      if (error) throw error
      setDiscussed(true)
      track('discussion_marked', { verse_ref: verse.verse_ref })
      showToast('Beautiful conversation tonight. 🙏')
    } catch (err) {
      console.error('[table:markDiscussed]', err?.message)
      showToast("That didn't save. Tap it again when you're ready.")
    }
    setMarkingDiscussed(false)
  }

  function getQuestion(level) {
    if (!verse) return ''
    if (level === 3) return verse.question_level_3 || verse.question_level_1
    if (level === 2) return verse.question_level_2 || verse.question_level_1
    return verse.question_level_1
  }

  function getPrayer() {
    if (!verse) return ''
    // Always the same level for everyone at the table -- this used to be
    // chosen per-viewer from their own profile.faith_level, which meant
    // two people at the same table could read a different prayer for the
    // same verse. "One Prayer" means one prayer, not one per viewer.
    return verse.prayer_level_1 || ''
  }

  async function nextPrayer() {
    if (!group?.id || allPrayed || markingPrayer) return // prevent double submission
    setMarkingPrayer(true)
    try {
      // complete_prayer_turn() is atomic and idempotent per turn (see
      // 20260714000004_shared_dinner_session.sql) -- it only advances if
      // expected_turns_completed still matches the shared row's current
      // value. Two devices racing to complete the same turn will not
      // double-advance and skip a person; the loser of the race simply
      // gets back the already-advanced state.
      const justPrayedId = prayerOrder[prayerTurnsCompleted]
      const { data, error } = await supabase.rpc('complete_prayer_turn', {
        group_id_input: group.id,
        expected_turns_completed: prayerTurnsCompleted
      })
      if (error) throw error
      const result = data?.[0]
      if (!result) throw new Error('No result')
      setPrayerTurnsCompleted(result.prayer_turns_completed)
      if (result.all_prayed) {
        track('prayer_completed', { member_count: prayerOrder.length })
        showToast('Everyone has prayed tonight. 🙏')
      } else {
        const upNextId = prayerOrder[result.prayer_turns_completed]
        showToast(`${nameFor(justPrayedId)} prayed. ${nameFor(upNextId)} is up next. 🙏`)
      }
    } catch (err) {
      console.error('[table:nextPrayer]', err?.message)
      showToast("That didn't save. Tap it again when you're ready.")
    }
    setMarkingPrayer(false)
  }

  async function saveNote() {
    if (!noteText.trim()) { showToast('Write something first.'); return }
    if (savingNote) return // prevent double submission
    setSavingNote(true)
    const saved = savedTargetsRef.current
    try {
      if ((noteTarget === 'personal' || noteTarget === 'both') && !saved.has('personal')) {
        const { error } = await supabase.from('notes').insert({
          user_id: user.id,
          verse_ref: verse?.verse_ref,
          category: verse?.category,
          content: noteText,
          family_id: null
        })
        if (error) throw error
        saved.add('personal') // don't re-insert this half if the group insert below fails and the user retries
      }
      if ((noteTarget === 'group' || noteTarget === 'both') && group?.id && !saved.has('group')) {
        const { error } = await supabase.from('notes').insert({
          user_id: user.id,
          verse_ref: verse?.verse_ref,
          category: verse?.category,
          content: noteText,
          family_id: group.id
        })
        if (error) throw error
        saved.add('group')
      }
      track('journal_saved', { target: noteTarget })
      showToast('Saved. ✓')
      setNoteText('') // only clear the draft once every save is confirmed
      saved.clear()
    } catch (err) {
      console.error('[table:saveNote]', err?.message)
      showToast("That didn't save. Your words are still here — try again.")
    }
    setSavingNote(false)
  }

  function handleLeaveTable() {
    const randomBlessing = BLESSINGS[Math.floor(Math.random() * BLESSINGS.length)]
    setBlessing(randomBlessing)
    setShowBlessing(true)
  }

  function confirmLeave() {
    track('table_left')
    setShowBlessing(false)
    if (isChurchCTAEligible()) {
      setShowChurchCTA(true)
    } else if (onLeaveTable) {
      onLeaveTable()
    }
  }

  function dismissChurchCTA(forever) {
    try {
      localStorage.setItem('dwj_church_cta_last_shown', String(Date.now()))
      if (forever) localStorage.setItem('dwj_church_cta_dismissed_forever', 'true')
    } catch { /* ignore -- never block leaving the table over storage failures */ }
    setShowChurchCTA(false)
    if (onLeaveTable) onLeaveTable()
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // Derived entirely from the shared prayerOrder/prayerTurnsCompleted --
  // never from local state -- so every device renders the same person.
  const allPrayed = prayerOrder.length > 0 && prayerTurnsCompleted >= prayerOrder.length
  const currentPrayerId = prayerOrder.length > 0 && !allPrayed ? prayerOrder[prayerTurnsCompleted] : null
  const nextPrayerId = prayerOrder.length > 1 && prayerTurnsCompleted + 1 < prayerOrder.length ? prayerOrder[prayerTurnsCompleted + 1] : null
  const currentPrayer = currentPrayerId ? nameFor(currentPrayerId) : null
  const nextMember = nextPrayerId ? nameFor(nextPrayerId) : null

  const goldAccent = { position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }
  // cardBase: the Verse -> Conversation -> Prayer sequence itself --
  // the three things this whole experience is actually about.
  // cardQuiet: everything around that sequence (who's here, optional
  // context, the closing journal entry) -- present, legible, but
  // deliberately not competing with the three primary cards for
  // attention. Presentation-only distinction, same underlying layout.
  const cardBase = { position: 'relative', overflow: 'hidden', background: 'var(--bg2)', border: '1.5px solid #C9A84C', borderRadius: '12px', padding: '1.4rem', marginBottom: '1.25rem', boxShadow: '0 3px 10px rgba(0,0,0,0.45)' }
  const cardQuiet = { position: 'relative', overflow: 'hidden', background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: '12px', padding: '1.1rem', marginBottom: '1rem' }
  const sectionTitle = { fontFamily: 'Lora, serif', fontSize: '1rem', fontWeight: 600, color: 'var(--white)', letterSpacing: '0.02em', marginBottom: '0.25rem', display: 'block' }

  if (loading) return (
    <div className="loading-wrap" style={{ flex: 1 }}>
      <div className="loading-cross">✝️</div>
      <p style={{ color: 'var(--silver)', fontSize: '14px' }}>Preparing your verse...</p>
    </div>
  )

  if (error) return (
    <div className="loading-wrap" style={{ flex: 1 }}>
      <p style={{ color: '#E57373', fontSize: '14px', textAlign: 'center', padding: '1rem' }}>{error}</p>
      <button className="btn btn-gold" style={{ marginTop: '1rem' }} onClick={loadVerse}>Try again</button>
    </div>
  )

  if (!group) return (
    <div className="loading-wrap" style={{ flex: 1, padding: '2rem', textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '1.25rem' }}>✝️</div>
      <p style={{ fontFamily: 'Lora, serif', fontSize: '1.2rem', color: 'var(--white)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
        The table is set.<br />You just need a circle.
      </p>
      <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, marginBottom: '1.5rem', fontStyle: 'italic' }}>
        Create your dinner circle in Settings and invite your family — then come back to the table.
      </p>
      <button
        className="btn btn-gold"
        style={{ width: '100%', maxWidth: 320 }}
        onClick={() => window.dispatchEvent(new CustomEvent('dwj-go-to-settings'))}
      >
        ⚙️ Set up my dinner circle
      </button>
    </div>
  )

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>

      {/* Who's at the table */}
      <div style={{ ...cardQuiet, background: 'var(--bg3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ ...sectionTitle, marginBottom: 0 }}>
            {group ? group.name : 'At the Table Tonight'}
          </span>
          {group && (
            <button
              onClick={() => {
                const link = `${window.location.origin}/table/${group.invite_code}`
                const msg = `Join us at the table tonight!\n\nTap this link to follow along with Dinner with Jesus — no account needed:\n\n${link}\n\n🙏`
                if (navigator.share) {
                  navigator.share({ text: msg })
                } else {
                  navigator.clipboard.writeText(link)
                  showToast('Guest link copied! 🙏')
                }
              }}
              style={{ background: 'none', border: '0.5px solid var(--border-gold)', borderRadius: 6, color: 'var(--gold)', fontSize: '11px', padding: '4px 10px', cursor: 'pointer' }}
            >
              🔗 Invite guest
            </button>
          )}
        </div>
        {members.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(memberProfiles && memberProfiles.length > 0 ? memberProfiles : members.map(m => ({ id: m, name: m }))).map(p => (
              <span key={p.id} style={{
                fontSize: '12px',
                color: 'var(--cream)',
                background: p.id === currentPrayerId && !allPrayed ? 'var(--gold-soft)' : 'var(--bg4)',
                border: `0.5px solid ${p.id === currentPrayerId && !allPrayed ? 'var(--border-gold)' : 'var(--border)'}`,
                borderRadius: 999,
                padding: '4px 12px'
              }}>
                {p.name}
              </span>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic' }}>
            Just you tonight. That's enough. 🙏
          </p>
        )}
      </div>

      {/* Verse */}
      {verse && (
        <div style={{ ...cardBase, borderColor: '#C9A84C' }}>
          <div style={goldAccent} />
          <div className="verse-ref">{verse.verse_ref} · {verse.category}</div>
          <div className="verse-text">"{verse.verse_text}"</div>
        </div>
      )}

      {/* Context */}
      {verse?.context_text && (
        <div style={{ ...cardQuiet, background: 'var(--bg3)' }}>
          <span style={sectionTitle}>A little context</span>
          <p style={{ fontSize: '15px', color: 'var(--cream)', lineHeight: 1.8, fontWeight: 300 }}>
            {verse.context_text}
          </p>
        </div>
      )}

      {/* Questions */}
      {verse && (
        <div style={cardBase}>
          <div style={goldAccent} />
          <span style={sectionTitle}>For the table tonight</span>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '1.1rem', color: 'var(--white)', lineHeight: 1.75, fontStyle: 'italic', marginTop: '0.625rem' }}>
            {getQuestion(1)}
          </p>
          {verse.question_level_2 && (
            <div style={{ marginTop: '1.25rem', borderTop: '0.5px solid var(--border)', paddingTop: '1rem' }}>
              <p style={{ fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--silver2)', marginBottom: '0.5rem', fontWeight: 500 }}>Go deeper</p>
              <p style={{ fontFamily: 'Lora, serif', fontSize: '0.98rem', color: 'var(--silver)', lineHeight: 1.7, fontStyle: 'italic' }}>{getQuestion(2)}</p>
            </div>
          )}
          {verse.question_level_3 && (
            <div style={{ marginTop: '1rem', borderTop: '0.5px solid var(--border)', paddingTop: '1rem' }}>
              <p style={{ fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--silver2)', marginBottom: '0.5rem', fontWeight: 500 }}>Push further</p>
              <p style={{ fontFamily: 'Lora, serif', fontSize: '0.98rem', color: 'var(--silver)', lineHeight: 1.7, fontStyle: 'italic' }}>{getQuestion(3)}</p>
            </div>
          )}
        </div>
      )}

      {/* Prayer */}
      <div style={cardBase}>
        <div style={goldAccent} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ ...sectionTitle, marginBottom: 0 }}>Prayer</span>
          {allPrayed ? (
            <span style={{ fontSize: '11px', color: 'var(--gold)', background: 'var(--gold-soft)', padding: '2px 10px', borderRadius: 999 }}>Everyone prayed 🙏</span>
          ) : nextMember ? (
            <span style={{ fontSize: '11px', color: 'var(--gold)', background: 'var(--gold-soft)', padding: '2px 10px', borderRadius: 999 }}>Next: {nextMember}</span>
          ) : null}
        </div>
        <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', color: 'var(--white)', marginBottom: '0.35rem' }}>
          {currentPrayer ? `${currentPrayer}'s turn to pray` : 'Your turn to pray'}
        </p>
        <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '1.1rem', marginBottom: '0.875rem', border: '0.5px solid var(--border)' }}>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '15px', fontStyle: 'italic', color: 'var(--cream)', lineHeight: 1.85 }}>
            {getPrayer()}
          </p>
          <p style={{ fontSize: '11px', color: 'var(--silver)', textAlign: 'right', marginTop: '0.5rem' }}>— Amen 🙏</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-green" onClick={nextPrayer} disabled={allPrayed} style={{ opacity: allPrayed ? 0.6 : 1 }}>
            {allPrayed ? '🙏 All prayed' : '✓ We prayed together'}
          </button>
          <button className="btn" onClick={() => setShowPrayerOverlay(true)}>📖 Full prayer</button>
        </div>
      </div>

      {/* We discussed this */}
      <div style={{ marginBottom: '1.25rem' }}>
        <button
          className="btn btn-gold"
          style={{ width: '100%', opacity: discussed ? 0.6 : 1 }}
          onClick={markDiscussed}
          disabled={discussed || markingDiscussed}
        >
          {discussed ? '✓ Conversation saved for tonight' : markingDiscussed ? 'Saving...' : '✓ We discussed this tonight 🙏'}
        </button>
      </div>

      {/* Journal */}
      <div style={cardQuiet}>
        <span style={sectionTitle}>What happened at the table tonight</span>
        <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic', marginBottom: '0.75rem', marginTop: '0.25rem' }}>
          Write it down. You'll want it later.
        </p>
        <textarea
          value={noteText}
          onChange={e => { setNoteText(e.target.value); savedTargetsRef.current.clear() }}
          placeholder="Something someone said that you never want to forget..."
          style={{ minHeight: 72, resize: 'none', marginBottom: 8 }}
        />
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {[
            { key: 'personal', label: 'My journal' },
            { key: 'group', label: `${group?.name || 'Group'} journal` },
            { key: 'both', label: 'Both' }
          ].map(opt => (
            <button key={opt.key} onClick={() => setNoteTarget(opt.key)}
              style={{ flex: 1, padding: '6px 4px', borderRadius: 8, border: `0.5px solid ${noteTarget === opt.key ? 'var(--gold)' : 'var(--border)'}`, background: noteTarget === opt.key ? 'var(--gold-soft)' : 'var(--bg3)', color: noteTarget === opt.key ? 'var(--gold)' : 'var(--silver)', fontSize: '11px', cursor: 'pointer' }}>
              {opt.label}
            </button>
          ))}
        </div>
        <button className="btn btn-gold" onClick={saveNote} disabled={savingNote}>
          {savingNote ? 'Saving...' : 'Save this moment'}
        </button>
      </div>

      {/* Leave the table */}
      <div style={{ ...cardQuiet, background: 'var(--bg3)', textAlign: 'center', padding: '1.75rem 1.4rem' }}>
        <p style={{ fontFamily: 'Lora, serif', fontSize: '17px', color: 'var(--white)', marginBottom: '0.625rem' }}>
          It is finished.
        </p>
        <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '1.5rem', fontStyle: 'italic', lineHeight: 1.7 }}>
          When you're ready to leave the table, tap below.
        </p>
        <button
          className="btn"
          style={{ width: '100%', padding: '15px 16px', color: 'var(--gold)', borderColor: 'var(--border-gold)', background: 'var(--gold-soft)' }}
          onClick={handleLeaveTable}
        >
          🕊 Leave the Table
        </button>
      </div>

      {/* Full prayer overlay */}
      {showPrayerOverlay && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,24,41,0.96)', zIndex: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>✝️</div>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.85, maxWidth: 380, marginBottom: '0.875rem' }}>
            {getPrayer()}
          </p>
          <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '2rem' }}>— Amen 🙏</p>
          <button className="btn btn-gold" style={{ width: 'auto', padding: '11px 2rem' }} onClick={() => setShowPrayerOverlay(false)}>Close</button>
        </div>
      )}

      {/* Blessing overlay */}
      {showBlessing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,24,41,0.98)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>✝️</div>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '1.1rem', color: 'var(--gold)', marginBottom: '1rem', fontStyle: 'italic' }}>
            A word before you go...
          </p>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.85, maxWidth: 380, marginBottom: '2rem' }}>
            {blessing}
          </p>
          <button className="btn btn-gold" style={{ width: 'auto', padding: '12px 2.5rem' }} onClick={confirmLeave}>
            Amen. Good night. 🙏
          </button>
        </div>
      )}

      {/* Church/group CTA — post-dinner only, rate-limited, dismissible forever */}
      {showChurchCTA && (
        <ChurchCTA
          onMaybeLater={() => dismissChurchCTA(false)}
          onDontShowAgain={() => dismissChurchCTA(true)}
        />
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
