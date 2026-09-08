# Dinner With Jesus — Editorial Standard

**Status:** Documentation only. This file records the editorial rules established through the Batch 01 draft, its revision ("Editorial Pass 2"), and Batch 02 (locked). It makes no changes to `public.dinner_verses` or any other production system. It is the reference future content work (Batch 03 onward) should be measured against.

**Source documents:** `docs/DWJ_CURRENT_CONTENT_LIBRARY.md` (audit of the existing 119 active dinners), `docs/DWJ_300_CONTENT_MAP.md` (the full expansion plan), `docs/DWJ_2_CONTENT_BATCH_01.md` (the first drafted batch and its revision report), `docs/DWJ_2_CONTENT_BATCH_02_JESUS.md` (locked). This document consolidates what those established into one durable standard — it doesn't replace them.

---

## 1. Purpose

Dinner With Jesus is not building 300 miniature Bible studies. It is building **300 conversations families will remember** — nights when something meaningful might actually happen around a dinner table.

The experience is **One Verse. One Conversation. One Prayer.**

**DWJ is not trying to make every dinner profound. It is trying to make every dinner worth having.** Some nights are light. Some are funny. Some are heavy. A 300-dinner library that is uniformly intense is not the goal, and neither is one that's uniformly safe. Range is the goal.

---

## 2. What "One Verse" Means

"One Verse" means **one focused Scripture reading** — it may be a single verse or a short passage. It is not a rule that every dinner must be exactly one numbered verse.

The standard for passage selection:

> **The shortest complete Scripture passage that gives the table enough of God's Word to understand and honestly wrestle with what is being discussed.**

- Never truncate Scripture merely to force a dinner into one numbered verse.
- Never isolate a sentence in a way that changes its meaning.
- Include enough Scripture to understand what's happening — no more, no less.
- Every question in a dinner must be grounded in Scripture actually displayed. "A Little Context" must never substitute for Scripture that should have been included instead.

*Example of this rule in practice: Batch 01 expanded three existing single-verse dinners (Mark 9:24 → 9:21-24; Psalm 34:18 → 34:17-18; Luke 15:20 → 15:17-24) specifically because the single verse had been isolated from the exchange or narrative moment that gave it meaning.*

---

## 3. Scripture Requirements

- **The complete selected passage must always be displayed**, in full, exactly as written. The person holding the phone must be able to read the whole thing aloud directly from the app.
- **Translation: World English Bible (WEB).** Confirmed public domain (verified independently, not assumed) — no licensing exposure. KJV is the only other translation with real data in this app and is also public domain. **Do not silently switch translations.** NIV/NLT/ESV/NKJV are commercially licensed and require a separate legal review before any of their text is used — this is a licensing decision, not a content decision, and it hasn't been made.
- **Pull Scripture text from the app's own `bible_verses` table (or an equally reliable WEB source) rather than composing it from memory.** Batch 01 did this via read-only query specifically to guarantee word-for-word accuracy; this should stay the standard method going forward.

---

## 4. The Five-Part Structure

### A Little Context — Help Me Understand
Usually 2-3 sentences. Explain only what helps an ordinary person understand who's speaking, what's happening, what led to this moment, and cultural/biblical background genuinely necessary to follow along. **Do not preach the lesson before the table discusses it. Do not write a miniature sermon.**

Governing rule (added in Editorial Pass 2, and now the standard for every context box in the library):

> **Context must be boringly accurate. Questions can be provocative.**

Context must never present:
- disputed authorship as settled fact
- cultural or historical background as fact without reliable support
- historical reconstruction as though Scripture explicitly states it
- theological interpretation as though it were simply what the text says
- dramatic embellishment to make the setup more interesting

**When uncertain, simplify.** The Scripture and the conversation are powerful enough without embellishment. Anything that can't be stated plainly and defensibly should be cut, not softened into a hedge — see the Editorial Failure Modes section for real examples of claims that were removed entirely rather than qualified.

### For the Table Tonight — Open the Door
The accessible question. A teenager understands it immediately; no Bible expertise required; conversational, not academic; connects naturally to the passage; invites stories, opinions, laughter, memories, or simple honesty. Its one job: **get everybody talking.**

### Go Deeper — Make It Personal
Scripture turns the mirror toward us — choices, relationships, fears, habits, failures, hopes, resentment, pride, trust, avoidance, forgiveness, priorities, behavior, faith. It should invite honesty without forcing disclosure (see §5).

### Push Further — Wrestle With the Word
**DWJ's signature question**, and usually the strongest one of the three. It should pull people back to the actual Scripture they just read — tension in the passage, surprising wording, something Jesus does or doesn't do, an assumption being challenged, what the passage reveals about God, what it reveals about us, why Jesus asks something difficult, apparent paradox, grace versus truth, belief versus behavior, the cost of following Jesus, what would change if we genuinely believed what we just read.

