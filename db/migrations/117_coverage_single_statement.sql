-- 117: fix 116 — coverage was broken in production.
--
-- 116 staged its per-item classification in a temporary table so the counts,
-- the JSON array and the orphan lookup could each read it once. It reset that
-- table with `delete from _cov_classified;`, and this database rejects a DELETE
-- with no WHERE clause:
--
--     beverage API returned HTTP 502
--     { "error": "DELETE requires a WHERE clause" }
--
-- So every `coverage` call failed. Caught by live QA through the agent's own
-- tool immediately after applying 116 — the migration applied cleanly and the
-- function was still unusable, which is exactly the gap between "DDL succeeded"
-- and "the thing works".
--
-- The temp table was the wrong shape anyway. It needed create-if-not-exists,
-- a reset, and `on commit drop` semantics inside a SECURITY DEFINER function
-- whose session lifetime it does not control. CTEs do the same work in one
-- statement with none of that: `classified` is computed once and read three
-- times, which was the only reason the table existed.
--
-- Behaviour is otherwise identical to 116, including everything it fixed:
-- orphaned chunks surfaced, a blank lesson_number no longer fails the call,
-- counts computed in a single pass, and a second lesson_manifest row rejected.

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

  -- Exactly one register is expected. Two would silently double every number.
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
      bool_and(c.locator->>'retrieval_type' is not distinct from 'page_text_only') as all_page_text
    from beverage.knowledge_chunks c
    where c.organization_id = v_org_id
      and c.locator ? 'lesson_id'
    group by 1
  ),
  classified as (
    select
      m.lesson_number, m.lesson_id, m.lesson_title, m.lesson_type, m.duration_or_marker,
      coalesce(h.chunks, 0) as chunks,
      case
        when coalesce(h.chunks, 0) > 0 and h.all_page_text then 'page_text'
        when coalesce(h.chunks, 0) > 0 then 'captions'
        -- A quiz carries no knowledge; the course's own guidance is that a quiz
        -- is course metadata, not material to answer from.
        when m.lesson_type = 'quiz' then 'register_only'
        else 'none'
      end as content_kind
    from manifest m
    left join held h on h.lesson_id = m.lesson_id
  ),
  agg as (
    select
      count(*) as items_total,
      count(*) filter (where content_kind in ('captions','page_text')) as with_content,
      count(*) filter (where content_kind = 'captions') as with_captions,
      count(*) filter (where content_kind = 'page_text') as page_text_only,
      count(*) filter (where content_kind = 'register_only') as register_only,
      count(*) filter (where content_kind = 'none') as not_collected,
      coalesce(jsonb_agg(jsonb_build_object(
        'lesson_number', lesson_number,
        'lesson_id', lesson_id,
        'lesson_title', lesson_title,
        'lesson_type', lesson_type,
        'duration_or_marker', duration_or_marker,
        'chunks', chunks,
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
      count(*) filter (where locator->>'retrieval_type' = 'page_text_only') as page_text
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
      'items_register_only', agg.register_only,
      'items_not_collected', agg.not_collected,
      'lessons', agg.lessons
    ),
    'chunks', jsonb_build_object(
      'total', chunk_totals.total,
      'embedded', chunk_totals.embedded,
      'caption', chunk_totals.caption,
      'page_text', chunk_totals.page_text,
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
