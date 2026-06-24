import { useState, useEffect } from 'react'

const MESSAGES = [
  "You made it. That's enough for tonight.",
  "I saved you a seat. I always do.",
  "Come as you are. We can work on the rest later.",
  "I've been looking forward to this all day.",
  "I turned water into wine. The least you can do is show up.",
  "I fed 5,000 people with 5 loaves and 2 fish. Your excuses are adorable.",
  "I walked on water and I still had a bad day. Sit down. You're fine.",
  "Yes, I know what you did. Still glad you're here.",
  "Whatever today cost you — you're still standing. That matters.",
  "The fact that you opened this? That was Me.",
  "You didn't come this far to only come this far.",
  "I didn't bring you through that to leave you here.",
  "I'm not interested in your highlight reel. Just you.",
  "The version of you that you're hiding? That's who I came for.",
  "You've been trying to carry that alone again, haven't you.",
  "What would you do tonight if you actually believed I was with you?",
  "I know. Sit with me anyway.",
  "Grief is just love with nowhere to go. I'll hold it with you.",
  "You're not too far gone. I don't have a 'too far gone.'",
  "Come back tomorrow. I've got something to say to you."
]

function pickMessage() {
  try {
    let idx = parseInt(localStorage.getItem('dwj_msg_idx') || '0')
    idx = idx % MESSAGES.length
    localStorage.setItem('dwj_msg_idx', ((idx + 1) % MESSAGES.length).toString())
    return MESSAGES[idx]
  } catch (e) {
    return MESSAGES[Math.floor(Math.random() * MESSAGES.length)]
  }
}

export default function KendylScene({ onEnter }) {
  const [message, setMessage] = useState('')
  const [typed, setTyped] = useState('')
  const [showCursor, setShowCursor] = useState(true)
  const [typingDone, setTypingDone] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const msg = pickMessage()
    setMessage(msg)
    // Fade in
    const fadeTimer = setTimeout(() => setVisible(true), 100)
    // Start typing after image loads
    const typeTimer = setTimeout(() => typeMessage(msg), 1200)
    return () => { clearTimeout(fadeTimer); clearTimeout(typeTimer) }
  }, [])

  function typeMessage(text) {
    let i = 0
    const speed = Math.max(28, Math.min(55, 1800 / text.length))
    const interval = setInterval(() => {
      setTyped(text.slice(0, i + 1))
      i++
      if (i >= text.length) {
        clearInterval(interval)
        setTypingDone(true)
        setTimeout(() => setShowCursor(false), 1800)
      }
    }, speed)
  }

  function handleEnter() {
    setVisible(false)
    setTimeout(() => onEnter(), 400)
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-end',
      zIndex: 9999,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.4s ease',
    }}>

      {/* Jesus image — fills screen */}
      <div style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
      }}>
        <img
          src="/jesus-at-table.png"
          alt="Jesus at the dinner table, welcoming you"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center top',
          }}
        />
        {/* Dark gradient overlay at bottom for text legibility */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.75) 65%, rgba(0,0,0,0.95) 100%)',
        }}/>
      </div>

      {/* Content — sits over image at bottom */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        width: '100%',
        maxWidth: '480px',
        padding: '0 24px 48px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
      }}>

        {/* Verse */}
        <p style={{
          fontFamily: 'Georgia, serif',
          fontSize: '11px',
          color: 'rgba(201,168,76,0.85)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          margin: 0,
        }}>
          Matthew 18:20
        </p>

        {/* Message typewriter */}
        <div style={{
          fontFamily: 'Georgia, serif',
          fontSize: 'clamp(18px, 4.5vw, 24px)',
          color: '#F5E6C8',
          fontStyle: 'italic',
          lineHeight: 1.55,
          minHeight: '80px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span>"{typed}</span>
          {showCursor && (
            <span style={{
              display: 'inline-block',
              width: '2px',
              height: '1.1em',
              background: '#C9A84C',
              marginLeft: '2px',
              verticalAlign: 'text-bottom',
              animation: 'blink 0.85s step-end infinite',
            }}/>
          )}
          {typed && <span>"</span>}
        </div>

        {/* CTA button — appears after typing done */}
        <button
          onClick={handleEnter}
          style={{
            marginTop: '8px',
            background: 'transparent',
            border: '1px solid #C9A84C',
            color: '#C9A84C',
            fontFamily: 'Georgia, serif',
            fontSize: '15px',
            padding: '13px 40px',
            borderRadius: '4px',
            cursor: 'pointer',
            letterSpacing: '0.06em',
            opacity: typingDone ? 1 : 0,
            transform: typingDone ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease, background 0.2s ease, color 0.2s ease',
            pointerEvents: typingDone ? 'auto' : 'none',
          }}
          onMouseEnter={e => {
            e.target.style.background = '#C9A84C'
            e.target.style.color = '#0D1829'
          }}
          onMouseLeave={e => {
            e.target.style.background = 'transparent'
            e.target.style.color = '#C9A84C'
          }}
        >
          Come to the Table
        </button>

        {/* Branding */}
        <p style={{
          fontFamily: 'Georgia, serif',
          fontSize: '11px',
          color: 'rgba(255,255,255,0.3)',
          letterSpacing: '0.1em',
          margin: 0,
          marginTop: '4px',
        }}>
          DINNER WITH JESUS · 1:10
        </p>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