Do not simply ask a third version of Go Deeper. **A teenager should understand the question. A mature Christian or pastor should still have to think about the answer.**

### Prayer — Close the Loop
One prayer for the whole table. It must arise naturally from **the Scripture + what was just discussed + how we want God to help or change us.** Plainspoken, sincere, specific to that night's Scripture, not overly long. **Prayers must pray, not preach** — a prayer that's really a sermon addressed to the ceiling instead of to God is a failure mode, not a style choice.

`prayer_level_2`/`prayer_level_3` source material from the existing library may be consulted when revising an existing dinner, but this is **one prayer per dinner** — there is no restoration of per-viewer or per-tier prayer selection.

---

## 5. Never Force Vulnerability

DWJ should create conditions where people *want* to open up. It must never pressure someone — especially a teenager, a guest, someone in recovery, someone grieving, or a struggling family member — to disclose something private at the table.

Avoid any question that is effectively asking:
- What haven't you told anyone?
- What secret are you carrying?
- What addiction do you have?
- What trauma haven't you discussed?
- Confess something to the table.

**People must always have room to answer at the depth they choose.** A question should be answerable safely and honestly by someone with nothing serious going on, *and* by someone carrying something heavy — without the question itself forcing them to reveal which one they are.

*Real example: Batch 01's original Go Deeper for John 8:34-36 asked what "has more control over you than you'd want to say out loud" — effectively daring a disclosure. The revised version asks about a pattern "you've tried to muscle through alone instead of letting anyone help you with," which a person can answer honestly about something small or something serious without the question demanding to know which.*

---

## 6. Text vs. Interpretation

Distinguish, in both the context and the questions, between **what the passage says** and **a reading of what it might mean**. An interpretive claim — even a well-supported, common one — should be phrased as an observation or a question, not asserted as the passage's plain meaning.

*Real example: Batch 01's original Push Further for Mark 9:21-24 stated as fact that Jesus relocates the father's "if" from his own ability to the father's belief. The revision keeps the same insight but frames it as something to trace and notice ("watch where the word 'if' moves... whether or not that's exactly what's happening"), not a settled reading.*

---

## 7. Don't Tell the Table What the Tension Means

When a passage holds a real tension — grace and truth, mercy and justice, forgiveness and cost — the job of the context box and the questions is to put that tension in front of the table, not to resolve it for them before they've talked. If Push Further explains what the tension *means*, there's nothing left to wrestle with; the table is just being told the answer in question form. Name the tension. Let the table sit in it.

*Real example: Batch 02's original Push Further for Luke 7:36-50 asserted a specific causal reading — "she loved much because she'd already been forgiven much" — as settled fact. The revision states what the passage actually says (forgiveness and great love appear together, in that order) and then asks the table what they think Jesus wants Simon to understand about the relationship between the two, rather than delivering the conclusion itself.*

---

## 8. Don't Assign Unstated Motives

Never give Jesus — or any biblical person — a thought, feeling, or intention that Scripture doesn't actually assign to them. "He touched him because..." or "she came at night because..." should only appear when the text says so directly, or the claim is clearly and visibly marked as a guess the table is free to disagree with. This is a stricter, more specific version of §6 (Text vs. Interpretation): it's not just that interpretive claims need hedging — motive-claims about a real person's inner life need the highest bar of all, because they're the easiest kind of claim to state confidently and be simply wrong about.

---

## 9. Some Questions Should Follow People Home

Not every dinner needs to resolve. A question that's still being turned over in someone's head three days later has done its job — closure is not the goal, engagement is. Resist the urge to round off a Push Further with a tidy takeaway just because the conversation is ending; some of Scripture's own tensions were never resolved for the reader either, and a dinner that respects that is doing something more honest than one that manufactures a bow.

---

## 10. Cultural and Historical Claims

Any claim about the culture, customs, or history behind a passage that is **not stated in the text itself** needs either a reliable source or removal. There is no third option of leaving it in unsourced because it's commonly taught or sounds right.

- If the text already carries the point on its own, prefer the text over the added color.
- If a claim can't be verified to production standard in the time available, cut it — don't hedge it with "probably" or "likely" and leave it in.

*Real example: Batch 01's original context for Luke 15:17-24 asserted that a father running in public was culturally undignified and would require hiking up his robe — a real, commonly-taught point in Middle Eastern cultural-background scholarship, but not sourced to production standard and not stated in the text. It was removed outright, not softened, and replaced with what the passage itself already says: the father saw him "while he was still far off" and was already running before the son said a word. The dinner was not weaker for the cut.*

---

## 11. Jesus-Centered, Not Jesus-Forced

The expanded library should substantially strengthen direct engagement with what Jesus said and did, how he treated broken people, who he spent time with, what he challenged, what he taught about God and about people, forgiveness, money, enemies, prayer, hypocrisy, service, sacrifice, faith, doubt, suffering, discipleship, the cost of following him, and his death and resurrection.

