-- Dinner with Jesus — Content inventory queries (read-only, no writes)
-- Run against production (mvswwnonafjencqumxvv) and paste results back.
-- Same pattern as every other production interaction in this engagement:
-- no database credentials are held by the assistant: these are for Steve
-- to run and share results from.

\echo '=== 0. SCHEMA CHECK — exact columns on the three content tables, so we are not guessing column names ==='
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name in ('dinner_verses', 'feeling_verses', 'bible_verses', 'bible_books')
order by table_name, ordinal_position;

\echo '=== 3A.1 — dinner_verses: total rows, active vs inactive ==='
select count(*) as total, count(*) filter (where active) as active_count, count(*) filter (where not active) as inactive_count
from public.dinner_verses;

\echo '=== 3A.2 — dinner_verses: completeness (level_1 fields, the guaranteed minimum per the app''s own fallback logic) ==='
select
  count(*) filter (where verse_text is null or verse_text = '') as missing_verse_text,
  count(*) filter (where context_text is null or context_text = '') as missing_context,
  count(*) filter (where question_level_1 is null or question_level_1 = '') as missing_question_1,
  count(*) filter (where prayer_level_1 is null or prayer_level_1 = '') as missing_prayer_1
from public.dinner_verses;

\echo '=== 3A.3 — dinner_verses: richness (optional level 2/3 fields) ==='
select
  count(*) filter (where question_level_2 is not null and question_level_2 <> '') as has_question_2,
  count(*) filter (where question_level_3 is not null and question_level_3 <> '') as has_question_3,
  count(*) filter (where prayer_level_2 is not null and prayer_level_2 <> '') as has_prayer_2,
  count(*) filter (where prayer_level_3 is not null and prayer_level_3 <> '') as has_prayer_3
from public.dinner_verses;

\echo '=== 3A.4 — dinner_verses: duplicate verse_ref (same reference used more than once) ==='
select verse_ref, count(*) as times_used
from public.dinner_verses
group by verse_ref
having count(*) > 1
order by times_used desc;

\echo '=== 3A.5 — dinner_verses: category breakdown ==='
select category, count(*) as verse_count
from public.dinner_verses
group by category
order by verse_count desc;

\echo '=== 3B.1 — feeling_verses: exact category list and count per category ==='
select feeling_key, count(*) as verse_count
from public.feeling_verses
group by feeling_key
order by feeling_key;

\echo '=== 3B.2 — feeling_verses: every row, for manual review of verse_ref quality/fit per category ==='
select feeling_key, display_order, verse_ref
from public.feeling_verses
order by feeling_key, display_order;

\echo '=== 3B.3 — feeling_verses: duplicate verse_ref within the same category ==='
select feeling_key, verse_ref, count(*) as times_in_category
from public.feeling_verses
group by feeling_key, verse_ref
having count(*) > 1;

\echo '=== 3B.4 — feeling_verses: verse_ref reused across DIFFERENT categories ==='
select verse_ref, count(distinct feeling_key) as category_count, array_agg(distinct feeling_key) as categories
from public.feeling_verses
group by verse_ref
having count(distinct feeling_key) > 1
order by category_count desc;

\echo '=== 3C.1 — bible_verses: total row count (is this a complete Bible? KJV is commonly cited as ~31,102 verses) ==='
select count(*) as total_bible_verses from public.bible_verses;

\echo '=== 3C.2 — bible_verses: distinct (chapter, verse) combinations actually used by "Verse for This Moment" (which queries eq(chapter,h).eq(verse,m) for h in 1-12, m in 0-59) ==='
select count(distinct (chapter, verse)) as distinct_time_slots_with_coverage
from public.bible_verses
where chapter between 1 and 12 and verse between 0 and 59;

\echo '=== 3C.3 — bible_verses: how many of the 720 possible time slots (12 hours x 60 minutes) have ZERO verses ==='
with all_slots as (
  select h, m from generate_series(1,12) h, generate_series(0,59) m
),
covered as (
  select distinct chapter as h, verse as m from public.bible_verses where chapter between 1 and 12 and verse between 0 and 59
)
select count(*) as slots_with_zero_coverage
from all_slots a
left join covered c on a.h = c.h and a.m = c.m
where c.h is null;

\echo '=== 3C.4 — bible_verses: verse-count distribution per time slot (min/avg/max verses returned for a given h:mm) ==='
select min(cnt) as min_verses_per_slot, round(avg(cnt),1) as avg_verses_per_slot, max(cnt) as max_verses_per_slot
from (
  select chapter, verse, count(*) as cnt
  from public.bible_verses
  where chapter between 1 and 12 and verse between 0 and 59
  group by chapter, verse
) sub;

\echo '=== 3E.1 — bible_verses: WEB vs KJV text coverage ==='
select
  count(*) as total_rows,
  count(*) filter (where text_web is not null and text_web <> '') as has_web_text,
  count(*) filter (where text_kjv is not null and text_kjv <> '') as has_kjv_text
from public.bible_verses;

\echo '=== 3E.2 — bible_books: total row count (66 expected for a complete Protestant canon) ==='
select count(*) as total_books from public.bible_books;

\echo '=== 3E.3 — bible_verses: any book present in bible_verses but missing from bible_books, or vice versa (cross-check completeness) ==='
select distinct bv.book
from public.bible_verses bv
where not exists (select 1 from public.bible_books bb where bb.name = bv.book or bb.book_abbr = bv.book_abbr);

\echo '=== CONTENT COUNT QUERIES COMPLETE ==='
