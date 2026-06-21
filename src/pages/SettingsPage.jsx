import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

const FAITH_LABELS = {
  1: 'Seeker — gentle questions',
  2: 'Growing — one layer deeper',
  3: 'Deep — challenging & application'
}
const TRANSLATIONS = ['NIV', 'NLT', 'KJV', 'ESV', 'NKJV']

export default function SettingsPage() {
  const { profile, signOut, updateProfile } = useAuth()
  const [toast, setToast] = useState('')

  async function handleTranslation(t) {
    await updateProfile({ preferred_translation: t })
    showToast(`Translation set to ${t} ✓`)
  }

  async function handleFaithLevel(level) {
    await updateProfile({ faith_level: level })
    showToast('Faith level updated ✓')
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>
      <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.3rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.25rem' }}>
        Settings
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--silver)', fontWeight: 300, marginBottom: '1.25rem' }}>
        Your table, your way.
      </p>

      <span className="section-label">Your Account</span>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--bg4)', border: '0.5px solid var(--border-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', color: 'var(--gold)', fontWeight: 500, flexShrink: 0 }}>
            {profile?.name?.charAt(0) || '?'}
          </div>
          <div>
            <div style={{ fontSize: '15px', color: 'var(--white)' }}>{profile?.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--silver)', marginTop: 2 }}>{profile?.email || ''}</div>
          </div>
        </div>
      </div>

      <span className="section-label">Faith Journey Level</span>
      <div style={{ marginBottom: '1.5rem' }}>
        {[1, 2, 3].map(level => (
          <div key={level} className="card"
            style={{ marginBottom: 6, cursor: 'pointer', borderColor: profile?.faith_level === level ? 'var(--gold)' : 'var(--border)', background: profile?.faith_level === level ? 'var(--gold-soft)' : 'var(--bg2)' }}
            onClick={() => handleFaithLevel(level)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', color: 'var(--cream)' }}>Level {level}</div>
                <div style={{ fontSize: '12px', color: 'var(--silver)', marginTop: 2 }}>{FAITH_LABELS[level]}</div>
              </div>
              {profile?.faith_level === level && (
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)' }} />
              )}
            </div>
          </div>
        ))}
        <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6, marginTop: '0.5rem', fontStyle: 'italic' }}>
          All 3 question levels are shown at the table — your level sets which appears first.
        </p>
      </div>

      <span className="section-label">Bible Translation</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {TRANSLATIONS.map(t => (
          <button key={t} onClick={() => handleTranslation(t)}
            style={{ padding: '6px 14px', borderRadius: 999, border: `0.5px solid ${profile?.preferred_translation === t ? 'var(--gold)' : 'var(--border)'}`, background: profile?.preferred_translation === t ? 'var(--gold-soft)' : 'var(--bg3)', color: profile?.preferred_translation === t ? 'var(--gold)' : 'var(--silver)', fontSize: '13px', cursor: 'pointer' }}>
            {t}
          </button>
        ))}
      </div>

      <span className="section-label">Your Table</span>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        {['Steve', 'Mandy', 'Avery', 'Kendyl'].map(m => (
          <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.65rem 0', borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg4)', border: '0.5px solid var(--border-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: 'var(--gold)', fontWeight: 500, flexShrink: 0 }}>
              {m.charAt(0)}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--cream)' }}>{m}</div>
          </div>
        ))}
        <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6, marginTop: '0.75rem', fontStyle: 'italic' }}>
          Full table management coming with Circles feature.
        </p>
      </div>

      <span className="section-label">About</span>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '14px', color: 'var(--cream)', marginBottom: 4 }}>Dinner with Jesus</div>
        <div style={{ fontSize: '12px', color: 'var(--silver)' }}>A table for every family · 1:10</div>
        <div style={{ height: '0.5px', background: 'var(--border)', margin: '0.875rem 0' }} />
        <div style={{ fontSize: '12px', color: 'var(--silver)', fontStyle: 'italic', lineHeight: 1.7 }}>
          "So that you may live a life worthy of the Lord and please him in every way: bearing fruit in every good work, growing in the knowledge of God."
        </div>
        <div style={{ fontSize: '11px', color: 'var(--gold)', marginTop: '0.5rem' }}>Colossians 1:10</div>
      </div>

      <button className="btn" style={{ marginBottom: '2rem', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }} onClick={signOut}>
        Sign out
      </button>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
