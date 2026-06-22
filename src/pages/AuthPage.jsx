import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

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
