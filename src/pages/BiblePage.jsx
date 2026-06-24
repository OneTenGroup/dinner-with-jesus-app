import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const BOOKS = [
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
  'Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon',
  'Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos',
  'Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah',
  'Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians',
  '2 Corinthians','Galatians','Ephesians','Philippians','Colossians',
  '1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon',
  'Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'
]

const TESTAMENT = {
  OT: BOOKS.slice(0, 39),
  NT: BOOKS.slice(39)
}

const CHAPTER_COUNTS = {
  'Genesis':50,'Exodus':40,'Leviticus':27,'Numbers':36,'Deuteronomy':34,'Joshua':24,
  'Judges':21,'Ruth':4,'1 Samuel':31,'2 Samuel':24,'1 Kings':22,'2 Kings':25,
  '1 Chronicles':29,'2 Chronicles':36,'Ezra':10,'Nehemiah':13,'Esther':10,'Job':42,
  'Psalms':150,'Proverbs':31,'Ecclesiastes':12,'Song of Solomon':8,'Isaiah':66,
  'Jeremiah':52,'Lamentations':5,'Ezekiel':48,'Daniel':12,'Hosea':14,'Joel':3,
  'Amos':9,'Obadiah':1,'Jonah':4,'Micah':7,'Nahum':3,'Habakkuk':3,'Zephaniah':3,
  'Haggai':2,'Zechariah':14,'Malachi':4,'Matthew':28,'Mark':16,'Luke':24,'John':21,
  'Acts':28,'Romans':16,'1 Corinthians':16,'2 Corinthians':13,'Galatians':6,
  'Ephesians':6,'Philippians':4,'Colossians':4,'1 Thessalonians':5,'2 Thessalonians':3,
  '1 Timothy':6,'2 Timothy':4,'Titus':3,'Philemon':1,'Hebrews':13,'James':5,
  '1 Peter':5,'2 Peter':3,'1 John':5,'2 John':1,'3 John':1,'Jude':1,'Revelation':22
}

