-- 111: give the beverage schema a retrievable corpus, and a way to search it.
--
-- WHY THIS EXISTS
--
-- `beverage.knowledge_sources` has held 5 rows since 20260825190958 and has no
-- column for content — only `governed_summary`, 156-319 characters each. So a
-- citation contract existed with nothing to cite from, and Brix answered every
-- technique question with "I don't know", correctly but uselessly.
--
-- The corpus was not missing. It was built in the Manus session
-- (https://manus.im/share/5BNfPHDbcgJbvdHmeTZo9E) on 2026-08-23 and never
-- reached this database because that session ran out of credits at step 2 of
-- its own 4-step handoff plan. Recovered 2026-08-31 from the still-live share:
-- 158 time-coded caption records across 12 lessons of the Art of Drink
-- "Flavour & Beverage Development" course, plus 24 governed summaries of public
-- practitioner sources. See docs/BRIX_KNOWLEDGE.md.
--
-- WHAT IS DELIBERATELY NOT HERE
--
--   * No recipe data. Nothing in this migration reads or writes
--     `formula_versions`, `formula_components`, `formula_drafts` or
--     `public.recipes`. Course material explains; it never supplies a measure.
--     The CRM remains the sole source of a cocktail's quantities and the
--     approved formula the sole source of a syrup's.
--   * No approval path. Every chunk lands `pending_review` and every source
--     lands `pending_review` or `reference_only`. Retrievability is not
--     approval, and nothing here can promote a source to an operating control.
--   * No CRM memory. `public.memory` (1,213 rows) is the CRM/Max memory system.
--     Its hybrid-search PATTERN is reused below; none of its CONTENT is.
--
-- THE TIER B BOUNDARY, from the course's own ingestion handoff
--
--   "The course is Tier B training reference material. It must never silently
--    alter a formula, approve an ingredient, authorize a shelf-life claim,
--    determine a preservation plan, or release a batch."
--
-- That sentence is returned by the search function on every call rather than
-- left for the agent to remember, because a rule the model has to recall is a
-- rule that eventually gets dropped.

-- ---------------------------------------------------------------------------
-- 1. The chunk table
-- ---------------------------------------------------------------------------
--
-- One row per retrievable passage. A source without chunks is still useful —
-- that is exactly what the 24 external practitioner records are, and what the
-- 5 pre-existing rows already were: a citation plus a governed summary, with
-- no reproducible body text. Chunks are for material we are licensed to hold
-- in full (Ashley's own enrolled course), summaries for material we are not.

create extension if not exists vector;

create table if not exists beverage.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  source_id uuid not null references beverage.knowledge_sources(id) on delete cascade,

  -- Stable identity from the producing transform, e.g. 'aod-fbd-4726-001'.
  -- Re-running the ingest updates in place rather than duplicating.
  chunk_key text not null check (btrim(chunk_key) <> ''),
  ordinal integer not null check (ordinal > 0),

  body text not null check (btrim(body) <> ''),

  -- Everything a citation needs, kept as data so the agent quotes a stored
  -- locator rather than composing one. For a course caption:
  --   { "lesson_id": "4726", "lesson_number": "5", "lesson_title": "Safety",
  --     "source_url": "https://…/4726", "start_seconds": 0.169,
  --     "end_seconds": 63.024, "caption_origin": "native_en_auto_vtt" }
  locator jsonb not null default '{}'::jsonb,

  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'reviewed', 'rejected')),

  -- 768 dimensions to match `public.memory.embedding` and the
  -- nomic-embed-text model already installed on the operator's machine.
  -- Nullable on purpose: a chunk is retrievable by full text the moment it
  -- lands, so ingestion never blocks on an embedding service being up.
  -- Schema-qualified because pgvector 0.8.0 is installed into `public` here.
  embedding public.vector(768),

  search_vector tsvector generated always as (to_tsvector('english', body)) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (source_id, chunk_key)
);

create index if not exists beverage_chunks_search_idx
  on beverage.knowledge_chunks using gin (search_vector);
