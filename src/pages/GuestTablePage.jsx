import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function GuestTablePage() {
  const { inviteCode } = useParams()
  const [verse, setVerse] = useState(null)
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadGuestTable()
  }, [inviteCode])

  async function loadGuestTable() {
    setLoading(true)
    try {
      // Find the group by invite code
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('id, name')
        .eq('invite_code', inviteCode.toUpperCase())
        .single()

      if (groupError || !groupData) {
        setError('Table not found. Check your invite code and try again.')
        setLoading(false)
        return
      }

      setGroup(groupData)

      // Get today's verse for this group
      const today = new Date().toISOString().split('T')[0]
      const { data: sticky } = await supabase
        .from('group_verse')
        .select('dinner_verse_id')
        .eq('group_id', groupData.id)
        .eq('verse_date', today)
        .single()

      if (!sticky?.dinner_verse_id) {
        setError("Tonight's verse hasn't been set yet. Ask the table owner to set it first.")
        setLoading(false)
        return
      }

      const { data: verseData } = await supabase
        .from('dinner_verses')
        .select('*')
        .eq('id', sticky.dinner_verse_id)
        .single()

      setVerse(verseData)
    } catch (err) {
      setError('Could not load the table. Please try again.')
    }
    setLoading(false)
  }

  const goldAccent = { position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, #C9A84C, transparent)' }
  const cardBase = { position: 'relative', overflow: 'hidden', background: '#1a2640', border: '0.5px solid rgba(201,168,76,0.3)', borderRadius: '12px', padding: '1.25rem', marginBottom: '0.875rem' }

  return (
    <div style={{ background: '#0D1829', minHeight: '100vh', padding: '1.5rem 1.25rem 4rem', fontFamily: 'Georgia, serif' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '1.5rem', color: '#C9A84C', marginBottom: '0.25rem' }}>✝</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 600, color: '#F5E6C8' }}>
            Dinner with <span style={{ color: '#C9A84C' }}>Jesus</span>
          </div>
          {group && (
            <div style={{ fontSize: '13px', color: 'rgba(201,168,76,0.7)', marginTop: '0.25rem' }}>
              You're at {group.name}'s table tonight
            </div>
          )}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#8899aa' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✝️</div>
            <p>Setting the table...</p>
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#E57373' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🍽️</div>
            <p style={{ fontSize: '14px', lineHeight: 1.7 }}>{error}</p>
          </div>
        )}

        {verse && (
          <>
            {/* Verse */}
            <div style={{ ...cardBase, border: '0.5px solid rgba(201,168,76,0.5)' }}>
              <div style={goldAccent} />
              <div style={{ fontSize: '11px', color: '#C9A84C', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                {verse.verse_ref} · {verse.category}
              </div>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.05rem', fontStyle: 'italic', color: '#F5E6C8', lineHeight: 1.8 }}>
                "{verse.verse_text}"
              </div>
            </div>

            {/* Context */}
            {verse.context_text && (
              <div style={{ ...cardBase, background: '#162033' }}>
                <div style={goldAccent} />
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#F5E6C8', marginBottom: '0.5rem' }}>A little context</div>
                <p style={{ fontSize: '13px', color: '#C8B89A', lineHeight: 1.75, fontWeight: 300 }}>
                  {verse.context_text}
                </p>
              </div>
            )}

            {/* Questions */}
            <div style={cardBase}>
              <div style={goldAccent} />
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#F5E6C8', marginBottom: '0.75rem' }}>For the table tonight</div>
              <p style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', color: '#F5E6C8', lineHeight: 1.65, fontStyle: 'italic' }}>
                {verse.question_level_1}
              </p>
              {verse.question_level_2 && (
                <div style={{ marginTop: '1rem', borderTop: '0.5px solid rgba(255,255,255,0.1)', paddingTop: '0.875rem' }}>
                  <p style={{ fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8899aa', marginBottom: '0.5rem' }}>Go deeper</p>
                  <p style={{ fontFamily: 'Georgia, serif', fontSize: '0.9rem', color: '#8899aa', lineHeight: 1.6, fontStyle: 'italic' }}>{verse.question_level_2}</p>
                </div>
              )}
            </div>

            {/* Prayer */}
            <div style={cardBase}>
              <div style={goldAccent} />
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#F5E6C8', marginBottom: '0.75rem' }}>Tonight's Prayer</div>
              <div style={{ background: '#0D1829', borderRadius: 10, padding: '1rem', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                <p style={{ fontFamily: 'Georgia, serif', fontSize: '14px', fontStyle: 'italic', color: '#C8B89A', lineHeight: 1.8, margin: 0 }}>
                  {verse.prayer_level_1}
                </p>
                <p style={{ fontSize: '11px', color: '#8899aa', textAlign: 'right', marginTop: '0.5rem' }}>— Amen 🙏</p>
              </div>
            </div>

            {/* CTA to download */}
            <div style={{ ...cardBase, textAlign: 'center', background: '#162033' }}>
              <div style={goldAccent} />
              <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>🍽️</div>
              <p style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', color: '#C9A84C', fontStyle: 'italic', lineHeight: 1.7, marginBottom: '1rem' }}>
                Want your own dinner circle?
              </p>
              <p style={{ fontSize: '13px', color: '#8899aa', lineHeight: 1.7, marginBottom: '1.25rem' }}>
                Dinner with Jesus is free. One verse, one conversation, one prayer — every night with the people you love.
              </p>
              <a
                href="https://flippingtables.ai"
                style={{ display: 'block', background: '#C9A84C', color: '#0D1829', padding: '13px', borderRadius: 8, textDecoration: 'none', fontFamily: 'Georgia, serif', fontWeight: 600, fontSize: '14px' }}
              >
                Download Dinner with Jesus — Free
              </a>
            </div>

            {/* Footer */}
            <p style={{ textAlign: 'center', fontSize: '11px', color: '#8899aa', opacity: 0.5, marginTop: '1rem' }}>
              Dinner with Jesus · flippingtables.ai · 1:10
            </p>
          </>
        )}
      </div>
    </div>
  )
}
