# Dinner With Jesus 2.0 — Library Count Tracker

**Status:** Documentation only. This is the single canonical count going forward — update it at the end of every batch rather than recalculating from scratch in each batch's own file. It supersedes ad-hoc counting in `docs/DWJ_300_CONTENT_MAP.md`, whose original "300" plan is itself superseded by the new library target below.

**New library target:** up to 365 excellent, active, unique dinners — a genuine ceiling for a year without repeating, not a quota. Quality overrides quantity: if the library naturally finishes short of 365 because there isn't another genuinely excellent, non-duplicate dinner left to write, that's the correct outcome.

**FINAL CANONICAL COUNT — LOCKED: 354 unique active dinners.** Content generation is complete as of Batch 08 and the global audit. No further dinners will be created to reach 365. See "Final canonical count" below for the full reconciliation.

---

## How the count works

- **Original active existing dinners:** 119 (confirmed via live query against `public.dinner_verses`, `active = true`). The 26 inactive rows in the same table are historical/duplicate content and are not counted here or anywhere in this tracker.
- **Upgrade/replacement:** a batch dinner whose passage is the exact same verse_ref as an existing active dinner, or a direct expansion/contraction of one (same core anchor verse, wider or narrower range). An upgrade replaces its existing counterpart — it does not add a new slot to the total.
- **Genuinely new:** a batch dinner whose passage doesn't overlap any existing active dinner's exact verses.

## Reconciliation through Batch 06

**5 upgrades/replacements identified, all from Batch 01:**

| Existing (to be replaced) | Batch 01 replacement | Status |
|---|---|---|
| Mark 9:24 (Faith) | Mark 9:21-24 | Documented in `DWJ_EDITORIAL_STANDARD.md` §2 as a deliberate expansion. |
| Psalm 34:18 (Hope) | Psalm 34:17-18 | Documented, deliberate expansion. |
| Luke 15:20 (Grace) | Luke 15:17-24 | Documented, deliberate expansion. |
| Ecclesiastes 4:9-10 (Community) | Ecclesiastes 4:9-10 | **Confirmed intentional upgrade/replacement.** |
| Matthew 6:33 (Purpose) | Matthew 6:31-33 | **Confirmed intentional upgrade/replacement of the existing Matthew 6:33 dinner.** |

**Resolved.** Both rows above are now confirmed as deliberate replacements, on the same footing as the first three. All five upgrades replace their existing counterparts and do not add new slots to the total — the counts below already reflected this treatment and are unchanged.

**Genuinely new dinners, Batches 01-06:**

| Batch | Dinners | Upgrades | New |
|---|---|---|---|
| 01 | 20 | 5 | 15 |
| 02 | 20 | 0 | 20 |
| 03 | 20 | 0 | 20 |
| 04 | 20 | 0 | 20 |
| 05 | 20 | 0 | 20 |
| 06 (Recovery/Temptation) | 20 | 0 | 20 |
| **Total** | **120** | **5** | **115** |

**Projected unique active total through Batch 06:** 119 (existing slots, 5 of which are now the upgraded versions) + 115 (net new) = **234**.

## Remaining opportunity from 234

| Target | Additional dinners needed |
|---|---|
| 340 | 106 |
| 350 | 116 |
| 365 | 131 |

## After Batch 07 (Freedom/Work/Money/Ambition/Generosity, 47 new dinners, 0 upgrades)

**Projected unique active total: 234 + 47 = 281.**

| Target | Additional dinners still needed after Batch 07 |
|---|---|
| 340 | 59 |
| 350 | 69 |
| 365 | 84 |

## After Batch 08 (Final Gap Fill, 75 new dinners, 0 upgrades)

**Projected unique active total: 281 + 75 = 356.**

This clears 340 by 16 and 350 by 6, and sits 9 short of the ideal 365 ceiling. Batch 08 was built almost entirely from the 300-map's own previously-undrafted clusters (Pride, Patience, Leadership, Doubt, Prayer, Trusting God, Discipleship, Obedience, and the "additional important themes" cluster, plus remaining entries in partially-used clusters) rather than invented territory — four map-planned passages were deliberately dropped as too thin or too dependent on missing context to draft well (see the batch's own header for detail), consistent with not padding the count.

| Target | Additional dinners still needed after Batch 08 (superseded, see below) |
|---|---|
| 340 | met (16 over) |
| 350 | met (6 over) |
| 365 | 9 |

## Final canonical count — LOCKED at 354

The global audit (`docs/DWJ_356_GLOBAL_AUDIT.md`) ran a programmatic overlap check across the entire projected library and found two additional collisions that the 356 figure above did not account for — neither was caught during drafting or by any single batch's own duplication check, because each involves a short existing verse expanded into its fuller unit by a later batch, the same pattern already accepted for five other passages.

**Both are now confirmed as intentional upgrades/replacements, on the same footing as the original five:**

| Existing (replaced) | Replacement | Status |
|---|---|---|
| 2 Corinthians 5:7 (Faith) | Batch 08, "2 Corinthians 5:1, 6-8" | **Confirmed intentional upgrade/replacement.** |
| Luke 12:15 (Wisdom) | Batch 07, "Luke 12:13-15" | **Confirmed intentional upgrade/replacement.** |

**Total upgrades/replacements: 7** (5 from Batch 01, 2 newly confirmed above). **Total genuinely new dinners across Batches 01-08: 235** (242 total batch dinners − 7 upgrades).

**Final reconciliation: 119 (original active) − 7 (replaced originals) + 235 (genuinely new) + 7 (replacement versions, embedded in the 242 batch dinners) = 354.**

**354 is the locked, final canonical projected library.** Content generation is complete. No further dinners will be drafted to close the gap to 365 — that gap (11 dinners) is an accepted, deliberate outcome of "quality overrides quantity," not an open task.

---

## Historical notes (content-generation phase, now closed)

Preserved for context; no further batches are planned. Check new passages against the full existing-119 list specifically (not only against other batches and the 300-map) before drafting — Batch 06 found two map-planned passages that turned out to already be active in the original 119, and the global audit found two more collisions of the same kind after Batches 07-08, confirming this check needs to happen at selection time, every time, not as a one-off.

**Batch 08 also surfaced a lesson worth keeping on record:** at 75 dinners, a single drafting pass produced 52 "Is there...?" Go Deeper questions and 25 "What's the difference between X and Y" Push Further questions out of 75 — a severity of repetition not seen at the 20-dinner batch scale. The larger the batch, the more a single default construction compounds; the full-batch pattern audit caught and fixed both (down to 12 and 10 respectively) before finalizing.

| Through batch | Total dinners drafted | Cumulative upgrades | Cumulative new | Projected unique active total |
|---|---|---|---|---|
| 06 | 120 | 5 | 115 | 234 |
| 07 | 167 | 5 | 162 | 281 |
| 08 | 242 | 5 | 237 | 356 (superseded) |
| **Final (global audit)** | **242** | **7** | **235** | **354 — LOCKED** |
