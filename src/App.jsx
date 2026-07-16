import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useFamily } from './hooks/useFamily'
import { supabase } from './lib/supabase'
import { track } from './lib/analytics'
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import HomePage from './pages/HomePage'
import TablePage from './pages/TablePage'
import StoryPage from './pages/StoryPage'
import JournalPage from './pages/JournalPage'
import SettingsPage from './pages/SettingsPage'
import KendylScene, { hasSeenTodaysScene } from './components/KendylScene'
import AdminPage from './pages/AdminPage'
import GuestTablePage from './pages/GuestTablePage'

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
  const [kendylDismissed, setKendylDismissed] = useState(false)
  const [isPasswordReset, setIsPasswordReset] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [appReady, setAppReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  // Admin status is verified against the database, never assumed from the client.
  // Deny by default: if the check errors (e.g. the is_admin() function isn't
  // deployed yet) or hasn't resolved, isAdmin stays false.
  useEffect(() => {
    if (!user) { setIsAdmin(false); return }
    let cancelled = false
    supabase.rpc('is_admin').then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        console.warn('[admin-check] is_admin() check failed — denying admin access by default.', error.message)
        setIsAdmin(false)
        return
      }
      setIsAdmin(data === true)
    })
    return () => { cancelled = true }
  }, [user])

  // Safety timeout — never hang forever on cold start
  // Forces app to show after 5 seconds no matter what
  useEffect(() => {
    const timeout = setTimeout(() => {
      setAppReady(true)
    }, 5000)
    return () => clearTimeout(timeout)
  }, [])

  // Mark app ready when both auth and family have resolved
  useEffect(() => {
    if (!loading && !familyLoading) {
      setAppReady(true)
    }
  }, [loading, familyLoading])

  useEffect(() => {
    // supabase-js's own GoTrueClient parses (and then clears) the
    // #access_token=...&type=recovery hash on init as part of
    // detectSessionInUrl -- reading window.location.hash here directly
    // raced against that and could lose depending on timing, silently
    // dropping the user into the signed-in app with no reset form and no
    // indication anything was pending. PASSWORD_RECOVERY is the event
    // GoTrueClient itself emits once it has recognized the recovery link,
    // so it can't miss the hash the SDK already consumed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsPasswordReset(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Show KendylScene once app is ready and user is logged in
  useEffect(() => {
    if (appReady && user && !isPasswordReset && !hasSeenTodaysScene() && !kendylDismissed) {
      setShowKendyl(true)
    }
  }, [appReady, user])

  // Load real conversation count
  useEffect(() => {
    if (!user) return
    track('app_opened')
    async function loadStats() {
      try {
        const { count } = await supabase
          .from('verse_history')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
        setStats({ conversations: count || 0 })
      } catch (err) {}
    }
    loadStats()
  }, [user])

  useEffect(() => {
    function handleGoToSettings() { setActiveTab('settings') }
    window.addEventListener('dwj-go-to-settings', handleGoToSettings)
    return () => window.removeEventListener('dwj-go-to-settings', handleGoToSettings)
  }, [])

  if (isPasswordReset) {
    return (
      <ResetPasswordScreen onDone={() => {
        setIsPasswordReset(false)
        window.history.replaceState(null, '', '/')
      }} />
    )
  }

  // Guest table route — no auth required
  if (window.location.pathname.startsWith('/table/')) {
    return (
      <Routes>
        <Route path="/table/:inviteCode" element={<GuestTablePage />} />
      </Routes>
    )
  }

  // Wait for app to be ready — max 5 seconds
  if (!appReady) {
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

  // Show KendylScene after app is ready — no blue screen
  if (showKendyl) {
    return (
      <KendylScene onEnter={() => {
        track('kendyl_dismissed')
        setShowKendyl(false)
        setKendylDismissed(true)
      }} />
    )
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

      <div style={{ display: activeTab === 'home' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
        <HomePage
          onGoToTable={goToTable}
          activeMembers={members}
          setActiveMembers={() => {}}
          allMembers={members}
          stats={stats}
        />
      </div>

      <div style={{ display: activeTab === 'story' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
        <StoryPage />
      </div>

      <div style={{ display: activeTab === 'table' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
        <TablePage onLeaveTable={handleLeaveTable} />
      </div>

      <div style={{ display: activeTab === 'journal' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
        <JournalPage />
      </div>

      <div style={{ display: activeTab === 'settings' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
        <SettingsPage
          isAdmin={isAdmin}
          onOpenAdmin={() => setShowAdmin(true)}
        />
      </div>

      {!atTable && (
        <nav className="bottom-nav">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`nav-item ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(t.id)
                track('tab_opened', { tab: t.id })
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
