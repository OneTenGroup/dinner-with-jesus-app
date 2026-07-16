import { useEffect } from 'react'
import { track } from '../lib/analytics'

const CONTACT_EMAIL = 'info@onetengroup.ai'
const RECOMMEND_MAILTO =
  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Church or Group Recommendation — Dinner with Jesus')}` +
  `&body=${encodeURIComponent(
    "Hi Friends,\n\nI'd like to recommend Dinner with Jesus to a church, ministry, small group, or organization:\n\n" +
    "Name: \nContact info: \nWhy I think they'd love it: \n\n"
  )}`

// Shown at most once every 14 days, and never before a family's 3rd
// completed dinner (avoids interrupting a brand-new user's first
// nights at the table). Entirely local -- no new table, no migration.
export default function ChurchCTA({ onMaybeLater, onDontShowAgain }) {
  useEffect(() => {
    track('church_cta_shown')
  }, [])

  function handleRecommend() {
    track('church_cta_recommend_clicked')
    window.location.href = RECOMMEND_MAILTO
  }

  async function handleShare() {
    track('church_cta_share_clicked')
    // Uses the app's own current origin, same pattern as the invite
    // link in TablePage.jsx -- never a hardcoded domain.
    const shareUrl = window.location.origin
    const shareData = {
      title: 'Dinner with Jesus',
      text: 'One verse. One conversation. One prayer. We\'ve been using Dinner with Jesus at our table — thought you might love it too.',
      url: shareUrl
    }
    if (navigator.share) {
      try { await navigator.share(shareData) } catch { /* user cancelled, nothing to do */ }
    } else {
      window.location.href = `mailto:?subject=${encodeURIComponent('A dinner-table habit worth trying')}&body=${encodeURIComponent(shareData.text + '\n\n' + shareUrl)}`
    }
  }

  function handleMaybeLater() {
    track('church_cta_maybe_later')
    onMaybeLater()
  }

  function handleDontShowAgain() {
    track('church_cta_dont_show_again')
    onDontShowAgain()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,24,41,0.98)', zIndex: 210, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
      <div style={{ fontSize: '1.8rem', marginBottom: '1.25rem' }}>✝️</div>
      <p style={{ fontFamily: 'Lora, serif', fontSize: '1.05rem', color: 'var(--gold)', marginBottom: '0.75rem', fontStyle: 'italic', maxWidth: 380 }}>
        Bring the Table to Your Church or Group
      </p>
      <p style={{ fontFamily: 'Lora, serif', fontSize: '0.85rem', color: 'var(--white)', lineHeight: 1.7, maxWidth: 380, marginBottom: '1rem', fontStyle: 'italic' }}>
        One verse. One conversation. One prayer. One community growing closer to Jesus.
      </p>
      <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, maxWidth: 360, marginBottom: '0.75rem' }}>
        Dinner with Jesus helps families slow down, open Scripture, and talk about what matters most.
      </p>
      <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, maxWidth: 360, marginBottom: '1.75rem' }}>
        Know a church, ministry, small group, recovery community, or organization that should bring this rhythm to its people? Help us start the conversation.
      </p>

      <button className="btn btn-gold" style={{ width: '100%', maxWidth: 320, marginBottom: '0.75rem' }} onClick={handleRecommend}>
        Recommend a Church or Group
      </button>
      <button className="btn" style={{ width: '100%', maxWidth: 320, marginBottom: '1.25rem', color: 'var(--gold)', borderColor: 'var(--border-gold)', background: 'var(--gold-soft)' }} onClick={handleShare}>
        Share Dinner with Jesus
      </button>

      <div style={{ display: 'flex', gap: '1.5rem' }}>
        <button onClick={handleMaybeLater} style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '12px', textDecoration: 'underline', cursor: 'pointer' }}>
          Maybe later
        </button>
        <button onClick={handleDontShowAgain} style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '12px', textDecoration: 'underline', cursor: 'pointer', opacity: 0.7 }}>
          Don't show again
        </button>
      </div>
    </div>
  )
}
