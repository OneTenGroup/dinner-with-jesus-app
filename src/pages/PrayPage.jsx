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
  const [loading, setLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState('')
  const [showPrayerOverlay, setShowPrayerOverlay] = useState(false)

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

  async function selectFeeling(key) {
    setSelectedFeeling(key)
    setFeelingVerseIdx(0)
    await loadFeelingVerse(key, 0)
  }

  async function loadFeelingVerse(key, idx) {
    setLoading(true)
    const { data } = await supabase
      .from('feeling_verses')
      .select('*')
      .eq('feeling_key', key)
      .order('display_order')
    if (data && data.length > 0) {
      setFeelingVerse(data[idx % data.length])
    }
    setLoading(false)
  }

  async function nextVerse() {
    const newIdx = feelingVerseIdx + 1
    setFeelingVerseIdx(newIdx)
    await loadFeelingVerse(selectedFeeling, newIdx)
  }

  const feeling = FEELINGS.find(f => f.key === selectedFeeling)

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>
      <div className="card card-gold" style={{ marginBottom: '1rem' }}>
        <p style={{ fontFamily: 'Lora, serif', fontSize: '1rem', color: 'var(--white)', marginBottom: '0.25rem' }}>
          Your verse for this moment
        </p>
        <p style={{ fontSize: '12px', color: 'var(--silver)', fontWeight: 300, marginBottom: '1rem' }}>
          Based on what time it is right now.
        </p>
        <div style={{ fontFamily: 'Lora, serif', fontSize: '2.5rem', fontWeight: 600, color: 'var(--gold)', textAlign: 'center', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
          {currentTime}
        </div>
        <div style={{ textAlign: 'center', padding: '1rem', background: 'var(--bg3)', borderRadius: 10, border: '0.5px dashed var(--border-gold)' }}>
          <div style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>🕐</div>
          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--gold)' }}>Coming soon.</strong><br /><br />
            Every minute has a Bible verse waiting for it.
            {currentTime} brings you every verse referenced as {currentTime} across all of Scripture.<br /><br />
            <em>Full feature arriving with the next update.</em>
          </p>
        </div>
      </div>

      <div className="card">
        <span className="section-label">How are you feeling right now?</span>
        <div className="feelings-grid">
          {FEELINGS.map(f => (
            <button key={f.key}
              className={`feeling-btn ${selectedFeeling === f.key ? 'selected' : ''}`}
              onClick={() => selectFeeling(f.key)}>
              <span className="feeling-emoji">{f.emoji}</span>
              <span className="feeling-label">{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedFeeling && (
        <div className="card card-gold" style={{ marginBottom: '1rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--silver)' }}>Loading...</div>
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
                <button className="btn" onClick={nextVerse}>↺ Another verse</button>
                <button className="btn btn-gold" onClick={() => setShowPrayerOverlay(true)}>🙏 Pray this</button>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--silver)', fontSize: '13px', textAlign: 'center', padding: '1rem' }}>
              More verses coming soon for this feeling.
            </p>
          )}
        </div>
      )}

      {showPrayerOverlay && feelingVerse && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,24,41,0.96)', zIndex: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
          <div style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>✝️</div>
          <p style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontStyle: 'italic', color: 'var(--white)', lineHeight: 1.85, maxWidth: 380, marginBottom: '0.875rem' }}>
            {feelingVerse.prayer_text}
          </p>
          <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '2rem' }}>— Amen 🙏</p>
          <button className="btn btn-gold" style={{ width: 'auto', padding: '11px 2rem' }} onClick={() => setShowPrayerOverlay(false)}>Close</button>
        </div>
      )}
    </div>
  )
}