create index if not exists beverage_chunks_source_idx
  on beverage.knowledge_chunks (source_id, ordinal);

-- No ivfflat/hnsw index. The corpus is 158 rows; an exact scan is both faster
-- and correct, and an approximate index on a set this small silently costs
-- recall for nothing. Add one when the corpus is large enough to need it.

alter table beverage.knowledge_chunks enable row level security;

-- Deliberately zero policies, matching all 27 existing beverage tables: the
-- schema is reachable only through SECURITY DEFINER functions run by
-- service_role. See db/baseline/DRIFT.md §6 before "fixing" this.
revoke all on beverage.knowledge_chunks from public, anon, authenticated;
grant all on beverage.knowledge_chunks to service_role;

create trigger knowledge_chunks_touch_updated_at
  before update on beverage.knowledge_chunks
  for each row execute function beverage.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Ingest: sources
-- ---------------------------------------------------------------------------
--
-- Upsert by (organization, source_key) so re-running the ingest is idempotent.
-- `authority_tier`, `rights_status` and `operational_status` are all checked by
-- the column constraints written in 20260825190958 — an unknown tier is
-- rejected by the database, not normalised by the caller.

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
      governed_summary, source_metadata, created_by
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
      updated_at = now();
      -- rights_status and operational_status are NOT overwritten on conflict.
      -- Those two are the human's decision: once someone moves a source from
      -- pending_review to approved_internal, re-running the ingest must not
      -- quietly walk it back to whatever the import file happened to say.

    if v_existing is null then v_inserted := v_inserted + 1;
    else v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Ingest: chunks
-- ---------------------------------------------------------------------------

