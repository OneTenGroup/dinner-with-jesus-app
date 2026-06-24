import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [showReset, setShowReset] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (mode === 'signup') {
      if (!name.trim()) { setError('Enter your name'); setLoading(false); return }
      const { error } = await signUp(email, password, name)
      if (error) setError(error.message)
      else setCheckEmail(true)
    } else {
      const { error } = await signIn(email, password)
      if (error) setError('Incorrect email or password')
    }
    setLoading(false)
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    if (!resetEmail.trim()) return
    setResetLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: 'https://www.flippingtables.ai'
    })
    if (error) {
      setError(error.message)
    } else {
      setResetSent(true)
    }
    setResetLoading(false)
  }

  if (checkEmail) {
    return (
      <div className="auth-wrap">
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📬</div>
        <h2 style={{ fontFamily: 'Lora, serif', color: 'var(--white)', marginBottom: '0.5rem' }}>
          Check your email
        </h2>
        <p style={{ color: 'var(--silver)', fontSize: '14px', maxWidth: '280px', lineHeight: 1.7 }}>
          We sent a confirmation link to <strong style={{ color: 'var(--cream)' }}>{email}</strong>.
          Click it to activate your account then come back here to sign in.
        </p>
        <button className="btn-ghost" style={{ marginTop: '1.5rem' }}
          onClick={() => { setCheckEmail(false); setMode('signin') }}>
          Back to sign in
        </button>
      </div>
    )
  }

  if (showReset) {
    return (
      <div className="auth-wrap">
        <div className="auth-logo">
          <div className="cross" style={{ width: 24, height: 24 }}></div>
          <h1 className="auth-title">Dinner with <span>Jesus</span></h1>
        </div>

        {resetSent ? (
          <>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📬</div>
            <h2 style={{ fontFamily: 'Lora, serif', color: 'var(--white)', marginBottom: '0.5rem' }}>
              Check your email
            </h2>
            <p style={{ color: 'var(--silver)', fontSize: '14px', maxWidth: '280px', lineHeight: 1.7 }}>
              We sent a password reset link to <strong style={{ color: 'var(--cream)' }}>{resetEmail}</strong>.
              Click it to set a new password.
            </p>
            <button className="btn-ghost" style={{ marginTop: '1.5rem' }}
              onClick={() => { setShowReset(false); setResetSent(false); setResetEmail('') }}>
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <p className="auth-sub">We'll send you a reset link.</p>
            <form className="auth-form" onSubmit={handleResetPassword}>
              <input
                type="email"
                placeholder="Your email address"
                value={resetEmail}
                onChange={e => setResetEmail(e.target.value)}
                required
              />
              {error && <div className="auth-error">{error}</div>}
              <button type="submit" className="btn btn-gold" disabled={resetLoading} style={{ marginTop: '4px' }}>
                {resetLoading ? '...' : 'Send reset link'}
              </button>
            </form>
            <div className="auth-switch" style={{ marginTop: '1rem' }}>
              <button onClick={() => { setShowReset(false); setError('') }}>Back to sign in</button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <div className="cross" style={{ width: 24, height: 24 }}></div>
        <h1 className="auth-title">Dinner with <span>Jesus</span></h1>
      </div>
      <p className="auth-sub">Not a ritual. A relationship.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === 'signup' && (
          <input type="text" placeholder="Your name" value={name}
            onChange={e => setName(e.target.value)} required />
        )}
        <input type="email" placeholder="Email address" value={email}
          onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)} required minLength={6} />

        {error && <div className="auth-error">{error}</div>}

        <button type="submit" className="btn btn-gold" disabled={loading} style={{ marginTop: '4px' }}>
          {loading ? '...' : mode === 'signup' ? 'Create my account' : 'Sign in'}
        </button>
      </form>

      {mode === 'signin' && (
        <div style={{ marginTop: '0.75rem' }}>
          <button
            onClick={() => { setShowReset(true); setError('') }}
            style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}
          >
            Forgot your password?
          </button>
        </div>
      )}

      <div className="auth-switch">
        {mode === 'signin' ? (
          <>Don't have an account?{' '}
            <button onClick={() => { setMode('signup'); setError('') }}>Sign up free</button>
          </>
        ) : (
          <>Already have an account?{' '}
            <button onClick={() => { setMode('signin'); setError('') }}>Sign in</button>
          </>
        )}
      </div>

      <p style={{ marginTop: '2rem', fontSize: '11px', color: 'var(--silver)', opacity: 0.6, lineHeight: 1.8 }}>
        Colossians 1:10<br />
        Built by <a href="https://onetengroup.ai" target="_blank" style={{ color: 'var(--gold)', textDecoration: 'none' }}>OneTen Group</a>
      </p>
    </div>
  )
}
