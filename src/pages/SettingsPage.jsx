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

// A curated set of IANA zone names, not an exhaustive list -- the
// database validates whatever is actually sent (groups_timezone_valid
// check constraint, 20260714000004_shared_dinner_session.sql), so this
// is only a convenience picker, not the source of truth for validity.
const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
]

// get_or_create_tonight_session() (20260714000004_shared_dinner_session.sql)
// is the single, atomic, server-side "lock tonight's verse" operation --
// see HomePage.jsx's copy of this same comment for why the client-side
// check-then-upsert this replaced was a real race, and why there's no
// separate "alreadyLocked" branch to handle anymore (the RPC is
// idempotent -- calling it when a verse is already locked just returns
// the existing session).
async function lockVerseForGroup(groupId) {
  if (!groupId) return { error: 'No group found' }
  const { data, error } = await supabase.rpc('get_or_create_tonight_session', {
    group_id_input: groupId
  })
  if (error || !data || data.length === 0) return { error: 'Could not lock verse' }
  return { success: true, wasCreated: data[0].was_created }
}

export default function SettingsPage({ isAdmin = false, onOpenAdmin }) {
  const { user, profile, signOut, updateProfile } = useAuth()
  const { group, members, memberProfiles, createGroup, joinGroup, leaveGroup, removeMember, reload: reloadFamily } = useFamily()

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
  const [removeConfirm, setRemoveConfirm] = useState(null) // { id, name } of member pending removal
  const [removing, setRemoving] = useState(false)
  const [savingTimezone, setSavingTimezone] = useState(false)

  // memberProfiles (id + name only, never email) comes from useFamily(),
  // which sources it from the get_my_group_members() RPC -- profiles
  // has no same-group SELECT policy, so a direct query here would
  // return nothing for anyone but the caller's own row.
  useEffect(() => {
    checkVerseLocked()
  }, [group])

  async function checkVerseLocked() {
    if (!group?.id) return
    // get_canonical_dinner_date_for_group() resolves "today" using the
    // group's own timezone + 4am cutoff, server-side -- not a
    // client-computed date, and without the side effect of creating a
    // session just to check whether one exists yet.
    const { data: today } = await supabase.rpc('get_canonical_dinner_date_for_group', {
      group_id_input: group.id
    })
    if (!today) return
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
    if (result.success) {
      track('verse_locked')
      showToast(result.wasCreated ? "Tonight's table is ready. 🙏" : 'Tonight\'s table was already set. 🙏')
      setVerseLocked(true)
    } else {
      showToast(result.error || 'Could not set verse. Try again.')
    }
    setLockingVerse(false)
  }

  async function handleChangeTimezone(tz) {
    if (!group?.id || !group.isOwner || tz === group.timezone) return
    setSavingTimezone(true)
    try {
      // groups_update_owner RLS policy already permits this (owner-only
      // update on their own group). The database's own
      // groups_timezone_valid check constraint validates tz server-side
      // regardless of what this picker offers -- this call cannot store
      // an unvalidated value even if the client were compromised.
      const { error } = await supabase.from('groups').update({ timezone: tz }).eq('id', group.id)
      if (error) throw error
      await reloadFamily()
      showToast('Table timezone updated. Future dinners will use it. ✓')
    } catch (err) {
      console.error('[settings:handleChangeTimezone]', err?.message)
      showToast('Could not update timezone. Try again.')
    }
    setSavingTimezone(false)
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
      // removeMember() already reloads group/memberProfiles internally
      // on success (see useFamily.js) -- no separate refresh needed here.
      showToast(`${removeConfirm.name} has been removed from the table.`)
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
    const { error } = await updateProfile({ preferred_translation: t })
    if (error) {
      console.error('[settings:handleTranslation]', error.message)
      showToast('Could not update translation. Try again.')
    } else {
      showToast(`Translation set to ${t} ✓`)
    }
  }

  async function handleFaithLevel(level) {
    const { error } = await updateProfile({ faith_level: level })
    if (error) {
      console.error('[settings:handleFaithLevel]', error.message)
      showToast('Could not update faith level. Try again.')
    } else {
      showToast('Faith journey level updated ✓')
    }
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

          {/* Table timezone — owner only. Determines when "tonight's"
              dinner day starts/ends (4am local cutoff) for every member,
              regardless of their own device's timezone. */}
          {group.isOwner && (
            <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '0.875rem', marginBottom: '0.875rem', border: '0.5px solid var(--border)' }}>
              <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.5rem', lineHeight: 1.6 }}>
                <span style={{ color: 'var(--gold)', fontWeight: 500 }}>Table timezone:</span> used to decide when tonight's dinner begins for everyone at the table, no matter where they are.
              </p>
              <select
                value={group.timezone || 'America/Chicago'}
                onChange={e => handleChangeTimezone(e.target.value)}
                disabled={savingTimezone}
                style={{ width: '100%' }}
              >
                {TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
          )}

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
              style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '3px' }}
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
              <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.875rem', fontWeight: 300 }}>Usually your family name — e.g. "The Johnson's"</p>
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
            const msg = `Check out Dinner with Jesus — one verse, one real conversation, one prayer at dinner. It's changing how families connect. flippingtables.ai 🙏`
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

      <button className="btn" style={{ marginBottom: '0.75rem', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }} onClick={signOut}>Sign out</button>

      <p style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <a href="/delete-account" target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--silver)', opacity: 0.6, textDecoration: 'underline', textUnderlineOffset: '3px' }}>
          Delete my account
        </a>
      </p>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
