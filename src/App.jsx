import KendylScene from './components/KendylScene'
import { useState, useEffect } from 'react'
import { useAuth } from './context/AuthContext'
import { useFamily } from './hooks/useFamily'
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import HomePage from './pages/HomePage'
import TablePage from './pages/TablePage'
import PrayPage from './pages/PrayPage'
import JournalPage from './pages/JournalPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const { user, profile, loading } = useAuth()
  const { members, loading: familyLoading } = useFamily()
  const [activeTab, setActiveTab] = useState('home')
  const [activeMembers, setActiveMembers] = useState([])
  const [initialFeeling, setInitialFeeling] = useState(null)
  const [stats, setStats] = useState({ conversations: 0 })
  const [onboardingDone, setOnboardingDone] = useState(false)

  // Sync activeMembers when family loads
  useEffect(() => {
    if (members.length > 0) {
      setActiveMembers(members)
    }
  }, [members])

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

  function goToTable() { setActiveTab('table') }
  function goToPray(feeling) { setInitialFeeling(feeling); setActiveTab('pray') }
  function onDiscussed() { setStats(s => ({ ...s, conversations: s.conversations + 1 })) }

  const tabs = [
    { id: 'home', icon: '🏠', label: 'Home' },
    { id: 'pray', icon: '🙏', label: 'Pray' },
    { id: 'table', icon: '🍽', label: 'Table' },
    { id: 'journal', icon: '📖', label: 'Journal' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ]

  return (
    <div className="app-shell">
      {activeTab === 'home' && (
        <HomePage
          onGoToTable={goToTable}
          onGoToPray={goToPray}
          activeMembers={activeMembers}
          setActiveMembers={setActiveMembers}
          allMembers={members}
          stats={stats}
        />
      )}
      {activeTab === 'table' && (
        <TablePage
          activeMembers={activeMembers.length > 0 ? activeMembers : members}
          onDiscussed={onDiscussed}
          stats={stats}
        />
      )}
      {activeTab === 'pray' && <PrayPage initialFeeling={initialFeeling} />}
      {activeTab === 'journal' && <JournalPage />}
      {activeTab === 'settings' && <SettingsPage members={members || []} />}
      <nav className="bottom-nav">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`nav-item ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <span className="nav-icon">{t.icon}</span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
