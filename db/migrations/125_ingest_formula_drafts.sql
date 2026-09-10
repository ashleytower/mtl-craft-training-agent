-- 125: an idempotent way to bring formula drafts in from an external source.
--
-- NUMBERING. 125 because the shared number line runs through two repositories
-- into one database (db/baseline/DRIFT.md §2). The CRM holds 119-123 on its
-- origin/main and 124 is this repository's coverage-provenance migration.
-- Checked against origin refs, not local files.
--
-- WHY THIS EXISTS
--
-- The 76 syrup drafts in `formula_drafts` came from a Notion export that
-- followed the `Ingredients ↔ Recipes` relation and kept one or two links per
-- syrup instead of all of them. The result is not a corpus of incomplete
-- recipes, it is a corpus of fragments: `Simple syrup` holds sugar and no
-- water, `Cranberry` holds water and nothing else, `Mosaiq Ginger` holds
-- nothing but preservative. 30 of 76 rows carry exactly one ingredient.
--
-- Approving those would have Brix hand somebody a jalapeño syrup with no
-- preservative and no acid. So they are being re-imported from Notion, which
-- holds the complete recipes, and there needs to be a write path that is safe
-- to run more than once.
--
-- No such path existed. `beverage_create_formula_version` and
-- `beverage_approve_formula_version_for_subject` both write governed,
-- human-decided state. The original drafts arrived through a one-off ingestion
-- run with no reusable entry point.
--
-- WHAT THIS DOES NOT DO
--
-- It writes drafts. It cannot create a formula version and it cannot approve
-- anything; those remain a signed-in person's decision in the console. It also
-- never moves a draft's `draft_status` backwards: if a human has already
-- reviewed, rejected, or accepted a draft for versioning, a re-run leaves that
-- decision alone. That mirrors how `beverage_ingest_knowledge_sources` refuses
-- to overwrite `rights_status`, `operational_status` and `review_status`.
--
-- THE UPSERT KEY, AND WHY IT IS NOT A CONTENT HASH
--
-- `formula_drafts` is unique on (organization_id, original_source_hash). The
-- name suggests hashing the recipe text, but doing that would mean every edit
-- in Notion creates a SECOND draft for the same syrup rather than updating the
-- one that exists, and the table would accumulate a row per revision with no
-- way to tell which is current.
--
-- So the hash is taken over the SOURCE IDENTITY — the Notion page URL — which
-- is stable for the life of that syrup. One page, one draft, forever. The hash
-- of the actual content travels inside `original_recipe_json.content_sha256`,
-- so a re-run can still report "these 3 recipes changed in Notion since last
-- time" without splitting the row.

