-- 112: let a cite-only source be found the same way a quotable chunk is.
--
-- THE DEFECT 111 SHIPPED WITH
--
-- `beverage_search_knowledge` gave chunks and sources different reach:
--
--   chunks   matched on full text OR were pulled in wholesale whenever an
--            embedding was supplied, so they had full semantic recall.
--   sources  matched on full text and nothing else.
--
-- `websearch_to_tsquery` ANDs its terms. So "how do I make clear ice at home"
-- becomes 'make' & 'clear' & 'ice' & 'home', which one source row satisfies —
-- while the plain phrase "clear ice" matches three. The question a person
-- actually asks was strictly worse than the keyword, and the three clear-ice
-- sources (PUB-CI-001, PUB-CI-002, PUB-KK-013) lost to course chunks about
-- sugar and tasting that had nothing to do with ice.
--
-- Measured before this migration, `q=how do I make clear ice at home` returned
-- three Art of Drink chunks and zero clear-ice sources. The corpus held exactly
-- the right material and the search could not reach it.
--
-- THE FIX
--
-- Embed the source the same way a chunk is embedded. What gets embedded is the
-- title, the governed summary and the topics — all text we already hold and are
-- already entitled to hold. This adds no new text about anyone's work: a
-- summary Manus wrote is exactly what the vector is built from, and the vector
-- is not reversible into the article it summarises.
--
-- Sources stay cite-only. Nothing here gives them a body.

alter table beverage.knowledge_sources
  add column if not exists embedding public.vector(768);

-- ---------------------------------------------------------------------------
-- Ingest accepts the source embedding
-- ---------------------------------------------------------------------------

