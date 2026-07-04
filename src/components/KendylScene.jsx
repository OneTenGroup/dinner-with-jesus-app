import { useState, useEffect } from 'react'

const FUNNY = [
  "I turned water into wine. The least you can do is show up on time.",
  "Blessed are the hungry, but dinner starts at 6.",
  "I multiplied the loaves and fish. You can bring dessert.",
  "I walked on water. You can walk from the parking lot.",
  "Before we eat, let's agree not to check our phones.",
  "This isn't the Last Supper. Relax and order appetizers.",
  "I fed 5,000 people with lunch. Don't complain about portion sizes.",
  "If I can calm a storm, we can survive a family dinner.",
  "Remember, whoever gets the last roll should ask first.",
  "Wine appears once. Dirty dishes appear daily.",
  "You call it meal prep. I call it manna.",
  "I've seen miracles. Finding a parking spot isn't one of them.",
  "Let's break bread, not the internet.",
  "I know what you're thinking. Yes, the fish is fresh.",
  "Some of you came for fellowship. Some came for free food.",
  "Love your neighbor. Even the one chewing loudly.",
  "Forgive seventy times seven. Especially at family reunions.",
  "Heaven has many rooms. This restaurant does not.",
  "Let's say grace before someone starts eating fries.",
  "If the bread basket is empty, have faith.",
  "I raised Lazarus. I cannot raise your Wi-Fi signal.",
  "Don't worry about tomorrow. Today's special is enough.",
  "Peter sank in water. Don't let your diet sink at dessert.",
  "The kingdom of heaven is not all-you-can-eat, but it's close.",
  "If you're arguing over the check, you're doing it right.",
  "Some miracles take time. Like getting seated on a Friday night.",
  "The first shall be last... unless they're holding the reservation.",
  "I never said calories don't count.",
  "It's easier to feed 5,000 than choose a restaurant with friends.",
  "If you're waiting for a sign, try the daily special.",
  "Love one another. Even when they steal your fries.",
  "Faith can move mountains. Reservations help too.",
  "I made fishermen famous. You're welcome.",
  "The bread is complimentary. Gratitude should be too.",
  "Let's keep the gossip lower than the candlelight.",
  "Not every fish story is a miracle story.",
  "Some of you need more vegetables and less worry.",
  "Yes, I know who ordered the extra dessert.",
  "Let's be honest — you came for the bread basket.",
  "Fellowship tastes better than fast food.",
  "If I ask you to share, don't suddenly become Judas.",
  "You bring the appetite. I'll bring the perspective.",
  "There are no leftovers in heaven.",
  "Blessed are those who tip generously.",
  "The waiter is not your enemy.",
  "Sometimes the miracle is getting everyone to agree.",
  "If dinner is cold, friendship shouldn't be.",
  "The table is big enough for one more.",
  "You don't need a miracle. You need a nap.",
  "The olives are not a test of faith.",
  "Keep your eyes on me, not everyone else's plate.",
  "Love is patient. Especially when the kitchen is backed up.",
  "You call it comfort food. I call it ministry.",
  "Nobody ever argued their way into peace.",
  "The bread may be unleavened, but the conversation shouldn't be.",
  "Let's turn awkward silence into gratitude.",
  "Even miracles pause for dinner.",
  "Your server deserves kindness.",
  "Good food. Good company. That's a pretty good start.",
  "Every meal is a chance to reconnect.",
  "Some people collect followers. I collected disciples.",
  "If the fish has eyes, don't make eye contact.",
  "The best seasoning is gratitude.",
  "I can forgive a lot. Maybe not pineapple on fish.",
  "Let's keep the commandments and pass the potatoes.",
  "The kingdom grows one conversation at a time.",
  "Nobody gets holier by skipping dinner.",
  "It's hard to be angry with a biscuit in your hand.",
  "Joy pairs well with every entrée.",
  "The shortest prayer: Thank You.",
  "A full heart beats a full plate.",
  "If you're counting blessings, count dessert too.",
  "Let's not make dinner more complicated than salvation.",
  "Some of you need seconds. Some need patience.",
  "Hospitality is love wearing an apron.",
  "Heaven's RSVP list is still open.",
  "Don't mistake busy for fruitful.",
  "Share the bread. Share the story.",
  "A grateful meal is a blessed meal.",
  "If nobody laughs, tell Peter another fishing joke.",
  "Sometimes the answer is prayer. Sometimes it's tacos.",
  "Don't let your soul get as empty as your glass.",
  "A meal shared is a burden divided.",
  "Every table can become sacred ground.",
  "Nobody remembers who was right. They remember who was kind.",
  "Bring your questions. Leave your pride.",
  "Peace goes great with roasted vegetables.",
  "I came that you may have life — and maybe dessert.",
  "Faith, hope, love, and warm bread.",
  "If you can't love your neighbor, start with passing the salt.",
  "Heaven has no waiting list.",
  "You are what you repeatedly order.",
  "The table is where strangers become friends.",
  "A grateful heart never leaves hungry.",
  "If I can forgive Peter, you can forgive your brother-in-law.",
  "Every dinner is a chance for a new beginning.",
  "Let's fill hearts before plates.",
  "The menu changes. Grace doesn't.",
  "I turned water into wine. What have you done with your Tuesday?",
  "I turned over tables once. Don't test me.",
  "I'm omniscient. Yes, I saw that.",
  "I had 12 disciples and one was an accountant. I understand complicated relationships.",
  "I made the entire universe in 6 days. I think you can make it to dinner.",
  "Thomas doubted me to my face. We worked it out. Bring your questions.",
  "Zacchaeus climbed a tree just to see me. You opened an app. I'll take it.",
  "I had no wifi, no smartphone, and still reached billions. Just saying.",
  "The Pharisees had theology degrees and still missed it. Don't overthink this.",
  "I rode into Jerusalem on a donkey. I'm not too proud for humble entrances.",
  "My mom told the servants to do whatever I said at a wedding. Moms always know.",
  "The disciples fell asleep while I was praying. I get it. Life is exhausting.",
  "I know every hair on your head. Yes, including the ones in the drain.",
  "My disciples argued about who was greatest. Even I rolled my eyes a little.",
  "I was born in a barn. I have zero standards for where we meet.",
  "The wise men brought gold, frankincense, and myrrh. You brought yourself. Good enough.",
  "I told the disciples to let the children come to me. Adults overcomplicate everything.",
  "I told the rich young ruler what he needed to hear, not what he wanted. I still do that.",
  "I made the Pharisees very uncomfortable. That was not accidental.",
  "I said my yoke is easy and my burden is light. You've been carrying the wrong things.",
  "I asked the paralyzed man if he wanted to be healed. Sometimes you have to want it.",
  "I said ask and it shall be given. You haven't asked lately.",
  "I sent the disciples out two by two. Even I knew nobody should do this alone.",
  "I rode a donkey into a city that would kill me five days later. I knew. I came anyway.",
  "I said it is finished and meant it. Stop trying to earn what I already paid for.",
]

