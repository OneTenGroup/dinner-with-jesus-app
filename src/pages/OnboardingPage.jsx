import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const STEPS = [
  {
    key: 'how_long',
    question: 'How long have you been following Jesus?',
    sub: 'This helps us set the right depth for your conversations.',
    options: [
      { value: 'just_starting', label: 'Just getting started' },
      { value: 'few_years', label: 'A few years' },
      { value: 'most_of_life', label: 'Most of my life' },
      { value: 'figuring_out', label: 'Still figuring it out' },
    ]
  },
  {
    key: 'faith_state',
    question: 'What does your faith life look like right now?',
    sub: 'Be honest — this is between you and God.',
    options: [
      { value: 'reads_regularly', label: 'I read the Bible regularly' },
      { value: 'prays_mostly', label: "I pray but don't read much" },
      { value: 'church_distant', label: 'Church feels distant lately' },
      { value: 'rebuilding', label: 'Rebuilding after a hard season' },
    ]
  },
  {
    key: 'table_goal',
    question: 'What do you want from this table?',
    sub: "We'll use this to shape your experience.",
    options: [
      { value: 'start_conversations', label: "Start conversations we've never had" },
      { value: 'go_deeper', label: 'Go deeper in what we believe' },
      { value: 'help_others', label: 'Help someone at my table find their way' },
      { value: 'all', label: 'All of the above' },
    ]
  }
]

function faithLevelFromAnswers(howLong, faithState) {
  if (howLong === 'just_starting' || howLong === 'figuring_out') return 1
  if (howLong === 'few_years' || faithState === 'church_distant' || faithState === 'rebuilding') return 2
  return 3
}

export default function OnboardingPage({ onComplete }) {
  const { user, updateProfile } = useAuth()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(false)

  const current = STEPS[step]

  async function handleSelect(value) {
    const newAnswers = { ...answers, [current.key]: value }
    setAnswers(newAnswers)

    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      setLoading(true)
      const faithLevel = faithLevelFromAnswers(newAnswers.how_long, newAnswers.faith_state)
      await supabase.from('onboarding').upsert({
        user_id: user.id,
        how_long: newAnswers.how_long,
        faith_state: newAnswers.faith_state,
        table_goal: newAnswers.table_goal,
        faith_level_assigned: faithLevel
      })
      await updateProfile({ faith_level: faithLevel, onboarding_complete: true })
      setLoading(false)
      onComplete()
    }
  }

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="loading-cross">✝️</div>
        <p style={{ color: 'var(--silver)', fontSize: '14px' }}>Setting your table...</p>
      </div>
    )
  }

  return (
    <div className="onboarding-wrap">
      <div style={{ display: 'flex', gap: 6, marginBottom: '2rem', justifyContent: 'center' }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{
            width: i === step ? 20 : 6, height: 6, borderRadius: 999,
            background: i <= step ? 'var(--gold)' : 'var(--border)',
            transition: 'all 0.3s'
          }} />
        ))}
      </div>

      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div className="cross" style={{ width: 32, height: 32, display: 'inline-block' }}></div>
      </div>

      <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.3rem', color: 'var(--white)', marginBottom: '0.5rem', lineHeight: 1.3, textAlign: 'center' }}>
        {current.question}
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic', marginBottom: '1.5rem', textAlign: 'center' }}>
        {current.sub}
      </p>

      <div className="option-grid">
        {current.options.map(opt => (
          <button key={opt.value}
            className={`option-btn ${answers[current.key] === opt.value ? 'selected' : ''}`}
            onClick={() => handleSelect(opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>

      <p style={{ marginTop: 'auto', paddingTop: '2rem', fontSize: '11px', color: 'var(--silver)', opacity: 0.5, textAlign: 'center' }}>
        This isn't a test. It's a starting point.<br />Your table grows with you.
      </p>
    </div>
  )
}
