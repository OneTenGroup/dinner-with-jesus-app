import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../hooks/useFamily'
import { supabase } from '../lib/supabase'
import { track } from '../lib/analytics'

const FAITH_LABELS = {
  1: 'Gentle, open-ended questions',
  2: 'One layer deeper',
  3: 'Challenging & application'
}

const TRANSLATIONS = ['KJV', 'NIV', 'NLT', 'ESV', 'NKJV']

async function lockVerseForGroup(groupId) {
  if (!groupId) return { error: 'No group found' }
  const today = new Date().toISOString().split('T')[0]

  const { data: existing } = await supabase
    .from('group_verse')
    .select('dinner_verse_id')
    .eq('group_id', groupId)
    .eq('verse_date', today)
    .single()

  if (existing?.dinner_verse_id) return { alreadyLocked: true }

  const { data: historyData } = await supabase
    .from('verse_history')
    .select('dinner_verse_id')

  const discussedIds = historyData?.map(d => d.dinner_verse_id) || []

  const { data: allVerses } = await supabase
    .from('dinner_verses')
    .select('id')
    .eq('active', true)
    .limit(200)

  if (!allVerses || allVerses.length === 0) return { error: 'No verses available' }

  const available = discussedIds.length > 0
    ? allVerses.filter(v => !discussedIds.includes(v.id))
    : allVerses
  const pool = available.length > 0 ? available : allVerses
  const picked = pool[Math.floor(Math.random() * pool.length)]

  const { error } = await supabase
    .from('group_verse')
    .upsert({ group_id: groupId, dinner_verse_id: picked.id, verse_date: today }, { onConflict: 'group_id,verse_date' })

  if (error) return { error: 'Could not lock verse' }
  return { success: true }
}

