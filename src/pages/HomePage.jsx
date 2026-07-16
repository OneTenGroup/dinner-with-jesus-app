import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../hooks/useFamily'
import { supabase } from '../lib/supabase'
import BiblePage from './BiblePage'

const GREETINGS = {
  morning: [
    { msg: "Good morning. The table's set and the day is ahead of you.", sub: "Start it with something that matters." },
    { msg: "Morning! God's mercies are new today. Every single one.", sub: "What are we eating? Who's with us?" },
    { msg: "Rise and shine. Someone's been waiting to sit with you.", sub: "Morning verse incoming." },
    { msg: "Before the day gets away from you — let's start here.", sub: "Two minutes at the table changes everything." },
  ],
  afternoon: [
    { msg: "Good afternoon. Step away for five minutes.", sub: "This is worth it. Promise." },
    { msg: "Halfway through the day. How are you actually doing?", sub: "A good conversation starts here." },
  ],
  evening: [
    { msg: "The table is ready. So is He.", sub: "Pull up a chair. Someone's been waiting." },
    { msg: "Good evening. You made it through today. That counts for something.", sub: "Let's end it well." },
    { msg: "Hey, it's been a day. Sit down. Take a breath.", sub: "The verse tonight might be exactly what you need." },
    { msg: "Welcome back. He's been here the whole time.", sub: "Glad you're here." },
    { msg: "The table is set. The family is together. That's already a blessing.", sub: "Let's make it a great one." },
  ]
}

const FEELINGS = [
  { emoji: '😰', label: 'Fear', key: 'fear' },
  { emoji: '😤', label: 'Anger', key: 'anger' },
  { emoji: '😔', label: 'Sadness', key: 'sadness' },
  { emoji: '😕', label: 'Lost', key: 'lost' },
  { emoji: '🙏', label: 'Grateful', key: 'grateful' },
  { emoji: '💪', label: 'Need strength', key: 'strength' },
  { emoji: '❤️', label: 'Need love', key: 'love' },
  { emoji: '😟', label: 'Anxious', key: 'anxious' },
  { emoji: '🌊', label: 'Overwhelmed', key: 'overwhelmed' },
  { emoji: '⚡', label: 'Temptation', key: 'temptation' },
  { emoji: '🕊', label: 'Need peace', key: 'peace' },
  { emoji: '🌟', label: 'Direction', key: 'direction' },
]

const sectionStyle = {
  background: 'var(--bg2)',
  border: '0.5px solid var(--border-gold)',
  borderRadius: '12px',
  padding: '1.25rem',
  marginBottom: '1rem',
  position: 'relative',
  overflow: 'hidden',
}

const sectionTitleStyle = {
  fontFamily: 'Lora, serif',
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--white)',
  letterSpacing: '0.02em',
  marginBottom: '0.35rem',
  display: 'block',
}

const sectionSubStyle = {
  fontSize: '13px',
  color: 'var(--silver2)',
  fontStyle: 'italic',
  fontWeight: 300,
  marginBottom: '1rem',
  lineHeight: 1.5,
}

// get_or_create_tonight_session() (20260714000004_shared_dinner_session.sql)
// is the single, atomic, server-side "lock tonight's verse" operation --
// this used to be a separate client-side check-then-upsert (duplicated
// four times across the app) with a real race: two near-simultaneous
// callers could both pass the "not locked yet" check, then both upsert,
// with the second silently overwriting the first caller's verse pick.
// The RPC's insert-on-conflict-do-nothing makes that impossible. It's
// also idempotent to call when a verse is already locked -- it just
// returns the existing session -- so there's no separate "alreadyLocked"
// branch to handle here anymore.
async function lockVerseForGroup(groupId) {
  if (!groupId) return { error: 'No group found' }
  const { data, error } = await supabase.rpc('get_or_create_tonight_session', {
    group_id_input: groupId
  })
  if (error || !data || data.length === 0) return { error: 'Could not lock verse' }
  return { success: true, wasCreated: data[0].was_created }
}

