-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260826003944
-- name: beverage_draft_provenance_read
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Extend the source-preserved draft read model with explicit provenance identifiers.

create or replace function public.beverage_list_formula_drafts(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean default false
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
      'id', id,
      'name', name,
      'product_category', product_category,
      'draft_status', draft_status,
      'intended_yield_value', intended_yield_value,
      'intended_yield_unit', intended_yield_unit,
      'warnings', warnings,
      'source_url', external_recipe_id,
      'ingestion_run_id', ingestion_run_id,
      'original_source_hash', original_source_hash,
      'original_recipe_json', original_recipe_json,
      'created_at', created_at
    ) order by name)
    from beverage.formula_drafts
    where organization_id = v_org_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.beverage_list_formula_drafts(text, text, boolean) from public, anon, authenticated;
grant execute on function public.beverage_list_formula_drafts(text, text, boolean) to service_role;