-- SUPERSEDED by 114_search_excludes_bookkeeping_sources.sql, which adds
-- citation_required to the on-conflict update. This body is the record of
-- what 112 applied.
create or replace function public.beverage_ingest_knowledge_sources(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_sources jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $$
declare
  v_context jsonb;
  v_org_id uuid;
  v_principal_id uuid;
  v_source jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_existing uuid;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;

  if jsonb_typeof(p_sources) <> 'array' then
    raise exception 'p_sources must be a JSON array';
  end if;

  for v_source in select * from jsonb_array_elements(p_sources) loop
    select id into v_existing
    from beverage.knowledge_sources
    where organization_id = v_org_id and source_key = v_source->>'source_key';

    insert into beverage.knowledge_sources (
      organization_id, source_key, title, publisher, creator, source_url,
      authority_tier, rights_status, operational_status, citation_required,
      governed_summary, source_metadata, embedding, created_by
    )
    values (
      v_org_id,
      v_source->>'source_key',
      v_source->>'title',
      v_source->>'publisher',
      v_source->>'creator',
      v_source->>'source_url',
      v_source->>'authority_tier',
      coalesce(v_source->>'rights_status', 'review_required'),
      coalesce(v_source->>'operational_status', 'reference_only'),
      coalesce((v_source->>'citation_required')::boolean, true),
      coalesce(v_source->>'governed_summary', ''),
      coalesce(v_source->'source_metadata', '{}'::jsonb),
      case
        when v_source->'embedding' is null or jsonb_typeof(v_source->'embedding') = 'null'
          then null
        else (v_source->>'embedding')::public.vector
      end,
      v_principal_id
    )
    on conflict (organization_id, source_key) do update set
      title = excluded.title,
      publisher = excluded.publisher,
      creator = excluded.creator,
      source_url = excluded.source_url,
      authority_tier = excluded.authority_tier,
      governed_summary = excluded.governed_summary,
      source_metadata = excluded.source_metadata,
      -- A run with the embedding service down must not erase what a previous
      -- run wrote. Same rule as chunks in 111.
      embedding = coalesce(excluded.embedding, beverage.knowledge_sources.embedding),
      updated_at = now();
      -- rights_status and operational_status remain the human's decision and
      -- are never overwritten by a re-import. See 111.

    if v_existing is null then v_inserted := v_inserted + 1;
    else v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

-- ---------------------------------------------------------------------------
-- Search treats both kinds alike
-- ---------------------------------------------------------------------------

-- SUPERSEDED by 114_search_excludes_bookkeeping_sources.sql, which stops
-- bookkeeping rows competing in source_hits. This body is the record of what
-- 112 applied; it is NOT current search behaviour.
create or replace function public.beverage_search_knowledge(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_query text,
  p_embedding text default null,
  p_limit integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $$
declare
  v_context jsonb;
  v_org_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 25);
  v_tsquery tsquery;
  v_vector public.vector(768);
  v_results jsonb;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;

  if btrim(coalesce(p_query, '')) = '' then
    raise exception 'A search query is required';
  end if;

  v_tsquery := websearch_to_tsquery('english', p_query);

  if p_embedding is not null and btrim(p_embedding) <> '' then
    v_vector := p_embedding::public.vector(768);
  end if;

  with chunk_hits as (
    select
      'chunk'::text as kind,
      c.chunk_key as ref,
      s.source_key,
      s.title as source_title,
      s.publisher,
      s.authority_tier,
      s.operational_status,
      s.citation_required,
      c.body,
      c.locator,
      c.review_status,
      ts_rank(c.search_vector, v_tsquery)::double precision as text_rank,
      case
        when v_vector is null or c.embedding is null then null
        else (1 - (c.embedding <=> v_vector))::double precision
      end as vector_similarity
    from beverage.knowledge_chunks c
    join beverage.knowledge_sources s on s.id = c.source_id
    where c.organization_id = v_org_id
      and s.operational_status <> 'blocked_rights'
      and c.review_status <> 'rejected'
      and (
        c.search_vector @@ v_tsquery
        or (v_vector is not null and c.embedding is not null)
      )
  ),
  source_hits as (
    select
      'source'::text as kind,
      s.source_key as ref,
      s.source_key,
      s.title as source_title,
      s.publisher,
      s.authority_tier,
      s.operational_status,
      s.citation_required,
      s.governed_summary as body,
      jsonb_build_object('source_url', s.source_url, 'topics', s.source_metadata->'topics') as locator,
      s.operational_status as review_status,
      ts_rank(
        to_tsvector('english', s.title || ' ' || s.governed_summary ||
          ' ' || coalesce(s.source_metadata->>'topics', '')),
        v_tsquery
      )::double precision as text_rank,
      case
        when v_vector is null or s.embedding is null then null
        else (1 - (s.embedding <=> v_vector))::double precision
      end as vector_similarity
    from beverage.knowledge_sources s
    where s.organization_id = v_org_id
      and s.operational_status <> 'blocked_rights'
      and btrim(s.governed_summary) <> ''
      -- Symmetric with chunk_hits above: a source is reachable semantically,
      -- not only by an exact AND of every term the question happened to use.
      and (
        to_tsvector('english', s.title || ' ' || s.governed_summary ||
          ' ' || coalesce(s.source_metadata->>'topics', '')) @@ v_tsquery
        or (v_vector is not null and s.embedding is not null)
      )
  ),
  merged as (
    select * from chunk_hits
    union all
    select * from source_hits
  ),
  scored as (
    select *,
      coalesce(vector_similarity, 0) * 0.6 + least(text_rank, 1.0) * 0.4 as score
    from merged
  )
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.score desc), '[]'::jsonb)
  into v_results
  from (
    select kind, ref, source_key, source_title, publisher, authority_tier,
           operational_status, citation_required, body, locator, review_status,
           text_rank, vector_similarity, score
    from scored
    order by score desc
    limit v_limit
  ) r;

  return jsonb_build_object(
    'query', p_query,
    'search_mode', case when v_vector is null then 'text_only' else 'hybrid' end,
    'count', jsonb_array_length(v_results),
    'results', v_results,
    'boundary', 'Tier B training reference material. It must never silently '
      || 'alter a formula, approve an ingredient, authorize a shelf-life claim, '
      || 'determine a preservation plan, or release a batch. Approved MTL Craft '
      || 'formula versions and CRM recipes remain the sole authority for '
      || 'quantities, and release remains a human decision.'
  );
end;
$$;

-- Coverage gains the source embedding count, so "is the corpus fully indexed?"
-- stays a question about data rather than about which script last ran.

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
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;

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
    'course_lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lesson_number', lesson->>'lesson_number',
        'lesson_id', lesson->>'lesson_id',
        'lesson_title', lesson->>'lesson_title',
        'lesson_type', lesson->>'lesson_type',
        'ingested', exists (
          select 1
          from beverage.knowledge_chunks c
          where c.organization_id = v_org_id
            and c.locator->>'lesson_id' = lesson->>'lesson_id'
        )
      ) order by (lesson->>'lesson_number')::integer)
      from beverage.knowledge_sources s
      cross join lateral jsonb_array_elements(s.source_metadata->'lesson_manifest') as lesson
      where s.organization_id = v_org_id
        and s.source_metadata ? 'lesson_manifest'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.beverage_ingest_knowledge_sources(text, text, boolean, jsonb)
  from public, anon, authenticated;
revoke all on function public.beverage_search_knowledge(text, text, boolean, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.beverage_knowledge_coverage(text, text, boolean)
  from public, anon, authenticated;

grant execute on function public.beverage_ingest_knowledge_sources(text, text, boolean, jsonb)
  to service_role;
grant execute on function public.beverage_search_knowledge(text, text, boolean, text, text, integer)
  to service_role;
grant execute on function public.beverage_knowledge_coverage(text, text, boolean)
  to service_role;
