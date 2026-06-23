import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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

export default function PrayPage({ initialFeeling }) {
  const [selectedFeeling, setSelectedFeeling] = useState(initialFeeling || null)
  const [feelingVerse, setFeelingVerse] = useState(null)
  const [feelingVerseIdx, setFeelingVerseIdx] = useState(0)
  const [feelingLoading, setFeelingLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState('')
  const [timeVerses, setTimeVerses] = useState([])
  const [timeLoading, setTimeLoading] = useState(false)
  const [timeLoaded, setTimeLoaded] = useState(false)
  const [showPrayerOverlay, setShowPrayerOverlay] = useState(false)
  const [selectedTimeVerse, setSelectedTimeVerse] = useState(null)

  useEffect(() => {
    updateTime()
    const t = setInterval(updateTime, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (initialFeeling) {
      setSelectedFeeling(initialFeeling)
      loadFeelingVerse(initialFeeling, 0)
    }
  }, [initialFeeling])

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
        .select('id, book, book_abbr, chapter, verse, text_kjv')
        .eq('chapter', h)
        .eq('verse', m)
        .order('book_order')

      if (error) throw error
      setTimeVerses(data || [])
      setTimeLoaded(true)
    } catch (err) {
      console.error('Time verse error:', err)
    }
    setTimeLoading(false)
  }

  async function selectFeeling(key) {
    setSelectedFeeling(key)
    setFeelingVerseIdx(0)
    await loadFeelingVerse(key, 0)
  }

  async function loadFeelingVerse(key, idx) {
    setFeelingLoading(true)
    try {
      const { data } = await supabase
        .from('feeling_verses')
        .select('*')
        .eq('feeling_key', key)
        .order('display_order')
      if (data && data.length > 0) {
        setFeelingVerse(data[idx % data.length])
      } else {
        setFeelingVerse(null)
      }
    } catch (err) {
      setFeelingVerse(null)
    }
    setFeelingLoading(false)
  }

  async function nextFeelingVerse() {
    const newIdx = feelingVerseIdx + 1
    setFeelingVerseIdx(newIdx)
    await loadFeelingVerse(selectedFeeling, newIdx)
  }

  const feeling = FEELINGS.find(f => f.key === selectedFeeling)

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>

      {/* TIME VERSE — prominent but not dominant */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{
          background: 'var(--bg2)',
          border: '0.5px solid var(--border-gold)',
          borderRadius: 14,
          overflow: 'hidden'
        }}>
          {/* Header row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1rem 0.75rem',
            borderBottom: timeLoaded ? '0.5px solid var(--border)' : 'none'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 40, height: 40,
                borderRadius: 10,
                background: 'var(--gold-soft)',
                border: '0.5px solid var(--border-gold)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.2rem', flexShrink: 0
              }}>
                🕐
              </div>
              <div>
                <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', color: 'var(--white)', fontWeight: 600 }}>
                  Your verse for this moment
                </div>
                <div style={{ fontSize: '11px', color: 'var(--silver)', fontWeight: 300, marginTop: 1 }}>
                  God speaks through Scripture — even in the numbers
                </div>
              </div>
            </div>
            <div style={{
              fontFamily: 'Lora, serif',
              fontSize: '1.4rem',
              fontWeight: 600,
              color: 'var(--gold)',
              letterSpacing: '0.05em',
              flexShrink: 0,
              marginLeft: 8
            }}>
              {currentTime}
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '0.875rem 1rem 1rem' }}>
            {!timeLoaded ? (
              <button
                className="btn btn-gold"
                onClick={loadTimeVerses}
                disabled={timeLoading}
                style={{ width: '100%', fontSize: '14px', padding: '12px' }}
              >
                {timeLoading ? 'Finding your verses...' : `Find verses for ${currentTime}`}
              </button>
            ) : timeVerses.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '0.75rem 0' }}>
                <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, marginBottom: '0.75rem' }}>
                  No verses found for {currentTime}.<br />
                  <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>Try again at a different moment.</span>
                </p>
                <button className="btn" onClick={() => { setTimeLoaded(false); setTimeVerses([]) }}>
                  Try current time
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--silver)', marginBottom: '0.75rem' }}>
                  {timeVerses.length} verse{timeVerses.length !== 1 ? 's' : ''} across Scripture for {currentTime}
                </p>
                {timeVerses.map(v => (
                  <div
                    key={v.id}
                    onClick={() => setSelectedTimeVerse(selectedTimeVerse?.id === v.id ? null : v)}
                    style={{
                      padding: '0.875rem',
                      background: selectedTimeVerse?.id === v.id ? 'var(--gold-soft)' : 'var(--bg3)',
                      borderRadius: 10,
                      border: `0.5px solid ${selectedTimeVerse?.id === v.id ? 'var(--border-gold)' : 'var(--border)'}`,
                      marginBottom: 8,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                      {v.book} {v.chapter}:{v.verse}
                    </div>
                    <div style={{ fontFamily: 'Lora, serif', fontSize: '0.88rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.7 }}>
                      "{v.text_kjv}"
                    </div>
                    {selectedTimeVerse?.id === v.id && (
                      <button
                        className="btn btn-gold"
                        style={{ marginTop: '0.75rem', fontSize: '12px', padding: '7px 14px', width: 'auto' }}
                        onClick={e => { e.stopPropagation(); setShowPrayerOverlay(true) }}
                      >
                        🙏 Pray this verse
                      </button>
                    )}
                  </div>
                ))}
                <button className="btn" style={{ marginTop: '0.25rem' }} onClick={() => { setTimeLoaded(false); setTimeVerses([]) }}>
                  ↺ Refresh for current time
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FEELINGS SECTION */}
      <div className="card">
        <span className="section-label">Need a moment with God right now?</span>
        <div className="feelings-grid">
          {FEELINGS.map(f => (
            <button
              key={f.key}
              className={`feeling-btn ${selectedFeeling === f.key ? 'selected' : ''}`}
              onClick={() => selectFeeling(f.key)}
            >
              <span className="feeling-emoji">{f.emoji}</span>
              <span className="feeling-label">{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* FEELING VERSE RESULT */}
      {selectedFeeling && (
        <div className="card card-gold" style={{ marginBottom: '1rem' }}>
          {feelingLoading ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--silver)' }}>
              Finding your verse...
            </div>
          ) : feelingVerse ? (
            <>
              <div className="verse-ref">
                {feeling?.emoji} {feelingVerse.verse_ref} — for when you feel {feeling?.label?.toLowerCase()}
              </div>
              <div className="verse-text" style={{ marginBottom: '0.875rem' }}>
                "{feelingVerse.verse_text}"
              </div>
              <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, marginBottom: '0.875rem', fontStyle: 'italic', fontWeight: 300 }}>
                {feelingVerse.context_text}
              </p>
              <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '1rem', marginBottom: '0.875rem', border: '0.5px solid var(--border)' }}>
                <p style={{ fontFamily: 'Lora, serif', fontSize: '13px', fontStyle: 'italic', color: 'var(--cream)', lineHeight: 1.8 }}>
                  {feelingVerse.prayer_text}
                </p>
              </div>
              <div className="btn-row">
                <button className="btn" onClick={nextFeelingVerse}>↺ Another verse</button>
                <button className="btn btn-gold" onClick={() => setShowPrayerOverlay(true)}>🙏 Pray this</button>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <p style={{ color: 'var(--silver)', fontSize: '13px', marginBottom: '0.5rem' }}>
                No verses loaded yet for this feeling.
              </p>
              <p style={{ color: 'var(--gold)', fontSize: '12px', fontStyle: 'italic' }}>
                Coming in the next update.
              </p>
            </div>
          )}
        </div>
      )}

      {/* PRAYER OVERLAY */}
      {showPrayerOverlay && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,24,41,0.96)', zIndex: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>✝️</div>
          {selectedTimeVerse ? (
            <>
              <p style={{ fontSize: '12px', color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                {selectedTimeVerse.book} {selectedTimeVerse.chapter}:{selectedTimeVerse.verse}
              </p>
              <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.85, maxWidth: 380, marginBottom: '1rem' }}>
                "{selectedTimeVerse.text_kjv}"
              </p>
              <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '2rem', fontStyle: 'italic' }}>
                God, this verse found me at {currentTime}. Let it speak to whatever I'm carrying right now. Amen.
              </p>
            </>
          ) : feelingVerse ? (
            <>
              <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.85, maxWidth: 380, marginBottom: '0.875rem' }}>
                {feelingVerse.prayer_text}
              </p>
              <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '2rem' }}>— Amen 🙏</p>
            </>
          ) : null}
          <button className="btn btn-gold" style={{ width: 'auto', padding: '11px 2rem' }} onClick={() => { setShowPrayerOverlay(false); setSelectedTimeVerse(null) }}>
            Close
          </button>
        </div>
      )}

    </div>
  )
}