create or replace function public.beverage_ingest_knowledge_chunks(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_source_key text,
  p_chunks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $$
declare
  v_context jsonb;
  v_org_id uuid;
  v_source_id uuid;
  v_chunk jsonb;
  v_count integer := 0;
  v_embedded integer := 0;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;

  select id into v_source_id
  from beverage.knowledge_sources
  where organization_id = v_org_id and source_key = p_source_key;

  if v_source_id is null then
    raise exception 'No knowledge source with key %', p_source_key;
  end if;

  if jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'p_chunks must be a JSON array';
  end if;

  for v_chunk in select * from jsonb_array_elements(p_chunks) loop
    insert into beverage.knowledge_chunks (
      organization_id, source_id, chunk_key, ordinal, body, locator, embedding
    )
    values (
      v_org_id,
      v_source_id,
      v_chunk->>'chunk_key',
      (v_chunk->>'ordinal')::integer,
      v_chunk->>'body',
      coalesce(v_chunk->'locator', '{}'::jsonb),
      case
        when v_chunk->'embedding' is null or jsonb_typeof(v_chunk->'embedding') = 'null'
          then null
        else (v_chunk->>'embedding')::vector
      end
    )
    on conflict (source_id, chunk_key) do update set
      ordinal = excluded.ordinal,
      body = excluded.body,
      locator = excluded.locator,
      -- An ingest run with no embedding service available must not erase the
      -- embeddings a previous run wrote.
      embedding = coalesce(excluded.embedding, beverage.knowledge_chunks.embedding),
      updated_at = now();
      -- review_status is not touched: same reason as rights_status above.

    v_count := v_count + 1;
    if v_chunk->'embedding' is not null and jsonb_typeof(v_chunk->'embedding') <> 'null' then
      v_embedded := v_embedded + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'source_key', p_source_key,
    'chunks', v_count,
    'embedded', v_embedded
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Retrieval
-- ---------------------------------------------------------------------------
--
-- Returns two kinds of result under one shape:
--
--   kind='chunk'   a passage we hold in full and may quote, with its exact
--                  lesson and time range.
--   kind='source'  a source we may only cite and summarise. The 24 external
--                  practitioner records and the 5 originals are all of this
--                  kind — there is no body text to return and inventing one
--                  would be the whole failure mode this schema exists to stop.
--
-- Ranking is hybrid when an embedding is supplied and full-text-only when it is
-- not, and the answer says which ran. That is not a fallback bolted on: the
-- embedding service is a local process that may simply be off, and a silent
-- downgrade to worse results would be indistinguishable from a thin corpus.
--
-- `blocked_rights` sources are excluded outright. A chunk whose review_status
-- is 'rejected' is excluded too — a person looked at it and said no.

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
  v_vector vector(768);
  v_results jsonb;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;

  if btrim(coalesce(p_query, '')) = '' then
    raise exception 'A search query is required';
  end if;

  -- websearch_to_tsquery never raises on operator soup the way to_tsquery does,
  -- so a spoken-language question cannot produce a 500.
  v_tsquery := websearch_to_tsquery('english', p_query);

  if p_embedding is not null and btrim(p_embedding) <> '' then
    v_vector := p_embedding::vector(768);
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
      -- Both signals are normalised to 0..1 before they are weighted below:
      -- cosine similarity already is, and ts_rank is clamped. Adding raw
      -- ts_rank to a raw distance would let one term dominate by unit alone.
      ts_rank(c.search_vector, v_tsquery) as text_rank,
      case
        when v_vector is null or c.embedding is null then null
        else 1 - (c.embedding <=> v_vector)
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
      ) as text_rank,
      null::double precision as vector_similarity
    from beverage.knowledge_sources s
    where s.organization_id = v_org_id
      and s.operational_status <> 'blocked_rights'
      and btrim(s.governed_summary) <> ''
      and to_tsvector('english', s.title || ' ' || s.governed_summary ||
            ' ' || coalesce(s.source_metadata->>'topics', '')) @@ v_tsquery
  ),
  merged as (
    select * from chunk_hits
    union all
    select * from source_hits
  ),
  scored as (
    -- Weighted toward meaning over wording: someone asking "why did my syrup
    -- go cloudy" will not use the caption's vocabulary. When no embedding was
    -- supplied every similarity is 0 and this degrades to pure text rank.
    select *,
      coalesce(vector_similarity, 0) * 0.6 + least(text_rank, 1.0)::double precision * 0.4 as score
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
    -- Carried on every response so the boundary does not depend on the agent
    -- remembering it. Wording is the course's own, from its ingestion handoff.
    'boundary', 'Tier B training reference material. It must never silently '
      || 'alter a formula, approve an ingredient, authorize a shelf-life claim, '
      || 'determine a preservation plan, or release a batch. Approved MTL Craft '
      || 'formula versions and CRM recipes remain the sole authority for '
      || 'quantities, and release remains a human decision.'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Coverage
-- ---------------------------------------------------------------------------
--
-- "Which lessons can Brix actually answer from?" is a question about data, so
-- it is answered from data. The course source row carries the full 39-item
-- manifest in `source_metadata.lesson_manifest`; this function joins it against
-- what was actually ingested and reports the gap. Without this the honest
-- answer would be prose in a document, which drifts the moment more captions
-- are collected.

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

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
--
-- Browser roles get nothing. Only the server-side service_role may call these,
-- exactly as with every other beverage RPC.

revoke all on function public.beverage_ingest_knowledge_sources(text, text, boolean, jsonb)
  from public, anon, authenticated;
revoke all on function public.beverage_ingest_knowledge_chunks(text, text, boolean, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.beverage_search_knowledge(text, text, boolean, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.beverage_knowledge_coverage(text, text, boolean)
  from public, anon, authenticated;

grant execute on function public.beverage_ingest_knowledge_sources(text, text, boolean, jsonb)
  to service_role;
grant execute on function public.beverage_ingest_knowledge_chunks(text, text, boolean, text, jsonb)
  to service_role;
grant execute on function public.beverage_search_knowledge(text, text, boolean, text, text, integer)
  to service_role;
grant execute on function public.beverage_knowledge_coverage(text, text, boolean)
  to service_role;
