-- 118: a lesson can hold BOTH time-coded and page-text passages. Count it.
--
-- Found by an independent Simplifier review of the page-text merge.
--
-- THE DEFECT
--
-- 117 classifies each lesson with `bool_and(retrieval_type = 'page_text_only')`:
-- true means page-text, anything else means captions. That is a two-state
-- answer to what is now a three-state question.
--
-- The ingest previously skipped a lesson's written page whenever that lesson
-- had captions, so the two sets never overlapped and two states were enough.
-- That guard is gone: 12 lessons that always had captions now also hold their
-- page text, and the 7 lessons being locally transcribed will hold both too.
--
-- Under 117 every one of those lessons classifies as plain `captions`, and its
-- page passages vanish from the per-item breakdown. `items_page_text_only`
-- reports 12 while 24 lessons actually hold page text. Chunk totals stay right,
-- because they count per chunk — so the two halves of the response disagree,
-- which is the same class of failure 116 existed to fix.
--
-- For a function whose entire job is to report coverage honestly, silently
-- describing half its page text as absent is the wrong failure.
--
-- WHAT CHANGES
--
-- A fourth content_kind, `mixed`, and the counts to go with it:
--
--   items_with_captions   captions + mixed   unchanged meaning: has a clock
--   items_page_text_only  page_text          unchanged meaning: STRICTLY page
--   items_mixed           mixed              new
--   items_with_page_text  page_text + mixed  new: the honest "holds page text"
--   items_with_content    all three          unchanged
--
-- The two pre-existing keys keep their exact former values, so nothing reading
-- them has to change: a `mixed` lesson does have captions, and it is not
-- page-text-ONLY. Only the previously-unanswerable questions are new.
--
-- The classification order is also inverted to test the cheap "no chunks" case
-- first. 117 asked `chunks > 0 and all_page_text` before `lesson_type = 'quiz'`,
-- which works only because `bool_and` over no rows is NULL rather than true —
-- correct, but resting on a NULL subtlety for no reason.