**Do not artificially force a Jesus connection into every Old Testament or Epistle passage.** Some dinners are about God the Father, or about human nature, or about wisdom for living, without needing a Jesus tie-in bolted on. The library as a whole should unmistakably lead people toward knowing and following Christ — that's a property of the collection, not a requirement of every individual entry.

---

## 12. Scripture Isn't Always About Us

Avoid reducing every passage to "what does this do for me?" Some dinners should turn outward instead:

- What does this reveal about God?
- Who is Jesus showing himself to be?
- Why does God care about this?
- Why would Jesus command this?
- What does following Jesus actually require here?
- What does this reveal about human nature in general, not just mine?
- What might we misunderstand about God from this passage?
- What would obedience actually look like?

---

## 13. Teenager-Accessible, Pastor-Worthy

Every dinner should clear this bar at every level, but especially at Push Further: **a teenager can understand the question; a mature Christian or a pastor still has to think about the answer.** Accessibility is not the same as shallowness — the goal is a question simple enough to enter and deep enough not to exit quickly.

Watch specifically for **adult-coded phrasing that a teenager could technically still answer but wasn't written with them in mind first** — this is a real, ongoing risk flagged (not fully resolved) in Batch 01's money-themed dinners, and worth deliberate attention whenever a topic (money, work, marriage) defaults to adult framing.

---

## 14. Emotional Range

Do not make 300 solemn devotionals. Across the library there should be dinners that make people laugh, think, debate, feel grateful, sit with healthy discomfort, consider an apology, expose pride, offer hope, help someone admit doubt, help someone forgive, make parents listen, make teenagers want to participate, help families understand each other, reveal something new about Jesus, and — occasionally — become deeply emotional.

Existing `humor_note` material may be used as source material where genuinely appropriate. **Do not force humor into serious subjects.** A lighter dinner (a short proverb, a simple practical question) is a legitimate and needed part of the range, not a lesser version of a "real" dinner — but it should be honestly light, not padded with manufactured depth to look equivalent to the heavier nights.

---

## 15. Difficult Subjects Require Real Hope, Not Simplistic Promises

Grief, death, suffering, addiction and recovery, doubt, and similar hard subjects must be handled with **theological hope that respects lived reality** — not simplified into promises the text doesn't make and life doesn't confirm.

Concretely, for recovery/addiction content specifically: freedom in Christ is real, but do not imply that it necessarily means cravings vanish instantly, treatment becomes unnecessary, accountability becomes unnecessary, recovery becomes effortless, relapse risk disappears, or that someone who still struggles isn't "really" free. A prayer or Push Further that promises "not partway, not managed, free" without qualification is overpromising in a way that can do real harm to a family with someone in active recovery.

*This is not a hypothetical concern — it's the single most substantial content rewrite in Batch 01. See the Editorial Failure Modes section.*

---

## 16. Avoid Repeated Rhetorical Patterns

A single author's voice will naturally develop tics; across 300 dinners those tics become obvious and cheapen the effect. Watch specifically for:

- Repeated prayer openers (e.g., a run of prayers all starting "God, thank you for...")
- Repeated Push Further constructions (e.g., "What does this reveal about God/Jesus that..." or "What's the difference between X and Y" used more than 2-3 times across a batch)
- Repeated contrastive sentence patterns (e.g., "Not X — Y") — this is the specific tic identified in the *existing* library's `prayer_level_2`/`prayer_level_3` content; it must not carry forward into new writing even when that old material is used as source content
- Questions that could be attached to almost any verse, regardless of which one is actually being discussed
- Push Further that is really just a third version of Go Deeper

Do a **global read of the whole batch together**, not just each dinner in isolation, before finalizing — several of these patterns are invisible dinner-by-dinner and only show up once you read all twenty (or all three hundred) back to back.

---

## 17. The Quiet Person Must Have Room

Every question — especially For the Table Tonight and Go Deeper — should be answerable by someone who wants to say one honest sentence and pass, not just by someone ready to hold forth. A dinner that only works if everyone at the table is emotionally expressive isn't ready.

---

## 18. The Final Test

Above every other rule, for every dinner, ask:

> **Would this create a conversation worth putting the phones down for?**

If not, it isn't ready — no matter how theologically sound or well-worded it is.

Supporting checks that feed into that final test:
1. Would an ordinary family actually want to answer this at dinner?
2. Can the quiet person participate without being put on the spot?
3. Does each question genuinely move deeper than the last?
4. Does Push Further make us wrestle with the Scripture we just read?
5. Could a teenager understand it while a pastor still finds something worth discussing?
6. Could this conversation teach us something meaningful about God, Jesus, ourselves, or each other?

---

## 19. Calibration References