const INSPIRATIONAL = [
  "You made it. That's enough for tonight.",
  "I saved you a seat. I always do.",
  "Come as you are. We can work on the rest later.",
  "I've been looking forward to this all day.",
  "Whatever today cost you — you're still standing. That matters.",
  "The fact that you opened this? That was Me.",
  "You didn't come this far to only come this far.",
  "I didn't bring you through that to leave you here.",
  "I'm not interested in your highlight reel. Just you.",
  "The version of you that you're hiding? That's who I came for.",
  "You've been trying to carry that alone again, haven't you.",
  "What would you do tonight if you actually believed I was with you?",
  "I know. Sit with me anyway.",
  "Grief is just love with nowhere to go. I'll hold it with you.",
  "You're not too far gone. I don't have a 'too far gone.'",
  "I see the person you're becoming. Keep going.",
  "Your story isn't over. I'm still writing it.",
  "The darkness you're sitting in right now? I invented light.",
  "I knew you before you were born. I haven't changed my mind about you.",
  "You are not a mistake. You are not an accident. You are not forgotten.",
  "The enemy has been lying to you. I came to tell you the truth.",
  "Rest tonight. I'll be up. I don't sleep.",
  "I go before you. Whatever is coming — I'm already there.",
  "You've been strong for everyone else. It's okay to need Me.",
  "The thing you're ashamed of — I already handled it. Come to the table.",
  "I collected your tears. Every one of them counted.",
  "The prayers you prayed in the dark? I heard every single one.",
  "I work all things together. Even this. Especially this.",
  "You are worth more than you believe right now. That's not your voice talking.",
  "I have plans for you. Good ones. Not finished yet.",
  "The cross was the worst day in history. I turned it into the best. Trust the process.",
  "I am making all things new. That includes you.",
  "Fear is a liar. I am not.",
  "You don't have to figure it out tonight. Just come to the table.",
  "I am the same yesterday, today, and forever. You can count on that.",
  "Your faith doesn't have to be big. A mustard seed moved mountains.",
  "I specialize in impossibilities. Bring me yours.",
  "The road is long. I walk it with you. Every step.",
  "You are seen. You are known. You are loved. Full stop.",
  "I didn't create you to be ordinary. Stop settling.",
  "The battle you're fighting? It's already won. Walk in that.",
  "I called you chosen before you chose Me. That's how this works.",
  "Your weakness is not disqualifying. It's where My strength shows up.",
  "I am close to the brokenhearted. If that's you tonight — I'm right here.",
  "You were made for more than survival. I came to give you life abundantly.",
  "The storm is not the end of your story. I'm in the boat with you.",
  "I know the plans I have for you. They are good. Hold on.",
  "You don't have to perform for Me. This isn't an audition.",
  "I love you with an everlasting love. Not a situational one.",
  "The mountain in front of you is not bigger than the One behind you.",
  "I am your refuge. You can stop running.",
  "The wait is not wasted. I am working in the waiting.",
  "You are my masterpiece. Still in progress. Still a masterpiece.",
  "I came so you could have life — and have it to the full. Are you living full?",
  "Nothing can separate you from my love. Nothing. Read that again.",
  "I am the Good Shepherd. I know my sheep. I know you.",
  "Your past does not define your future. I do.",
  "I restore what the enemy destroys. Give me the broken pieces.",
  "You are not alone tonight. You have never been alone.",
  "I am the God who sees you. Right here. Right now.",
  "The anchor holds. Even in this storm.",
  "I have overcome the world. That means this too.",
  "Your name is written on my hands. I don't forget.",
  "I am working even when you can't see it. Especially then.",
  "You were built for this season. I don't make mistakes.",
  "The light at the end of the tunnel is Me. Keep walking.",
  "I give peace that the world cannot give. It's yours if you want it.",
  "Cast your anxiety on Me. I can handle it.",
  "I am your strength when yours runs out. You don't have to white knuckle it.",
  "Draw near to Me and I will draw near to you. That's a promise.",
  "I am the author of your story. The best chapters are still ahead.",
  "Your family at this table tonight — that's not an accident. I arranged it.",
  "I collect the broken and make them beautiful. You qualify.",
  "The enemy meant it for evil. I mean it for good. Watch.",
  "I am patient with you. Be patient with yourself.",
  "You are running a race. Don't quit before the finish line.",
  "I am your Father. Not a distant one. A close one.",
  "The Holy Spirit lives in you. You have everything you need.",
  "I delight in you. Not your performance. You.",
  "I called you friend. Let that sink in.",
  "You are the light of the world. Stop hiding under a bowl.",
  "I am the vine. Stay connected. Everything else flows from that.",
  "Your prayers move things. Don't stop.",
  "I have not given you a spirit of fear. That's not from Me.",
  "I am your peace. Not your circumstances — Me.",
  "The joy of the Lord is your strength. Let that in tonight.",
  "I am enough. When nothing else is — I am.",
  "You were chosen. Redeemed. Adopted. Loved. Act like it.",
  "I am the resurrection and the life. Death is not the end of anything.",
  "I said it is well. Even when it doesn't feel like it — it is well.",
  "You are held. Right now. In this moment. Held.",
  "I am faithful even when you aren't. That's the deal.",
  "The table is set. The seat is yours. I've been waiting.",
  "I came for the lost, the last, and the least. Whoever you feel like tonight — you're covered.",
  "You matter to the Kingdom. Don't let anyone tell you otherwise.",
  "I go before you and I am your rear guard. You are surrounded — by Me.",
  "Tonight at this table, something is happening that matters for eternity. Don't rush it.",
  "I love you. Not because of what you do. Because of who you are. Mine.",
  "I'm still at the door knocking. I've got nowhere else to be.",
  "Come back tomorrow. I've got something to say to you.",
]

