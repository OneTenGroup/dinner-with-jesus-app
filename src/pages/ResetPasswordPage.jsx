import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Dedicated route (see vercel.json's catch-all -> index.html, and
// App.jsx's early pathname check) that the branded password-reset
// email links to directly -- NOT the normal app shell. Landing here at
// all only ever happens via a reset-password email, so this page
// doesn't need to re-derive "is this actually a recovery flow" from a
// timing-sensitive signal the way a shared route would.
//
// Two independent signals confirm the link is valid, so this is never
// dependent on which one fires first relative to this component
// mounting:
//   1. The official PASSWORD_RECOVERY auth event, which GoTrueClient
//      emits once it recognizes the link -- reliable regardless of
//      when this component subscribes.
//   2. A direct getSession() check on mount, which catches the case
//      where GoTrueClient already processed the link (and already
//      fired the event) before this component had a chance to
//      subscribe -- a session existing at all on this route means the
//      link was already honored.
// If neither resolves within a few seconds, the link is treated as
// invalid/expired rather than leaving the user staring at a spinner.
export default function ResetPasswordPage() {
  const [status, setStatus] = useState('verifying') // verifying | ready | invalid | success
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const resolvedRef = useRef(false)

  useEffect(() => {
    function markReady() {
      if (resolvedRef.current) return
      resolvedRef.current = true
      setStatus('ready')
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') markReady()
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) markReady()
    })

    const timeout = setTimeout(() => {
      if (!resolvedRef.current) setStatus('invalid')
    }, 4000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }
    setStatus('success')
    setSaving(false)
    // updateUser() succeeding while a recovery session is active leaves
    // the user genuinely signed in with that session -- send them
    // straight into the app rather than back to a sign-in form they'd
    // have to fill out again.
    setTimeout(() => {
      window.history.replaceState(null, '', '/')
      window.location.href = '/'
    }, 2200)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <div className="cross" style={{ width: 24, height: 24 }}></div>
        <h1 className="auth-title">Dinner with <span>Jesus</span></h1>
      </div>

      {status === 'verifying' && (
        <>
          <div className="loading-cross" style={{ marginTop: '1rem' }}>✝️</div>
          <p style={{ color: 'var(--silver)', fontSize: '14px', marginTop: '0.75rem' }}>Verifying your link...</p>
        </>
      )}

      {status === 'invalid' && (
        <>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔒</div>
          <h2 style={{ fontFamily: 'Lora, serif', color: 'var(--white)', marginBottom: '0.5rem' }}>
            This link has expired
          </h2>
          <p style={{ color: 'var(--silver)', fontSize: '14px', maxWidth: '280px', lineHeight: 1.7 }}>
            Password reset links only work once and expire after a while. Head back to sign in and request a new one.
          </p>
          <button className="btn-ghost" style={{ marginTop: '1.5rem' }} onClick={() => { window.location.href = '/' }}>
            Back to sign in
          </button>
        </>
      )}

      {status === 'ready' && (
        <>
          <p className="auth-sub">Create a new password.</p>
          <form className="auth-form" onSubmit={handleSubmit}>
            <input
              type="password"
              placeholder="New password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              autoFocus
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              minLength={6}
            />
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="btn btn-gold" disabled={saving} style={{ marginTop: '4px' }}>
              {saving ? '...' : 'Set new password'}
            </button>
          </form>
        </>
      )}

      {status === 'success' && (
        <>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ fontFamily: 'Lora, serif', color: 'var(--white)', fontSize: '1.1rem' }}>Password updated</h2>
          <p style={{ color: 'var(--silver)', fontSize: '13px', marginTop: '0.5rem' }}>Taking you to the table...</p>
        </>
      )}

      <p style={{ marginTop: '2rem', fontSize: '11px', color: 'var(--silver)', opacity: 0.6, lineHeight: 1.8 }}>
        Colossians 1:10<br />
        Built by <a href="https://onetengroup.ai" target="_blank" rel="noreferrer" style={{ color: 'var(--gold)', textDecoration: 'none' }}>OneTen Group</a>
      </p>
    </div>
  )
}