export default function SettingsPage({ isAdmin = false, onOpenAdmin }) {
  const { user, profile, signOut, updateProfile } = useAuth()
  const { group, members, createGroup, joinGroup, leaveGroup, removeMember } = useFamily()

  const [toast, setToast] = useState('')
  const [mode, setMode] = useState('none')
  const [newGroupName, setNewGroupName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [verseLocked, setVerseLocked] = useState(false)
  const [lockingVerse, setLockingVerse] = useState(false)
  const [accountMode, setAccountMode] = useState('none')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accountSaving, setAccountSaving] = useState(false)
  const [memberProfiles, setMemberProfiles] = useState([])
  const [removeConfirm, setRemoveConfirm] = useState(null) // { id, name } of member pending removal
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    checkVerseLocked()
    loadMemberProfiles()
  }, [group])

  async function loadMemberProfiles() {
    if (!group?.id) { setMemberProfiles([]); return }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, name')
        .eq('group_id', group.id)
      setMemberProfiles(data || [])
    } catch (err) {
      setMemberProfiles([])
    }
  }

  async function checkVerseLocked() {
    if (!group?.id) return
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('group_verse')
      .select('id')
      .eq('group_id', group.id)
      .eq('verse_date', today)
      .single()
    setVerseLocked(!!data)
  }

  async function handleLockVerse() {
    if (!group?.id) { showToast('You need a dinner circle first.'); return }
    setLockingVerse(true)
    const result = await lockVerseForGroup(group.id)
    if (result.alreadyLocked) {
      showToast("Tonight's verse is already set. 🙏")
      setVerseLocked(true)
    } else if (result.success) {
      track('verse_locked')
      showToast("Tonight's verse is set! Now share your invite code. 🙏")
      setVerseLocked(true)
    } else {
      showToast(result.error || 'Could not set verse. Try again.')
    }
    setLockingVerse(false)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) { showToast('Give your group a name first.'); return }
    setCreating(true)
    const result = await createGroup(newGroupName)
    if (result.error) {
      showToast(result.error)
    } else {
      setNewGroupName('')
      setMode('none')
      track('group_created')
      showToast(`${result.group.name} is ready! 🙏`)
    }
    setCreating(false)
  }

  async function handleJoinGroup() {
    if (!joinCode.trim() || joinCode.length !== 6) { showToast('Enter a valid 6-character code.'); return }
    setJoining(true)
    const result = await joinGroup(joinCode)
    if (result.error) {
      showToast(result.error)
    } else {
      setJoinCode('')
      setMode('none')
      track('group_joined')
      showToast(`Welcome to ${result.groupName}! 🙏`)
    }
    setJoining(false)
  }

  async function handleLeaveGroup() {
    setLeaving(true)
    const result = await leaveGroup()
    if (result.error) {
      showToast(result.error)
    } else {
      setShowLeaveConfirm(false)
      showToast('You have left the group.')
    }
    setLeaving(false)
  }

  async function handleRemoveMember() {
    if (!removeConfirm) return
    setRemoving(true)
    const result = await removeMember(removeConfirm.id)
    if (result.error) {
      showToast(result.error)
    } else {
      showToast(`${removeConfirm.name} has been removed from the table.`)
      await loadMemberProfiles()
    }
    setRemoveConfirm(null)
    setRemoving(false)
  }

  function copyInviteCode() {
    navigator.clipboard.writeText(group.invite_code)
    showToast('Invite code copied! ✓')
  }

  function shareInviteCode() {
    const msg = `Hey — we set a place for you at our table tonight.\n\nWe're doing Dinner with Jesus — one verse, one real conversation, one prayer. Takes 15 minutes and it's genuinely special.\n\nDownload the app at flippingtables.ai and enter this code in Settings:\n\n${group.invite_code}\n\nDon't be late. 🙏`
    if (navigator.share) {
      navigator.share({ text: msg })
    } else {
      navigator.clipboard.writeText(msg)
      showToast('Invite message copied! ✓')
    }
  }

  async function handleTranslation(t) {
    await updateProfile({ preferred_translation: t })
    showToast(`Translation set to ${t} ✓`)
  }

  async function handleFaithLevel(level) {
    await updateProfile({ faith_level: level })
    showToast('Faith journey level updated ✓')
  }

  async function handleUpdateName() {
    if (!newName.trim()) { showToast('Enter a name.'); return }
    setAccountSaving(true)
    try {
      const { error } = await supabase.from('profiles').update({ name: newName.trim() }).eq('id', user.id)
      if (error) throw error
      await updateProfile({ name: newName.trim() })
      showToast('Name updated ✓')
      setAccountMode('none')
      setNewName('')
    } catch (err) { showToast('Could not update name. Try again.') }
    setAccountSaving(false)
  }

  async function handleUpdateEmail() {
    if (!newEmail.trim()) { showToast('Enter an email.'); return }
    setAccountSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() })
      if (error) throw error
      await supabase.from('profiles').update({ email: newEmail.trim() }).eq('id', user.id)
      showToast('Check your new email to confirm the change ✓')
      setAccountMode('none')
      setNewEmail('')
    } catch (err) { showToast(err.message || 'Could not update email.') }
    setAccountSaving(false)
  }

  async function handleUpdatePassword() {
    if (!newPassword) { showToast('Enter a password.'); return }
    if (newPassword.length < 6) { showToast('Password must be at least 6 characters.'); return }
    if (newPassword !== confirmPassword) { showToast('Passwords do not match.'); return }
    setAccountSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      showToast('Password updated ✓')
      setAccountMode('none')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) { showToast(err.message || 'Could not update password.') }
    setAccountSaving(false)
  }

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>
      <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.3rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.25rem' }}>Settings</h2>
      <p style={{ fontSize: '13px', color: 'var(--silver)', fontWeight: 300, marginBottom: '1.25rem' }}>Your table, your way.</p>

      {/* Account */}
      <span className="section-label">Your Account</span>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: accountMode === 'none' ? 0 : '1rem' }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--bg4)', border: '0.5px solid var(--border-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', color: 'var(--gold)', fontWeight: 500, flexShrink: 0 }}>
            {profile?.name?.charAt(0) || '?'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', color: 'var(--white)' }}>{profile?.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--silver)', marginTop: 2 }}>{profile?.email || user?.email || ''}</div>
          </div>
          <button onClick={() => setAccountMode(accountMode === 'none' ? 'menu' : 'none')} style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--silver)', fontSize: '12px', cursor: 'pointer' }}>
            {accountMode === 'none' ? 'Edit' : 'Cancel'}
          </button>
        </div>
        {accountMode === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: '0.75rem' }}>
            <button className="btn" style={{ width: '100%', textAlign: 'left', fontSize: '13px' }} onClick={() => { setNewName(profile?.name || ''); setAccountMode('name') }}>✏️ Change display name</button>
            <button className="btn" style={{ width: '100%', textAlign: 'left', fontSize: '13px' }} onClick={() => { setNewEmail(profile?.email || ''); setAccountMode('email') }}>📧 Change email</button>
            <button className="btn" style={{ width: '100%', textAlign: 'left', fontSize: '13px' }} onClick={() => setAccountMode('password')}>🔒 Change password</button>
          </div>
        )}
        {accountMode === 'name' && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.5rem' }}>Display name</p>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Your name" maxLength={40} style={{ marginBottom: 8 }} />
            <div className="btn-row">
              <button className="btn" onClick={() => setAccountMode('menu')}>Cancel</button>
              <button className="btn btn-gold" onClick={handleUpdateName} disabled={accountSaving}>{accountSaving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        )}
        {accountMode === 'email' && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.5rem' }}>New email address</p>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="new@email.com" style={{ marginBottom: 8 }} />
            <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6, marginBottom: 8, fontStyle: 'italic' }}>You'll need to confirm the change from your new email address.</p>
            <div className="btn-row">
              <button className="btn" onClick={() => setAccountMode('menu')}>Cancel</button>
              <button className="btn btn-gold" onClick={handleUpdateEmail} disabled={accountSaving}>{accountSaving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        )}
        {accountMode === 'password' && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.5rem' }}>New password</p>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password (min 6 characters)" minLength={6} style={{ marginBottom: 8 }} />
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm new password" minLength={6} style={{ marginBottom: 8 }} />
            <div className="btn-row">
              <button className="btn" onClick={() => setAccountMode('menu')}>Cancel</button>
              <button className="btn btn-gold" onClick={handleUpdatePassword} disabled={accountSaving}>{accountSaving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        )}
      </div>

      {/* Dinner Circle */}
      <span className="section-label">Your Dinner Circle</span>
      {group ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <p style={{ fontSize: '14px', color: 'var(--white)', fontWeight: 500, margin: 0 }}>{group.name}</p>
            <span style={{ fontSize: '11px', color: 'var(--gold)', opacity: 0.7 }}>{group.isOwner ? '⭐ Owner' : 'Member'}</span>
          </div>

          {/* Members */}
          <div style={{ marginBottom: '1rem', marginTop: '0.5rem' }}>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.5rem', fontWeight: 300 }}>
              At the table{group.isOwner ? ' — tap a name to remove' : ''}:
            </p>
            {memberProfiles.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {memberProfiles.map(m => {
                  const isSelf = m.id === user.id
                  const canRemove = group.isOwner && !isSelf
                  return (
                    <div
                      key={m.id}
                      onClick={() => canRemove && setRemoveConfirm({ id: m.id, name: m.name })}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                        color: 'var(--cream)',
                        background: 'var(--bg3)',
                        border: '0.5px solid var(--border)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        cursor: canRemove ? 'pointer' : 'default'
                      }}
                    >
                      <span>{m.name}{isSelf ? ' (you)' : ''}</span>
                      {canRemove && (
                        <span style={{ color: '#E57373', fontSize: '11px' }}>Remove</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p style={{ fontSize: '12px', color: 'var(--silver)', fontStyle: 'italic' }}>Just you so far. Share your code to invite others.</p>
            )}
          </div>

          {/* Remove confirmation */}
          {removeConfirm && (
            <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '0.875rem', marginBottom: '0.875rem', border: '0.5px solid rgba(229,115,115,0.3)', textAlign: 'center' }}>
              <p style={{ fontSize: '13px', color: 'var(--white)', marginBottom: '0.75rem' }}>
                Remove {removeConfirm.name} from {group.name}? They'll need a new invite code to rejoin.
              </p>
              <div className="btn-row">
                <button className="btn" onClick={() => setRemoveConfirm(null)} style={{ flex: 1 }}>Cancel</button>
                <button
                  className="btn"
                  onClick={handleRemoveMember}
                  disabled={removing}
                  style={{ flex: 1, color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }}
                >
                  {removing ? 'Removing...' : 'Yes, remove'}
                </button>
              </div>
            </div>
          )}

          {/* Lock verse + instructions */}
          <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '0.875rem', marginBottom: '0.875rem', border: '0.5px solid var(--border)' }}>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.6 }}>
              <span style={{ color: 'var(--gold)', fontWeight: 500 }}>Before you invite:</span> Set tonight's verse first so everyone sees the same one. Then share your code.
            </p>
            <button
              className="btn"
              style={{ width: '100%', background: verseLocked ? 'var(--bg4)' : 'var(--gold-soft)', borderColor: 'var(--border-gold)', color: verseLocked ? 'var(--silver)' : 'var(--gold)', fontSize: '13px' }}
              onClick={handleLockVerse}
              disabled={lockingVerse || verseLocked}
            >
              {lockingVerse ? 'Setting the table...' : verseLocked ? "✓ Tonight's verse is set" : "🔒 Set tonight's verse"}
            </button>
          </div>

          {/* Invite code */}
          <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.75rem', fontWeight: 300 }}>Share this code so others can join your table.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg3)', borderRadius: 10, padding: '0.875rem 1rem', border: '0.5px solid var(--border-gold)', marginBottom: '0.875rem' }}>
            <div style={{ fontFamily: 'Lora, serif', fontSize: '1.8rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.2em', flex: 1, textAlign: 'center' }}>
              {group.invite_code}
            </div>
          </div>
          <div className="btn-row" style={{ marginBottom: '0.875rem' }}>
            <button className="btn" onClick={copyInviteCode}>📋 Copy code</button>
            <button className="btn btn-gold" onClick={shareInviteCode}>📤 Share invite</button>
          </div>

          {/* Leave */}
          {!showLeaveConfirm ? (
            <button className="btn" onClick={() => setShowLeaveConfirm(true)} style={{ width: '100%', fontSize: '12px', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)', marginTop: '0.5rem' }}>
              🚪 Leave this group
            </button>
          ) : (
            <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
              <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '0.75rem' }}>Are you sure you want to leave {group.name}?</p>
              <div className="btn-row">
                <button className="btn" onClick={() => setShowLeaveConfirm(false)} style={{ flex: 1 }}>Cancel</button>
                <button className="btn" onClick={handleLeaveGroup} disabled={leaving} style={{ flex: 1, color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }}>
                  {leaving ? 'Leaving...' : 'Yes, leave'}
                </button>
              </div>
            </div>
          )}

          {/* Setup guide — always visible */}
          <p style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button
              onClick={async () => {
                await updateProfile({ onboarding_complete: false })
                window.location.reload()
              }}
              style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '3px', opacity: 0.6 }}
            >
              Need help? Restart the setup guide
            </button>
          </p>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          {mode === 'none' && (
            <>
              <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '1rem', lineHeight: 1.6 }}>Start your own dinner circle or join one you've been invited to.</p>
              <div className="btn-row">
                <button className="btn btn-gold" onClick={() => setMode('create')}>🍽️ Start a circle</button>
                <button className="btn" onClick={() => setMode('join')}>🔑 Join a circle</button>
              </div>
              <p style={{ textAlign: 'center', marginTop: '1rem' }}>
                <button
                  onClick={async () => {
                    await updateProfile({ onboarding_complete: false })
                    window.location.reload()
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '3px', opacity: 0.6 }}
                >
                  Need help? Restart the setup guide
                </button>
              </p>
            </>
          )}
          {mode === 'create' && (
            <>
              <p style={{ fontSize: '13px', color: 'var(--white)', marginBottom: '0.25rem', fontWeight: 500 }}>Name your dinner circle</p>
              <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.875rem', fontWeight: 300 }}>Usually your family name — e.g. "The Korbars"</p>
              <input type="text" placeholder="The ___ Family" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} maxLength={40} style={{ marginBottom: 8 }} />
              <button className="btn btn-gold" onClick={handleCreateGroup} disabled={creating} style={{ marginBottom: 8 }}>{creating ? 'Setting the table...' : 'Create my circle 🙏'}</button>
              <button onClick={() => setMode('none')} style={{ fontSize: '13px', color: 'var(--silver)', background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: '6px 0' }}>Cancel</button>
            </>
          )}
          {mode === 'join' && (
            <>
              <p style={{ fontSize: '13px', color: 'var(--white)', marginBottom: '0.25rem', fontWeight: 500 }}>Join a dinner circle</p>
              <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.875rem', fontWeight: 300 }}>Enter the 6-character code from the person who invited you.</p>
              <input type="text" placeholder="Enter invite code" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} maxLength={6} style={{ marginBottom: 8, textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.2em', textTransform: 'uppercase' }} />
              <button className="btn btn-gold" onClick={handleJoinGroup} disabled={joining} style={{ marginBottom: 8 }}>{joining ? 'Joining...' : 'Join this circle 🙏'}</button>
              <button onClick={() => setMode('none')} style={{ fontSize: '13px', color: 'var(--silver)', background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: '6px 0' }}>Cancel</button>
            </>
          )}
        </div>
      )}

      {/* Faith Level */}
      <span className="section-label">Faith Journey</span>
      <div style={{ marginBottom: '1.5rem' }}>
        {[{ level: 1, label: 'Exploring' }, { level: 2, label: 'Growing' }, { level: 3, label: 'Going Deeper' }].map(({ level, label }) => (
          <div key={level} className="card"
            style={{ marginBottom: 6, cursor: 'pointer', borderColor: profile?.faith_level === level ? 'var(--gold)' : 'var(--border)', background: profile?.faith_level === level ? 'var(--gold-soft)' : 'var(--bg2)' }}
            onClick={() => handleFaithLevel(level)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', color: 'var(--cream)' }}>{label}</div>
                <div style={{ fontSize: '12px', color: 'var(--silver)', marginTop: 2 }}>{FAITH_LABELS[level]}</div>
              </div>
              {profile?.faith_level === level && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)' }} />}
            </div>
          </div>
        ))}
        <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6, marginTop: '0.5rem', fontStyle: 'italic' }}>All 3 question levels shown at the table — your level sets which appears first.</p>
      </div>

      {/* Translation */}
      <span className="section-label">Bible Translation</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        {TRANSLATIONS.map(t => (
          <button key={t} onClick={() => handleTranslation(t)}
            style={{ padding: '6px 14px', borderRadius: 999, border: `0.5px solid ${profile?.preferred_translation === t ? 'var(--gold)' : 'var(--border)'}`, background: profile?.preferred_translation === t ? 'var(--gold-soft)' : 'var(--bg3)', color: profile?.preferred_translation === t ? 'var(--gold)' : 'var(--silver)', fontSize: '13px', cursor: 'pointer' }}>
            {t}
          </button>
        ))}
      </div>
      <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6, marginBottom: '1.5rem', fontStyle: 'italic' }}>WEB translation loaded. Other translations coming soon.</p>

      {/* About */}
      <span className="section-label">About</span>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '14px', color: 'var(--cream)', marginBottom: 4 }}>Dinner with Jesus</div>
        <div style={{ fontSize: '12px', color: 'var(--silver)' }}>A table for every family · 1:10</div>
        <div style={{ height: '0.5px', background: 'var(--border)', margin: '0.875rem 0' }} />
        <div style={{ fontSize: '12px', color: 'var(--silver)', fontStyle: 'italic', lineHeight: 1.7 }}>
          "That you may walk worthily of the Lord, to please him in all respects, bearing fruit in every good work, and increasing in the knowledge of God."
        </div>
        <div style={{ fontSize: '11px', color: 'var(--gold)', marginTop: '0.5rem' }}>Colossians 1:10</div>
        <div style={{ height: '0.5px', background: 'var(--border)', margin: '0.875rem 0' }} />
        <div style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6 }}>Built by <span style={{ color: 'var(--gold)' }}>OneTen Group</span> · onetengroup.ai</div>
        <div style={{ height: '0.5px', background: 'var(--border)', margin: '0.875rem 0' }} />
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <a href="/privacy-policy" target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Privacy Policy</a>
          <a href="/terms-of-service" target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: '3px' }}>Terms of Service</a>
        </div>
      </div>

      {/* Share the app */}
      <div style={{ marginBottom: '0.75rem' }}>
        <button
          className="btn"
          style={{ color: 'var(--gold)', borderColor: 'var(--border-gold)', background: 'var(--gold-soft)', width: '100%' }}
          onClick={() => {
            const msg = `Check out Dinner with Jesus — one verse, one real conversation, one prayer at dinner. It's free and it's changing how families connect. flippingtables.ai 🙏`
            if (navigator.share) {
              navigator.share({ text: msg })
            } else {
              navigator.clipboard.writeText(msg)
              showToast('Copied! Share it with someone. 🙏')
            }
          }}
        >
          🙏 Share Dinner with Jesus
        </button>
      </div>

      {/* Feedback */}
      <div style={{ marginBottom: '0.75rem' }}>
        <a href="mailto:info@onetengroup.ai?subject=DWJ Feedback&body=Hi Friends,%0D%0A%0D%0AHere's my feedback on Dinner with Jesus:%0D%0A%0D%0A" style={{ display: 'block', textDecoration: 'none' }}>
          <button className="btn" style={{ color: 'var(--gold)', borderColor: 'var(--border-gold)', background: 'var(--gold-soft)', width: '100%' }}>💬 Send Feedback</button>
        </a>
      </div>

      {isAdmin && (
        <button className="btn" style={{ marginBottom: '0.75rem', color: 'var(--gold)', borderColor: 'var(--border-gold)', background: 'var(--gold-soft)' }} onClick={onOpenAdmin}>⚙️ Admin Dashboard</button>
      )}

      <button className="btn" style={{ marginBottom: '2rem', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }} onClick={signOut}>Sign out</button>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
