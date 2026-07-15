import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AdminPage({ onClose }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  // Data
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  const [verses, setVerses] = useState([])
  const [analyticsData, setAnalyticsData] = useState([])
  const [dailyActive, setDailyActive] = useState([])
  const [eventCounts, setEventCounts] = useState([])
  const [announcement, setAnnouncement] = useState('')
  const [activeAnnouncement, setActiveAnnouncement] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pendingAction, setPendingAction] = useState(null) // guards against double taps on group/verse/announcement actions

  // Defense in depth: re-verify admin status against the database on mount
  // rather than trusting that this component was only ever shown to an
  // admin. Fails closed — any error or non-true result closes the panel
  // before any admin data is fetched. `loading` stays true (showing the
  // existing loading state below) until this resolves.
  useEffect(() => {
    let cancelled = false
    supabase.rpc('is_admin').then(({ data, error }) => {
      if (cancelled) return
      if (error || data !== true) {
        console.warn('[admin-page] Authorization check failed — closing.', error?.message)
        onClose()
        return
      }
      loadAll()
    })
    return () => { cancelled = true }
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [
        usersRes,
        groupsRes,
        versesRes,
        analyticsRes,
        announcementRes
      ] = await Promise.all([
        supabase.from('profiles').select('id, name, email, created_at, faith_level, group_id, onboarding_complete').order('created_at', { ascending: false }),
        supabase.from('groups').select('id, name, invite_code, owner_id, created_at'),
        supabase.from('dinner_verses').select('id, verse_ref, category, active').order('verse_ref'),
        supabase.from('analytics').select('event, user_id, created_at').order('created_at', { ascending: false }).limit(500),
        supabase.from('announcements').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1)
      ])

      const usersList = usersRes.data || []
      const groupsList = groupsRes.data || []

      // Enrich groups with member count and owner name
      const enrichedGroups = groupsList.map(g => ({
        ...g,
        memberCount: usersList.filter(u => u.group_id === g.id).length,
        ownerName: usersList.find(u => u.id === g.owner_id)?.name || 'Unknown'
      }))

      // Enrich users with group name
      const enrichedUsers = usersList.map(u => ({
        ...u,
        groupName: groupsList.find(g => g.id === u.group_id)?.name || null
      }))

      // Analytics summary
      const analytics = analyticsRes.data || []
      const eventMap = {}
      analytics.forEach(a => {
        eventMap[a.event] = (eventMap[a.event] || 0) + 1
      })
      const eventCountsList = Object.entries(eventMap)
        .map(([event, count]) => ({ event, count }))
        .sort((a, b) => b.count - a.count)

      // Daily active users (last 7 days)
      const days = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().split('T')[0]
        const count = new Set(
          analytics
            .filter(a => a.created_at.startsWith(dateStr))
            .map(a => a.user_id)
        ).size
        days.push({ date: dateStr, count, label: d.toLocaleDateString('en-US', { weekday: 'short' }) })
      }

      setUsers(enrichedUsers)
      setGroups(enrichedGroups)
      setVerses(versesRes.data || [])
      setAnalyticsData(analytics)
      setEventCounts(eventCountsList)
      setDailyActive(days)
      setActiveAnnouncement((announcementRes.data || [])[0] || null)
    } catch (err) {
      showToast('Error loading data.')
    }
    setLoading(false)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  async function resetUserGroup(userId, userName) {
    if (!confirm(`Remove ${userName} from their group?`)) return
    if (pendingAction) return // prevent double submission
    setPendingAction(`reset-${userId}`)
    try {
      const { error } = await supabase.from('profiles').update({ group_id: null }).eq('id', userId)
      if (error) throw error
      showToast(`${userName} removed from their group.`)
      await loadAll()
    } catch (err) {
      console.error('[admin:resetUserGroup]', err?.message)
      showToast('Could not reset group. Try again.')
    }
    setPendingAction(null)
  }

  async function deleteGroup(groupId, groupName) {
    if (!confirm(`Delete group "${groupName}"? All members will be removed.`)) return
    if (pendingAction) return // prevent double submission
    setPendingAction(`delete-${groupId}`)
    try {
      const { error: memberError } = await supabase.from('profiles').update({ group_id: null }).eq('group_id', groupId)
      if (memberError) throw memberError
      const { error: groupError } = await supabase.from('groups').delete().eq('id', groupId)
      if (groupError) throw groupError
      showToast(`Group "${groupName}" deleted.`)
      await loadAll()
    } catch (err) {
      console.error('[admin:deleteGroup]', err?.message)
      showToast('Could not delete group. Try again.')
    }
    setPendingAction(null)
  }

  async function toggleVerse(verseId, currentActive) {
    if (pendingAction) return // prevent double submission
    setPendingAction(`verse-${verseId}`)
    try {
      const { error } = await supabase.from('dinner_verses').update({ active: !currentActive }).eq('id', verseId)
      if (error) throw error
      setVerses(prev => prev.map(v => v.id === verseId ? { ...v, active: !currentActive } : v))
      showToast(currentActive ? 'Verse deactivated.' : 'Verse activated.')
    } catch (err) {
      console.error('[admin:toggleVerse]', err?.message)
      showToast('Could not update verse. Try again.')
    }
    setPendingAction(null)
  }

  async function sendAnnouncement() {
    if (!announcement.trim()) return
    if (saving) return // prevent double submission
    setSaving(true)
    try {
      const { error: clearError } = await supabase.from('announcements').update({ active: false }).eq('active', true)
      if (clearError) throw clearError
      const { data, error: insertError } = await supabase.from('announcements').insert({ message: announcement.trim(), active: true }).select().single()
      if (insertError) throw insertError
      setActiveAnnouncement(data)
      setAnnouncement('')
      showToast('Announcement sent! ✓')
      await loadAll()
    } catch (err) {
      console.error('[admin:sendAnnouncement]', err?.message)
      showToast('Could not send announcement. Your draft is still here — try again.')
    }
    setSaving(false)
  }

  async function clearAnnouncement() {
    if (pendingAction) return // prevent double submission
    setPendingAction('clear-announcement')
    try {
      const { error } = await supabase.from('announcements').update({ active: false }).eq('active', true)
      if (error) throw error
      setActiveAnnouncement(null)
      showToast('Announcement cleared.')
    } catch (err) {
      console.error('[admin:clearAnnouncement]', err?.message)
      showToast('Could not clear the announcement. Try again.')
    }
    setPendingAction(null)
  }

  const last7days = users.filter(u => {
    const d = new Date(u.created_at)
    return (new Date() - d) / (1000 * 60 * 60 * 24) <= 7
  })

  const todayActive = dailyActive[dailyActive.length - 1]?.count || 0
  const conversations = eventCounts.find(e => e.event === 'discussion_marked')?.count || 0
  const activeVerses = verses.filter(v => v.active).length

  const goldAccent = { position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }
  const cardBase = { position: 'relative', overflow: 'hidden', background: 'var(--bg2)', border: '0.5px solid var(--border-gold)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }

  const tabs = ['overview', 'users', 'groups', 'verses', 'analytics', 'announce']

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={loadAll} style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 6, color: 'var(--silver)', fontSize: '11px', padding: '4px 10px', cursor: 'pointer' }}>↺ Refresh</button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '20px', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
        </div>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '1rem 1.25rem 4rem' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: '7px 12px', borderRadius: 8, border: `0.5px solid ${activeTab === tab ? 'var(--gold)' : 'var(--border)'}`, background: activeTab === tab ? 'var(--gold-soft)' : 'var(--bg3)', color: activeTab === tab ? 'var(--gold)' : 'var(--silver)', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', fontWeight: activeTab === tab ? 600 : 400 }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: '1rem' }}>
                  {[
                    { label: 'Total Users', value: users.length, icon: '👤' },
                    { label: 'Dinner Circles', value: groups.length, icon: '🍽️' },
                    { label: 'New This Week', value: last7days.length, icon: '✨' },
                    { label: 'Active Today', value: todayActive, icon: '🔥' },
                    { label: 'Conversations', value: conversations, icon: '🙏' },
                    { label: 'Active Verses', value: activeVerses, icon: '📖' },
                  ].map(s => (
                    <div key={s.label} style={{ ...cardBase, textAlign: 'center', padding: '1rem 0.5rem' }}>
                      <div style={goldAccent} />
                      <div style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>{s.icon}</div>
                      <div style={{ fontFamily: 'Lora, serif', fontSize: '1.6rem', fontWeight: 600, color: 'var(--gold)' }}>{s.value}</div>
                      <div style={{ fontSize: '10px', color: 'var(--silver)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '0.25rem' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 7 day activity */}
                <div style={cardBase}>
                  <div style={goldAccent} />
                  <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.75rem' }}>Daily Active Users — Last 7 Days</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
                    {dailyActive.map(d => (
                      <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: '100%', background: 'var(--gold)', borderRadius: 4, height: d.count > 0 ? Math.max(8, (d.count / Math.max(...dailyActive.map(x => x.count), 1)) * 60) : 4, opacity: d.count > 0 ? 1 : 0.2 }} />
                        <div style={{ fontSize: '9px', color: 'var(--silver)' }}>{d.label}</div>
                        <div style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 600 }}>{d.count}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent signups */}
                <div style={cardBase}>
                  <div style={goldAccent} />
                  <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.75rem' }}>Recent Signups</div>
                  {users.slice(0, 8).map(u => (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '0.5px solid var(--border)' }}>
                      <div>
                        <div style={{ fontSize: '13px', color: 'var(--cream)' }}>{u.name || 'No name'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--silver)' }}>{u.groupName ? `⭕ ${u.groupName}` : '— no circle'}</div>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--silver)' }}>{new Date(u.created_at).toLocaleDateString()}</div>
                    </div>
                  ))}
                </div>

                {/* Active announcement */}
                <div style={cardBase}>
                  <div style={goldAccent} />
                  <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.5rem' }}>Active Announcement</div>
                  {activeAnnouncement ? (
                    <>
                      <p style={{ fontSize: '13px', color: 'var(--cream)', lineHeight: 1.6, marginBottom: '0.75rem', fontStyle: 'italic' }}>"{activeAnnouncement.message}"</p>
                      <button className="btn" style={{ fontSize: '12px', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }} onClick={clearAnnouncement} disabled={pendingAction === 'clear-announcement'}>
                        {pendingAction === 'clear-announcement' ? 'Clearing...' : 'Clear announcement'}
                      </button>
                    </>
                  ) : (
                    <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic' }}>No active announcement.</p>
                  )}
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
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', color: 'var(--cream)', fontWeight: 500 }}>{u.name || 'No name'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--silver)' }}>{u.email}</div>
                        <div style={{ fontSize: '11px', color: u.groupName ? 'var(--gold)' : 'var(--silver)', marginTop: 2 }}>
                          {u.groupName ? `⭕ ${u.groupName}` : '— no circle'}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--silver)', marginTop: 2, opacity: 0.6 }}>
                          Faith level {u.faith_level || 1} · Joined {new Date(u.created_at).toLocaleDateString()}
                          {!u.onboarding_complete && <span style={{ color: '#E57373', marginLeft: 6 }}>· onboarding incomplete</span>}
                        </div>
                      </div>
                      {u.group_id && (
                        <button
                          onClick={() => resetUserGroup(u.id, u.name)}
                          disabled={pendingAction === `reset-${u.id}`}
                          style={{ background: 'none', border: '0.5px solid rgba(229,115,115,0.3)', borderRadius: 6, color: '#E57373', fontSize: '10px', padding: '4px 8px', cursor: pendingAction === `reset-${u.id}` ? 'default' : 'pointer', flexShrink: 0, opacity: pendingAction === `reset-${u.id}` ? 0.5 : 1 }}
                        >
                          {pendingAction === `reset-${u.id}` ? 'Removing...' : 'Remove from group'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* GROUPS */}
            {activeTab === 'groups' && (
              <div style={cardBase}>
                <div style={goldAccent} />
                <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.75rem' }}>
                  All Dinner Circles ({groups.length})
                </div>
                {groups.length === 0 && (
                  <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic' }}>No circles yet.</p>
                )}
                {groups.map(g => (
                  <div key={g.id} style={{ padding: '0.75rem 0', borderBottom: '0.5px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', color: 'var(--cream)', fontWeight: 500 }}>{g.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--gold)', letterSpacing: '0.1em' }}>{g.invite_code}</div>
                        <div style={{ fontSize: '11px', color: 'var(--silver)', marginTop: 2 }}>
                          Owner: {g.ownerName} · {g.memberCount} member{g.memberCount !== 1 ? 's' : ''}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--silver)', opacity: 0.6, marginTop: 2 }}>
                          Created {new Date(g.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteGroup(g.id, g.name)}
                        disabled={pendingAction === `delete-${g.id}`}
                        style={{ background: 'none', border: '0.5px solid rgba(229,115,115,0.3)', borderRadius: 6, color: '#E57373', fontSize: '10px', padding: '4px 8px', cursor: pendingAction === `delete-${g.id}` ? 'default' : 'pointer', flexShrink: 0, opacity: pendingAction === `delete-${g.id}` ? 0.5 : 1 }}
                      >
                        {pendingAction === `delete-${g.id}` ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* VERSES */}
            {activeTab === 'verses' && (
              <div style={cardBase}>
                <div style={goldAccent} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)' }}>
                    Dinner Verses ({verses.length})
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--silver)' }}>
                    {activeVerses} active · {verses.length - activeVerses} inactive
                  </div>
                </div>
                {verses.map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '0.5px solid var(--border)', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', color: v.active ? 'var(--cream)' : 'var(--silver)', fontWeight: 500 }}>{v.verse_ref}</div>
                      <div style={{ fontSize: '10px', color: 'var(--gold)', opacity: 0.7 }}>{v.category}</div>
                    </div>
                    <button
                      onClick={() => toggleVerse(v.id, v.active)}
                      disabled={pendingAction === `verse-${v.id}`}
                      style={{ background: v.active ? 'var(--gold-soft)' : 'var(--bg3)', border: `0.5px solid ${v.active ? 'var(--border-gold)' : 'var(--border)'}`, borderRadius: 6, color: v.active ? 'var(--gold)' : 'var(--silver)', fontSize: '10px', padding: '4px 10px', cursor: pendingAction === `verse-${v.id}` ? 'default' : 'pointer', flexShrink: 0, opacity: pendingAction === `verse-${v.id}` ? 0.5 : 1 }}
                    >
                      {pendingAction === `verse-${v.id}` ? '...' : v.active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ANALYTICS */}
            {activeTab === 'analytics' && (
              <>
                {/* Event totals */}
                <div style={cardBase}>
                  <div style={goldAccent} />
                  <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.75rem' }}>Feature Usage</div>
                  {eventCounts.length === 0 && (
                    <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic' }}>No events tracked yet.</p>
                  )}
                  {eventCounts.map(e => (
                    <div key={e.event} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '0.5px solid var(--border)' }}>
                      <div style={{ fontSize: '13px', color: 'var(--cream)' }}>{e.event.replace(/_/g, ' ')}</div>
                      <div style={{ fontSize: '13px', color: 'var(--gold)', fontWeight: 600 }}>{e.count}</div>
                    </div>
                  ))}
                </div>

                {/* Per user activity */}
                <div style={cardBase}>
                  <div style={goldAccent} />
                  <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.75rem' }}>Activity Per User</div>
                  {users.map(u => {
                    const userEvents = analyticsData.filter(a => a.user_id === u.id)
                    const lastSeen = userEvents[0]?.created_at
                    return (
                      <div key={u.id} style={{ padding: '0.65rem 0', borderBottom: '0.5px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: '13px', color: 'var(--cream)' }}>{u.name || 'No name'}</div>
                            <div style={{ fontSize: '11px', color: 'var(--silver)' }}>
                              {lastSeen ? `Last seen ${new Date(lastSeen).toLocaleDateString()}` : 'No activity yet'}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '13px', color: 'var(--gold)', fontWeight: 600 }}>{userEvents.length}</div>
                            <div style={{ fontSize: '10px', color: 'var(--silver)' }}>events</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* ANNOUNCE */}
            {activeTab === 'announce' && (
              <div style={cardBase}>
                <div style={goldAccent} />
                <div style={{ fontFamily: 'Lora, serif', fontSize: '0.95rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.25rem' }}>Send Announcement</div>
                <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '1rem', lineHeight: 1.6 }}>
                  This message appears as a banner at the top of the app for all users.
                </p>
                {activeAnnouncement && (
                  <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '0.875rem', border: '0.5px solid var(--border-gold)', marginBottom: '1rem' }}>
                    <div style={{ fontSize: '11px', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Current active message</div>
                    <p style={{ fontSize: '13px', color: 'var(--cream)', fontStyle: 'italic', lineHeight: 1.6 }}>"{activeAnnouncement.message}"</p>
                    <button className="btn" style={{ marginTop: '0.75rem', fontSize: '12px', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }} onClick={clearAnnouncement} disabled={pendingAction === 'clear-announcement'}>
                      {pendingAction === 'clear-announcement' ? 'Clearing...' : 'Clear this announcement'}
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
