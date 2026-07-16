import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../hooks/useFamily'
import { supabase } from '../lib/supabase'
import { track } from '../lib/analytics'

const FAITH_STEPS = [
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

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))
  return code
}

const TOTAL_STEPS = 6 // 3 faith + welcome + circle + ready

export default function OnboardingPage({ onComplete }) {
  const { user, updateProfile } = useAuth()
  const { createGroup, joinGroup } = useFamily()
  const [step, setStep] = useState(0) // 0 = welcome, 1-3 = faith, 4 = circle, 5 = ready
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(false)
  const [circleMode, setCircleMode] = useState('none') // none | create | join
  const [groupName, setGroupName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [circleError, setCircleError] = useState('')
  const [createdGroup, setCreatedGroup] = useState(null)
  const [verseLocked, setVerseLocked] = useState(false)

  async function saveFaithAnswers(finalAnswers) {
    const faithLevel = faithLevelFromAnswers(finalAnswers.how_long, finalAnswers.faith_state)
    try {
      await supabase.from('onboarding').upsert({
        user_id: user.id,
        how_long: finalAnswers.how_long,
        faith_state: finalAnswers.faith_state,
        table_goal: finalAnswers.table_goal,
        faith_level_assigned: faithLevel
      })
      await updateProfile({ faith_level: faithLevel })
    } catch (err) {}
    return faithLevel
  }

  async function handleFaithSelect(value) {
    const faithIndex = step - 1 // faith steps are 1,2,3
    const current = FAITH_STEPS[faithIndex]
    const newAnswers = { ...answers, [current.key]: value }
    setAnswers(newAnswers)

    if (faithIndex < FAITH_STEPS.length - 1) {
      setStep(step + 1)
    } else {
      // All faith questions done — save and move to circle step
      setLoading(true)
      await saveFaithAnswers(newAnswers)
      setLoading(false)
      setStep(4)
    }
  }

  async function handleCreateGroup() {
    if (!groupName.trim()) { setCircleError('Give your circle a name.'); return }
    setLoading(true)
    setCircleError('')
    const result = await createGroup(groupName)
    if (result.error) {
      setCircleError(result.error)
      setLoading(false)
      return
    }
    // Lock tonight's verse
    await lockVerse(result.group.id)
    setCreatedGroup(result.group)
    track('group_created', { from: 'onboarding' })
    setLoading(false)
    setStep(5)
  }

  async function handleJoinGroup() {
    if (!joinCode.trim() || joinCode.length !== 6) { setCircleError('Enter a valid 6-character code.'); return }
    setLoading(true)
    setCircleError('')
    const result = await joinGroup(joinCode)
    if (result.error) {
      setCircleError(result.error)
      setLoading(false)
      return
    }
    track('group_joined', { from: 'onboarding' })
    setLoading(false)
    setStep(5)
  }

  // get_or_create_tonight_session() (20260714000004_shared_dinner_session.sql)
  // is the single, atomic, server-side "lock tonight's verse" operation --
  // see HomePage.jsx's copy of this comment for why the client-side
  // check-then-upsert this replaced was a real race.
  async function lockVerse(groupId) {
    try {
      const { data, error } = await supabase.rpc('get_or_create_tonight_session', {
        group_id_input: groupId
      })
      if (error || !data || data.length === 0) return
      setVerseLocked(true)
      track('verse_locked', { from: 'onboarding' })
    } catch (err) {}
  }

  async function handleFinish() {
    setLoading(true)
    await updateProfile({ onboarding_complete: true })
    track('onboarding_complete')
    setLoading(false)
    onComplete()
  }

  function shareInviteCode() {
    if (!createdGroup) return
    const msg = `Hey — we set a place for you at our table tonight.\n\nWe're doing Dinner with Jesus — one verse, one real conversation, one prayer. Takes 15 minutes and it's genuinely special.\n\nDownload the app at flippingtables.ai and enter this code in Settings:\n\n${createdGroup.invite_code}\n\nDon't be late. 🙏`
    if (navigator.share) {
      navigator.share({ text: msg })
    } else {
      navigator.clipboard.writeText(msg)
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

  const progressStep = step
  const goldAccent = { position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }

  return (
    <div className="onboarding-wrap">

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '2rem', justifyContent: 'center' }}>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div key={i} style={{
            width: i === progressStep ? 20 : 6,
            height: 6,
            borderRadius: 999,
            background: i <= progressStep ? 'var(--gold)' : 'var(--border)',
            transition: 'all 0.3s'
          }} />
        ))}
      </div>

      {/* STEP 0 — Welcome */}
      {step === 0 && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✝️</div>
          <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.5rem', color: 'var(--white)', marginBottom: '1rem', lineHeight: 1.4 }}>
            Welcome to the Table.
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--silver)', lineHeight: 1.8, marginBottom: '1rem', fontStyle: 'italic' }}>
            One verse. One conversation. One prayer.
          </p>
          <p style={{ fontSize: '13px', color: 'var(--silver2)', lineHeight: 1.8, marginBottom: '2rem' }}>
            Dinner with Jesus was built to bring families back to the table — not just to eat, but to talk about what matters. It takes 15 minutes. It changes everything.
          </p>
          <button className="btn btn-gold" style={{ width: '100%' }} onClick={() => setStep(1)}>
            Let's get started 🙏
          </button>
        </div>
      )}

      {/* STEPS 1-3 — Faith questions */}
      {step >= 1 && step <= 3 && (
        <>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div className="cross" style={{ width: 32, height: 32, display: 'inline-block' }}></div>
          </div>
          <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.3rem', color: 'var(--white)', marginBottom: '0.5rem', lineHeight: 1.3, textAlign: 'center' }}>
            {FAITH_STEPS[step - 1].question}
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic', marginBottom: '1.5rem', textAlign: 'center' }}>
            {FAITH_STEPS[step - 1].sub}
          </p>
          <div className="option-grid">
            {FAITH_STEPS[step - 1].options.map(opt => (
              <button key={opt.value}
                className={`option-btn ${answers[FAITH_STEPS[step - 1].key] === opt.value ? 'selected' : ''}`}
                onClick={() => handleFaithSelect(opt.value)}>
                {opt.label}
              </button>
            ))}
          </div>
          <p style={{ marginTop: 'auto', paddingTop: '2rem', fontSize: '11px', color: 'var(--silver)', opacity: 0.5, textAlign: 'center' }}>
            This isn't a test. It's a starting point.<br />Your table grows with you.
          </p>
        </>
      )}

      {/* STEP 4 — Create or join circle */}
      {step === 4 && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🍽️</div>
            <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.3rem', color: 'var(--white)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
              Set up your dinner circle.
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, fontStyle: 'italic' }}>
              Create your own circle or join one you've been invited to. Everyone in your circle sees the same verse every night.
            </p>
          </div>

          {circleMode === 'none' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn btn-gold" style={{ width: '100%', padding: '14px' }} onClick={() => setCircleMode('create')}>
                🍽️ Create my dinner circle
              </button>
              <button className="btn" style={{ width: '100%', padding: '14px' }} onClick={() => setCircleMode('join')}>
                🔑 Join a circle with a code
              </button>
              <button
                onClick={() => { updateProfile({ onboarding_complete: true }); onComplete() }}
                style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '12px', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'center', opacity: 0.6 }}
              >
                Skip for now
              </button>
            </div>
          )}

          {circleMode === 'create' && (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--white)', marginBottom: '0.25rem', fontWeight: 500 }}>Name your circle</p>
              <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.875rem' }}>Usually your family name — e.g. "The Baxter's"</p>
              <input
                type="text"
                placeholder="The ___ Family"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                maxLength={40}
                style={{ marginBottom: 8 }}
              />
              {circleError && <p style={{ fontSize: '12px', color: '#E57373', marginBottom: 8 }}>{circleError}</p>}
              <button className="btn btn-gold" onClick={handleCreateGroup} style={{ width: '100%', marginBottom: 8 }}>
                Create my circle 🙏
              </button>
              <button onClick={() => { setCircleMode('none'); setCircleError('') }} style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '13px', cursor: 'pointer', width: '100%', padding: '6px 0' }}>
                Cancel
              </button>
            </div>
          )}

          {circleMode === 'join' && (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--white)', marginBottom: '0.25rem', fontWeight: 500 }}>Enter your invite code</p>
              <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.875rem' }}>The 6-character code from the person who invited you.</p>
              <input
                type="text"
                placeholder="Enter code"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                style={{ marginBottom: 8, textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}
              />
              {circleError && <p style={{ fontSize: '12px', color: '#E57373', marginBottom: 8 }}>{circleError}</p>}
              <button className="btn btn-gold" onClick={handleJoinGroup} style={{ width: '100%', marginBottom: 8 }}>
                Join this circle 🙏
              </button>
              <button onClick={() => { setCircleMode('none'); setCircleError('') }} style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '13px', cursor: 'pointer', width: '100%', padding: '6px 0' }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 5 — Ready */}
      {step === 5 && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🙏</div>
          <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.4rem', color: 'var(--white)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
            Your table is set.
          </h2>

          {verseLocked && (
            <div style={{ background: 'var(--bg2)', border: '0.5px solid var(--border-gold)', borderRadius: 12, padding: '0.875rem', marginBottom: '1rem', position: 'relative', overflow: 'hidden' }}>
              <div style={goldAccent} />
              <p style={{ fontSize: '12px', color: 'var(--gold)', marginBottom: '0.25rem' }}>✓ Tonight's verse is locked</p>
              <p style={{ fontSize: '12px', color: 'var(--silver)', fontStyle: 'italic' }}>Everyone in your circle will see the same verse.</p>
            </div>
          )}

          {createdGroup && (
            <div style={{ background: 'var(--bg2)', border: '0.5px solid var(--border-gold)', borderRadius: 12, padding: '0.875rem', marginBottom: '1.25rem', position: 'relative', overflow: 'hidden' }}>
              <div style={goldAccent} />
              <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.5rem' }}>Share this code to invite your family:</p>
              <div style={{ fontFamily: 'Lora, serif', fontSize: '2rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.2em', marginBottom: '0.75rem' }}>
                {createdGroup.invite_code}
              </div>
              <button className="btn btn-gold" onClick={shareInviteCode} style={{ width: '100%', marginBottom: 6 }}>
                📤 Share invite now
              </button>
            </div>
          )}

          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, marginBottom: '1.5rem', fontStyle: 'italic' }}>
            The table is ready. He's already there. Come when you're ready — tonight, at dinner.
          </p>

          <button className="btn btn-gold" style={{ width: '100%' }} onClick={handleFinish}>
            Come to the Table 🙏
          </button>
        </div>
      )}
    </div>
  )
}
