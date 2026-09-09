# Dinner With Jesus 2.0 — Global Library Audit

**Status:** Documentation only. Read-only against production. No content activated, deactivated, or modified. No migrations. No app code touched. This audit examines the *projected* final library — 119 currently active production dinners plus Batches 01-08 — as it would exist if everything drafted so far were loaded, without actually loading anything.

**Method:** Every dinner from the 119 active production rows (via read-only query) and all 242 dinners across Batches 01-08 (parsed programmatically from their source documents, not re-typed by hand) were assembled into one structured dataset and analyzed with scripts, not by rereading 354 documents one at a time. Findings below are backed by exact counts, not impressions, except where a phase explicitly required editorial judgment (context accuracy, emotional tone, strongest/weakest).

---

## Canonical Count

**RESOLVED AND LOCKED: 354 unique active dinners.** Both collisions identified below have been confirmed as intentional upgrades/replacements. This is now the final canonical count — see `docs/DWJ_LIBRARY_TRACKER.md`. The reconciliation that produced it is preserved below for the record.

Starting point: 119 original active + 242 batch dinners (100 from Batches 01-06, 47 from Batch 07, 75 from Batch 08) = 361 raw entries.

Five upgrades were already known and documented (all Batch 01, all confirmed intentional in `DWJ_LIBRARY_TRACKER.md`):

| Existing (replaced) | Replacement |
|---|---|
| Mark 9:24 | Mark 9:21-24 |
| Psalm 34:18 | Psalm 34:17-18 |
| Luke 15:20 | Luke 15:17-24 |
| Ecclesiastes 4:9-10 | Ecclesiastes 4:9-10 (exact match) |
| Matthew 6:33 | Matthew 6:31-33 |

**Programmatic overlap detection surfaced two more collisions that were never caught during drafting or any prior batch's own duplication check:**

| Existing (active) | Colliding batch dinner | Shared verse |
|---|---|---|
| 2 Corinthians 5:7 (Faith) | Batch 08, Dinner 22 — "2 Corinthians 5:1, 6-8" | verse 7 appears in both |
| Luke 12:15 (Wisdom) | Batch 07, Dinner 33 — "Luke 12:13-15" | verse 15 appears in both |

Both are the exact same pattern already established and accepted for the other five (a batch dinner expanding a short existing verse into its fuller narrative/argumentative unit). Treating them consistently as upgrades — the least disruptive resolution, and the one the editorial standard's own §2 precedent supports — means:

**119 − 7 (replaced originals) + 235 (genuinely new) + 7 (replacement versions, embedded in the 242 batch dinners) = 354.**

**Resolved:** both confirmed as intentional upgrades, matching the treatment already given to the other five. Final library = **354**, locked. No further dinners will be drafted to reach 365 — the remaining 11-dinner gap is an accepted outcome of "quality overrides quantity," not an open task.

No other discrepancies were found in the count mechanics: zero exact duplicate verse_refs *within* the 242 batch dinners (checked programmatically), all 8 batches' dinner counts match their own reports exactly (20/20/20/20/20/20/47/75), and no inactive historical row was found mixed into the active count anywhere in this analysis.

---

## Critical Issues (must fix before production)

1. ~~Canonical count correction: 356 → 354.~~ **Resolved** — see above. Final canonical count is locked at 354 in `docs/DWJ_LIBRARY_TRACKER.md`.
2. ~~Psalm 100:1-2 (existing, Gratitude) has a genuine data defect, not just a weak conversation.~~ **Fixed and verified.** `verse_text` (id `0c854040-cbe2-47d5-809a-dff39c6743b4`) was truncated to only `"&gt; Shout for joy to Yahweh, all you lands!"` (verse 1, with a stray HTML-entity artifact) despite `verse_ref` claiming "1-2," and `question_level_2` referenced verse 2's "serving the Lord with gladness" content, which wasn't in the displayed text. Corrected via a single-field `UPDATE`, scoped by exact `id` and `verse_ref`, to the complete two-verse WEB text with the artifact stripped: `"Shout for joy to Yahweh, all you lands! Serve Yahweh with gladness. Come before his presence with singing."` Context, questions, prayers, category, and active status were untouched — they already correctly assumed verse 2's presence and are now consistent with what's actually displayed. Verified via an independent follow-up read after the update.