function getDayKey() {
  const now = new Date()
  return `dwj_seen_${now.getFullYear()}_${now.getMonth()}_${now.getDate()}`
}

export function hasSeenTodaysScene() {
  try {
    return sessionStorage.getItem('dwj_seen_this_session') === 'true'
  } catch (e) { return false }
}

function markSeenToday() {
  try {
    sessionStorage.setItem('dwj_seen_this_session', 'true')
  } catch (e) {}
}

function getShuffledPool() {
  const funny = [...FUNNY].sort(() => Math.random() - 0.5)
  const inspo = [...INSPIRATIONAL].sort(() => Math.random() - 0.5)
  const pool = []
  const max = Math.max(funny.length, inspo.length)
  for (let i = 0; i < max; i++) {
    if (i < funny.length) pool.push(funny[i])
    if (i < inspo.length) pool.push(inspo[i])
  }
  return pool
}

// Pick one message for today — same one all day, new one tomorrow
function getTodaysMessage() {
  try {
    const poolKey = 'dwj_msg_pool'
    let pool = []
    try {
      const storedPool = localStorage.getItem(poolKey)
      pool = storedPool ? JSON.parse(storedPool) : []
    } catch (e) { pool = [] }

    if (pool.length < 1) {
      pool = getShuffledPool()
    }

    const msg = pool[0]
    const remaining = pool.slice(1)
    localStorage.setItem(poolKey, JSON.stringify(remaining))
    return msg
  } catch (e) {
    return FUNNY[0]
  }
}