export default function HomePage({ onGoToTable, activeMembers, setActiveMembers, allMembers, stats }) {
  const { profile, user } = useAuth()
  const { group, members } = useFamily()
  const [greeting, setGreeting] = useState({ msg: 'Welcome.', sub: '' })
  const [currentTime, setCurrentTime] = useState('')
  const [timeVerses, setTimeVerses] = useState([])
  const [timeLoading, setTimeLoading] = useState(false)
  const [timeLoaded, setTimeLoaded] = useState(false)
  const [selectedTimeVerse, setSelectedTimeVerse] = useState(null)
  const [announcement, setAnnouncement] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [verseLocked, setVerseLocked] = useState(false)
  const [lockingVerse, setLockingVerse] = useState(false)

  const [customTimeInput, setCustomTimeInput] = useState('')
  const [customTimeLoading, setCustomTimeLoading] = useState(false)

  const [selectedFeeling, setSelectedFeeling] = useState(null)
  const [feelingVerse, setFeelingVerse] = useState(null)
  const [feelingVerseIdx, setFeelingVerseIdx] = useState(0)
  const [feelingLoading, setFeelingLoading] = useState(false)
  const [showFeelingPopup, setShowFeelingPopup] = useState(false)
  const [showPrayOverlay, setShowPrayOverlay] = useState(false)
  const [showBible, setShowBible] = useState(false)
  const [toast, setToast] = useState('')

  const familyMembers = members || []
  const isOwner = group?.isOwner

  useEffect(() => {
    const h = new Date().getHours()
    const pool = h < 11 ? GREETINGS.morning : h < 17 ? GREETINGS.afternoon : GREETINGS.evening
    setGreeting(pool[Math.floor(Math.random() * pool.length)])
    updateTime()
    const timer = setInterval(updateTime, 30000)
    loadAnnouncement()
    checkVerseLocked()
    return () => clearInterval(timer)
  }, [group])

  async function checkVerseLocked() {
    if (!group?.id) return
    // get_canonical_dinner_date_for_group() resolves "today" using the
    // group's own timezone + 4am cutoff, server-side -- not a
    // client-computed date, and without the side effect of creating a
    // session just to check whether one exists yet.
    const { data: today } = await supabase.rpc('get_canonical_dinner_date_for_group', {
      group_id_input: group.id
    })
    if (!today) return
    const { data } = await supabase
      .from('group_verse')
      .select('id')
      .eq('group_id', group.id)
      .eq('verse_date', today)
      .single()
    setVerseLocked(!!data)
  }

  async function handleLockVerse() {
    if (!group?.id) { showToast('You need a dinner circle first.'); return }
    setLockingVerse(true)
    const result = await lockVerseForGroup(group.id)
    if (result.success) {
      showToast(result.wasCreated ? "Tonight's table is ready. 🙏" : 'Tonight\'s table was already set. 🙏')
      setVerseLocked(true)
    } else {
      showToast(result.error || 'Could not set verse. Try again.')
    }
    setLockingVerse(false)
  }

  async function loadAnnouncement() {
    try {
      const dismissed = localStorage.getItem('dwj_announcement_dismissed')
      const { data } = await supabase
        .from('announcements')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
      if (data && data.length > 0) {
        const ann = data[0]
        if (dismissed !== ann.id) setAnnouncement(ann)
      }
    } catch (err) {}
  }

  function dismissBanner() {
    if (announcement) localStorage.setItem('dwj_announcement_dismissed', announcement.id)
    setBannerDismissed(true)
  }

  function updateTime() {
    const now = new Date()
    let h = now.getHours() % 12 || 12
    const m = now.getMinutes().toString().padStart(2, '0')
    setCurrentTime(`${h}:${m}`)
  }

  async function loadTimeVerses() {
    if (timeLoaded) return
    setTimeLoading(true)
    const now = new Date()
    const h = now.getHours() % 12 || 12
    const m = now.getMinutes()
    try {
      const { data, error } = await supabase
        .from('bible_verses')
        .select('id, book, book_abbr, chapter, verse, text_web')
        .eq('chapter', h)
        .eq('verse', m)
        .order('book_order')
      if (error) throw error
      setTimeVerses(data || [])
      setTimeLoaded(true)
    } catch (err) {}
    setTimeLoading(false)
  }

  async function searchCustomTime() {
    const input = customTimeInput.trim()
    if (!input) return
    // Parse h:mm or h format
    const parts = input.split(':')
    const h = parseInt(parts[0], 10)
    const m = parts[1] !== undefined ? parseInt(parts[1], 10) : 0
    if (isNaN(h) || isNaN(m) || h < 1 || h > 12 || m < 0 || m > 59) {
      showToast('Enter a valid time like 6:24 or 11:00')
      return
    }
    setCustomTimeLoading(true)
    try {
      const { data, error } = await supabase
        .from('bible_verses')
        .select('id, book, book_abbr, chapter, verse, text_web')
        .eq('chapter', h)
        .eq('verse', m)
        .order('book_order')
      if (error) throw error
      // Randomly pick up to 3 so it feels personal not overwhelming
      const shuffled = (data || []).sort(() => Math.random() - 0.5).slice(0, 3)
      setTimeVerses(shuffled)
      setTimeLoaded(true)
      setCustomTimeInput('')
      if (!data || data.length === 0) {
        showToast(`No verses found for ${h}:${m.toString().padStart(2,'0')}`)
      }
    } catch (err) {
      showToast('Could not search. Try again.')
    }
    setCustomTimeLoading(false)
  }

  async function selectFeeling(key) {
    setSelectedFeeling(key)
    setFeelingVerseIdx(0)
    setShowFeelingPopup(true)
    setFeelingLoading(true)
    try {
      const { data } = await supabase
        .from('feeling_verses')
        .select('*')
        .eq('feeling_key', key)
        .order('display_order')
      if (data && data.length > 0) setFeelingVerse(data[0])
      else setFeelingVerse(null)
    } catch (err) { setFeelingVerse(null) }
    setFeelingLoading(false)
  }

  async function nextFeelingVerse() {
    const newIdx = feelingVerseIdx + 1
    setFeelingVerseIdx(newIdx)
    setFeelingLoading(true)
    try {
      const { data } = await supabase
        .from('feeling_verses')
        .select('*')
        .eq('feeling_key', selectedFeeling)
        .order('display_order')
      if (data && data.length > 0) setFeelingVerse(data[newIdx % data.length])
    } catch (err) {}
    setFeelingLoading(false)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const feeling = FEELINGS.find(f => f.key === selectedFeeling)

  const conversationMsg = stats.conversations === 0
    ? "Your first conversation hasn't happened yet. Tonight could be the night. 🙏"
    : stats.conversations === 1
    ? "Your family has shared 1 conversation at this table. Keep going."
    : `Your family has shared ${stats.conversations} conversations at this table. That's ${stats.conversations} nights that mattered.`

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>

      {showBible && <BiblePage onClose={() => setShowBible(false)} />}

      {announcement && !bannerDismissed && (
        <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--bg3)', border: '0.5px solid rgba(76,175,118,0.4)', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '10px', borderLeft: '3px solid var(--gold)' }}>
          <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '1px' }}>📣</span>
          <p style={{ fontSize: '13px', color: 'var(--cream)', lineHeight: 1.6, flex: 1, margin: 0 }}>{announcement.message}</p>
          <button onClick={dismissBanner} style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '16px', cursor: 'pointer', padding: '0 0 0 8px', flexShrink: 0, lineHeight: 1 }}>✕</button>
        </div>
      )}

      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: '1.25rem' }}>
        <div className="cross" style={{ width: 28, height: 28 }}></div>
        <div style={{ fontFamily: 'Lora, serif', fontSize: '1.05rem', fontWeight: 600, color: 'var(--white)' }}>
          Dinner with <span style={{ color: 'var(--gold)' }}>Jesus</span>
        </div>
      </div>

      {/* Greeting */}
      <div style={{ ...sectionStyle, background: 'var(--bg2)' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }} />
        <div style={{ fontFamily: 'Lora, serif', fontSize: '1rem', color: 'var(--white)', lineHeight: 1.5, marginBottom: 4 }}>{greeting.msg}</div>
        <div style={{ fontSize: '13px', color: 'var(--silver2)', fontStyle: 'italic', fontWeight: 300 }}>{greeting.sub}</div>
      </div>

      {/* Tonight's Table */}
      <div style={sectionStyle}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
          <span style={sectionTitleStyle}>Tonight's Table</span>
        </div>
        <p style={sectionSubStyle}>The table is set. He's already here.</p>

        {familyMembers.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic', marginBottom: '1rem', lineHeight: 1.6 }}>
            Your table is empty. Go to Settings to create or join a dinner circle.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1rem' }}>
            {familyMembers.map(m => (
              <div key={m} className="member-chip">
                <div className="member-dot"></div>
                {m}
              </div>
            ))}
          </div>
        )}

        {/* Lock verse button */}
        {group && (
          <button
            className="btn"
            style={{ width: '100%', marginBottom: 8, background: verseLocked ? 'var(--bg3)' : 'var(--gold-soft)', borderColor: 'var(--border-gold)', color: verseLocked ? 'var(--silver)' : 'var(--gold)', fontSize: '13px' }}
            onClick={handleLockVerse}
            disabled={lockingVerse || verseLocked}
          >
            {lockingVerse ? 'Setting the table...' : verseLocked ? '✓ Tonight\'s verse is set' : '🔒 Set tonight\'s verse'}
          </button>
        )}

        <button className="btn btn-gold" onClick={onGoToTable}>
          Let's Get Started 🙏
        </button>
      </div>

      {/* Time Verse */}
      <div style={sectionStyle}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }} />
        <span style={sectionTitleStyle}>Your verse for this moment</span>
        <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, marginBottom: '1rem', fontStyle: 'italic' }}>
          What time was it when everything changed?
        </p>
        <p style={{ fontSize: '12px', color: 'var(--silver2)', lineHeight: 1.6, marginBottom: '1rem', fontWeight: 300 }}>
          Every chapter and verse in the Bible has a number. So does every moment of your day. Enter a time that moved you — and find the verse that was waiting there.
        </p>
        <input
          type="text"
          placeholder="Enter a time — e.g. 6:24"
          value={customTimeInput}
          onChange={e => setCustomTimeInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && searchCustomTime()}
          maxLength={5}
          style={{ width: '100%', marginBottom: 8, textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.15em' }}
        />
        <button
          className="btn btn-gold"
          onClick={searchCustomTime}
          disabled={customTimeLoading}
          style={{ width: '100%', marginBottom: timeVerses.length > 0 ? '1rem' : 0 }}
        >
          {customTimeLoading ? 'Searching...' : '🕐 Find my verse'}
        </button>

        {/* Results */}
        {timeLoaded && timeVerses.length === 0 && (
          <p style={{ fontSize: '13px', color: 'var(--silver)', textAlign: 'center', fontStyle: 'italic', marginTop: '0.75rem' }}>
            No verses found for that time. Try another moment.
          </p>
        )}
        {timeVerses.length > 0 && (
          <div>
            <p style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--silver)', marginBottom: '0.75rem' }}>
              {timeVerses.length} verse{timeVerses.length !== 1 ? 's' : ''} across Scripture
            </p>
            {timeVerses.map(v => (
              <div key={v.id} onClick={() => setSelectedTimeVerse(selectedTimeVerse?.id === v.id ? null : v)}
                style={{ padding: '0.875rem', background: selectedTimeVerse?.id === v.id ? 'var(--gold-soft)' : 'var(--bg3)', borderRadius: 10, border: `0.5px solid ${selectedTimeVerse?.id === v.id ? 'var(--border-gold)' : 'var(--border)'}`, marginBottom: 8, cursor: 'pointer' }}>
                <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>{v.book} {v.chapter}:{v.verse}</div>
                <div style={{ fontFamily: 'Lora, serif', fontSize: '0.88rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.7 }}>"{v.text_web}"</div>
              </div>
            ))}
            <button className="btn" style={{ width: '100%', marginTop: '0.25rem' }} onClick={() => { setTimeLoaded(false); setTimeVerses([]); setSelectedTimeVerse(null); setCustomTimeInput('') }}>
              ↺ Search another time
            </button>
          </div>
        )}
      </div>

      {/* Feelings Grid */}
      <div style={sectionStyle}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }} />
        <span style={sectionTitleStyle}>Need a moment with God right now?</span>
        <p style={sectionSubStyle}>Pick what you're actually feeling. He already knows anyway.</p>
        <div className="feelings-grid">
          {FEELINGS.map(f => (
            <button key={f.key} className="feeling-btn" onClick={() => selectFeeling(f.key)}>
              <span className="feeling-emoji">{f.emoji}</span>
              <span className="feeling-label">{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Conversations */}
      <div style={{ ...sectionStyle, textAlign: 'center', background: 'var(--bg3)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }} />
        <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🍽️</div>
        <p style={{ fontFamily: 'Lora, serif', fontSize: '17px', color: 'var(--gold)', lineHeight: 1.7, fontStyle: 'italic', fontWeight: 600 }}>{conversationMsg}</p>
      </div>

      {/* Share the app */}
      <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
        <button
          onClick={() => {
            const msg = `Check out Dinner with Jesus — one verse, one real conversation, one prayer at dinner. It's changing how families connect. flippingtables.ai 🙏`
            if (navigator.share) {
              navigator.share({ text: msg })
            } else {
              navigator.clipboard.writeText(msg)
              showToast('Copied! Share it with someone. 🙏')
            }
          }}
          style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: '14px', cursor: 'pointer', fontFamily: 'Lora, serif', fontStyle: 'italic', textDecoration: 'underline', textUnderlineOffset: '3px' }}
        >
          🙏 Share Dinner with Jesus
        </button>
      </div>

      {/* Bible Reader */}
      <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
        <button onClick={() => setShowBible(true)} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: '14px', cursor: 'pointer', fontFamily: 'Lora, serif', fontStyle: 'italic', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
          📖 Read the Bible
        </button>
      </div>

      <p style={{ textAlign: 'center', fontSize: '11px', color: 'var(--silver)', opacity: 0.5, paddingBottom: '1.5rem' }}>
        Built by <a href="https://onetengroup.ai" target="_blank" rel="noreferrer" style={{ color: 'var(--gold)', textDecoration: 'none' }}>OneTen Group</a> · 1:10
      </p>

      {/* Feeling Verse Popup */}
      {showFeelingPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,24,41,0.96)', zIndex: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowFeelingPopup(false) }}>
          <div style={{ background: 'var(--bg2)', borderRadius: 16, border: '0.5px solid var(--border-gold)', padding: '1.5rem', width: '100%', maxWidth: '420px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
              <button onClick={() => setShowFeelingPopup(false)} style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '20px', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
            </div>
            {feelingLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--silver)' }}>Finding your verse...</div>
            ) : feelingVerse ? (
              <>
                <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  {feeling?.emoji} {feelingVerse.verse_ref} — for when you feel {feeling?.label?.toLowerCase()}
                </div>
                <div style={{ fontFamily: 'Lora, serif', fontSize: '1.05rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.7, marginBottom: '0.875rem' }}>"{feelingVerse.verse_text}"</div>
                <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, marginBottom: '0.875rem', fontStyle: 'italic', fontWeight: 300 }}>{feelingVerse.context_text}</p>
                <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '1rem', marginBottom: '1rem', border: '0.5px solid var(--border)' }}>
                  <p style={{ fontFamily: 'Lora, serif', fontSize: '13px', fontStyle: 'italic', color: 'var(--cream)', lineHeight: 1.8, margin: 0 }}>{feelingVerse.prayer_text}</p>
                </div>
                <div className="btn-row">
                  <button className="btn" onClick={nextFeelingVerse}>↺ Another verse</button>
                  <button className="btn btn-gold" onClick={() => setShowPrayOverlay(true)}>🙏 Pray this</button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <p style={{ color: 'var(--silver)', fontSize: '13px' }}>No verses found for this feeling.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Prayer overlay */}
      {showPrayOverlay && feelingVerse && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,24,41,0.98)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>✝️</div>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.85, maxWidth: 380, marginBottom: '0.875rem' }}>{feelingVerse.prayer_text}</p>
          <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '2rem' }}>— Amen 🙏</p>
          <button className="btn btn-gold" style={{ width: 'auto', padding: '11px 2rem' }} onClick={() => { setShowPrayOverlay(false); setShowFeelingPopup(false) }}>Close</button>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