No other Critical Issues were found. No theological-harm pattern scan produced a genuine hit (see Theological/Harm Review below), and no other Scripture-integrity defect surfaced in the batch-authored content (all 242 batch dinners were sourced via read-only query against `bible_verses` at drafting time, not hand-typed).

---

## Important Issues (worth fixing before pastor pilot)

1. **Batches 03 and 04 have a materially higher concentration of "Is there...?" as a question opener than the rest of the library.** Library-wide, "Is there" appears in 81 of 354 dinners (22.9%) — but broken out by source, existing content sits at 10%, Batches 06-08 (after the pattern-audit discipline was introduced) sit at 0-16%, while **Batch 03 sits at 70% and Batch 04 at 65%**. These two batches predate the full-batch pattern-audit step that was added starting with Batch 06. This doesn't make either batch bad — the individual questions are still specific and well-grounded — but reading either batch back-to-back, a family would notice the repetition more than in any other batch. A light, targeted rewrite pass on Batches 03 and 04's Go Deeper questions (not a full rewrite) would bring them in line with the rest of the library.
2. **The existing Forgiveness category (9 dinners, all still active and untouched by any batch) has a documented internal repetition problem**, already flagged in the original content audit: 5 of 9 open with a close variant of "is there someone you haven't forgiven," and most resolve with "Christ forgave you first, so now you." Individually fine; noticeable back-to-back. No batch added to or touched this category, so it remains exactly as it was.
3. **A handful of existing dinners have Go Deeper / Push Further questions that are functionally the same question asked twice** (Matthew 18:20, Joshua 24:15, Ephesians 4:32, 1 Corinthians 13:4-5, Matthew 6:33 — though 6:33 is resolved by its Batch 01 upgrade, Proverbs 16:9, Acts 2:42). These are pre-existing, not introduced by this project; see Weakest Dinners below for the full list with reasoning already on record.

---

## Cosmetic Issues (do not block launch)

1. **Em-dash density is very high throughout the entire library — 97.7% of all 354 dinners contain at least one, averaging 2.85 per dinner.** This is a plausible "AI fingerprint" red flag on its face, but breaking it out by source shows the **existing, pre-project content already sits at 96%** — this is consistent with the app's established voice from before this project began, not something the new batches introduced or that makes them stand out as different. Worth knowing, not worth fixing.
2. **Prayer address terms skew toward "God" library-wide (43.2%, vs. Lord 20.6%, Jesus 19.2%, Father 14.7%)** — driven mostly by the existing 119 and Batches 01-05, which predate the address-balancing discipline introduced in Batch 06 onward (Batches 06-08 each land close to an even four-way split on their own). This is a natural skew for pre-existing Christian devotional writing, not a mechanical tell, and isn't concentrated enough anywhere to sound repetitive within a single sitting.
3. Zero exact-duplicate prayers found anywhere in the library.

---

## Duplicates / Overlap

Full classification per the requested A/B/C/D scheme:

**A — Accidental duplicate, fix required:**
- 2 Corinthians 5:7 (existing) vs. Batch 08 "2 Corinthians 5:1, 6-8" (verse 7 shared)
- Luke 12:15 (existing) vs. Batch 07 "Luke 12:13-15" (verse 15 shared)
- *(Recommended resolution: reclassify both as Category B — see Canonical Count above)*

**B — Intentional upgrade/replacement, expected:**
- Mark 9:24 → Mark 9:21-24
- Psalm 34:18 → Psalm 34:17-18
- Luke 15:20 → Luke 15:17-24
- Ecclesiastes 4:9-10 → Ecclesiastes 4:9-10
- Matthew 6:33 → Matthew 6:31-33

