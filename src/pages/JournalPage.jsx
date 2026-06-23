import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { id: 'personal', label: 'My Journal' },
  { id: 'family', label: 'Family Table' },
]

export default function JournalPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('personal')
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    loadNotes()
  }, [activeTab])

  async function loadNotes() {
    setLoading(true)
    try {
      if (activeTab === 'personal') {
        // Personal notes — only this user, no verse_ref (not dinner notes)
        const { data } = await supabase
          .from('notes')
          .select('*')
          .eq('user_id', user.id)
          .is('verse_ref', null)
          .order('created_at', { ascending: false })
        setNotes(data || [])
      } else {
        // Family table notes — find this user's family first
        const { data: memberData } = await supabase
          .from('family_members')
          .select('family_id')
          .eq('user_id', user.id)
          .single()

        if (memberData?.family_id) {
          const { data } = await supabase
            .from('notes')
            .select('*')
            .eq('family_id', memberData.family_id)
            .not('verse_ref', 'is', null)
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
    setSaving(true)
    try {
      await supabase.from('notes').insert({
        user_id: user.id,
        content: newNote,
        category: 'Personal',
        verse_ref: null
      })
      setNewNote('')
      showToast('Saved to your journal. ✓')
      loadNotes()
    } catch (err) {
      showToast('Could not save. Try again.')
    }
    setSaving(false)
  }

  async function deleteNote(id) {
    try {
      await supabase.from('notes').delete().eq('id', id)
      setNotes(prev => prev.filter(n => n.id !== id))
      showToast('Note deleted.')
    } catch (err) {
      showToast('Could not delete.')
    }
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
            onChange={e => setNewNote(e.target.value)}
            placeholder="Something on your heart today..."
            style={{ minHeight: 80, resize: 'none', marginBottom: 8 }}
          />
          <button
            className="btn btn-gold"
            onClick={saveNote}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save to my journal'}
          </button>
        </div>
      )}

      {/* Notes list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--silver)' }}>
          Loading...
        </div>
      ) : notes.length === 0 ? (
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
                {activeTab === 'personal' && (
                  <button
                    onClick={() => deleteNote(note.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: '14px', opacity: 0.5, padding: 0 }}
                  >
                    ✕
                  </button>
                )}
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
