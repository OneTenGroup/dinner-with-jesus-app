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
import ResetPasswordPage from './pages/ResetPasswordPage'
import { setUpdateBusy, registerUpdateNotifyHandler, applyUpdateNow } from './lib/appUpdate'

export default function App() {
  const { user, profile, loading } = useAuth()
  const { members, group, loading: familyLoading } = useFamily()
  const [activeTab, setActiveTab] = useState('home')
  const [atTable, setAtTable] = useState(false)
  const [stats, setStats] = useState({ conversations: 0 })
  const [onboardingDone, setOnboardingDone] = useState(false)
  const [showKendyl, setShowKendyl] = useState(false)
  const [kendylDismissed, setKendylDismissed] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [appReady, setAppReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)

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

  // Show KendylScene once app is ready and user is logged in
  useEffect(() => {
    if (appReady && user && !hasSeenTodaysScene() && !kendylDismissed) {
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

  // A pending PWA update defers its reload while atTable is true --
  // the same flag that already hides the bottom nav during the dinner
  // flow, reused here so a reload never interrupts someone mid-verse,
  // mid-question, or mid-prayer. See src/lib/appUpdate.js.
  useEffect(() => {
    setUpdateBusy(atTable)
  }, [atTable])

  useEffect(() => {
    registerUpdateNotifyHandler(() => setUpdateReady(true))
  }, [])

  // Password-reset route — a dedicated path the branded reset email
  // links to directly, checked from the raw URL before any auth-state
  // logic runs at all. This is deliberately NOT derived from an async
  // Supabase event/session check at the routing level (that was the
  // previous, race-prone approach) -- arriving at this exact path only
  // ever happens via a reset email, so the path itself is the routing
  // signal. ResetPasswordPage handles the async recovery-session
  // detection internally.
  if (window.location.pathname.startsWith('/reset-password')) {
    return <ResetPasswordPage />
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

  // KendylScene is checked before onboarding so it's the true opening
  // moment for a brand-new user too -- not just something returning
  // users see later. hasSeenTodaysScene() is false for anyone who's
  // never seen it, so a first-time user gets it right here, then flows
  // into onboarding once they dismiss it. Returning users (onboarding
  // already complete) see the same daily-scene behavior as before.
  if (showKendyl) {
    return (
      <KendylScene onEnter={() => {
        track('kendyl_dismissed')
        setShowKendyl(false)
        setKendylDismissed(true)
      }} />
    )
  }

  if (user && profile && !profile.onboarding_complete && !onboardingDone) {
    return <OnboardingPage onComplete={() => setOnboardingDone(true)} />
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

      {/* A pending update only ever reaches this banner while busy
          (atTable, or actively typing a journal entry) -- otherwise it
          reloads on its own the moment the user isn't busy anymore, with
          no banner shown at all. This is the explicit "small notice"
          fallback for someone who stays on a busy screen a while. */}
      {updateReady && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'var(--bg2)', borderBottom: '1px solid var(--border-gold)', padding: '8px 14px', fontSize: '12px', color: 'var(--silver)' }}>
          <span>A new version is ready.</span>
          <button
            onClick={applyUpdateNow}
            style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px', padding: 0 }}
          >
            Refresh now
          </button>
        </div>
      )}

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