**C — Same theme, meaningfully different conversation, keep as-is (sampled, not exhaustive — each was already flagged transparently in its own batch's header at drafting time):**
- Three Luke 15 dinners (existing 15:20, Batch 01's 15:17-24, Batch 06's 15:11-16) — three different scenes in one parable, each read for a different purpose (grace, the return, the descent).
- Two John 11 dinners (Batch 04's 11:28-37 and 11:20-27) — Mary's grief and Martha's resurrection declaration, deliberately kept separate so "Jesus wept" isn't diluted.
- Five-plus Matthew 6 dinners, six-plus Romans 12 dinners, four Philippians 4 dinners, four-plus Colossians 3/4 dinners, three Ecclesiastes dinners, three Job dinners — all distinct verses within naturally rich chapters, no text overlap, each flagged in its batch's own header when drafted.
- Two Beatitudes dinners sitting adjacent (Matthew 5:3, 5:4, 5:6 across existing/Batch 04) and four Romans 8 dinners (8:1, 8:26-27, 8:28, 8:38-39) — tight concentration, zero verse overlap, each covering a genuinely distinct facet.

**D — Questionable overlap, human review suggested:**
- Two pre-existing overlaps *within the original 119 itself*, predating this entire project: **Matthew 6:14 vs. Matthew 6:14-15**, and **1 Thessalonians 5:18 vs. 1 Thessalonians 5:16-18**. Neither was introduced or touched by any batch. Worth a human look during the eventual no-repeat rotation build (a family could hit both halves of the same near-identical teaching within the same year), but not a defect this project created.

No further exact or overlapping-range duplicates were found across the remaining ~340 dinners not listed above.

---

## Scripture Integrity

All 354 dinners have non-empty Scripture, context, three questions, and a prayer — verified programmatically (zero missing fields across the entire dataset). All 242 batch dinners were sourced from the app's own `bible_verses` (WEB) table via read-only query at drafting time, per the standing rule; each batch's own header documents any translator-footnote stripping or bracketed-supplied-word handling. Spot-checked deliberate content-appropriateness trims (2 Samuel 12, Genesis 22, Matthew 5:29-30) all display verbatim, complete text within the range they chose to show — none of them make their own questions rely on text outside what's displayed.

**The one confirmed Scripture-integrity defect is Psalm 100:1-2**, detailed under Critical Issues — a pre-existing production data problem, not something any batch introduced.

No other truncation, paraphrase-inside-Scripture, or reference/text mismatch was found in the batch-authored content during this pass.

---

## Pattern Analysis

Counts across all 354 dinners' three questions combined (percentages are of dinners containing at least one instance, not total occurrences):

| Pattern | Count | % |
|---|---|---|
| "Is there...?" | 81 | 22.9% |
| "Have you ever...?" | 50 | 14.1% |
| "What's something...?" | 51 | 14.4% |
| "What's the difference between...?" | 41 | 11.6% |
| "Think of...?" | 24 | 6.8% |
| "Why might...?" | 16 | 4.5% |
| "Why do you think...?" | 12 | 3.4% |
| "When was the last time...?" | 8 | 2.3% |
| "What would change if...?" | 5 | 1.4% |
| "What does this reveal/tell us...?" | 0 | 0.0% |

"Is there" is the single most concentrated construction library-wide, but no single batch (aside from 03 and 04, flagged above as Important) exceeds a level that would make it sound machine-generated within one sitting — the concentration is spread thin enough across 354 dinners that a family working through the library sequentially wouldn't notice a pattern most nights. "What does this reveal/tell us" — the single most stereotypical AI devotional-writing tic — appears **zero times** in the entire library.

---

## Prayer Analysis

| Address | Count | % |
|---|---|---|
| God | 153 | 43.2% |
| Lord | 73 | 20.6% |
| Jesus | 68 | 19.2% |
| Father | 52 | 14.7% |
| Spirit | 2 | 0.6% |
| Other/none | 6 | 1.7% |

Phrase frequency: "help us" 34.7%, "tonight" 28.2%, "thank you" 15.3%, "give us" 14.4%, "show us" 9.9%, "we don't want" 5.9%, "teach us" 4.8%, "we're asking" 1.4%, "this week" 1.1%, "bring to mind" 0%. Every single prayer ends with "Amen" (100%), which is expected and correct, not a defect.

**Zero exact-duplicate prayers anywhere in the library.** No near-duplicate prayer clusters were found beyond the natural family resemblance any consistent devotional voice would have (shared closing structure, shared vocabulary of asking/thanking/being taught) — nothing that reads as copy-pasted or templated.

---

## Context Accuracy

Every batch (01 through 08) ran its own context-accuracy check against §6 and §10 of the editorial standard at drafting time, and each batch's header/report documents specific claims that were cut or hedged (three named examples in Batch 01 alone, logged permanently in the editorial standard's Failure Modes list). Spot-checking the highest-risk entries from this audit's own findings:

- **2 Chronicles 7:14** (Batch 08) — correctly classified as *textually explicit, appropriately scoped*: the context box states plainly this is God's specific answer to Solomon about Israel and the temple before drawing any wider principle, avoiding the verse's common misapplication to modern nations.
- **Matthew 5:29-30** (Batch 06) — correctly classified as *interpretive but appropriately hedged, and necessarily direct*: the context states plainly that "pluck it out" is hyperbole, a deliberate, justified exception to the usual practice of hedging interpretive claims, because ambiguity on this specific text would be the actual harm.
- **Matthew 4:18** footnote handling (Batch 08) and **Matthew 5:21-22**'s "Raca"/"Gehenna" handling (Batch 05, after an initial mistake was caught and fixed) — both now correctly display verbatim WEB wording rather than a paraphrase.
- **Genesis 22, 2 Samuel 12** — both make a deliberate, disclosed choice about *what to display*, not a claim about what the text means; neither asserts a motive or historical fact not in the text.

No context box was found asserting authorship, dating, or cultural-background claims as settled fact without either textual support or an explicit hedge — the standard's discipline held up under this pass. This audit did not re-verify every one of the ~356 individual historical/cultural claims line by line (that would be the "academic citation project" explicitly out of scope); it confirmed the pattern of care holds by checking the highest-risk entries this audit's other phases surfaced.

---

## Theological / Harm Review

A programmatic scan for the specific harmful-implication patterns listed in the brief (weak-faith language, "God needed another angel," "more than you can handle," prayer-replaces-treatment, forced reconciliation, "stay in danger," "obey harmful commands," wealth/poverty moralizing, "doubt is sin," "temptation equals sin") returned **zero genuine hits** across all 354 dinners. The single pattern match (Matthew 6:24, matching "money is evil") was a false positive — the actual sentence is "Jesus isn't saying money is evil," the correct, protective framing, caught by the regex only because it doesn't understand negation.

This confirms rather than replaces the batch-by-batch care already documented: Batch 01's addiction/recovery rewrite (removing an "instant, effortless freedom" implication), Batch 03's explicit avoidance of Colossians 3:18-19 and careful handling of 1 Peter 3:7/Ephesians 5:25-33, Batch 04's refusal to manufacture explanations for suffering, and Batch 06's explicit no-shame recovery framework all remain intact and uncontradicted anywhere else in the library.

---

## Coverage

**Testament split:** Old Testament 134 (37.9%) / New Testament 220 (62.1%).

**Genre split:** Gospels 96 (27.1%), Epistles 114 (32.2%), Psalms/Wisdom/Job 68 (19.2%), Prophets 25 (7.1%), Acts/Revelation 10 (2.8%), other OT narrative/law 41 (11.6%).

**56 of 66 biblical books represented.** Absent: 1 Chronicles, 2 John, Amos, Ezekiel, Ezra, Haggai, Jonah, Judges, Nahum, Zechariah, Jude — all short or minor books; none represents a meaningful thematic gap given everything else covered. Most-used books: Psalms (32), Matthew (31), Luke (31), Proverbs (28), John (23), Genesis (17), Romans (16).

**No meaningful theme gap remains** against the original 30-item brief plus the 11 "additional important themes" the map identified along the way — every one of those has at least one dedicated dinner by the end of Batch 08. The honest remaining gap, as Batch 08's own report said, is volume, not topic.

---

## Jesus-Centeredness

96 of 354 dinners (27.1%) sit directly in the four Gospels — Jesus's own words, actions, and encounters as the text itself, not a topic he's cited to support. Batch 02 alone contributed 20 dinners built entirely around direct Gospel encounters (Zacchaeus, the woman caught in adultery, the rich young ruler, Gethsemane, the road to Emmaus, and more), deliberately showing Jesus with outsiders, sinners, the religious, doubters, children, the sick, the grieving, the wealthy, and his own closest friends — compassionate and angry, demanding and merciful, in the same collection. Beyond the Gospels themselves, Jesus is the explicit subject or the explicit lens in dinners drawn from Acts, the Epistles' own Christ-hymns and confessions, and Revelation's resurrection material. A product called **Dinner With Jesus** keeps Jesus genuinely, structurally central — not as an arbitrary quota, but as the observable shape of the collection.

---

## Emotional Balance

Approximate distribution across the library, by theme and by each batch's own documented tonal intent:

- **Light/fun or warm:** existing Gratitude/Joy/Family clusters, Batch 06's habit dinners (phones, complaining), Batch 07's "consider the ant," Batch 08's farmer/patience and friendship dinners — a meaningful, genuine minority, not an afterthought.
- **Reflective/practical:** the majority of Wisdom, Work, Money, Purpose, and Service dinners across Batches 03, 07, and 08.
- **Challenging/uncomfortable:** Batch 02's "don't sanitize Jesus" material, Batch 05's conflict dinners, Batch 07's Luke 16:19-31 and James 5:1-6, Batch 08's 2 Chronicles 7:14 and Job 27:5.
- **Grief/heavy:** concentrated almost entirely in Batch 04 (by design — that was its entire brief) and scattered individual entries elsewhere (2 Samuel 18, the existing Hope cluster).
- **Hopeful:** deliberately placed at the close of Batches 04, 06, and 08's harder stretches (Revelation 21, Isaiah 61, Micah 7:18-19, Matthew 28's Great Commission).
- **Intellectually/theologically demanding:** Batch 02's John 3, Luke 24; Batch 08's Daniel 3 and 6, Psalm 73.

