-- Dinner with Jesus — deduplicate active dinner_verses by verse_ref,
-- prevent recurrence
-- Date: 2026-07-24
-- Status: NOT YET APPLIED. Forward-repair; no destructive operations.
--
-- ROOT CAUSE (confirmed against production content, not guessed)
-- Pre-launch verification (docs: SQL launch-verification block run by
-- Steve against production) found 18 verse_ref values with more than
-- one ACTIVE public.dinner_verses row. get_or_create_tonight_session()
-- avoids repeats by excluding dinner_verse_id already present in the
-- group's verse_history -- it does not dedupe by verse_ref. Two active
-- rows sharing a verse_ref therefore read as two different "unseen"
-- verses to that exclusion logic, so a family could be served the same
-- verse reference twice (different question/prayer wording) within
-- what should be one full rotation cycle through all active content.
--
-- Full-row inspection of all 44 rows across the 18 affected verse_refs
-- (id, category, verse_text/context/question/prayer content and
-- lengths) found two distinct causes, confirmed by direct comparison,
-- not assumed:
--
--   1. EXACT DUPLICATE IMPORT: for 12 of the 18 verse_refs, two rows
--      are byte-identical across every content column, created 11
--      seconds apart (2026-06-21 03:58:00.293378 and 03:58:11.429499)
--      -- a seed/import script that ran twice against the same source
--      data, minting two ids for the same content.
--   2. INCOMPLETE VERSE RANGE: for 5 multi-verse-range references
--      (John 13:34-35, 1 Corinthians 13:4-5, Lamentations 3:22-23,
--      Proverbs 3:5-6, Ecclesiastes 4:9-10), one or more rows quote
--      only the FIRST verse of the cited range (e.g. "Ecclesiastes
--      4:9-10" quoting only verse 9), while a later revision row
--      correctly quotes the full cited range. The incomplete rows are
--      real content defects independent of the duplicate-row issue,
--      not just shorter alternates.
--
-- For the remaining ambiguous cases with no objective completeness
-- defect (Hebrews 11:1: two comparably rich, differently-framed
-- devotionals; Colossians 1:10: a duplicate generic pair vs. a
-- distinct row whose context_text is the app's own founding story),
-- the canonical row was chosen per Steve's explicit direction rather
-- than by an automated completeness rule.
--
-- THE FIX
-- Deactivate (active = false) the 26 confirmed-redundant rows below,
-- one canonical row kept active per verse_ref. NO ROW IS DELETED. No
-- group_verse or verse_history row is touched -- both reference
-- dinner_verse_id directly and are unaffected by a referenced row's
-- active flag, so no historical dinner session's displayed content
-- changes. Deactivated rows remain fully queryable for audit/rollback
-- (re-activate with `update public.dinner_verses set active = true
-- where id = '...'` if a selection is ever judged wrong later).
--
-- PREVENTION
-- A partial unique index on lower(trim(verse_ref)) where active = true
-- makes this class of defect impossible to reintroduce from any code
-- path (admin content tools, a future seed script, a manual insert) --
-- enforced by Postgres itself, matching this migration package's
-- established pattern (see is_valid_iana_timezone /
-- groups_timezone_valid in 20260714000004_shared_dinner_session.sql
-- for the same "constraint enforced in the database, not by client
-- care" approach). Activating or inserting a second row for a
-- verse_ref that already has an active row will now fail with a
-- unique-violation error instead of silently succeeding.
--
-- SAFE TO RE-RUN: the UPDATE targets a fixed, explicit list of ids --
-- re-running it is a no-op on rows already inactive. The index
-- creation uses `if not exists`.

begin;

-- ============================================================
-- DEACTIVATE CONFIRMED-REDUNDANT ROWS (26 rows, 18 verse_refs)
-- One canonical row remains active per verse_ref -- see header comment
-- for the exact per-row rationale (exact duplicate vs. incomplete
-- verse range vs. Steve's explicit call on the two ambiguous refs).
-- ============================================================

update public.dinner_verses
set active = false
where id in (
  -- John 13:34-35 -- verse_text omits v.35 despite the "34-35" citation
  '1c61c59e-0735-43b6-a227-d5ed7147c3c6',

  -- 1 Corinthians 13:4-5 -- verse_text truncated mid-clause
  'f42a4992-78c1-4173-955f-d372ba759020',

  -- 1 Thessalonians 5:18 -- exact duplicate (11 seconds apart)
  '15d2d4a6-d8ae-4253-9519-8578589962c7',

  -- Isaiah 40:31 -- exact duplicate, plus a thinner third row
  'ac62c621-985d-4c4c-bc87-b30481982095',
  '725adbae-6bfa-4fc8-a372-eabac0fddfb1',

  -- Romans 8:28 -- exact duplicate, plus a thinner third row
  'f40c68f0-e8f3-45ab-a480-36d364780503',
  'c355377f-1461-45e1-b2b3-f50b09eb74c3',

  -- Proverbs 27:17 -- thinner prayer content overall
  '868eabd2-742e-4cf2-bd2a-08252840f28d',

  -- Matthew 6:14 -- exact duplicate
  'b34219fb-5ddc-457a-a4fa-c5faab5943b2',

  -- Hebrews 11:1 -- Steve's explicit call: keep 5d19f8a5
  '16da3790-216a-47a9-b62a-972a4d58d0ca',

  -- Joshua 1:9 -- exact duplicate, plus a thinner third row
  'cafa8437-af94-4356-8d7b-f22ce2ca28f4',
  '0d43af81-53dc-435f-a55d-331d804b4eea',

  -- John 15:13 -- exact duplicate
  'e3beca03-9848-4aa4-ba6d-92bec9d7f8ff',

  -- Romans 15:13 -- thinner overall
  'f26e97bb-3828-437c-bb77-7041a16fbc6f',

  -- Psalm 46:10 -- exact duplicate, plus a thinner third row
  '936fd9b5-5435-4544-93b8-e5d33ac557e0',
  'b7079eef-dbb5-4025-aecc-ee45bf0479f3',

  -- Lamentations 3:22-23 -- verse_text omits v.23 despite the "3:22-23" citation
  'b0bacce9-7ed7-40d7-b18a-392fcae7cd8e',

  -- Proverbs 3:5-6 -- all three omit v.6 despite the "3:5-6" citation
  'ad325f31-ed07-460a-93de-94931640fd8a',
  '34277b16-9a55-4773-9c44-88de0c9d9fb5',
  'a5498e4a-16f8-4bcf-9ba5-f9c0e87953a2',

  -- Ecclesiastes 4:9-10 -- verse_text omits v.10 despite the "4:9-10" citation
  '3a3f94a4-a079-4303-9031-23917de2768e',

  -- Romans 12:2 -- thinner overall
  '2c570368-6806-4d6a-8fc5-3982c110785b',

  -- Colossians 1:10 -- Steve's explicit call: keep the founding-story
  -- row (9b990790), deactivate both rows of the generic duplicate pair
  '24ffa8b3-88aa-4eea-bb9e-9c18b138b9a0',
  '63f60dff-df47-4a02-b0a6-339c70a3af74',

  -- Jeremiah 29:11 -- exact duplicate, plus a thinner third row
  'aa06d394-f639-48da-8a35-7903b13e0209',
  '1ffa7568-7e45-427e-9a82-1d156f44be52'
);

-- ============================================================
-- PREVENTION: one active row per normalized verse_ref, enforced by
-- Postgres, not by client-side or admin-tool care.
-- ============================================================
create unique index if not exists dinner_verses_active_verse_ref_unique
  on public.dinner_verses (lower(trim(verse_ref)))
  where active = true;

comment on index public.dinner_verses_active_verse_ref_unique is
  'At most one ACTIVE dinner_verses row per normalized (trimmed, '
  'lowercased) verse_ref. Prevents the 2026-07-24 duplicate-active-row '
  'defect from recurring via any code path -- activating or inserting '
  'a second active row for a verse_ref that already has one now fails '
  'with a unique-violation instead of silently succeeding.';

commit;

-- ============================================================
-- VERIFICATION REQUIRED IMMEDIATELY AFTER APPLYING
-- ============================================================
-- 1. Re-run the full launch-verification query. duplicate_verse_ref_
--    active must return [] and active_verse_count must be 145 - 26 = 119.
-- 2. select count(*) from public.dinner_verses where active = false
--    and id in (<the 26 ids above>);
--    -- must return 26 -- confirms every targeted row is inactive and
--    -- none were deleted (row still exists, just active = false).
-- 3. select count(*) from public.group_verse; and
--    select count(*) from public.verse_history;
--    -- compare against pre-migration counts (unchanged) -- confirms
--    -- no historical session or discussion record was touched.
-- 4. Attempt to reactivate a duplicate to confirm the prevention index
--    works, then undo it:
--      update public.dinner_verses set active = true
--      where id = '15d2d4a6-d8ae-4253-9519-8578589962c7';
--    -- must fail with a unique-violation error naming
--    -- dinner_verses_active_verse_ref_unique. No need to undo -- the
--    -- failed statement makes no change.
