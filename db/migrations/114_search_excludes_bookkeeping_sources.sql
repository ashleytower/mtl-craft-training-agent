-- 114: stop bookkeeping rows competing with real content, and let
--      `citation_required` re-sync on re-ingest.
--
-- Both defects were found by an independent Simplifier review of the merged
-- 111-113 work, and the first one is worse than the review estimated.
--
-- ---------------------------------------------------------------------------
-- 1. Coverage stubs were winning nearly half the result slots
-- ---------------------------------------------------------------------------
--
-- `source_hits` in 112 treats every `knowledge_sources` row with a non-empty
-- `governed_summary` as a citable result. That was written for the 29 external
-- practitioner sources, where the summary IS the content — it is the only text
-- we are entitled to hold.
--
-- But it also caught the rows that exist purely for bookkeeping:
--
--   * 14 per-lesson rows, whose summary reads "Lesson 5 of the Flavour &
--     Beverage Development course. 6 time-coded passages covering 1:03 of 7
--     minutes." That is a coverage label. The lesson's actual content is its
--     chunks, which are indexed separately and properly.
--   * 1 course row, whose summary counts curriculum items and carries the
--     39-item manifest in `source_metadata`.
--
-- Measured against the live corpus before this migration, across 8 ordinary
-- questions at the default limit of 6:
--
--   22 of 48 result slots (45.8%) were bookkeeping stubs.
--   "what does the course say about safety"  -> 4 of 6 stubs
--   "how long is the sugar lesson"           -> 6 of 6 stubs, no real content
--   "what is in the … course"                -> 6 of 6 stubs, no real content
--
-- So Brix was being handed "Lesson 7 … 7 time-coded passages covering 8:41 of
-- 9 minutes" where it should have been handed what the lesson actually says.
--
-- The predicate below is semantic rather than a hardcoded key list:
--
--   * A source that HAS chunks is represented in search by those chunks. Its
--     summary is metadata about them, not a citation. This is what separates a
--     lesson row from an external row — the external sources have no chunks
--     precisely because their summary is all we may hold.
--   * The course row has no chunks but is still a register, identified by the
--     `lesson_manifest` key it carries for `beverage_knowledge_coverage`.
--
-- The two Notion intake rows keep competing, correctly: they have no chunks and
-- their summaries are real descriptive statements about the intake, not counts.
--
-- Nothing is deleted. Every stub stays in `knowledge_sources`, still grouped by
-- `beverage_knowledge_coverage`, still carrying its manifest. It simply stops
-- being offered as an answer.
--
-- ---------------------------------------------------------------------------
-- 2. `citation_required` could never be corrected after the first ingest
-- ---------------------------------------------------------------------------
--
-- `beverage_ingest_knowledge_sources` inserts `citation_required` but omitted it
-- from `on conflict do update set`. `rights_status` and `operational_status` are
-- omitted deliberately and 111 says why — they are the human's decision and a
-- re-import must not walk an approval back. `citation_required` is not that: it
-- comes from the import file like `title` or `governed_summary`, and freezing it
-- was an oversight, not a policy.
--
-- Effect today is nil — all 44 rows are `true` and nothing has needed
-- correcting — but the ingest's idempotency contract was broken for one column,
-- silently. Fixed here so a corrected rights posture in the corpus actually
-- lands.

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
      -- Added in 114. Comes from the import file, so it must re-sync like any
      -- other imported field. Only rights_status and operational_status are
      -- withheld, because those two are a person's decision.
      citation_required = excluded.citation_required,
      governed_summary = excluded.governed_summary,
      source_metadata = excluded.source_metadata,
      embedding = coalesce(excluded.embedding, beverage.knowledge_sources.embedding),
      updated_at = now();

    if v_existing is null then v_inserted := v_inserted + 1;
    else v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

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
      -- A source with chunks is already represented in search BY those chunks.
      -- Its summary is a coverage label, not a citation, so it must not compete
      -- with the material it describes. Added in 114 — before it, bookkeeping
      -- rows took 45.8% of result slots.
      and not exists (
        select 1 from beverage.knowledge_chunks c2 where c2.source_id = s.id
      )
      -- The course register has no chunks of its own but is still bookkeeping.
      -- Identified by the manifest it carries for beverage_knowledge_coverage,
      -- rather than by a hardcoded key.
      and not (s.source_metadata ? 'lesson_manifest')
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

revoke all on function public.beverage_ingest_knowledge_sources(text, text, boolean, jsonb)
  from public, anon, authenticated;
revoke all on function public.beverage_search_knowledge(text, text, boolean, text, text, integer)
  from public, anon, authenticated;

grant execute on function public.beverage_ingest_knowledge_sources(text, text, boolean, jsonb)
  to service_role;
grant execute on function public.beverage_search_knowledge(text, text, boolean, text, text, integer)
  to service_role;