create or replace function public.beverage_knowledge_coverage(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $$
declare
  v_context jsonb;
  v_org_id uuid;
  v_manifest_rows integer;
  v_result jsonb;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;

  -- Exactly one register is expected. Two would double every number below
  -- without changing anything visible, so fail loudly instead.
  select count(*) into v_manifest_rows
  from beverage.knowledge_sources s
  where s.organization_id = v_org_id and s.source_metadata ? 'lesson_manifest';

  if v_manifest_rows > 1 then
    raise exception 'Expected at most one lesson_manifest source, found %', v_manifest_rows;
  end if;

  with manifest as (
    select
      lesson->>'lesson_number' as lesson_number,
      lesson->>'lesson_id'     as lesson_id,
      lesson->>'lesson_title'  as lesson_title,
      lesson->>'lesson_type'   as lesson_type,
      lesson->>'duration_or_marker' as duration_or_marker
    from beverage.knowledge_sources s
    cross join lateral jsonb_array_elements(s.source_metadata->'lesson_manifest') as lesson
    where s.organization_id = v_org_id
      and s.source_metadata ? 'lesson_manifest'
  ),
  held as (
    select
      c.locator->>'lesson_id' as lesson_id,
      count(*) as chunks,
      count(*) filter (
        where c.locator->>'retrieval_type' is not distinct from 'page_text_only'
      ) as page_chunks,
      count(*) filter (
        where c.locator->>'retrieval_type' is distinct from 'page_text_only'
      ) as time_coded_chunks
    from beverage.knowledge_chunks c
    where c.organization_id = v_org_id
      and c.locator ? 'lesson_id'
    group by 1
  ),
  classified as (
    select
      m.lesson_number, m.lesson_id, m.lesson_title, m.lesson_type, m.duration_or_marker,
      coalesce(h.chunks, 0) as chunks,
      coalesce(h.page_chunks, 0) as page_chunks,
      coalesce(h.time_coded_chunks, 0) as time_coded_chunks,
      case
        -- A quiz carries no knowledge; the course's own guidance is that a quiz
        -- is course metadata, not material to answer from.
        when coalesce(h.chunks, 0) = 0 and m.lesson_type = 'quiz' then 'register_only'
        when coalesce(h.chunks, 0) = 0 then 'none'
        when h.time_coded_chunks = 0 then 'page_text'
        when h.page_chunks > 0 then 'mixed'
        else 'captions'
      end as content_kind
    from manifest m
    left join held h on h.lesson_id = m.lesson_id
  ),
  agg as (
    select
      count(*) as items_total,
      count(*) filter (where content_kind in ('captions','page_text','mixed')) as with_content,
      -- "has time-coded text" — a mixed lesson does have captions.
      count(*) filter (where content_kind in ('captions','mixed')) as with_captions,
      -- "holds page text at all" — the number that was previously unreportable.
      count(*) filter (where content_kind in ('page_text','mixed')) as with_page_text,
      -- STRICTLY page text and nothing else. Same meaning it always had.
      count(*) filter (where content_kind = 'page_text') as page_text_only,
      count(*) filter (where content_kind = 'mixed') as mixed,
      count(*) filter (where content_kind = 'register_only') as register_only,
      count(*) filter (where content_kind = 'none') as not_collected,
      coalesce(jsonb_agg(jsonb_build_object(
        'lesson_number', lesson_number,
        'lesson_id', lesson_id,
        'lesson_title', lesson_title,
        'lesson_type', lesson_type,
        'duration_or_marker', duration_or_marker,
        'chunks', chunks,
        -- The split, per item, so a reader never has to infer it from the label.
        'time_coded_chunks', time_coded_chunks,
        'page_chunks', page_chunks,
        'content_kind', content_kind,
        -- Retained for older callers. Means "represented", the MANIFEST question.
        'ingested', chunks > 0
      ) order by nullif(btrim(lesson_number), '')::integer nulls last), '[]'::jsonb) as lessons
    from classified
  ),
  orphan_rows as (
    -- Chunks attributed to a lesson_id that is in no manifest row. Invisible to
    -- every per-item count, so named rather than left to be inferred from a
    -- total that does not add up.
    select c.locator->>'lesson_id' as lesson_id, count(*) as n
    from beverage.knowledge_chunks c
    where c.organization_id = v_org_id
      and c.locator ? 'lesson_id'
      and not exists (select 1 from manifest m where m.lesson_id = c.locator->>'lesson_id')
    group by 1
  ),
  orphans as (
    select
      coalesce(jsonb_agg(jsonb_build_object('lesson_id', lesson_id, 'chunks', n)
                         order by lesson_id), '[]'::jsonb) as list,
      coalesce(sum(n), 0) as total
    from orphan_rows
  ),
  chunk_totals as (
    select
      count(*) as total,
      count(*) filter (where embedding is not null) as embedded,
      count(*) filter (where locator->>'retrieval_type' is distinct from 'page_text_only') as caption,
      count(*) filter (where locator->>'retrieval_type' = 'page_text_only') as page_text,
      -- Time-coded chunks this machine transcribed rather than the publisher
      -- captioning. Both have a clock; only one is the publisher's own words.
      count(*) filter (where locator->>'caption_origin' like 'local\_whisper\_%') as local_transcript
    from beverage.knowledge_chunks
    where organization_id = v_org_id
  ),
  source_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source_key', s.source_key,
      'title', s.title,
      'authority_tier', s.authority_tier,
      'operational_status', s.operational_status,
      'summary_embedded', s.embedding is not null,
      'chunks', (select count(*) from beverage.knowledge_chunks c where c.source_id = s.id),
      'embedded', (select count(*) from beverage.knowledge_chunks c
                   where c.source_id = s.id and c.embedding is not null)
    ) order by s.authority_tier, s.source_key), '[]'::jsonb) as list
    from beverage.knowledge_sources s
    where s.organization_id = v_org_id
  )
  select jsonb_build_object(
    'sources', source_rows.list,
    'course', jsonb_build_object(
      'items_total', agg.items_total,
      'items_with_content', agg.with_content,
      'items_with_captions', agg.with_captions,
      'items_page_text_only', agg.page_text_only,
      'items_with_page_text', agg.with_page_text,
      'items_mixed', agg.mixed,
      'items_register_only', agg.register_only,
      'items_not_collected', agg.not_collected,
      'lessons', agg.lessons
    ),
    'chunks', jsonb_build_object(
      'total', chunk_totals.total,
      'embedded', chunk_totals.embedded,
      'caption', chunk_totals.caption,
      'page_text', chunk_totals.page_text,
      'local_transcript', chunk_totals.local_transcript,
      'orphaned_lessons', orphans.list,
      'orphaned', orphans.total
    )
  )
  into v_result
  from agg, orphans, chunk_totals, source_rows;

  return v_result;
end;
$$;

revoke all on function public.beverage_knowledge_coverage(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.beverage_knowledge_coverage(text, text, boolean)
  to service_role;
