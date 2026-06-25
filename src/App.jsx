import { useState, useEffect } from 'react'
import { useAuth } from './context/AuthContext'
import { useFamily } from './hooks/useFamily'
import { supabase } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import HomePage from './pages/HomePage'
import TablePage from './pages/TablePage'
import StoryPage from './pages/StoryPage'
import JournalPage from './pages/JournalPage'
import SettingsPage from './pages/SettingsPage'
import KendylScene, { hasSeenTodaysScene } from './components/KendylScene'
import AdminPage from './pages/AdminPage'

const ADMIN_USER_ID = '28356e7e-067c-49a8-81a2-095576c432a7'

function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleReset(e) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
      setTimeout(() => onDone(), 2000)
    }
    setLoading(false)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <div className="cross" style={{ width: 24, height: 24 }}></div>
        <h1 className="auth-title">Dinner with <span>Jesus</span></h1>
      </div>
      {success ? (
        <>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✅</div>
          <p style={{ fontFamily: 'Lora, serif', color: 'var(--white)', fontSize: '1.1rem' }}>Password updated!</p>
          <p style={{ color: 'var(--silver)', fontSize: '13px', marginTop: '0.5rem' }}>Taking you to the app...</p>
        </>
      ) : (
        <>
          <p className="auth-sub">Set your new password.</p>
          <form className="auth-form" onSubmit={handleReset}>
            <input type="password" placeholder="New password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            <input type="password" placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={6} />
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="btn btn-gold" disabled={loading} style={{ marginTop: '4px' }}>
              {loading ? '...' : 'Update password'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}

export default function App() {
  const { user, profile, loading } = useAuth()
  const { members, group, loading: familyLoading } = useFamily()
  const [activeTab, setActiveTab] = useState('home')
  const [atTable, setAtTable] = useState(false)
  const [stats, setStats] = useState({ conversations: 0 })
  const [onboardingDone, setOnboardingDone] = useState(false)
  const [showKendyl, setShowKendyl] = useState(false)
  const [isPasswordReset, setIsPasswordReset] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const isAdmin = user?.id === ADMIN_USER_ID

  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('type=recovery')) {
      setIsPasswordReset(true)
    }
  }, [])

  useEffect(() => {
    if (user && !isPasswordReset && !hasSeenTodaysScene()) setShowKendyl(true)
  }, [user])

  if (isPasswordReset) {
    return (
      <ResetPasswordScreen onDone={() => {
        setIsPasswordReset(false)
        window.history.replaceState(null, '', '/')
      }} />
    )
  }

  if (loading || familyLoading) {
    return (
      <div style={{ background: 'var(--bg)', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ fontSize: '2rem', animation: 'pulse 2s ease-in-out infinite' }}>✝️</div>
        <p style={{ color: 'var(--silver)', fontSize: '14px' }}>Dinner with Jesus</p>
        <style>{`@keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }`}</style>
      </div>
    )
  }

  if (!user) return <AuthPage />

  if (user && profile && !profile.onboarding_complete && !onboardingDone) {
    return <OnboardingPage onComplete={() => setOnboardingDone(true)} />
  }

  if (showKendyl) {
    return <KendylScene onEnter={() => setShowKendyl(false)} />
  }

  function onDiscussed() {
    setStats(s => ({ ...s, conversations: s.conversations + 1 }))
  }

  function goToTable() {
    setActiveTab('table')
    setAtTable(true)
  }

  function handleLeaveTable() {
    setAtTable(false)
    setActiveTab('home')
  }

  const tabs = [
    { id: 'home', icon: '🏠', label: 'Home' },
    { id: 'story', icon: '📖', label: 'Story 1:10' },
    { id: 'table', icon: '🍽', label: 'Table' },
    { id: 'journal', icon: '📓', label: 'Journal' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ]

  return (
    <div className="app-shell">
      {showAdmin && <AdminPage onClose={() => setShowAdmin(false)} />}

      {activeTab === 'home' && (
        <HomePage
          onGoToTable={goToTable}
          activeMembers={members}
          setActiveMembers={() => {}}
          allMembers={members}
          stats={stats}
        />
      )}
      {activeTab === 'story' && <StoryPage />}
      {activeTab === 'table' && (
        <TablePage
          onLeaveTable={handleLeaveTable}
        />
      )}
      {activeTab === 'journal' && <JournalPage />}
      {activeTab === 'settings' && (
        <SettingsPage
          isAdmin={isAdmin}
          onOpenAdmin={() => setShowAdmin(true)}
        />
      )}

      {/* Hide nav while at the table */}
      {!atTable && (
        <nav className="bottom-nav">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`nav-item ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(t.id)
                if (t.id === 'table') setAtTable(true)
              }}
            >
              <span className="nav-icon">{t.icon}</span>
              <span className="nav-label">{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
