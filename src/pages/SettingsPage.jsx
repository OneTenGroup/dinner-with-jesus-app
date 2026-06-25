import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../hooks/useFamily'
import { supabase } from '../lib/supabase'

const FAITH_LABELS = {
  1: 'Gentle, open-ended questions',
  2: 'One layer deeper',
  3: 'Challenging & application'
}

const TRANSLATIONS = ['KJV', 'NIV', 'NLT', 'ESV', 'NKJV']

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

export default function SettingsPage({ members = [], isAdmin = false, onOpenAdmin, onJoined }) {
  const { user, profile, signOut, updateProfile } = useAuth()
  const { allFamilies, reload, switchTable } = useFamily()
  const [toast, setToast] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newFamilyName, setNewFamilyName] = useState('')
  const [circleMode, setCircleMode] = useState('none')
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [accountMode, setAccountMode] = useState('none')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accountSaving, setAccountSaving] = useState(false)

  async function handleCreateFamily() {
    if (!newFamilyName.trim()) {
      showToast('Give your table a name first.')
      return
    }
    setCreating(true)
    try {
      let code = generateInviteCode()
      const { data: existing } = await supabase
        .from('families')
        .select('id')
        .eq('invite_code', code)
        .single()
      if (existing) code = generateInviteCode()

      const { data: newFamily, error: familyError } = await supabase
        .from('families')
        .insert({
          name: newFamilyName.trim(),
          invite_code: code,
          owner_id: user.id
        })
        .select('id, name, invite_code')
        .single()

      if (familyError || !newFamily) {
        showToast('Could not create table. Try again.')
        setCreating(false)
        return
      }

      const { error: memberError } = await supabase
        .from('family_members')
        .insert({
          family_id: newFamily.id,
          user_id: user.id,
          display_name: profile?.name || 'Owner',
          role: 'host',
          prayer_order: 1
        })

      if (memberError) {
        showToast('Table created but could not add you. Try signing out and back in.')
        setCreating(false)
        return
      }

      setNewFamilyName('')
      setCircleMode('none')
      await reload()
      showToast(`${newFamily.name} is ready! Share your code. 🙏`)
    } catch (err) {
      showToast('Something went wrong. Try again.')
    }
    setCreating(false)
  }

  async function handleJoinFamily() {
    if (!joinCode.trim() || joinCode.length !== 6) {
      showToast('Enter a valid 6-character code.')
      return
    }
    setJoining(true)
    try {
      const { data: familyResults, error } = await supabase
        .from('families')
        .select('id, name')
        .eq('invite_code', joinCode.toUpperCase())
        .limit(1)

      if (error || !familyResults || familyResults.length === 0) {
        showToast('Code not found. Check and try again.')
        setJoining(false)
        return
      }
      const familyData = familyResults[0]

      const { data: existing } = await supabase
        .from('family_members')
        .select('id')
        .eq('family_id', familyData.id)
        .eq('user_id', user.id)
        .single()

      if (existing) {
        showToast('You are already at this table!')
        setJoining(false)
        return
      }

      await supabase.from('family_members').insert({
        family_id: familyData.id,
        user_id: user.id,
        display_name: profile?.name || 'Guest',
        role: 'member',
        prayer_order: 99
      })

      setJoinCode('')
      setCircleMode('none')
      await supabase.from('profiles').update({ active_family_id: familyData.id }).eq('id', user.id)
      await reload()
      showToast(`Welcome to ${familyData.name}! 🙏`)
      setTimeout(() => onJoined && onJoined(), 1200)
    } catch (err) {
      showToast('Something went wrong. Try again.')
    }
    setJoining(false)
  }

  async function handleLeaveTable(familyId) {
    setLeaving(true)
    try {
      await supabase
        .from('family_members')
        .delete()
        .eq('user_id', user.id)
        .eq('family_id', familyId)

      setShowLeaveConfirm(null)
      await reload()
      showToast('You have left the table.')
    } catch (err) {
      showToast('Could not leave table. Try again.')
    }
    setLeaving(false)
  }

  async function handleRegenerateCode(familyId) {
    setRegenerating(true)
    try {
      let code = generateInviteCode()
      const { data: existing } = await supabase
        .from('families')
        .select('id')
        .eq('invite_code', code)
        .single()
      if (existing) code = generateInviteCode()

      const { error } = await supabase
        .from('families')
        .update({ invite_code: code })
        .eq('id', familyId)

      if (error) {
        showToast('Could not regenerate code. Try again.')
      } else {
        await reload()
        showToast('New invite code generated! ✓')
      }
    } catch (err) {
      showToast('Something went wrong. Try again.')
    }
    setRegenerating(false)
  }

  function copyInviteCode(code) {
    navigator.clipboard.writeText(code)
    showToast('Invite code copied! ✓')
  }

  function shareInviteCode(family) {
    const msg = `Join my table on Dinner with Jesus!\n\nEnter this code in the app Settings:\n${family.invite_code}\n\nDownload at flippingtables.ai`
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
      const { error } = await supabase
        .from('profiles')
        .update({ name: newName.trim() })
        .eq('id', user.id)
      if (error) throw error
      await supabase
        .from('family_members')
        .update({ display_name: newName.trim() })
        .eq('user_id', user.id)
      await updateProfile({ name: newName.trim() })
      showToast('Name updated ✓')
      setAccountMode('none')
      setNewName('')
    } catch (err) {
      showToast('Could not update name. Try again.')
    }
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
    } catch (err) {
      showToast(err.message || 'Could not update email.')
    }
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
    } catch (err) {
      showToast(err.message || 'Could not update password.')
    }
    setAccountSaving(false)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  const hasFamilies = allFamilies.length > 0

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>
      <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.3rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.25rem' }}>
        Settings
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--silver)', fontWeight: 300, marginBottom: '1.25rem' }}>
        Your table, your way.
      </p>

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
          <button
            onClick={() => setAccountMode(accountMode === 'none' ? 'menu' : 'none')}
            style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--silver)', fontSize: '12px', cursor: 'pointer' }}
          >
            {accountMode === 'none' ? 'Edit' : 'Cancel'}
          </button>
        </div>

        {accountMode === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: '0.75rem' }}>
            <button className="btn" style={{ width: '100%', textAlign: 'left', fontSize: '13px' }} onClick={() => { setNewName(profile?.name || ''); setAccountMode('name') }}>
              ✏️ Change display name
            </button>
            <button className="btn" style={{ width: '100%', textAlign: 'left', fontSize: '13px' }} onClick={() => { setNewEmail(profile?.email || ''); setAccountMode('email') }}>
              📧 Change email
            </button>
            <button className="btn" style={{ width: '100%', textAlign: 'left', fontSize: '13px' }} onClick={() => setAccountMode('password')}>
              🔒 Change password
            </button>
          </div>
        )}

        {accountMode === 'name' && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.5rem' }}>Display name</p>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Your name"
              maxLength={40}
              style={{ marginBottom: 8 }}
            />
            <div className="btn-row">
              <button className="btn" onClick={() => setAccountMode('menu')}>Cancel</button>
              <button className="btn btn-gold" onClick={handleUpdateName} disabled={accountSaving}>
                {accountSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {accountMode === 'email' && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.5rem' }}>New email address</p>
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="new@email.com"
              style={{ marginBottom: 8 }}
            />
            <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6, marginBottom: 8, fontStyle: 'italic' }}>
              You'll need to confirm the change from your new email address.
            </p>
            <div className="btn-row">
              <button className="btn" onClick={() => setAccountMode('menu')}>Cancel</button>
              <button className="btn btn-gold" onClick={handleUpdateEmail} disabled={accountSaving}>
                {accountSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {accountMode === 'password' && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.5rem' }}>New password</p>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="New password (min 6 characters)"
              minLength={6}
              style={{ marginBottom: 8 }}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              minLength={6}
              style={{ marginBottom: 8 }}
            />
            <div className="btn-row">
              <button className="btn" onClick={() => setAccountMode('menu')}>Cancel</button>
              <button className="btn btn-gold" onClick={handleUpdatePassword} disabled={accountSaving}>
                {accountSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Circles */}
      <span className="section-label">Your Circles</span>

      {allFamilies.map(family => (
        <div key={family.id} className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <p style={{ fontSize: '13px', color: 'var(--white)', fontWeight: 500, margin: 0 }}>
              {family.name}
            </p>
            <span style={{ fontSize: '11px', color: 'var(--gold)', opacity: 0.7 }}>
              {family.role === 'host' ? '⭐ Host' : 'Member'}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '1rem', fontWeight: 300 }}>
            Share this code so others can join your table.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg3)', borderRadius: 10, padding: '0.875rem 1rem', border: '0.5px solid var(--border-gold)', marginBottom: '0.875rem' }}>
            <div style={{ fontFamily: 'Lora, serif', fontSize: '1.8rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.2em', flex: 1, textAlign: 'center' }}>
              {family.invite_code || '------'}
            </div>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => copyInviteCode(family.invite_code)}>📋 Copy code</button>
            <button className="btn btn-gold" onClick={() => shareInviteCode(family)}>📤 Share invite</button>
          </div>

          <button
            className="btn btn-gold"
            style={{ width: '100%', marginBottom: 8, fontSize: '13px' }}
            onClick={() => switchTable(family.id)}
          >
            🍽️ Sit here tonight
          </button>

          {family.role === 'host' && (
            <button
              className="btn"
              onClick={() => handleRegenerateCode(family.id)}
              disabled={regenerating}
              style={{ marginTop: 8, width: '100%', fontSize: '12px', color: 'var(--silver)' }}
            >
              {regenerating ? 'Generating...' : '🔄 Generate new invite code'}
            </button>
          )}

          <div style={{ marginTop: '1rem', borderTop: '0.5px solid var(--border)', paddingTop: '0.875rem' }}>
            {showLeaveConfirm !== family.id ? (
              <button
                className="btn"
                onClick={() => setShowLeaveConfirm(family.id)}
                style={{ width: '100%', fontSize: '12px', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }}
              >
                🚪 Leave this table
              </button>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '0.75rem' }}>
                  Are you sure you want to leave {family.name}?
                </p>
                <div className="btn-row">
                  <button className="btn" onClick={() => setShowLeaveConfirm(null)} style={{ flex: 1 }}>Cancel</button>
                  <button
                    className="btn"
                    onClick={() => handleLeaveTable(family.id)}
                    disabled={leaving}
                    style={{ flex: 1, color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }}
                  >
                    {leaving ? 'Leaving...' : 'Yes, leave'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6, marginTop: '0.75rem', fontStyle: 'italic', textAlign: 'center' }}>
            Anyone with this code can join your table.
          </p>
        </div>
      ))}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        {circleMode === 'none' && (
          <>
            <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '1rem', lineHeight: 1.6 }}>
              {hasFamilies ? "Start another table or join one you've been invited to." : "Start your own table or join one you've been invited to."}
            </p>
            <div className="btn-row">
              <button className="btn btn-gold" onClick={() => setCircleMode('create')}>
                🍽️ Start a table
              </button>
              <button className="btn" onClick={() => setCircleMode('join')}>
                🔑 Join a table
              </button>
            </div>
          </>
        )}

        {circleMode === 'create' && (
          <>
            <p style={{ fontSize: '13px', color: 'var(--white)', marginBottom: '0.25rem', fontWeight: 500 }}>
              Name your table
            </p>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.875rem', fontWeight: 300 }}>
              Usually your family name — e.g. "The Crawfords"
            </p>
            <input
              type="text"
              placeholder="The ___ Family"
              value={newFamilyName}
              onChange={e => setNewFamilyName(e.target.value)}
              maxLength={40}
              style={{ marginBottom: 8 }}
            />
            <button className="btn btn-gold" onClick={handleCreateFamily} disabled={creating} style={{ marginBottom: 8 }}>
              {creating ? 'Setting the table...' : 'Create my table 🙏'}
            </button>
            <button className="btn-ghost" onClick={() => setCircleMode('none')} style={{ fontSize: '13px', color: 'var(--silver)', background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: '6px 0' }}>
              Cancel
            </button>
          </>
        )}

        {circleMode === 'join' && (
          <>
            <p style={{ fontSize: '13px', color: 'var(--white)', marginBottom: '0.25rem', fontWeight: 500 }}>
              Join a table
            </p>
            <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '0.875rem', fontWeight: 300 }}>
              Enter the 6-character code from the person who invited you. You can be part of multiple tables.
            </p>
            <input
              type="text"
              placeholder="Enter invite code"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              style={{ marginBottom: 8, textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}
            />
            <button className="btn btn-gold" onClick={handleJoinFamily} disabled={joining} style={{ marginBottom: 8 }}>
              {joining ? 'Joining...' : 'Join this table 🙏'}
            </button>
            <button className="btn-ghost" onClick={() => setCircleMode('none')} style={{ fontSize: '13px', color: 'var(--silver)', background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: '6px 0' }}>
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Table Members */}
      <span className="section-label">Table Members</span>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        {members && members.length > 0 ? (
          members.map(m => (
            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.65rem 0', borderBottom: '0.5px solid var(--border)' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg4)', border: '0.5px solid var(--border-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: 'var(--gold)', fontWeight: 500, flexShrink: 0 }}>
                {m.charAt(0)}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--cream)' }}>{m}</div>
            </div>
          ))
        ) : (
          <p style={{ fontSize: '13px', color: 'var(--silver)', fontStyle: 'italic', padding: '0.5rem 0' }}>
            No table set up yet. Start or join a table above.
          </p>
        )}
      </div>

      {/* Faith Level */}
      <span className="section-label">Faith Journey</span>
      <div style={{ marginBottom: '1.5rem' }}>
        {[
          { level: 1, label: 'Exploring' },
          { level: 2, label: 'Growing' },
          { level: 3, label: 'Going Deeper' }
        ].map(({ level, label }) => (
          <div key={level} className="card"
            style={{ marginBottom: 6, cursor: 'pointer', borderColor: profile?.faith_level === level ? 'var(--gold)' : 'var(--border)', background: profile?.faith_level === level ? 'var(--gold-soft)' : 'var(--bg2)' }}
            onClick={() => handleFaithLevel(level)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', color: 'var(--cream)' }}>{label}</div>
                <div style={{ fontSize: '12px', color: 'var(--silver)', marginTop: 2 }}>{FAITH_LABELS[level]}</div>
              </div>
              {profile?.faith_level === level && (
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)' }} />
              )}
            </div>
          </div>
        ))}
        <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6, marginTop: '0.5rem', fontStyle: 'italic' }}>
          All 3 question levels shown at the table — your level sets which appears first.
        </p>
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
      <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6, marginBottom: '1.5rem', fontStyle: 'italic' }}>
        WEB translation loaded. Other translations coming soon.
      </p>

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
        <div style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6 }}>
          Built by <span style={{ color: 'var(--gold)' }}>OneTen Group</span> · onetengroup.ai
        </div>
      </div>

      {/* Feedback */}
      <div style={{ marginBottom: '0.75rem' }}>
        <a
          href="mailto:steve@onetengroup.ai?subject=DWJ Feedback&body=Hi Steve,%0D%0A%0D%0AHere's my feedback on Dinner with Jesus:%0D%0A%0D%0A"
          style={{ display: 'block', textDecoration: 'none' }}
        >
          <button className="btn" style={{ color: 'var(--gold)', borderColor: 'var(--border-gold)', background: 'var(--gold-soft)', width: '100%' }}>
            💬 Send Feedback
          </button>
        </a>
      </div>

      {isAdmin && (
        <button
          className="btn"
          style={{ marginBottom: '0.75rem', color: 'var(--gold)', borderColor: 'var(--border-gold)', background: 'var(--gold-soft)' }}
          onClick={onOpenAdmin}
        >
          ⚙️ Admin Dashboard
        </button>
      )}

      <button className="btn" style={{ marginBottom: '2rem', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }} onClick={signOut}>
        Sign out
      </button>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
