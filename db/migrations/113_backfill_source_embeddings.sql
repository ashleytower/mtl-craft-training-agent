-- 113: a way to embed a source that some other path created.
--
-- 112 gave `knowledge_sources` an embedding and the ingest script fills it for
-- the 37 rows it writes. It cannot fill the 5 that were already there when this
-- work started:
--
--   notion-syrups-hq-master          tier_a_internal   pending_review
--   notion-master-cocktail-recipes   tier_a_internal   pending_review
--   PUB-FS-001  Water Activity (FDA)             tier_c   reference_only
--   PUB-FS-002  Acidified & Low-Acid Canned Foods (FDA)   tier_c   reference_only
--   PUB-GR-001  Cocktail 101 (Serious Eats)      tier_c   reference_only
--
-- Those five are not in any import file — they were inserted directly in
-- 20260825190958 and 20260825225644. Two of them are the FDA water-activity and
-- acidified-foods references, which are exactly what a preservation question
-- should reach, so leaving them findable only by an exact term match would
-- rebuild the defect 112 just fixed, in the corner nobody looks at.
--
-- Rather than hard-code five keys, this is a general backfill: any source with
-- a summary and no embedding is offered up, whoever created it and whenever.
-- The next source added by hand is covered without a further migration.

-- What still needs embedding, and the exact text to embed.
--
-- The text is assembled here rather than in the script so that both paths embed
-- the same three fields in the same order. Two callers building "title, summary,
-- topics" slightly differently would put two incompatible vector spaces in one
-- column, and nothing would report it — the results would just quietly get
-- worse.
create or replace function public.beverage_knowledge_sources_pending_embedding(
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'source_key', s.source_key,
      'embed_text', concat_ws(
        E'\n',
        s.title,
        nullif(btrim(s.governed_summary), ''),
        nullif(btrim(coalesce(
          (select string_agg(topic, ', ')
           from jsonb_array_elements_text(
             case when jsonb_typeof(s.source_metadata->'topics') = 'array'
                  then s.source_metadata->'topics'
                  else '[]'::jsonb end
           ) as topic),
          ''
        )), '')
      )
    ) order by s.source_key)
    from beverage.knowledge_sources s
    where s.organization_id = v_org_id
      and s.embedding is null
      and btrim(s.governed_summary) <> ''
  ), '[]'::jsonb);
end;
$$;

-- Set one source's embedding. Touches nothing else — not the summary, not the
-- rights status, not the operational status. An embedding is an index, and
-- writing one must never be a way to edit a record.
create or replace function public.beverage_set_source_embedding(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_source_key text,
  p_embedding text
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $$
declare
  v_context jsonb;
  v_org_id uuid;
  v_updated integer;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;

  if p_embedding is null or btrim(p_embedding) = '' then
    raise exception 'An embedding is required';
  end if;

  update beverage.knowledge_sources
  set embedding = p_embedding::public.vector(768),
      updated_at = now()
  where organization_id = v_org_id and source_key = p_source_key;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'No knowledge source with key %', p_source_key;
  end if;

  return jsonb_build_object('source_key', p_source_key, 'embedded', true);
end;
$$;

revoke all on function public.beverage_knowledge_sources_pending_embedding(text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.beverage_set_source_embedding(text, text, boolean, text, text)
  from public, anon, authenticated;

grant execute on function public.beverage_knowledge_sources_pending_embedding(text, text, boolean)
  to service_role;
grant execute on function public.beverage_set_source_embedding(text, text, boolean, text, text)
  to service_role;
