export default function StoryPage() {
  return (
    <div className="screen" style={{ paddingTop: '1rem', paddingBottom: '3rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
        <div className="cross" style={{ width: 28, height: 28 }}></div>
        <div>
          <div style={{ fontFamily: 'Lora, serif', fontSize: '1.05rem', fontWeight: 600, color: 'var(--white)' }}>
            Our Story
          </div>
          <div style={{ fontSize: '11px', color: 'var(--gold)', letterSpacing: '0.08em' }}>1:10</div>
        </div>
      </div>

      {/* How to Use */}
      <div className="card card-gold" style={{ marginBottom: '1.5rem' }}>
        <span className="section-label">How to Use This App</span>

        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold)', marginBottom: '0.25rem' }}>🏠 Home</p>
          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, fontWeight: 300 }}>
            Start here every time. See who's at your table tonight, find a verse for this exact moment using the time feature, or tap how you're feeling for an instant Scripture and prayer.
          </p>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold)', marginBottom: '0.25rem' }}>🍽️ Table</p>
          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, fontWeight: 300 }}>
            The heart of the app. One verse, context that makes it human, and three questions calibrated to your faith level. Pray together. Write down what happened. The app succeeds when you put your phone down.
          </p>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold)', marginBottom: '0.25rem' }}>📓 Journal</p>
          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, fontWeight: 300 }}>
            Your personal record of what God has been saying at your table. Personal and family journals are separate. Write it down — you'll want it later.
          </p>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold)', marginBottom: '0.25rem' }}>⚙️ Settings</p>
          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, fontWeight: 300 }}>
            Create or join your family Circle. Set your faith level. Choose your Bible translation. Share your invite code with family so everyone's at the same table.
          </p>
        </div>

        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold)', marginBottom: '0.25rem' }}>🕐 Your Verse for This Moment</p>
          <p style={{ fontSize: '13px', color: 'var(--silver)', lineHeight: 1.7, fontWeight: 300 }}>
            Look at the clock. Tap the button. Every chapter and verse matching that exact time across all 66 books of the Bible appears. God has been speaking through numbers long before any of us were paying attention.
          </p>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '0.5px', background: 'var(--border-gold)', opacity: 0.3, marginBottom: '1.5rem' }} />

      {/* Story title */}
      <p style={{ fontFamily: 'Lora, serif', fontSize: '1.1rem', fontWeight: 600, color: 'var(--white)', marginBottom: '1.5rem', textAlign: 'center' }}>
        The Story Behind Dinner with Jesus
      </p>

      {/* Opening */}
      {section(null, `My name is Steve. I'm an alcoholic in recovery.\n\nNot "was." Alcoholism doesn't have a past tense. It's one drink away from taking everything you've built. It kicked my ass for years — years I can't get back. I wasn't living under a bridge, but I was losing. My family. Myself. The person God made me to be.\n\nOn May 8, 2022, I checked into rehab. Best decision I ever made. Second hardest day of my life.\n\nThe hardest came 28 days later.`)}

      {section("Maddie", `My daughter Madison — we called her Maddie — died on June 5, 2022. She was 25.\n\nShe had her own battle with addiction. Wrong crowd. A hard life I couldn't pull her back from no matter how hard I tried. One night — a stolen van, a dog she loved, a gunfight — and she was gone. Shot on a street in San Antonio.\n\nI couldn't save her. That's something a father carries forever.\n\nBut I made a choice. I would honor her by staying sober, telling my story, and making sure her life meant something beyond the way it ended.\n\nMaddie leaves me dimes.\n\nIn parking lots. On sidewalks. In the oddest places — exactly when I need to know I'm on the right path. When the doubt creeps in and the weight gets heavy, there's a dime. On the worst days. At the exact right moment. It's not coincidence. Nothing about this journey has been coincidence.`)}

      {section("The Rescue", `My sponsor saved my life.\n\nHe walked me through the Steps. Sat with me in the darkest nights when I didn't know how to keep going. Never flinched. Never gave up on me. He told me two things I will never forget:\n\n"Stay sober and tell your story."\n\nAnd later, deep in the grief: "Your story is going to save lives."\n\nHe brought me back to the church through an ACTS retreat. I grew up attending Our Lady of Perpetual Help in Oakland, New Jersey. I have always believed, but like many of us, I was a lukewarm Christian. Going through the motions and leading a sinful life.\n\nAttending that ACTS retreat changed my life — the one that cracked me open and put me back together. ACTS was founded at a church in San Antonio called Our Lady of Perpetual Help.\n\nSame name. Different city. Thirty years apart.\n\nThat's not a coincidence. That's a breadcrumb. God leaving a trail back to Himself for a man who'd been running in the wrong direction for a very long time.\n\nA room full of brothers met me right where I was — broken, grieving, and searching. We were strangers who became family in four days. They guided me through forgiveness I didn't think I deserved. Hope I couldn't see. Faith that slowly, stubbornly, became the foundation of everything I've built since. We still talk through a group chat full of men who refuse to let each other drift.\n\nThen Jesus took over. And nothing has been the same since.`)}

      {section("The Numbers", `I was in the middle of a tough season — trying to figure out my purpose, searching for the direction God was trying to lead me. I pulled into Buc-ee's just to cool down — get out of the truck, get out of my head.\n\nI got back in. Looked at the clock: 1:00. Looked at the temperature: 100°.\n\nThen 1:01 — 101°.\nThen 1:02 — 102°.\nThen 1:03 — 103°.\nThen 1:04 — 104°.\n\nMinute by minute. Degree by degree. I caught it on camera.\n\nI don't hear God in a loud voice. I never have. He speaks to me in feelings and in numbers — a language He built specifically for the way my mind works. In that truck, in that parking lot, on one of the hardest days of that season, He was saying: I see you. I'm with you. It's going to be okay.\n\nThat's why the time verse feature exists in this app. Look at the clock. Open the verse. See what He has to say to you right now — because He's been saying things in the numbers long before any of us were paying attention.`)}

      {section("Mandy", `God brought Mandy into my life through a Christian dating site — which tells you everything about her and where I was spiritually by that point.\n\nShe came in during the rebuilding. Through the grief, through a hard season of searching for purpose and direction, through all of it. She's been my rock. She picks me up when I need it. She kicks my ass when I need that more. She walks beside me every single day as we build our faith and future together — toward Jesus, side by side. She puts up with a lot. She does it with grace, strength, and the occasional eye roll.\n\nMy addictive personality is in constant pursuit of perfection. The unattainable is always in sight — never quite realized. My therapist calls it a gift. My sponsor calls it exhausting. Mandy just shakes her head, hands me tea, and gets out of the way.\n\nIn the middle of everything, she found Colossians 1:10.\n\n"That ye might walk worthy of the Lord unto all pleasing, being fruitful in every good work, and increasing in the knowledge of God."\n\nShe handed it to me without a word. That verse became our mission. Our calling. Our purpose. Everything we build traces back to that moment — a woman who loved a broken man enough to hand him the one verse he needed.\n\nThat's where the name comes from. OneTen Group. One represents Jesus — the One. Ten represents the dimes Maddie leaves behind. A cross appears in every logo we build. The signature 1:10 runs through everything. It's not branding. It's a promise. It's her.`)}

      {section("The Fear That Drives Me", `Matthew 7:23 keeps me up at night.\n\n"And then will I profess unto them, I never knew you: depart from me, ye that work iniquity."\n\nThat's my biggest fear. Not failure. Not loss. Not relapse. Standing before God one day and hearing those words. So I keep going. Keep building. Keep introducing Jesus to as many people as I can — because He is the only way. I refuse to be ashamed of that.\n\nRomans 1:16. We are not ashamed.`)}

      {section("The Community", `None of this happened alone.\n\nMy sponsor. AA brothers. Church brothers who became family at a retreat and never stopped showing up. A street preacher who stopped me in my tracks at exactly the right moment. A restaurant owner who puts scripture on his menus and doesn't apologize to a single soul about it. Mandy and Kendyl — our daughter — who was 14 years old when she had a vision that became the heart of this entire app.\n\nEvery single one of them had a part in this. That's not coincidence — that's God assembling a team.\n\nWe cannot do this alone. None of it.`)}

      {section("Kendyl's Vision", `Kendyl saw it before any of us did.\n\nJesus at a dinner table. Hand outstretched. Welcoming you in. Not a church Jesus. Not a stained-glass Jesus. A real one — sitting at a real table, looking you in the eye, glad you came.\n\n"For where two or three gather in my name, there am I with them."\n— Matthew 18:20\n\nThat's the first thing you see when you open this app. A 14-year-old saw it and we built it. Every time you open it, He has something to say to you. Something real. Sometimes serious. Sometimes funny. Sometimes exactly what you didn't know you needed.\n\nCome back tomorrow. See what He says next.`)}

      {section("The App", `My therapist told me to honor Maddie by staying sober and telling her story. My sponsor told me my story would save lives. My church brothers walked me toward forgiveness and hope I didn't deserve. Mandy has carried me through the toughest seasons of my life always knowing what to say. She is truly my best friend and my entire world. I am forever grateful God has brought her into my life. Kendyl had the vision. Watching her faith grow daily is a true blessing. She is an amazing young lady and I am so proud of her. I am honored and humbled that she calls me Dad.\n\nSo we built this at the dinner table.\n\nDinner with Jesus is our way of giving back. Of honoring Maddie. Of spreading what saved us. Of introducing Jesus to as many people as we can — one dinner table at a time.\n\nThe app succeeds when you put your phone down. No streaks. No shame. No performance. Just a real conversation with the people sitting across from you, anchored in something that matters.\n\nThis table was built for everyone. The ones solid in their faith. The ones still finding their way. And especially the ones who think they've gone too far to come back.\n\nYou haven't. Pull up a chair.`)}

      {/* Closing verse */}
      <div className="card card-gold" style={{ textAlign: 'center', marginTop: '0.5rem' }}>
        <p style={{ fontFamily: 'Lora, serif', fontSize: '14px', fontStyle: 'italic', color: 'var(--silver)', lineHeight: 1.8, marginBottom: '0.5rem' }}>
          "That ye might walk worthy of the Lord unto all pleasing, being fruitful in every good work, and increasing in the knowledge of God."
        </p>
        <p style={{ fontSize: '13px', color: 'var(--gold)', marginBottom: '1rem' }}>Colossians 1:10</p>
        <p style={{ fontFamily: 'Lora, serif', fontSize: '15px', color: 'var(--white)', marginBottom: '0.25rem' }}>
          The table is set. You are welcome here.
        </p>
        <p style={{ fontSize: '12px', color: 'var(--silver)', fontStyle: 'italic' }}>— Steve, Mandy & Kendyl</p>
      </div>

      {/* OneTen credit */}
      <div style={{ textAlign: 'center', marginTop: '1.5rem', paddingBottom: '1rem' }}>
        <p style={{ fontSize: '12px', color: 'var(--silver)', opacity: 0.6, lineHeight: 1.8 }}>
          Built with purpose by{' '}
          <a href="https://onetengroup.ai" target="_blank" rel="noreferrer" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
            OneTen Group
          </a>
          {' '}· flippingtables.ai · 1:10
        </p>
        <p style={{ fontSize: '11px', color: 'var(--silver)', opacity: 0.4, marginTop: '0.25rem' }}>
          Colossians 1:10 · Romans 1:16
        </p>
      </div>

    </div>
  )
}

function section(title, body) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {title && (
        <p style={{ fontFamily: 'Lora, serif', fontSize: '1rem', fontWeight: 600, color: 'var(--gold)', marginBottom: '0.75rem' }}>
          {title}
        </p>
      )}
      {body.split('\n\n').map((para, i) => (
        <p key={i} style={{
          fontSize: '14px',
          color: para.startsWith('"') ? 'var(--cream)' : 'var(--silver)',
          lineHeight: 1.8,
          fontWeight: 300,
          marginBottom: '0.75rem',
          fontStyle: para.startsWith('"') ? 'italic' : 'normal',
          fontFamily: para.startsWith('"') ? 'Lora, serif' : 'inherit',
          whiteSpace: 'pre-line'
        }}>
          {para}
        </p>
      ))}
    </div>
  )
}
