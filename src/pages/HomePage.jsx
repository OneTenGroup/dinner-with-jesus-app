import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

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

export default function HomePage({ onGoToTable, onGoToPray, activeMembers, setActiveMembers, allMembers, stats }) {
  const { profile } = useAuth()
  const [greeting, setGreeting] = useState({ msg: 'Welcome.', sub: '' })
  const [currentTime, setCurrentTime] = useState('')
  const familyMembers = allMembers && allMembers.length > 0 ? allMembers : ['Steve', 'Mandy', 'Avery', 'Kendyl']

  useEffect(() => {
    const h = new Date().getHours()
    const pool = h < 11 ? GREETINGS.morning : h < 17 ? GREETINGS.afternoon : GREETINGS.evening
    setGreeting(pool[Math.floor(Math.random() * pool.length)])
    updateTime()
    const timer = setInterval(updateTime, 30000)
    return () => clearInterval(timer)
  }, [])

  function updateTime() {
    const now = new Date()
    let h = now.getHours() % 12 || 12
    const m = now.getMinutes().toString().padStart(2, '0')
    setCurrentTime(`${h}:${m}`)
  }

  function toggleMember(name) {
    setActiveMembers(prev =>
      prev.includes(name) ? prev.filter(m => m !== name) : [...prev, name]
    )
  }

  const firstName = profile?.name?.split(' ')[0] || 'friend'

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
        <div className="cross" style={{ width: 28, height: 28 }}></div>
        <div>
          <div style={{ fontFamily: 'Lora, serif', fontSize: '1.05rem', fontWeight: 600, color: 'var(--white)' }}>
            Dinner with <span style={{ color: 'var(--gold)' }}>Jesus</span>
          </div>
        </div>
      </div>

      {/* Greeting */}
      <div className="card card-gold" style={{ marginBottom: '1rem' }}>
        <div style={{ fontFamily: 'Lora, serif', fontSize: '1rem', color: 'var(--white)', lineHeight: 1.5, marginBottom: 4 }}>
          {greeting.msg}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic', fontWeight: 300 }}>
          {greeting.sub}
        </div>
      </div>

      {/* Tonight's Table */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span className="section-label" style={{ marginBottom: 0 }}>Tonight's Table</span>
          <span style={{ fontSize: '11px', color: 'var(--silver)', fontWeight: 300 }}>Tap to remove</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1rem' }}>
          {familyMembers.map(m => (
            <button
              key={m}
              className={`member-chip ${activeMembers.includes(m) ? '' : 'off'}`}
              onClick={() => toggleMember(m)}
            >
              <div className="member-dot"></div>
              {m}
            </button>
          ))}
        </div>
        <button className="btn btn-gold" onClick={onGoToTable}>
          Let's Get Started 🙏
        </button>
      </div>

      {/* Pray Anytime */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <span className="section-label">Need a moment with God right now?</span>
        <div className="feelings-grid">
          {FEELINGS.map(f => (
            <button
              key={f.key}
              className="feeling-btn"
              onClick={() => onGoToPray(f.key)}
            >
              <span className="feeling-emoji">{f.emoji}</span>
              <span className="feeling-label">{f.label}</span>
            </button>
          ))}
        </div>
        <button
          className="btn"
          style={{ background: 'var(--gold-soft)', borderColor: 'var(--border-gold)', color: 'var(--gold)' }}
          onClick={() => onGoToPray(null)}
        >
          🕐 {currentTime} — Find your verse for this moment
        </button>
      </div>

      {/* Memory strip */}
      <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--silver)', fontStyle: 'italic', fontWeight: 300, paddingBottom: '1rem' }}>
        {stats.conversations === 0
          ? 'Your first conversation starts tonight.'
          : stats.conversations === 1
          ? 'Your family has shared 1 conversation at this table.'
          : `Your family has shared ${stats.conversations} conversations at this table.`
        }
      </p>
    </div>
  )
}
