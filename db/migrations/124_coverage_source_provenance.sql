-- 124: report each source's provenance and rights, not just its chunk count.
--
-- NUMBERING. This is 124 and not 119. The beverage migrations in this
-- repository and the CRM's migrations in `mtl-craft-cocktails-ai` write one
-- shared number line into one shared database, with nothing coordinating them
-- (db/baseline/DRIFT.md §2). The CRM holds 119 through 123 on its origin/main,
-- so those numbers are taken. Checked against origin refs, not local files.
--
-- LEDGER NOTE. `supabase_migrations.schema_migrations` records this project's
-- beverage migrations only up to 117, yet 118 is demonstrably applied: the live
-- `beverage_knowledge_coverage` returns `items_mixed` and `items_with_page_text`,
-- which exist in no migration before 118. The ledger under-reports what is
-- applied, so it is not a safe source of truth for "what is live" here. Read the
-- catalog (`pg_get_functiondef`) instead.
--
-- THE GAP
--
-- 118 answers "how much of the course do we hold?" well. It cannot answer the
-- question the source inventory has to answer, which is "what is each source,
-- who made it, what are we allowed to do with it, and do we hold its text or
-- only a citation?"
--
-- That distinction is not cosmetic. 36 of the 71 sources carry a governed
-- summary and zero passages — every Kevin Kos item, the FDA guidance, the
-- Morgenthaler calculators, the linked Perfumer & Flavorist and FEMA documents.
-- They are retrievable and citable, and they are NOT quotable. `beverage_search_
-- knowledge` already draws that line per result (`kind = 'source'` vs 'chunk'),
-- but coverage reports only `chunks: 0`, which reads as "missing" when the true
-- state is "held correctly, as a citation, because copying the text would
-- exceed the rights we have".
--
-- Reporting those 36 as a gap would misdescribe a deliberate rights posture as
-- a collection failure, and would invite someone to "fix" it by scraping
-- third-party pages. So the state is named in the data.
--
-- WHAT CHANGES
--
-- Only the `sources` array gains keys. `course` and `chunks` are untouched and
-- every existing key keeps its exact meaning and value, so `KnowledgeCoverage`
-- consumers and Brix's `coverage` tool continue to work unchanged.
--
--   creator, publisher, source_url   provenance, straight from the row
--   rights_status                    what we may do with it
--   citation_required                the citation contract, per source
--   citable                          passages that can produce a checkable
--                                    reference (513/513 today, and counted so
--                                    that a future one that cannot shows up)
--   has_governed_summary             whether a cite-only source can say anything
--   holding                          derived, three states:
--                                      'passages'      we hold its text
--                                      'citation_only' summary + citation only
--                                      'registered'    neither: a declared gap
--
-- `holding` is derived here rather than in the report generator so that every
-- reader of this RPC — the inventory, the console, and Brix itself — gets the
-- same answer, and so a source with no passages can never be silently rendered
-- as uncollected material somebody ought to go and fetch.

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
  source_counts as (
    -- Counted once per source rather than as correlated subqueries per key, so
    -- `chunks`, `citable` and `holding` cannot disagree about the same row.
    select
      s.id,
      count(c.id) as chunks,
      count(c.id) filter (where c.embedding is not null) as embedded,
      -- A passage is citable when `citationFor` can build a reference a reader
      -- could actually check: a source URL, plus the locator the passage's own
      -- kind requires — a clock for time-coded text, a section/paragraph for
      -- page text. This is 513/513 today. It is counted rather than asserted
      -- precisely so that material arriving later without a locator shows up
      -- as uncitable instead of quietly entering the corpus.
      count(c.id) filter (
        where coalesce(c.locator->>'source_url', '') <> ''
          and case
                when c.locator->>'retrieval_type' = 'page_text_only'
                  then coalesce(c.locator->>'page_reference', '') <> ''
                else coalesce(c.locator->>'timestamp', '') <> ''
              end
      ) as citable
    from beverage.knowledge_sources s
    left join beverage.knowledge_chunks c on c.source_id = s.id
    where s.organization_id = v_org_id
    group by s.id
  ),
  source_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source_key', s.source_key,
      'title', s.title,
      'authority_tier', s.authority_tier,
      'operational_status', s.operational_status,
      'summary_embedded', s.embedding is not null,
      'chunks', sc.chunks,
      'embedded', sc.embedded,
      -- 124 additions.
      'citable', sc.citable,
      'creator', s.creator,
      'publisher', s.publisher,
      'source_url', s.source_url,
      'rights_status', s.rights_status,
      'citation_required', s.citation_required,
      'has_governed_summary',
        s.governed_summary is not null and btrim(s.governed_summary) <> '',
      -- Whether we hold the text, only a citation, or nothing yet. See the
      -- header: 'citation_only' is a correct resting state for a third-party
      -- source, not a gap to be closed by copying somebody's page.
      'holding', case
        when sc.chunks > 0 then 'passages'
        when s.governed_summary is not null and btrim(s.governed_summary) <> ''
          then 'citation_only'
        else 'registered'
      end
    ) order by s.authority_tier, s.source_key), '[]'::jsonb) as list
    from beverage.knowledge_sources s
    join source_counts sc on sc.id = s.id
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