export default function BiblePage({ initialBook, initialChapter, initialVerse, onClose }) {
  const [view, setView] = useState('books') // 'books' | 'chapters' | 'reading'
  const [selectedBook, setSelectedBook] = useState(initialBook || null)
  const [selectedChapter, setSelectedChapter] = useState(initialChapter || null)
  const [translation, setTranslation] = useState('web')
  const [verses, setVerses] = useState([])
  const [loading, setLoading] = useState(false)
  const [testament, setTestament] = useState('NT')
  const [highlightVerse, setHighlightVerse] = useState(initialVerse || null)
  const verseRef = useRef(null)

  useEffect(() => {
    if (initialBook && initialChapter) {
      setSelectedBook(initialBook)
      setSelectedChapter(initialChapter)
      setView('reading')
      loadChapter(initialBook, initialChapter)
    }
  }, [])

  useEffect(() => {
    if (highlightVerse && verseRef.current) {
      verseRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [verses, highlightVerse])

  async function loadChapter(book, chapter) {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('bible_verses')
        .select('verse, text_kjv, text_web')
        .eq('book', book)
        .eq('chapter', chapter)
        .order('verse')
      setVerses(data || [])
    } catch (err) {
      setVerses([])
    }
    setLoading(false)
  }

  function selectBook(book) {
    setSelectedBook(book)
    setView('chapters')
  }

  function selectChapter(ch) {
    setSelectedChapter(ch)
    setView('reading')
    loadChapter(selectedBook, ch)
  }

  function prevChapter() {
    if (selectedChapter > 1) {
      const ch = selectedChapter - 1
      setSelectedChapter(ch)
      loadChapter(selectedBook, ch)
    }
  }

  function nextChapter() {
    const max = CHAPTER_COUNTS[selectedBook] || 1
    if (selectedChapter < max) {
      const ch = selectedChapter + 1
      setSelectedChapter(ch)
      loadChapter(selectedBook, ch)
    }
  }

  const goldAccent = { position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--gold), transparent)' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 500, display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ background: 'var(--bg2)', borderBottom: '0.5px solid var(--border-gold)', padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {view !== 'books' && (
            <button onClick={() => view === 'chapters' ? setView('books') : setView('chapters')}
              style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: '18px', cursor: 'pointer', padding: '0 8px 0 0' }}>
              ‹
            </button>
          )}
          <div>
            <div style={{ fontFamily: 'Lora, serif', fontSize: '1rem', fontWeight: 600, color: 'var(--white)' }}>
              {view === 'books' ? 'The Bible' : view === 'chapters' ? selectedBook : `${selectedBook} ${selectedChapter}`}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--gold)', letterSpacing: '0.08em' }}>
              {view === 'reading' ? (translation === 'web' ? 'WORLD ENGLISH BIBLE' : 'KING JAMES VERSION') : 'SELECT A BOOK'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {view === 'reading' && (
            <div style={{ display: 'flex', background: 'var(--bg3)', borderRadius: 6, border: '0.5px solid var(--border-gold)', overflow: 'hidden' }}>
              {['web', 'kjv'].map(t => (
                <button key={t} onClick={() => setTranslation(t)}
                  style={{ padding: '5px 12px', fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', background: translation === t ? 'var(--gold)' : 'transparent', color: translation === t ? 'var(--bg)' : 'var(--silver)', border: 'none', cursor: 'pointer', transition: 'all 0.15s' }}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--silver)', fontSize: '20px', cursor: 'pointer', padding: '4px 0 4px 8px' }}>✕</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem 2rem' }}>

        {/* BOOKS VIEW */}
        {view === 'books' && (
          <>
            {/* Testament toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem' }}>
              {['OT', 'NT'].map(t => (
                <button key={t} onClick={() => setTestament(t)}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `0.5px solid ${testament === t ? 'var(--gold)' : 'var(--border)'}`, background: testament === t ? 'var(--gold-soft)' : 'var(--bg3)', color: testament === t ? 'var(--gold)' : 'var(--silver)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.06em' }}>
                  {t === 'OT' ? 'Old Testament' : 'New Testament'}
                </button>
              ))}
            </div>

            {/* Book list */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {TESTAMENT[testament].map(book => (
                <button key={book} onClick={() => selectBook(book)}
                  style={{ padding: '12px', borderRadius: 10, border: `0.5px solid ${selectedBook === book ? 'var(--gold)' : 'var(--border-gold)'}`, background: selectedBook === book ? 'var(--gold-soft)' : 'var(--bg2)', color: selectedBook === book ? 'var(--gold)' : 'var(--cream)', fontSize: '13px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', fontFamily: 'Lora, serif' }}>
                  {book}
                </button>
              ))}
            </div>
          </>
        )}

        {/* CHAPTERS VIEW */}
        {view === 'chapters' && (
          <>
            <p style={{ fontSize: '13px', color: 'var(--silver)', marginBottom: '1rem', fontStyle: 'italic' }}>
              {CHAPTER_COUNTS[selectedBook]} chapter{CHAPTER_COUNTS[selectedBook] !== 1 ? 's' : ''}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
              {Array.from({ length: CHAPTER_COUNTS[selectedBook] || 1 }, (_, i) => i + 1).map(ch => (
                <button key={ch} onClick={() => selectChapter(ch)}
                  style={{ padding: '12px 4px', borderRadius: 8, border: `0.5px solid ${selectedChapter === ch ? 'var(--gold)' : 'var(--border-gold)'}`, background: selectedChapter === ch ? 'var(--gold-soft)' : 'var(--bg2)', color: selectedChapter === ch ? 'var(--gold)' : 'var(--cream)', fontSize: '14px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {ch}
                </button>
              ))}
            </div>
          </>
        )}

        {/* READING VIEW */}
        {view === 'reading' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--silver)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✝️</div>
                Loading...
              </div>
            ) : (
              <>
                {verses.map(v => (
                  <div key={v.verse}
                    ref={v.verse === highlightVerse ? verseRef : null}
                    style={{ display: 'flex', gap: 12, marginBottom: '0.875rem', padding: v.verse === highlightVerse ? '8px 10px' : '0', background: v.verse === highlightVerse ? 'var(--gold-soft)' : 'transparent', borderRadius: v.verse === highlightVerse ? 8 : 0, border: v.verse === highlightVerse ? '0.5px solid var(--border-gold)' : 'none', transition: 'all 0.3s' }}>
                    <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 600, minWidth: 20, marginTop: 3, flexShrink: 0 }}>{v.verse}</span>
                    <p style={{ fontFamily: 'Lora, serif', fontSize: '1rem', color: 'var(--cream)', lineHeight: 1.85, margin: 0 }}>
                      {translation === 'web' ? (v.text_web || v.text_kjv) : v.text_kjv}
                    </p>
                  </div>
                ))}

                {/* Chapter navigation */}
                <div style={{ display: 'flex', gap: 8, marginTop: '1.5rem' }}>
                  <button className="btn" onClick={prevChapter} disabled={selectedChapter <= 1}
                    style={{ opacity: selectedChapter <= 1 ? 0.4 : 1 }}>
                    ‹ Previous
                  </button>
                  <button className="btn" onClick={() => setView('chapters')} style={{ flex: 0, padding: '11px 16px' }}>
                    {selectedChapter}
                  </button>
                  <button className="btn" onClick={nextChapter} disabled={selectedChapter >= (CHAPTER_COUNTS[selectedBook] || 1)}
                    style={{ opacity: selectedChapter >= (CHAPTER_COUNTS[selectedBook] || 1) ? 0.4 : 1 }}>
                    Next ›
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
