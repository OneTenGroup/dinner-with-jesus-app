import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function JournalPage() {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadNotes() }, [])

  async function loadNotes() {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .order('created_at', { ascending: false })
    setNotes(data || [])
    setLoading(false)
  }

  if (loading) return (
    <div className="loading-wrap" style={{ flex: 1 }}>
      <div className="loading-cross">📖</div>
      <p style={{ color: 'var(--silver)', fontSize: '14px' }}>Loading your journal...</p>
    </div>
  )

  return (
    <div className="screen" style={{ paddingTop: '1rem' }}>
      <h2 style={{ fontFamily: 'Lora, serif', fontSize: '1.3rem', fontWeight: 600, color: 'var(--white)', marginBottom: '0.25rem' }}>
        Your Table Journal
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--silver)', fontWeight: 300, marginBottom: '1.25rem' }}>
        Every moment your family saved at the table.
      </p>

      {notes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.875rem' }}>📖</div>
          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7 }}>
            Your journal is empty right now.<br /><br />
            Save a moment at the table tonight<br />
            and it will live here forever.
          </p>
        </div>
      ) : (
        notes.map(note => (
          <div key={note.id} className="card" style={{ marginBottom: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <div style={{ fontFamily: 'Lora, serif', fontSize: '0.9rem', fontWeight: 600, color: 'var(--white)' }}>
                {note.verse_ref || 'Note'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--silver)' }}>
                {new Date(note.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
            {note.category && (
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
    </div>
  )
}
