import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../hooks/useFamily'
import { supabase } from '../lib/supabase'

const FAITH_LABELS = {
  1: 'Seeker — gentle questions',
  2: 'Growing — one layer deeper',
  3: 'Deep — challenging & application'
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

export default function SettingsPage({ members = [] }) {
  const { user, profile, signOut, updateProfile } = useAuth()
  const { reload } = useFamily()
  const [toast, setToast] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [creating, setCreating] = useState(false)
  const [familyName, setFamilyName] = useState('')
  const [newFamilyName, setNewFamilyName] = useState('')
  const [hasFamily, setHasFamily] = useState(false)
  const [familyId, setFamilyId] = useState(null)
  const [userRole, setUserRole] = useState('member')
  const [circleMode, setCircleMode] = useState('none')
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    loadFamilyInfo()
  }, [])

  async function loadFamilyInfo() {
    if (!user?.id) return
    try {
      const { data: memberData } = await supabase
        .from('family_members')
        .select('family_id, role')
        .eq('user_id', user.id)
        .single()

      if (memberData?.family_id) {
        setHasFamily(true)
        setFamilyId(memberData.family_id)
        setUserRole(memberData.role || 'member')
        const { data: familyData } = await supabase
          .from('families')
          .select('name, invite_code')
          .eq('id', memberData.family_id)
          .single()
        if (familyData) {
          setFamilyName(familyData.name)
          setInviteCode(familyData.invite_code || '')
        }
      }
    } catch (err) {
      // No family yet
    }
  }

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
          role: 'owner',
          prayer_order: 1
        })

      if (memberError) {
        showToast('Table created but could not add you. Try signing out and back in.')
        setCreating(false)
        return
      }

      setFamilyName(newFamily.name)
      setInviteCode(newFamily.invite_code)
      setFamilyId(newFamily.id)
      setUserRole('owner')
      setHasFamily(true)
      setCircleMode('none')
      setNewFamilyName('')
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
      setHasFamily(true)
      setCircleMode('none')
      await loadFamilyInfo()
      await reload()
      showToast(`Welcome to ${familyData.name}! 🙏`)
    } catch (err) {
      showToast('Something went wrong. Try again.')
    }
    setJoining(false)
  }

  async function handleLeaveTable() {
    setLeaving(true)
    try {
      await supabase
        .from('family_members')
        .delete()
        .eq('user_id', user.id)
        .eq('family_id', familyId)

      setHasFamily(false)
      setFamilyId(null)
      setFamilyName('')
      setInviteCode('')
      setUserRole('member')
      setShowLeaveConfirm(false)
      await reload()
      showToast('You have left the table.')
    } catch (err) {
      showToast('Could not leave table. Try again.')
    }
    setLeaving(false)
  }

  async function handleRegenerateCode() {
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
        setInviteCode(code)
        showToast('New invite code generated! ✓')
      }
    } catch (err) {
      showToast('Something went wrong. Try again.')
    }
    setRegenerating(false)
  }

  function copyInviteCode() {
    navigator.clipboard.writeText(inviteCode)
    showToast('Invite code copied! ✓')
  }

  function shareInviteCode() {
    const msg = `Join my table on Dinner with Jesus!\n\nEnter this code in the app Settings:\n${inviteCode}\n\nDownload at flippingtables.ai`
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
    showToast('Faith level updated ✓')
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  const isOwner = userRole === 'owner'

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--bg4)', border: '0.5px solid var(--border-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', color: 'var(--gold)', fontWeight: 500, flexShrink: 0 }}>
            {profile?.name?.charAt(0) || '?'}
          </div>
          <div>
            <div style={{ fontSize: '15px', color: 'var(--white)' }}>{profile?.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--silver)', marginTop: 2 }}>{profile?.email || ''}</div>
          </div>
        </div>
      </div>

      {/* Circles */}
      <span className="section-label">Your Circle</span>

      {hasFamily ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <p style={{ fontSize: '13px', color: 'var(--white)', fontWeight: 500, margin: 0 }}>
              {familyName || 'Your Table'}
            </p>
            <span style={{ fontSize: '11px', color: 'var(--gold)', opacity: 0.7 }}>
              {isOwner ? 'Owner' : 'Member'}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--silver)', marginBottom: '1rem', fontWeight: 300 }}>
            Share this code so others can join your table.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg3)', borderRadius: 10, padding: '0.875rem 1rem', border: '0.5px solid var(--border-gold)', marginBottom: '0.875rem' }}>
            <div style={{ fontFamily: 'Lora, serif', fontSize: '1.8rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.2em', flex: 1, textAlign: 'center' }}>
              {inviteCode || '------'}
            </div>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={copyInviteCode}>📋 Copy code</button>
            <button className="btn btn-gold" onClick={shareInviteCode}>📤 Share invite</button>
          </div>

          {/* Owner-only: regenerate code */}
          {isOwner && (
            <button
              className="btn"
              onClick={handleRegenerateCode}
              disabled={regenerating}
              style={{ marginTop: 8, width: '100%', fontSize: '12px', color: 'var(--silver)' }}
            >
              {regenerating ? 'Generating...' : '🔄 Generate new invite code'}
            </button>
          )}

          {/* Leave table */}
          <div style={{ marginTop: '1rem', borderTop: '0.5px solid var(--border)', paddingTop: '0.875rem' }}>
            {!showLeaveConfirm ? (
              <button
                className="btn"
                onClick={() => setShowLeaveConfirm(true)}
                style={{ width: '100%', fontSize: '12px', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }}
              >
                {isOwner ? '🚪 Leave & close table' : '🚪 Leave this table'}
              </button>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '0.75rem' }}>
                  {isOwner
                    ? 'Are you sure? This will remove you from the table. Others can still use the invite code.'
                    : 'Are you sure you want to leave this table?'}
                </p>
                <div className="btn-row">
                  <button
                    className="btn"
                    onClick={() => setShowLeaveConfirm(false)}
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn"
                    onClick={handleLeaveTable}
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
      ) : (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          {circleMode === 'none' && (
            <>
              <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '1rem', lineHeight: 1.6 }}>
                Start your own table or join one you've been invited to.
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
              <button
                className="btn btn-gold"
                onClick={handleCreateFamily}
                disabled={creating}
                style={{ marginBottom: 8 }}
              >
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
                Enter the 6-character code from the person who invited you.
              </p>
              <input
                type="text"
                placeholder="Enter invite code"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                style={{ marginBottom: 8, textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}
              />
              <button
                className="btn btn-gold"
                onClick={handleJoinFamily}
                disabled={joining}
                style={{ marginBottom: 8 }}
              >
                {joining ? 'Joining...' : 'Join this table 🙏'}
              </button>
              <button className="btn-ghost" onClick={() => setCircleMode('none')} style={{ fontSize: '13px', color: 'var(--silver)', background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: '6px 0' }}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}

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
      <span className="section-label">Faith Journey Level</span>
      <div style={{ marginBottom: '1.5rem' }}>
        {[1, 2, 3].map(level => (
          <div key={level} className="card"
            style={{ marginBottom: 6, cursor: 'pointer', borderColor: profile?.faith_level === level ? 'var(--gold)' : 'var(--border)', background: profile?.faith_level === level ? 'var(--gold-soft)' : 'var(--bg2)' }}
            onClick={() => handleFaithLevel(level)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', color: 'var(--cream)' }}>Level {level}</div>
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
        KJV is fully loaded. Other translations coming soon.
      </p>

      {/* About */}
      <span className="section-label">About</span>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '14px', color: 'var(--cream)', marginBottom: 4 }}>Dinner with Jesus</div>
        <div style={{ fontSize: '12px', color: 'var(--silver)' }}>A table for every family · 1:10</div>
        <div style={{ height: '0.5px', background: 'var(--border)', margin: '0.875rem 0' }} />
        <div style={{ fontSize: '12px', color: 'var(--silver)', fontStyle: 'italic', lineHeight: 1.7 }}>
          "That ye might walk worthy of the Lord unto all pleasing, being fruitful in every good work, and increasing in the knowledge of God."
        </div>
        <div style={{ fontSize: '11px', color: 'var(--gold)', marginTop: '0.5rem' }}>Colossians 1:10</div>
        <div style={{ height: '0.5px', background: 'var(--border)', margin: '0.875rem 0' }} />
        <div style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.6 }}>
          Built by <span style={{ color: 'var(--gold)' }}>OneTen Group</span> · onetengroup.ai
        </div>
      </div>

      {/* Sign out */}
      <button className="btn" style={{ marginBottom: '2rem', color: '#E57373', borderColor: 'rgba(229,115,115,0.2)' }} onClick={signOut}>
        Sign out
      </button>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
