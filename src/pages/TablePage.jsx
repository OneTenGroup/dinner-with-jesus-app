import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../hooks/useFamily'
import { supabase } from '../lib/supabase'

const BLESSINGS = [
  "Go now — and carry what happened at this table into the rest of your night. I'll be here tomorrow. Same time. Same table. Don't be late. 🙏",
  "You showed up. That matters more than you know. The conversation you just had — I was in the middle of it. See you tomorrow. 🙏",
  "This is why the table exists. Not the food. Not the routine. This — what just happened between you. Bring it with you. 🙏",
  "Well done. You came, you sat, you talked. That's the whole thing. I'll have something new for you tomorrow. 🙏",
  "Every dinner at this table is a stone in the foundation. Keep building. I'm not going anywhere. 🙏",
  "You made time for what matters. That's not small. That's everything. See you tomorrow. 🙏",
]

export default function TablePage({ onLeaveTable }) {
  const { user, profile } = useAuth()
  const { group, members } = useFamily()

  const [verse, setVerse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteTarget, setNoteTarget] = useState('both')
  const [toast, setToast] = useState('')
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showBlessing, setShowBlessing] = useState(false)
  const [blessing, setBlessing] = useState('')
  const [showPrayerOverlay, setShowPrayerOverlay] = useState(false)
  const [prayerIdx, setPrayerIdx] = useState(0)
  const [prayedCount, setPrayedCount] = useState(0)
  const [discussed, setDiscussed] = useState(false)

  const faithLevel = profile?.faith_level || 1

  useEffect(() => {
    loadVerse()
  }, [group])

  async function loadVerse() {
    setLoading(true)
    setError(null)
    try {
      const today = new Date().toISOString().split('T')[0]
      const groupId = group?.id

      if (groupId) {
        const { data: sticky } = await supabase
          .from('group_verse')
          .select('dinner_verse_id')
          .eq('group_id', groupId)
          .eq('verse_date', today)
          .single()

        if (sticky?.dinner_verse_id) {
          const { data: verseData } = await supabase
            .from('dinner_verses')
            .select('*')
            .eq('id', sticky.dinner_verse_id)
            .single()
          if (verseData) {
            setVerse(verseData)
            // Check if already discussed tonight
            const { data: historyData } = await supabase
              .from('verse_history')
              .select('id')
              .eq('dinner_verse_id', verseData.id)
              .eq('user_id', user.id)
              .gte('discussed_at', today)
              .single()
            setDiscussed(!!historyData)
            setLoading(false)
            return
          }
        }
      }

      const { data: historyData } = await supabase
        .from('verse_history')
        .select('dinner_verse_id')

      const discussedIds = historyData?.map(d => d.dinner_verse_id) || []

      const { data: allVerses, error: versesError } = await supabase
        .from('dinner_verses')
        .select('*')
        .eq('active', true)
        .limit(200)

      if (versesError) throw versesError
      if (!allVerses || allVerses.length === 0) {
        setError('No verses found.')
        setLoading(false)
        return
      }

      const available = discussedIds.length > 0
        ? allVerses.filter(v => !discussedIds.includes(v.id))
        : allVerses
      const pool = available.length > 0 ? available : allVerses
      const picked = pool[Math.floor(Math.random() * pool.length)]
      setVerse(picked)

      if (groupId && picked) {
        const today = new Date().toISOString().split('T')[0]
        await supabase
          .from('group_verse')
          .upsert({ group_id: groupId, dinner_verse_id: picked.id, verse_date: today }, { onConflict: 'group_id,verse_date' })
      }

    } catch (err) {
      setError('Could not load verse. Please try again.')
    }
    setLoading(false)
  }

  async function markDiscussed() {
    if (!verse || discussed) return
    try {
      await supabase.from('verse_history').upsert({
        dinner_verse_id: verse.id,
        user_id: user.id,
        discussed_at: new Date().toISOString()
      }, { onConflict: 'dinner_verse_id,user_id' })
      setDiscussed(true)
      showToast('Beautiful conversation tonight. 🙏')
    } catch (err) {
      showToast('Could not save. Try again.')
    }
  }

  function getQuestion(level) {
    if (!verse) return ''
    if (level === 3) return verse.question_level_3 || verse.question_level_1
    if (level === 2) return verse.question_level_2 || verse.question_level_1
    return verse.question_level_1
  }

  function getPrayer() {
    if (!verse) return ''
    if (faithLevel === 3 && verse.prayer_level_3) return verse.prayer_level_3
    if (faithLevel === 2 && verse.prayer_level_2) return verse.prayer_level_2
    return verse.prayer_level_1 || ''
  }

  function nextPrayer() {
    const newIdx = prayerIdx + 1
    setPrayerIdx(newIdx)
    setPrayedCount(c => c + 1)
    const justPrayed = members[prayerIdx % members.length]
    const upNext = members[newIdx % members.length]
    if (members.length <= 1 || newIdx >= members.length) {
      showToast(`${justPrayed || 'You'} prayed. Everyone has prayed tonight. 🙏`)
    } else {
      showToast(`${justPrayed} prayed. ${upNext} is up next. 🙏`)
    }
  }

  async function saveNote() {
    if (!noteText.trim()) { showToast('Write something first.'); return }
    setSavingNote(true)
    try {
      if (noteTarget === 'personal' || noteTarget === 'both') {
        await supabase.from('notes').insert({
          user_id: user.id,
          verse_ref: verse?.verse_ref,
          category: verse?.category,
          content: noteText,
          family_id: null
        })
      }
      if ((noteTarget === 'group' || noteTarget === 'both') && group?.id) {
        await supabase.from('notes').insert({
          user_id: user.id,
          verse_ref: verse?.verse_ref,
          category: verse?.category,
          content: noteText,
          family_id: group.id
        })
      }
      showToast('Saved. ✓')
      setNoteText('')
    } catch (err) {
      showToast('Could not save. Try again.')
    }
    setSavingNote(false)
  }

  function handleLeaveTable() {
    const randomBlessing = BLESSINGS[Math.floor(Math.random() * BLESSINGS.length)]
    setBlessing(randomBlessing)
    setShowBlessing(true)
  }

  function confirmLeave() {
    setShowBlessing(false)
    if (onLeaveTable) onLeaveTable()
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const allPrayed = members.length > 0 && prayedCount >= members.length
  const currentPrayer = members.length > 0 ? members[prayerIdx % members.length] : null
  const nextMember = members.length > 1 ? members[(prayerIdx + 1) % members.length] : null

  const goldAccent = { position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }
  const cardBase = { position: 'relative', overflow: 'hidden', background: 'var(--bg2)', border: '0.5px solid var(--border-gold)', borderRadius: '12px', padding: '1.25rem', marginBottom: '0.875rem' }
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

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>

      {/* Who's at the table */}
      <div style={{ ...cardBase, background: 'var(--bg3)' }}>
        <div style={goldAccent} />
        <span style={{ ...sectionTitle, marginBottom: '0.5rem' }}>
          {group ? group.name : 'At the Table Tonight'}
        </span>
        {members.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {members.map(m => (
              <span key={m} style={{ fontSize: '12px', color: 'var(--cream)', background: 'var(--bg4)', border: '0.5px solid var(--border-gold)', borderRadius: 999, padding: '4px 12px' }}>
                {m}
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
        <div style={{ ...cardBase, borderColor: 'var(--border-gold)' }}>
          <div style={goldAccent} />
          <div className="verse-ref">{verse.verse_ref} · {verse.category}</div>
          <div className="verse-text">"{verse.verse_text}"</div>
        </div>
      )}

      {/* Context */}
      {verse?.context_text && (
        <div style={{ ...cardBase, background: 'var(--bg3)' }}>
          <div style={goldAccent} />
          <span style={sectionTitle}>A little context</span>
          <p style={{ fontSize: '14px', color: 'var(--cream)', lineHeight: 1.75, fontWeight: 300 }}>
            {verse.context_text}
          </p>
        </div>
      )}

      {/* Questions */}
      {verse && (
        <div style={cardBase}>
          <div style={goldAccent} />
          <span style={sectionTitle}>For the table tonight</span>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '1rem', color: 'var(--white)', lineHeight: 1.65, fontStyle: 'italic', marginTop: '0.5rem' }}>
            {getQuestion(1)}
          </p>
          {faithLevel >= 2 && verse.question_level_2 && (
            <div style={{ marginTop: '1rem', borderTop: '0.5px solid var(--border)', paddingTop: '0.875rem' }}>
              <p style={{ fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--silver2)', marginBottom: '0.5rem', fontWeight: 500 }}>Go deeper</p>
              <p style={{ fontFamily: 'Lora, serif', fontSize: '0.9rem', color: 'var(--silver)', lineHeight: 1.6, fontStyle: 'italic' }}>{getQuestion(2)}</p>
            </div>
          )}
          {faithLevel >= 3 && verse.question_level_3 && (
            <div style={{ marginTop: '0.875rem', borderTop: '0.5px solid var(--border)', paddingTop: '0.875rem' }}>
              <p style={{ fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--silver2)', marginBottom: '0.5rem', fontWeight: 500 }}>Push further</p>
              <p style={{ fontFamily: 'Lora, serif', fontSize: '0.9rem', color: 'var(--silver)', lineHeight: 1.6, fontStyle: 'italic' }}>{getQuestion(3)}</p>
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
        <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '1rem', marginBottom: '0.875rem', border: '0.5px solid var(--border)' }}>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '14px', fontStyle: 'italic', color: 'var(--cream)', lineHeight: 1.8 }}>
            {getPrayer()}
          </p>
          <p style={{ fontSize: '11px', color: 'var(--silver)', textAlign: 'right', marginTop: '0.5rem' }}>— Amen 🙏</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-green" onClick={nextPrayer} style={{ opacity: allPrayed ? 0.6 : 1 }}>
            {allPrayed ? '🙏 All prayed' : '✓ We prayed together'}
          </button>
          <button className="btn" onClick={() => setShowPrayerOverlay(true)}>📖 Full prayer</button>
        </div>
      </div>

      {/* We discussed this */}
      <div style={{ marginBottom: '0.875rem' }}>
        <button
          className="btn btn-gold"
          style={{ width: '100%', opacity: discussed ? 0.6 : 1 }}
          onClick={markDiscussed}
          disabled={discussed}
        >
          {discussed ? '✓ Conversation saved for tonight' : '✓ We discussed this tonight 🙏'}
        </button>
      </div>

      {/* Journal */}
      <div style={cardBase}>
        <div style={goldAccent} />
        <span style={sectionTitle}>What happened at the table tonight</span>
        <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic', marginBottom: '0.75rem', marginTop: '0.25rem' }}>
          Write it down. You'll want it later.
        </p>
        <textarea
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
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
      <div style={{ ...cardBase, background: 'var(--bg3)', textAlign: 'center' }}>
        <div style={goldAccent} />
        <p style={{ fontFamily: 'Lora, serif', fontSize: '15px', color: 'var(--white)', marginBottom: '0.5rem' }}>
          It is finished.
        </p>
        <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '1rem', fontStyle: 'italic' }}>
          When you're ready to leave the table, tap below.
        </p>
        <button
          className="btn"
          style={{ width: '100%', color: 'var(--gold)', borderColor: 'var(--border-gold)', background: 'var(--gold-soft)' }}
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

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
