-- 115: report CONTENT coverage separately from MANIFEST coverage.
--
-- WHY
--
-- `beverage_knowledge_coverage` returned one boolean per course item,
-- `ingested`, derived purely from "does this lesson have chunks". That answers
-- the manifest question — is the row represented — and it silently conflates
-- three genuinely different states:
--
--   * a lesson whose captions we hold and can quote with timestamps
--   * a lesson we hold only as page text, cited by section and paragraph
--   * a lesson with nothing at all
--
-- and it has no way at all to say "this item is a quiz, and a quiz is course
-- metadata rather than knowledge to answer from" — which is the course's own
-- guidance. Under the old shape a quiz looks identical to a 40-minute lesson
-- nobody has collected.
--
-- That distinction is the difference between an honest coverage number and a
-- misleading one. 39 manifest rows exist and always did; what matters is how
-- many carry retrievable content. This function now answers both, separately,
-- so no report has to assert it in prose.
--
-- WHAT IT DOES NOT DO
--
-- It creates no rows. Earlier work (114) had to stop bookkeeping rows competing
-- with real content in search; the fix for coverage must not reintroduce them.
-- Classification is derived at read time from the manifest and the chunks that
-- actually exist. A quiz gets no `knowledge_sources` row, because it has no
-- knowledge — it is counted, not invented.

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
  v_lessons jsonb;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;

  -- One row per manifest item, classified by what is actually held.
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
      -- A lesson is page-text only when EVERY chunk it has is page text.
      -- Mixed would mean captions were later collected for a page-text lesson,
      -- which is an upgrade, so captions win the label.
      bool_and(c.locator->>'retrieval_type' is not distinct from 'page_text_only') as all_page_text
    from beverage.knowledge_chunks c
    where c.organization_id = v_org_id
      and c.locator ? 'lesson_id'
    group by 1
  ),
  classified as (
    select
      m.*,
      coalesce(h.chunks, 0) as chunks,
      case
        when coalesce(h.chunks, 0) > 0 and h.all_page_text then 'page_text'
        when coalesce(h.chunks, 0) > 0 then 'captions'
        -- A quiz carries no knowledge. The course's own ingestion guidance is
        -- that quizzes are indexed as course metadata, not as material to
        -- answer from, so "not collected" would misrepresent it as a gap.
        when m.lesson_type = 'quiz' then 'register_only'
        else 'none'
      end as content_kind
    from manifest m
    left join held h on h.lesson_id = m.lesson_id
  )
  select jsonb_agg(jsonb_build_object(
    'lesson_number', lesson_number,
    'lesson_id', lesson_id,
    'lesson_title', lesson_title,
    'lesson_type', lesson_type,
    'duration_or_marker', duration_or_marker,
    'chunks', chunks,
    'content_kind', content_kind,
    -- Retained for callers written against the old shape. It means "this row
    -- is represented", which is the MANIFEST question — not the content one.
    'ingested', chunks > 0
  ) order by (lesson_number)::integer)
  into v_lessons
  from classified;

  v_lessons := coalesce(v_lessons, '[]'::jsonb);

  return jsonb_build_object(
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_key', s.source_key,
        'title', s.title,
        'authority_tier', s.authority_tier,
        'operational_status', s.operational_status,
        'summary_embedded', s.embedding is not null,
        'chunks', (select count(*) from beverage.knowledge_chunks c where c.source_id = s.id),
        'embedded', (select count(*) from beverage.knowledge_chunks c
                     where c.source_id = s.id and c.embedding is not null)
      ) order by s.authority_tier, s.source_key)
      from beverage.knowledge_sources s
      where s.organization_id = v_org_id
    ), '[]'::jsonb),

    'course', jsonb_build_object(
      'items_total', jsonb_array_length(v_lessons),
      -- CONTENT coverage: items we can actually answer from.
      'items_with_content', (
        select count(*) from jsonb_array_elements(v_lessons) l
        where l->>'content_kind' in ('captions','page_text')),
      'items_with_captions', (
        select count(*) from jsonb_array_elements(v_lessons) l
        where l->>'content_kind' = 'captions'),
      'items_page_text_only', (
        select count(*) from jsonb_array_elements(v_lessons) l
        where l->>'content_kind' = 'page_text'),
      -- Counted honestly, not collected: a quiz has no knowledge to hold.
      'items_register_only', (
        select count(*) from jsonb_array_elements(v_lessons) l
        where l->>'content_kind' = 'register_only'),
      -- The real gap.
      'items_not_collected', (
        select count(*) from jsonb_array_elements(v_lessons) l
        where l->>'content_kind' = 'none'),
      'lessons', v_lessons
    ),

    'chunks', jsonb_build_object(
      'total', (select count(*) from beverage.knowledge_chunks where organization_id = v_org_id),
      'embedded', (select count(*) from beverage.knowledge_chunks
                   where organization_id = v_org_id and embedding is not null),
      'caption', (select count(*) from beverage.knowledge_chunks
                  where organization_id = v_org_id
                    and locator->>'retrieval_type' is distinct from 'page_text_only'),
      'page_text', (select count(*) from beverage.knowledge_chunks
                    where organization_id = v_org_id
                      and locator->>'retrieval_type' = 'page_text_only')
    )
  );
end;
$$;

revoke all on function public.beverage_knowledge_coverage(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.beverage_knowledge_coverage(text, text, boolean)
  to service_role;