export default function KendylScene({ onEnter }) {
  const [typed, setTyped] = useState('')
  const [showCursor, setShowCursor] = useState(true)
  const [typingDone, setTypingDone] = useState(false)
  const [visible, setVisible] = useState(false)
  const [msgData, setMsgData] = useState(null)

  useEffect(() => {
    const msg = getTodaysMessage()
    setMsgData({ text: msg })
    const fadeTimer = setTimeout(() => setVisible(true), 100)
    const typeTimer = setTimeout(() => typeMessage(msg), 1200)
    return () => { clearTimeout(fadeTimer); clearTimeout(typeTimer) }
  }, [])

  function typeMessage(text) {
    let i = 0
    const speed = Math.max(25, Math.min(55, 1800 / text.length))
    const interval = setInterval(() => {
      setTyped(text.slice(0, i + 1))
      i++
      if (i >= text.length) {
        clearInterval(interval)
        setTypingDone(true)
        setTimeout(() => setShowCursor(false), 1800)
      }
    }, speed)
  }

  function handleEnter() {
    markSeenToday()
    setVisible(false)
    setTimeout(() => onEnter(), 400)
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-end',
      zIndex: 9999,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.4s ease',
    }}>

      {/* Jesus image */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <img
          src="https://flippingtables.ai/jesus-at-table.png?v=2"
          alt="Jesus at the dinner table, welcoming you"
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }}
        />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.75) 65%, rgba(0,0,0,0.95) 100%)',
        }}/>
      </div>

      {/* Content */}
      <div style={{
        position: 'relative', zIndex: 2, width: '100%', maxWidth: '480px',
        padding: '0 24px 48px', textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
      }}>

        {/* Option 1 tagline — always at the top */}
        <div style={{
          marginBottom: '4px',
          padding: '10px 20px',
          borderTop: '1px solid rgba(201,168,76,0.3)',
          borderBottom: '1px solid rgba(201,168,76,0.3)',
        }}>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: 'clamp(13px, 3.2vw, 16px)',
            color: '#F5E6C8',
            lineHeight: 1.7,
            margin: 0,
            letterSpacing: '0.01em',
          }}>
            One verse. One conversation. One prayer.
          </p>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: 'clamp(14px, 3.5vw, 18px)',
            color: '#C9A84C',
            fontStyle: 'italic',
            fontWeight: 'bold',
            lineHeight: 1.5,
            margin: '4px 0 0',
          }}>
            15 minutes that will change your family forever.
          </p>
        </div>

        <p style={{ fontFamily: 'Georgia, serif', fontSize: '11px', color: 'rgba(201,168,76,0.85)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
              Matthew 18:20
            </p>
            <p style={{ fontFamily: 'Georgia, serif', fontSize: '13px', color: 'rgba(201,168,76,0.85)', fontStyle: 'italic', lineHeight: 1.6, margin: 0, maxWidth: '320px' }}>
              "For where two or three gather in my name, there am I with them."
            </p>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(18px, 4.5vw, 24px)', color: '#F5E6C8', fontStyle: 'italic', lineHeight: 1.55, minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {typed ? <span>"{typed}{showCursor && <span style={cursorStyle}/>}"</span> : <span style={cursorStyle}/>}
            </div>
            <button
              onClick={handleEnter}
              style={btnStyle(typingDone)}
              onMouseEnter={e => { if (typingDone) { e.target.style.background = '#C9A84C'; e.target.style.color = '#0D1829' } }}
              onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = '#C9A84C' }}
            >
              Come to the Table
            </button>

        <p style={{ fontFamily: 'Georgia, serif', fontSize: '11px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', margin: 0, marginTop: '4px' }}>
          DINNER WITH JESUS · 1:10
        </p>
      </div>

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  )
}

const btnStyle = (active) => ({
  marginTop: '8px',
  background: 'transparent',
  border: '1px solid #C9A84C',
  color: '#C9A84C',
  fontFamily: 'Georgia, serif',
  fontSize: '15px',
  padding: '13px 40px',
  borderRadius: '4px',
  cursor: active ? 'pointer' : 'default',
  letterSpacing: '0.06em',
  opacity: active ? 1 : 0,
  transform: active ? 'translateY(0)' : 'translateY(8px)',
  transition: 'opacity 0.5s ease, transform 0.5s ease, background 0.2s ease, color 0.2s ease',
  pointerEvents: active ? 'auto' : 'none',
})

const cursorStyle = {
  display: 'inline-block',
  width: '2px',
  height: '1.1em',
  background: '#C9A84C',
  marginLeft: '2px',
  verticalAlign: 'text-bottom',
  animation: 'blink 0.85s step-end infinite',
}
