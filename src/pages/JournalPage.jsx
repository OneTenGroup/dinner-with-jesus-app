import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFamily } from '../hooks/useFamily'
import { setUpdateBusy } from '../lib/appUpdate'

const TABS = [
  { id: 'personal', label: 'My Journal' },
  { id: 'family', label: 'Family Table' },
]

export default function JournalPage() {
  const { user } = useAuth()
  const { group } = useFamily()
  const [activeTab, setActiveTab] = useState('personal')
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    loadNotes()
  }, [activeTab, group])

  async function loadNotes() {
    setLoading(true)
    try {
      if (activeTab === 'personal') {
        // All notes belonging to this user
        const { data } = await supabase
          .from('notes')
          .select('*')
          .eq('user_id', user.id)
          .is('family_id', null)
          .order('created_at', { ascending: false })
        setNotes(data || [])
      } else {
        // Group/family table notes
        if (group?.id) {
          const { data } = await supabase
            .from('notes')
            .select('*')
            .eq('family_id', group.id)
            .order('created_at', { ascending: false })
          setNotes(data || [])
        } else {
          setNotes([])
        }
      }
    } catch (err) {
      setNotes([])
    }
    setLoading(false)
  }

  async function saveNote() {
    if (!newNote.trim()) { showToast('Write something first.'); return }
    if (saving) return // prevent double submission
    setSaving(true)
    const content = newNote
    try {
      const { error } = await supabase.from('notes').insert({
        user_id: user.id,
        content,
        category: 'Personal',
        verse_ref: null,
        family_id: null
      })
      if (error) throw error
      setNewNote('') // only clear the draft once the save is confirmed
      setUpdateBusy(false) // draft cleared programmatically -- onChange won't fire, so clear the busy flag explicitly
      showToast('Saved to your journal. ✓')
      loadNotes()
    } catch (err) {
      console.error('[journal:saveNote]', err?.message)
      showToast("That didn't save. Your words are still here — try again.")
    }
    setSaving(false)
  }

  async function deleteNote(id) {
    if (deletingId) return // prevent double submission
    setDeletingId(id)
    try {
      const { error } = await supabase.from('notes').delete().eq('id', id)
      if (error) throw error
      setNotes(prev => prev.filter(n => n.id !== id))
      showToast('Note deleted.')
    } catch (err) {
      console.error('[journal:deleteNote]', err?.message)
      showToast("Could not delete that note. It's still here — try again.")
    }
    setDeletingId(null)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2800)
  }

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>
      <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.3rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.25rem' }}>
        Journal
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--silver)', fontWeight: 300, marginBottom: '1rem' }}>
        Every moment worth remembering.
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: 8,
              border: `0.5px solid ${activeTab === t.id ? 'var(--gold)' : 'var(--border)'}`,
              background: activeTab === t.id ? 'var(--gold-soft)' : 'var(--bg3)',
              color: activeTab === t.id ? 'var(--gold)' : 'var(--silver)',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: activeTab === t.id ? 500 : 400,
              transition: 'all 0.15s'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Personal journal — add new note */}
      {activeTab === 'personal' && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <span className="section-label">Add a note</span>
          <textarea
            value={newNote}
            onChange={e => { setNewNote(e.target.value); setUpdateBusy(e.target.value.trim().length > 0) }}
            onFocus={() => setUpdateBusy(true)}
            onBlur={() => setUpdateBusy(newNote.trim().length > 0)}
            placeholder="Something on your heart today..."
            style={{ minHeight: 80, resize: 'none', marginBottom: 8 }}
          />
          <button className="btn btn-gold" onClick={saveNote} disabled={saving}>
            {saving ? 'Saving...' : 'Save to my journal'}
          </button>
        </div>
      )}

      {/* Family tab — no group */}
      {activeTab === 'family' && !group && (
        <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🍽️</div>
          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7 }}>
            You're not in a dinner circle yet. Go to Settings to create or join one.
          </p>
        </div>
      )}

      {/* Notes list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--silver)' }}>Loading...</div>
      ) : notes.length === 0 && (activeTab === 'personal' || group) ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.875rem' }}>
            {activeTab === 'personal' ? '✏️' : '🍽'}
          </div>
          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7 }}>
            {activeTab === 'personal'
              ? 'Your personal journal is empty.\nWrite something worth remembering.'
              : 'No family table notes yet.\nSave a moment at dinner tonight.'
            }
          </p>
        </div>
      ) : (
        notes.map(note => (
          <div key={note.id} className="card" style={{ marginBottom: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <div style={{ fontFamily: 'Lora, serif', fontSize: '0.9rem', fontWeight: 600, color: 'var(--white)' }}>
                {note.verse_ref || note.category || 'Note'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: '11px', color: 'var(--silver)' }}>
                  {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <button
                  onClick={() => deleteNote(note.id)}
                  disabled={deletingId === note.id}
                  style={{ background: 'none', border: 'none', color: 'var(--silver)', cursor: deletingId === note.id ? 'default' : 'pointer', fontSize: '14px', opacity: deletingId === note.id ? 0.25 : 0.5, padding: 0 }}
                >
                  {deletingId === note.id ? '…' : '✕'}
                </button>
              </div>
            </div>
            {note.category && note.verse_ref && (
              <div style={{ fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: '0.35rem' }}>
                {note.category}
              </div>
            )}
            <div style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.6, fontStyle: 'italic' }}>
              "{note.content}"
            </div>
          </div>
        ))
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
