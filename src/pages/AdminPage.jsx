import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const ADMIN_USER_ID = '28356e7e-067c-49a8-81a2-095576c432a7'

export default function AdminPage({ onClose }) {
  const [stats, setStats] = useState({ users: 0, families: 0, members: 0 })
  const [users, setUsers] = useState([])
  const [families, setFamilies] = useState([])
  const [announcement, setAnnouncement] = useState('')
  const [activeAnnouncement, setActiveAnnouncement] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [profilesRes, familiesRes, membersRes, announcementRes] = await Promise.all([
        supabase.from('profiles').select('id, name, email, created_at, faith_level').order('created_at', { ascending: false }),
        supabase.from('families').select('id, name, invite_code, created_at').order('created_at', { ascending: false }),
        supabase.from('family_members').select('id, family_id, display_name, role'),
        supabase.from('announcements').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1)
      ])

      const profiles = profilesRes.data || []
      const familiesList = familiesRes.data || []
      const membersList = membersRes.data || []
      const announcements = announcementRes.data || []

      setUsers(profiles)
      setFamilies(familiesList)
      setActiveAnnouncement(announcements[0] || null)
      setStats({
        users: profiles.length,
        families: familiesList.length,
        members: membersList.length,
      })
    } catch (err) {
      showToast('Error loading data.')
    }
    setLoading(false)
  }

  async function sendAnnouncement() {
    if (!announcement.trim()) return
    setSaving(true)
    try {
      // Deactivate old announcements
      await supabase.from('announcements').update({ active: false }).eq('active', true)
      // Create new
      const { data } = await supabase.from('announcements').insert({
        message: announcement.trim(),
        active: true
      }).select().single()
      setActiveAnnouncement(data)
      setAnnouncement('')
      showToast('Announcement sent! ✓')
    } catch (err) {
      showToast('Could not send announcement.')
    }
    setSaving(false)
  }

  async function clearAnnouncement() {
    await supabase.from('announcements').update({ active: false }).eq('active', true)
    setActiveAnnouncement(null)
    showToast('Announcement cleared.')
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  function getFamilyMembers(familyId) {
    return []
  }

  const recentUsers = users.slice(0, 10)
  const last7days = users.filter(u => {
    const d = new Date(u.created_at)
    const now = new Date()
    return (now - d) / (1000 * 60 * 60 * 24) <= 7
  })

  const goldAccent = { position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }
  const cardBase = { position: 'relative', overflow: 'hidden', background: 'var(--bg2)', border: '0.5px solid var(--border-gold)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 500, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg2)', borderBottom: '0.5px solid var(--border-gold)', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="cross" style={{ width: 20, height: 20 }} />
          <div>
            <div style={{ fontFamily: 'Lora, serif', fontSize: '1rem', fontWeight: 600, color: 'var(--white)' }}>Admin Dashboard</div>
            <div style={{ fontSize: '10px', color: 'var(--gold)', letterSpacing: '0.08em' }}>DINNER WITH JESUS · 1:10</div>
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '20px', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
      </div>

      <div style={{ maxWidth: '540px', margin: '0 auto', padding: '1rem 1.25rem 4rem' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem' }}>
          {['overview', 'users', 'families', 'announce'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ flex: 1, padding: '8px 4px', borderRadius: 8, border: `0.5px solid ${activeTab === tab ? 'var(--gold)' : 'var(--border)'}`, background: activeTab === tab ? 'var(--gold-soft)' : 'var(--bg3)', color: activeTab === tab ? 'var(--gold)' : 'var(--silver)', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', fontWeight: activeTab === tab ? 600 : 400 }}>
              {tab}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--silver)' }}>Loading...</div>
        ) : (
          <>
            {/* OVERVIEW */}
            {activeTab === 'overview' && (
              <>
                {/* Stat cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: '1rem' }}>
                  {[
                    { label: 'Total Users', value: stats.users, icon: '👤' },
                    { label: 'Families', value: stats.families, icon: '🍽️' },
                    { label: 'New (7d)', value: last7days.length, icon: '✨' },
                  ].map(s => (
                    <div key={s.label} style={{ ...cardBase, textAlign: 'center', padding: '1rem 0.5rem' }}>
                      <div style={goldAccent} />
                      <div style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>{s.icon}</div>
                      <div style={{ fontFamily: 'Lora, serif', fontSize: '1.6rem', fontWeight: 600, color: 'var(--gold)' }}>{s.value}</div>
                      <div style={{ fontSize: '10px', color: 'var(--silver)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '0.25rem' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Active announcement */}
                <div style={cardBase}>
                  <div style={goldAccent} />
                  <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.5rem' }}>Active Announcement</div>
                  {activeAnnouncement ? (
                    <>
                      <p style={{ fontSize: '13px', color: 'var(--cream)', lineHeight: 1.6, marginBottom: '0.75rem', fontStyle: 'italic' }}>
                        "{activeAnnouncement.message}"
                      </p>
                      <button className="btn" style={{ fontSize: '12px', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }} onClick={clearAnnouncement}>
                        Clear announcement
                      </button>
                    </>
                  ) : (
                    <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic' }}>No active announcement.</p>
                  )}
                </div>

                {/* Recent signups */}
                <div style={cardBase}>
                  <div style={goldAccent} />
                  <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.75rem' }}>Recent Signups</div>
                  {recentUsers.map(u => (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '0.5px solid var(--border)' }}>
                      <div>
                        <div style={{ fontSize: '14px', color: 'var(--cream)' }}>{u.name || 'No name'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--silver)' }}>{u.email}</div>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--silver)', textAlign: 'right' }}>
                        {new Date(u.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* USERS */}
            {activeTab === 'users' && (
              <div style={cardBase}>
                <div style={goldAccent} />
                <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.75rem' }}>
                  All Users ({users.length})
                </div>
                {users.map(u => (
                  <div key={u.id} style={{ padding: '0.75rem 0', borderBottom: '0.5px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '14px', color: 'var(--cream)', fontWeight: 500 }}>{u.name || 'No name'}</div>
                        <div style={{ fontSize: '12px', color: 'var(--silver)' }}>{u.email}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: 'var(--gold)', background: 'var(--gold-soft)', padding: '2px 8px', borderRadius: 999, marginBottom: 2 }}>
                          Level {u.faith_level || 1}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--silver)' }}>
                          {new Date(u.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* FAMILIES */}
            {activeTab === 'families' && (
              <div style={cardBase}>
                <div style={goldAccent} />
                <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.75rem' }}>
                  All Families ({families.length})
                </div>
                {families.map(f => (
                  <div key={f.id} style={{ padding: '0.75rem 0', borderBottom: '0.5px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '14px', color: 'var(--cream)', fontWeight: 500 }}>{f.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--gold)', letterSpacing: '0.1em' }}>{f.invite_code}</div>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--silver)' }}>
                        {new Date(f.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ANNOUNCE */}
            {activeTab === 'announce' && (
              <div style={cardBase}>
                <div style={goldAccent} />
                <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.25rem' }}>
                  Send Announcement
                </div>
                <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '1rem', lineHeight: 1.6 }}>
                  This message will appear as a banner at the top of the app for all users. One active announcement at a time.
                </p>

                {activeAnnouncement && (
                  <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '0.875rem', border: '0.5px solid var(--border-gold)', marginBottom: '1rem' }}>
                    <div style={{ fontSize: '11px', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Current active message</div>
                    <p style={{ fontSize: '13px', color: 'var(--cream)', fontStyle: 'italic', lineHeight: 1.6 }}>"{activeAnnouncement.message}"</p>
                    <button className="btn" style={{ marginTop: '0.75rem', fontSize: '12px', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }} onClick={clearAnnouncement}>
                      Clear this announcement
                    </button>
                  </div>
                )}

                <textarea
                  value={announcement}
                  onChange={e => setAnnouncement(e.target.value)}
                  placeholder="Type your message to all users..."
                  style={{ minHeight: 100, resize: 'none', marginBottom: 8 }}
                />
                <button className="btn btn-gold" onClick={sendAnnouncement} disabled={saving || !announcement.trim()}>
                  {saving ? 'Sending...' : '📣 Send to all users'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