create or replace function public.beverage_ingest_formula_drafts(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_run jsonb,
  p_drafts jsonb
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
  v_run_id uuid;
  v_draft jsonb;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_content text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_status_preserved integer := 0;
  v_changed jsonb := '[]'::jsonb;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;

  if jsonb_typeof(p_drafts) <> 'array' then
    raise exception 'p_drafts must be a JSON array';
  end if;

  -- Provenance first. Every draft this call writes points at one run, so
  -- "where did this recipe come from and when" is answerable from the row
  -- rather than from whoever remembers running the script.
  insert into beverage.recipe_ingestion_runs (
    organization_id, intake_kind, source_label, original_reference,
    parser_version, parse_status, warnings, initiated_by, completed_at
  )
  values (
    v_org_id,
    -- Constrained to notion_export | spreadsheet | manual_entry |
    -- browser_asset | text | other. `other` is the honest default for an
    -- import whose provenance the caller did not name.
    coalesce(p_run->>'intake_kind', 'other'),
    coalesce(p_run->>'source_label', 'unspecified'),
    -- `original_reference` is jsonb on this table, not text. `->>` extracts a
    -- text value and the insert fails; `to_jsonb` keeps it a JSON string.
    to_jsonb(p_run->>'original_reference'),
    coalesce(p_run->>'parser_version', 'unversioned'),
    -- parse_status is constrained to received | parsed_to_draft |
    -- needs_human_review | rejected | failed. Drafts written, not approved.
    'parsed_to_draft',
    coalesce(p_run->'warnings', '[]'::jsonb),
    v_principal_id,
    now()
  )
  returning id into v_run_id;

  for v_draft in select * from jsonb_array_elements(p_drafts) loop
    if coalesce(btrim(v_draft->>'name'), '') = '' then
      raise exception 'every draft needs a name; got %', v_draft;
    end if;
    if coalesce(btrim(v_draft->>'original_source_hash'), '') = '' then
      raise exception 'draft "%" has no original_source_hash', v_draft->>'name';
    end if;

    select id, draft_status, original_recipe_json->>'content_sha256'
      into v_existing_id, v_existing_status, v_existing_content
    from beverage.formula_drafts
    where organization_id = v_org_id
      and original_source_hash = v_draft->>'original_source_hash';

    if v_existing_id is null then
      insert into beverage.formula_drafts (
        organization_id, ingestion_run_id, external_recipe_id, name,
        product_category, original_recipe_json, original_source_hash,
        intended_yield_value, intended_yield_unit, extraction_confidence,
        draft_status, warnings, created_by
      )
      values (
        v_org_id, v_run_id, v_draft->>'external_recipe_id', v_draft->>'name',
        v_draft->>'product_category',
        coalesce(v_draft->'original_recipe_json', '{}'::jsonb),
        v_draft->>'original_source_hash',
        nullif(v_draft->>'intended_yield_value', '')::numeric,
        nullif(v_draft->>'intended_yield_unit', ''),
        nullif(v_draft->>'extraction_confidence', '')::numeric,
        'needs_review',
        coalesce(v_draft->'warnings', '[]'::jsonb),
        v_principal_id
      );
      v_inserted := v_inserted + 1;

    elsif v_existing_content is not distinct from (v_draft->'original_recipe_json'->>'content_sha256') then
      -- Byte-identical to what is already stored. Touch nothing at all, so a
      -- re-run cannot churn `updated_at` and make an unchanged corpus look busy.
      v_unchanged := v_unchanged + 1;

    else
      update beverage.formula_drafts set
        ingestion_run_id      = v_run_id,
        external_recipe_id    = v_draft->>'external_recipe_id',
        name                  = v_draft->>'name',
        product_category      = v_draft->>'product_category',
        original_recipe_json  = coalesce(v_draft->'original_recipe_json', '{}'::jsonb),
        intended_yield_value  = nullif(v_draft->>'intended_yield_value', '')::numeric,
        intended_yield_unit   = nullif(v_draft->>'intended_yield_unit', ''),
        extraction_confidence = nullif(v_draft->>'extraction_confidence', '')::numeric,
        warnings              = coalesce(v_draft->'warnings', '[]'::jsonb),
        -- draft_status is deliberately absent. A human may have moved this to
        -- in_review, rejected or accepted_for_versioning; re-running an import
        -- must not drag it back to needs_review.
        updated_at            = now()
      where id = v_existing_id;

      v_updated := v_updated + 1;
      if v_existing_status is distinct from 'needs_review' then
        v_status_preserved := v_status_preserved + 1;
      end if;
      v_changed := v_changed || jsonb_build_object(
        'name', v_draft->>'name',
        'previous_content_sha256', v_existing_content,
        'draft_status_preserved', v_existing_status
      );
    end if;
  end loop;

  return jsonb_build_object(
    'run_id', v_run_id,
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'human_status_preserved', v_status_preserved,
    'changed', v_changed
  );
end;
$$;

revoke all on function public.beverage_ingest_formula_drafts(text, text, boolean, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.beverage_ingest_formula_drafts(text, text, boolean, jsonb, jsonb)
  to service_role;

-- Supersede a draft without deleting it.
--
-- The 76 fragment rows are the record of what a previous import believed, and
-- deleting them would erase the evidence that the fragments ever existed. They
-- are marked `rejected` with a reason instead, so `list drafts` stops offering
-- them while the audit trail survives.
--
-- `rejected` is one of the four values formula_drafts_draft_status_check already
-- allows, so this introduces no new vocabulary.
create or replace function public.beverage_supersede_formula_drafts(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_draft_ids jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $$
declare
  v_context jsonb;
  v_org_id uuid;
  v_superseded integer := 0;
  v_skipped_versioned integer := 0;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to supersede a draft';
  end if;
  if jsonb_typeof(p_draft_ids) <> 'array' then
    raise exception 'p_draft_ids must be a JSON array';
  end if;

  -- A draft that already produced a formula version is never superseded here.
  -- Something approved descends from it, and quietly rejecting its parent would
  -- make the approved formula look like it came from rejected work.
  select count(*) into v_skipped_versioned
  from beverage.formula_drafts d
  where d.organization_id = v_org_id
    and d.id::text in (select jsonb_array_elements_text(p_draft_ids))
    and exists (select 1 from beverage.formula_versions v where v.formula_draft_id = d.id);

  with target as (
    update beverage.formula_drafts d set
      draft_status = 'rejected',
      warnings = coalesce(d.warnings, '[]'::jsonb) || jsonb_build_object(
        'superseded_at', now(),
        'reason', p_reason
      ),
      updated_at = now()
    where d.organization_id = v_org_id
      and d.id::text in (select jsonb_array_elements_text(p_draft_ids))
      and d.draft_status <> 'rejected'
      and not exists (select 1 from beverage.formula_versions v where v.formula_draft_id = d.id)
    returning 1
  )
  select count(*) into v_superseded from target;

  return jsonb_build_object(
    'superseded', v_superseded,
    'skipped_because_versioned', v_skipped_versioned
  );
end;
$$;

revoke all on function public.beverage_supersede_formula_drafts(text, text, boolean, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.beverage_supersede_formula_drafts(text, text, boolean, jsonb, text)
  to service_role;
