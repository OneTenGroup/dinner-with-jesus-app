import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const PRAYERS = {
  Wisdom: "Lord, your wisdom is so much better than ours. Tonight we sat around this table and actually talked — about your Word and about our lives. Help us carry what we said into tomorrow. Amen.",
  Hope: "God of hope, thank you for this table. Thank you for the reminder tonight that you hold the future — and it's good. Give us hope for what's ahead. Amen.",
  Love: "Father, we don't always love well. But we want to. Thank you for showing us what love looks like and for the people at this table who are trying to live it. Amen.",
  Faith: "Lord, increase our faith. Thank you for tonight — for the reminder that you are faithful even when we're not. We trust you with what we can't see. Amen.",
  Courage: "God, thank you that we don't face what's ahead alone. Give this family courage. We go into tomorrow knowing you go first. Amen.",
  Forgiveness: "Father, forgiveness is hard. Receiving it and giving it. Thank you that yours is complete. Help us be a little more like that with each other. Amen.",
  Gratitude: "Lord, we have so much more than we notice most days. Thank you for this food, this table, these people. Help us be grateful people tomorrow too. Amen."
}

export default function TablePage({ activeMembers, onDiscussed, stats }) {
  const { user, profile } = useAuth()
  const [verse, setVerse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [prayerIdx, setPrayerIdx] = useState(0)
  const [showPrayer, setShowPrayer] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [toast, setToast] = useState('')
  const [discussed, setDiscussed] = useState([])
  const [prayedCount, setPrayedCount] = useState(0)

  const faithLevel = profile?.faith_level || 1

  useEffect(() => { loadEverything() }, [])

  async function loadEverything() {
    setLoading(true)
    setError(null)
    try {
      const { data: historyData } = await supabase
        .from('verse_history')
        .select('dinner_verse_id')
      const discussedIds = historyData?.map(d => d.dinner_verse_id) || []
      setDiscussed(discussedIds)
      await loadVerse(discussedIds)
    } catch (err) {
      setError('Could not load. Please try again.')
      setLoading(false)
    }
  }

  async function loadVerse(discussedIds) {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('dinner_verses')
        .select('*')
        .eq('active', true)
        .limit(50)

      if (error) throw error
      if (!data || data.length === 0) {
        setError('No verses found in database.')
        setLoading(false)
        return
      }

      const ids = discussedIds !== undefined ? discussedIds : discussed
      const available = ids.length > 0 ? data.filter(v => !ids.includes(v.id)) : data
      const pool = available.length > 0 ? available : data
      setVerse(pool[Math.floor(Math.random() * pool.length)])
    } catch (err) {
      setError('Could not load verse. Please try again.')
    }
    setLoading(false)
  }

  async function newVerse() { await loadVerse(discussed) }

  async function markDiscussed() {
    if (!verse) return
    try {
      await supabase.from('verse_history').upsert({
        dinner_verse_id: verse.id,
        discussed_at: new Date().toISOString()
      })
      const newDiscussed = [...discussed, verse.id]
      setDiscussed(newDiscussed)
      onDiscussed()
      showToast('Beautiful conversation tonight. 🙏')
      setTimeout(() => loadVerse(newDiscussed), 1800)
    } catch (err) {
      showToast('Could not save. Please try again.')
    }
  }

  async function saveNote() {
    if (!noteText.trim()) { showToast('Write something first.'); return }
    try {
      // Get family_id for current user specifically
      const { data: memberData } = await supabase
        .from('family_members')
        .select('family_id')
        .eq('user_id', user.id)
        .single()

      const { error } = await supabase.from('notes').insert({
        user_id: user.id,
        verse_ref: verse?.verse_ref,
        category: verse?.category,
        content: noteText,
        family_id: memberData?.family_id || null
      })

      if (error) throw error
      showToast('Saved to your journal. ✓')
      setNoteText('')
      onDiscussed()
    } catch (err) {
      showToast('Could not save note.')
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
    return verse.prayer_level_1 || PRAYERS[verse.category] || PRAYERS['Faith']
  }

  function nextPrayer() {
    const members = activeMembers || []
    const newIdx = prayerIdx + 1
    setPrayerIdx(newIdx)
    setPrayedCount(c => c + 1)

    if (members.length === 0) {
      showToast('Prayer complete. Amen. 🙏')
      return
    }

    const justPrayed = members[prayerIdx % members.length]
    const upNext = members[newIdx % members.length]

    if (members.length === 1) {
      showToast(`${justPrayed} prayed. Amen. 🙏`)
      return
    }

    // If we've gone through everyone at least once
    if (newIdx >= members.length) {
      showToast(`${justPrayed} prayed. Everyone has prayed tonight. 🙏`)
    } else {
      showToast(`${justPrayed} prayed. ${upNext} is up next. 🙏`)
    }
  }

  function sendInvite() {
    if (!verse) return
    const msg = encodeURIComponent(`Hey — we're having Dinner with Jesus tonight. Join us?\n\nTonight's verse: ${verse.verse_ref}\n"${verse.verse_text?.substring(0, 80)}..."\n\n[YES, I'm in 🙌] [Sorry, can't make it 🙏]`)
    window.open(`sms:?body=${msg}`)
  }

  function shareVerse() {
    if (!verse) return
    const msg = encodeURIComponent(`Thinking of you.\n\n${verse.verse_ref}\n"${verse.verse_text}"\n\n🙏`)
    window.open(`sms:?body=${msg}`)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const h = new Date().getHours()
  const mealLabel = h < 11 ? '☀️ Morning verse' : h < 17 ? '🌤 Afternoon verse' : '🌙 Tonight\'s verse'
  const members = activeMembers || []
  const currentMember = members.length > 0 ? members[prayerIdx % members.length] : null
  const nextMember = members.length > 1 ? members[(prayerIdx + 1) % members.length] : null
  const allPrayed = members.length > 0 && prayedCount >= members.length

  if (loading) return (
    <div className="loading-wrap" style={{ flex: 1 }}>
      <div className="loading-cross">✝️</div>
      <p style={{ color: 'var(--silver)', fontSize: '14px' }}>Preparing your verse...</p>
    </div>
  )

  if (error) return (
    <div className="loading-wrap" style={{ flex: 1 }}>
      <p style={{ color: '#E57373', fontSize: '14px', textAlign: 'center', padding: '1rem' }}>{error}</p>
      <button className="btn btn-gold" style={{ width: 'auto', padding: '10px 2rem', marginTop: '1rem' }} onClick={loadEverything}>
        Try again
      </button>
    </div>
  )

  if (!verse) return (
    <div className="loading-wrap" style={{ flex: 1 }}>
      <p style={{ color: 'var(--silver)', fontSize: '14px' }}>No verses available.</p>
      <button className="btn" style={{ marginTop: '1rem' }} onClick={loadEverything}>Refresh</button>
    </div>
  )

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>
      <div style={{ fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: '1rem' }}>
        {mealLabel}
      </div>

      <div className="card card-gold">
        <div className="verse-ref">{verse.verse_ref} · {verse.category}</div>
        <div className="verse-text">"{verse.verse_text}"</div>
      </div>

      {verse.context_text && (
        <div className="card" style={{ background: 'var(--bg3)' }}>
          <span className="section-label">A little context</span>
          <p style={{ fontSize: '14px', color: 'var(--cream)', lineHeight: 1.75, fontWeight: 300 }}>
            {verse.context_text}
          </p>
        </div>
      )}

      <div className="card card-gold">
        <span className="section-label">For the table tonight</span>
        <p style={{ fontFamily: 'Lora, serif', fontSize: '1rem', color: 'var(--white)', lineHeight: 1.65, fontStyle: 'italic' }}>
          {getQuestion(1)}
        </p>
        {faithLevel >= 2 && verse.question_level_2 && (
          <div style={{ marginTop: '1rem', borderTop: '0.5px solid var(--border)', paddingTop: '0.875rem' }}>
            <p style={{ fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--silver)', marginBottom: '0.5rem' }}>Go deeper</p>
            <p style={{ fontFamily: 'Lora, serif', fontSize: '0.9rem', color: 'var(--silver)', lineHeight: 1.6, fontStyle: 'italic' }}>{getQuestion(2)}</p>
          </div>
        )}
        {faithLevel >= 3 && verse.question_level_3 && (
          <div style={{ marginTop: '0.875rem', borderTop: '0.5px solid var(--border)', paddingTop: '0.875rem' }}>
            <p style={{ fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--silver)', marginBottom: '0.5rem' }}>Push further</p>
            <p style={{ fontFamily: 'Lora, serif', fontSize: '0.9rem', color: 'var(--silver)', lineHeight: 1.6, fontStyle: 'italic' }}>{getQuestion(3)}</p>
          </div>
        )}
      </div>

      {/* Prayer rotation */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span className="section-label" style={{ marginBottom: 0 }}>Prayer</span>
          {nextMember && !allPrayed && (
            <span style={{ fontSize: '11px', color: 'var(--gold)', background: 'var(--gold-soft)', padding: '2px 10px', borderRadius: 999 }}>
              Next: {nextMember}
            </span>
          )}
          {allPrayed && (
            <span style={{ fontSize: '11px', color: 'var(--gold)', background: 'var(--gold-soft)', padding: '2px 10px', borderRadius: 999 }}>
              Everyone prayed 🙏
            </span>
          )}
        </div>

        <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', color: 'var(--white)', marginBottom: '0.35rem' }}>
          {currentMember ? `${currentMember}'s turn to pray` : 'Your turn to pray'}
        </p>
        <p style={{ fontSize: '12px', color: 'var(--silver)', lineHeight: 1.5, marginBottom: '0.875rem', fontStyle: 'italic', fontWeight: 300 }}>
          {stats.conversations < 3
            ? "Not sure what to say? Read the prayer below. Next time is yours."
            : "Make it yours. Speak from the heart."}
        </p>

        <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '1rem', marginBottom: '0.875rem', border: '0.5px solid var(--border)' }}>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '14px', fontStyle: 'italic', color: 'var(--cream)', lineHeight: 1.8 }}>
            {getPrayer()}
          </p>
          <p style={{ fontSize: '11px', color: 'var(--silver)', textAlign: 'right', marginTop: '0.5rem' }}>— Amen 🙏</p>
        </div>

        <div className="btn-row">
          <button
            className="btn btn-green"
            onClick={nextPrayer}
            style={{ opacity: allPrayed ? 0.6 : 1 }}
          >
            {allPrayed ? '🙏 All prayed' : '✓ We prayed together'}
          </button>
          <button className="btn" onClick={() => setShowPrayer(!showPrayer)}>📖 Full prayer</button>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn" onClick={newVerse}>↺ Different verse</button>
        <button className="btn btn-gold" onClick={markDiscussed}>✓ We discussed this</button>
      </div>

      <button
        className="btn"
        style={{ marginBottom: '0.875rem', background: 'var(--gold-soft)', borderColor: 'var(--border-gold)', color: 'var(--gold)' }}
        onClick={() => setShowInvite(!showInvite)}
      >
        🪑 Invite someone to the table tonight
      </button>

      {showInvite && (
        <div className="card" style={{ marginBottom: '0.875rem' }}>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', color: 'var(--white)', marginBottom: '0.25rem' }}>Can I join your table tonight?</p>
          <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.875rem', fontWeight: 300 }}>Send a quick text. One tap to join.</p>
          {['👨‍👩‍👧‍👦 Extended Family', '👥 Friends', '🏛 Community'].map(g => (
            <div key={g} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.875rem', background: 'var(--bg3)', borderRadius: 10, border: '0.5px solid var(--border)', marginBottom: 6 }}>
              <span style={{ fontSize: '14px', color: 'var(--cream)' }}>{g}</span>
              <button style={{ background: 'var(--gold-soft)', border: '0.5px solid var(--border-gold)', color: 'var(--gold)', borderRadius: 6, padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }} onClick={sendInvite}>Invite</button>
            </div>
          ))}
          <button className="btn" style={{ marginTop: '0.5rem' }} onClick={shareVerse}>📤 Share tonight's verse</button>
        </div>
      )}

      {/* Journal note */}
      <div style={{ marginBottom: '5px' }}>
        <span className="section-label">What happened at the table tonight</span>
      </div>
      <textarea
        value={noteText}
        onChange={e => setNoteText(e.target.value)}
        placeholder="Something someone said that you never want to forget..."
        style={{ minHeight: 72, resize: 'none', marginBottom: 8 }}
      />
      <button className="btn btn-gold" onClick={saveNote} style={{ marginBottom: '1.5rem' }}>
        Save this moment
      </button>

      <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--silver)', fontStyle: 'italic', paddingBottom: '1rem' }}>
        {stats.conversations === 0
          ? 'Your first conversation starts tonight.'
          : `Your family has shared ${stats.conversations} conversation${stats.conversations !== 1 ? 's' : ''} at this table.`}
      </p>

      {/* Full prayer overlay */}
      {showPrayer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,24,41,0.96)', zIndex: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>✝️</div>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.85, maxWidth: 380, marginBottom: '0.875rem' }}>
            {getPrayer()}
          </p>
          <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '2rem' }}>— Amen 🙏</p>
          <button className="btn btn-gold" style={{ width: 'auto', padding: '11px 2rem' }} onClick={() => setShowPrayer(false)}>Close</button>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