**The library does not read as 354 heavy nights.** Batch 04 is the one batch built to sit in real weight, and it says so explicitly in its own brief and report; every other batch was deliberately required to interleave tones within itself (Batches 06, 07, and 08 all documented this as an explicit drafting requirement, verified in their own internal QC). There is real breathing room across a full year's rotation.

---

## Teen Accessibility

Programmatic scan of all 354 "For the Table Tonight" questions for adult-coded terms (marriage, spouse, mortgage, retirement, career, salary, investment, divorce, parenting-from-the-parent's-seat, taxes) found only **2 of 354** containing such language — Genesis 2:18-24 and Proverbs 18:22 — and **both already contain an explicit branch for someone who isn't married** ("or, if you're not married, someone in a marriage you admire..."), written that way from first draft specifically to avoid excluding a teenager or single adult at the table. No other dinner in the library routinely locks a teenager out of the opening question.

---

## Strongest Dinners (20)

Not for revision — these define what DWJ is at its best, drawn from across the existing library and all eight batches:

1. Mark 9:24 (existing/Batch 01 upgrade), "I believe; help my unbelief"
2. John 11:40 (existing) — believing before seeing
3. Joshua 1:9 (existing) — afraid vs. dismayed
4. Isaiah 40:31 (existing) — soar/run/walk
5. Psalm 139:13-14 (existing) — fully known, fully loved
6. Luke 5:27-32 (Batch 01) — "Dinner With Sinners"
7. John 8:34-36 (Batch 01) — "Free Indeed"
8. Mark 10:17-22 (Batch 02) — the rich young ruler, no forced happy ending
9. Luke 7:36-50 (Batch 02) — "She Loved Much"
10. Luke 24:13-32 (Batch 02) — the Emmaus road
11. Psalm 88 (Batch 04) — deliberately unresolved
12. Job 2:11-13 (Batch 04) — presence over explanation
13. Matthew 18:21-35 (Batch 05) — "Seventy Times Seven"
14. 2 Samuel 12:1-9, 13 (Batch 05) — "You Are the Man"
15. Romans 7:15, 18-19, 24-25 (Batch 06) — honest confession held with real hope
16. James 5:16 (Batch 06) — confession and community
17. Luke 16:19-31 (Batch 07) — "The Rich Man and Lazarus"
18. Matthew 25:14-30 (Batch 07) — the talents, severity intact
19. Luke 10:30-37 (Batch 08) — "The Good Samaritan," never used before in 119 or any batch
20. Daniel 3:16-18 (Batch 08) — "But If Not," trust before the outcome is known

## Weakest Dinners (20)

Genuinely candid, not padded to a round number — every entry below already has documented reasoning on record from the batch or audit that first identified it. Ranked roughly by severity:

1. **Psalm 100:1-2** (existing) — data defect (truncated/artifact text, question references undisplayed content). Fix the data, not just the editorial framing.
2. **Matthew 18:20** (existing) — Go Deeper and Push Further ask the same question from two angles.
3. **Joshua 24:15** (existing) — same issue, insufficient daylight between levels.
4. **Ephesians 4:32** (existing) — Push Further restates Go Deeper; also part of the repetitive Forgiveness cluster.
5. **Colossians 3:13** (existing) — near-identical structure to two other Forgiveness-cluster entries run back to back.
6. **1 Corinthians 13:4-5** (existing) — Go Deeper and Push Further read as the same question twice.
7. **Ephesians 2:8-9** (existing) — Push Further is a stock systematic-theology question not grounded in this verse specifically.
8. **Proverbs 16:9** (existing) — generic "let go and let God" framing, doesn't push past the verse's plain surface.
9. **Acts 2:42** (existing) — Push Further mostly restates the context note.
10. **Philippians 2:3-5** (Batch 01) — abstract, no narrative to return to; already flagged as the batch's own weakest.
11. **Proverbs 15:1** (Batch 01) — intentionally light, but the shallowest Push Further in its batch.
12. **Psalm 127:3-5** (Batch 01) — Push Further manufactures tension the short, declarative text doesn't really carry.
13. **Matthew 18:1-5** (Batch 02) — thinnest Push Further in its batch; short, symbolic passage without a full encounter.
14. **Mark 1:35-38** (Batch 02) — real concept, low stakes; risks reading as a lesson on prayer habits rather than an encounter with Jesus.
15. **Proverbs 29:11** (Batch 05) — thin, sits in the shadow of an adjacent, richer dinner on the same territory.
16. **2 Corinthians 5:18-19** (Batch 05) — abstract theology needing more work from the questions than the narrative-driven dinners around it.
17. **Isaiah 61:1** (Batch 06) — leans on outside context (Jesus's synagogue reading) more than its own single verse.
18. **1 Corinthians 14:40** (Batch 07) — thinnest single verse in the library relative to what's asked of it.
19. **Psalm 15:1-2** (Batch 08) — thinnest text-to-conversation ratio in its batch.
20. **2 Chronicles 7:14** (Batch 08) — theologically sound and carefully handled, but carries more outside-baggage risk than any other single dinner in the library.

None of these twenty are recommended for outright removal — each was independently judged, at the time it was written, to clear the "worth having" bar. This list is the honest floor of the library, offered as candidates for a future light-touch pass, not a rewrite mandate.

---

## Final Verdict

# READY FOR PRODUCTION PREP

Verdict accepted, and both attached conditions are now closed:

1. **Canonical count:** resolved and locked at **354 unique active dinners** (`docs/DWJ_LIBRARY_TRACKER.md`).
2. **Psalm 100:1-2 data defect:** fixed and independently verified in production (see Critical Issues above) — the only content change made as part of this audit.

Every other finding in this audit — the Batch 03/04 question-pattern concentration, the existing Forgiveness cluster's repetition, the pre-existing Matthew 6/1 Thessalonians 5 overlap, the 20 weakest dinners — is real, worth knowing, and appropriate to address during the next phase (fix true outliers → no-repeat rotation → production load → pastor pilot), but none of it should hold up moving into that phase. The library is large, varied, theologically careful, genuinely Jesus-centered, and does not read as machine-generated at the scale a family would actually encounter it — a few nights at a time, not all 354 back to back.