Dinners from Batch 01 and Batch 02, after revision, that meet this standard and are worth using as a north star for tone, depth, and structure in future batches. Full text lives in `docs/DWJ_2_CONTENT_BATCH_01.md` and `docs/DWJ_2_CONTENT_BATCH_02_JESUS.md` — not duplicated here.

- **Mark 9:21-24 — "Bring Jesus Your Doubt Too."** Doubt handled without demanding a confession; the Push Further reads the actual dialogue instead of asserting a conclusion about it.
- **Luke 15:17-24 — "The Father Ran."** A case study in letting the plain text carry the weight instead of added cultural color — the dinner got stronger, not weaker, when the unsupported claim was removed.
- **John 8:3-11 — "Grace Without Stones."** Holds truth and grace in real tension without collapsing into either "it didn't matter" or "she deserved it."
- **Luke 5:27-32 — "Dinner With Sinners."** The clearest example in the batch of a Push Further that turns outward (who did Jesus keep company with) before it turns inward (who would you rather not) — the right order, not the reverse.
- **John 8:34-36 — "Free Indeed."** The addiction/recovery standard-bearer specifically because it's the dinner that required the most editorial care, and now models §15 (real hope without a simplistic promise) directly.
- **Mark 10:17-22 — "The One Thing He Lacked" (Batch 02).** The clearest example anywhere in the library of §9 (some questions should follow people home) — the man walks away sad, and the dinner doesn't chase him down with a tidier ending than the text gives.
- **Mark 3:1-5 — "Grieved at Their Hardness" (Batch 02).** Real anger, paired with real grief, stated because the text states it — not softened, not embellished. The standard for §8 (don't assign unstated motives) done right: the emotion is quoted, not invented.

---

## 20. Editorial Failure Modes (caught in Batch 01 and Batch 02 — do not repeat these)

Concrete, not hypothetical. Each of these was actually drafted, actually caught, and actually fixed once already:

1. **Unsupported biographical/historical color added to make a setup more interesting.** ("The richest, wisest man who ever lived"; a specific unstated motive attributed to why a passage was written.) *Fix: state only what the text or reliable, cited background actually supports.*
2. **A cultural-background claim, common in sermons, presented as fact with no source.** (A father running being "undignified," requiring him to "hike up his robe.") *Fix: either source it or cut it — the plain text is usually strong enough alone.*
3. **A misplaced factual claim about a passage's occasion.** (Attributing a nearby conflict between two named people to a passage where they aren't actually mentioned.) *Fix: verify what's actually near the passage in the source text before asserting a connection, not just what's thematically plausible.*
4. **An interpretive reading stated as the text's plain meaning.** *Fix: phrase it as an observation or question, with room for another reading.*
5. **A Go Deeper question that effectively demands disclosure of something serious** (framed as "something you wouldn't want to say out loud"). *Fix: ask about the pattern or behavior in a way answerable at any depth, without the question itself implying a minimum severity.*
6. **A hopeful claim that overpromises against lived reality**, specifically on recovery/addiction content ("not partway, not managed, free," with no acknowledgment that real freedom can still include an ongoing fight). *Fix: real theological hope, stated honestly alongside the real, ongoing nature of recovery.*
7. **A guilt-toned prayer** ("we spend so much of each day chasing X before we ever get around to seeking you"). *Fix: lead with invitation, not accusation — a prayer should feel like being drawn toward something, not caught doing something wrong.*
8. **A generic opening question that would work equally well on several unrelated passages.** *Fix: ground the opener in something specific to the actual passage's content, not just its general topic.*
9. **Repeated prayer openers and repeated Push Further constructions invisible dinner-by-dinner, only visible reading the batch as one document.** *Fix: always do a full-batch read as a last pass, specifically hunting for repetition, before calling a batch finished.*
10. **An unverifiable frequency or superlative claim added for emphasis** ("one of the few moments the Gospels describe him that specifically"). *Fix: if it can't be checked against a concordance or reliable source in the time available, remove it — the underlying fact usually doesn't need the emphasis to land.*
11. **"What does it say about Jesus that..." (or a close variant) as the default Push Further construction**, found in half of Batch 02's first draft. *Fix: vary the shape — notice a specific textual detail and ask why it matters; ask "why do you think..."; ask what would change if the passage's logic were applied to the reader's own life — and reserve the "what does it reveal about Jesus" frame for the two or three dinners where it's genuinely the strongest fit, not the default for every one.*
12. **A causal theological claim stated as the passage's plain meaning, when the text only shows two things next to each other, not one explicitly causing the other** (Batch 02's original Luke 7:36-50 Push Further asserted "she loved much because she'd already been forgiven much" as settled fact). *Fix, and now its own standing rule — see §7: state what the passage actually shows, then ask the table what they think the relationship is, rather than resolving it for them.*
