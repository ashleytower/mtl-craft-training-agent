-- 116: make the two halves of the coverage response reconcile, and stop a
--      malformed manifest row from failing the whole call.
--
-- Found by an independent Simplifier review of 115.
--
-- 1. ORPHANED CHUNKS WERE COUNTED TWICE OVER, DIFFERENTLY
--
--    115 builds the per-item breakdown by joining FROM the manifest, so a
--    chunk whose `locator->>'lesson_id'` matches no manifest row is invisible
--    to every per-item count. The top-level `chunks.*` totals query
--    `knowledge_chunks` directly, with no manifest join, so the same chunk IS
--    counted there.
--
--    The two halves of one response then disagree, and the disagreement is
--    silent: "158 caption chunks" could no longer be re-derived from
--    "12 lessons with captions", and the orphan stays fully searchable while
--    appearing in no coverage number. For a function whose entire job is to
--    report coverage honestly, a chunk it cannot see is exactly the wrong
--    failure.
--
--    Reachable: captions arrive from `art_of_drink_knowledge_chunks.jsonl`,
--    which is sourced independently of `art_of_drink_lesson_manifest.csv`.
--    Nothing enforces that a lesson_id in one appears in the other.
--
--    Zero orphans exist today. This surfaces them rather than waiting.
--
-- 2. A BLANK lesson_number KILLED THE WHOLE CALL
--
--    `order by (lesson_number)::integer` raises `invalid input syntax for type
--    integer` on any non-numeric value, failing coverage entirely rather than
--    degrading. Carried over from 112. Today's manifest is clean 1-39, but
--    nothing validates that column and losing all coverage to one bad cell is
--    a poor trade.
--
-- 3. Counts are computed once over the classified rows instead of re-scanning
--    the built JSON five times. Same numbers, one pass.
--
-- 4. A second `lesson_manifest` row would silently double every count, because
--    the CTE cross-joins whatever it finds. Only `courseSource()` writes that
--    key today; the guard makes a future second writer loud instead of wrong.

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
  v_lessons jsonb;
  v_counts record;
  v_orphans jsonb;
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

  create temporary table if not exists _cov_classified (
    lesson_number text, lesson_id text, lesson_title text, lesson_type text,
    duration_or_marker text, chunks bigint, content_kind text
  ) on commit drop;
  delete from _cov_classified;

  insert into _cov_classified
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
  )
  select
    m.lesson_number, m.lesson_id, m.lesson_title, m.lesson_type, m.duration_or_marker,
    coalesce(h.chunks, 0),
    case
      when coalesce(h.chunks, 0) > 0 and h.all_page_text then 'page_text'
      when coalesce(h.chunks, 0) > 0 then 'captions'
      -- A quiz carries no knowledge. The course's own ingestion guidance is
      -- that quizzes are course metadata, not material to answer from.
      when m.lesson_type = 'quiz' then 'register_only'
      else 'none'
    end
  from manifest m
  left join held h on h.lesson_id = m.lesson_id;

  select
    count(*) as items_total,
    count(*) filter (where content_kind in ('captions','page_text')) as with_content,
    count(*) filter (where content_kind = 'captions') as with_captions,
    count(*) filter (where content_kind = 'page_text') as page_text_only,
    count(*) filter (where content_kind = 'register_only') as register_only,
    count(*) filter (where content_kind = 'none') as not_collected
  into v_counts
  from _cov_classified;

  select coalesce(jsonb_agg(jsonb_build_object(
    'lesson_number', lesson_number,
    'lesson_id', lesson_id,
    'lesson_title', lesson_title,
    'lesson_type', lesson_type,
    'duration_or_marker', duration_or_marker,
    'chunks', chunks,
    'content_kind', content_kind,
    -- Retained for older callers. Means "represented", the MANIFEST question.
    'ingested', chunks > 0
  ) order by nullif(btrim(lesson_number), '')::integer nulls last), '[]'::jsonb)
  into v_lessons
  from _cov_classified;

  -- Chunks whose lesson_id is in no manifest row. Invisible to every per-item
  -- count above, so named explicitly rather than left to be inferred from a
  -- total that does not add up.
  select coalesce(jsonb_agg(jsonb_build_object('lesson_id', lesson_id, 'chunks', n)
                            order by lesson_id), '[]'::jsonb)
  into v_orphans
  from (
    select c.locator->>'lesson_id' as lesson_id, count(*) as n
    from beverage.knowledge_chunks c
    where c.organization_id = v_org_id
      and c.locator ? 'lesson_id'
      and not exists (select 1 from _cov_classified k where k.lesson_id = c.locator->>'lesson_id')
    group by 1
  ) o;

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
      'items_total', v_counts.items_total,
      'items_with_content', v_counts.with_content,
      'items_with_captions', v_counts.with_captions,
      'items_page_text_only', v_counts.page_text_only,
      'items_register_only', v_counts.register_only,
      'items_not_collected', v_counts.not_collected,
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
                      and locator->>'retrieval_type' = 'page_text_only'),
      -- Chunks attributed to no manifest item. Non-empty means the per-item
      -- breakdown and these totals describe different sets, and the corpus
      -- needs reconciling.
      'orphaned_lessons', v_orphans,
      'orphaned', (select coalesce(sum((e->>'chunks')::bigint), 0)
                   from jsonb_array_elements(v_orphans) e)
    )
  );
end;
$$;

revoke all on function public.beverage_knowledge_coverage(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.beverage_knowledge_coverage(text, text, boolean)
  to service_role;
