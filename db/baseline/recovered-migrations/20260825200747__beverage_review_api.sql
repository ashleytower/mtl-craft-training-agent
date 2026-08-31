-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260825200747
-- name: beverage_review_api
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Additive review access for the standalone beverage operator interface.
-- Browser roles remain unable to call these functions directly.

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
      'original_recipe_json', original_recipe_json,
      'created_at', created_at
    ) order by name)
    from beverage.formula_drafts
    where organization_id = v_org_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.beverage_list_pending_formula_versions(
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
  v_role text;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_role := v_context->>'role';
  if v_role not in ('owner', 'approver') then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'formula_key', f.formula_key,
      'version_number', f.version_number,
      'name', f.name,
      'intended_yield_value', f.intended_yield_value,
      'intended_yield_unit', f.intended_yield_unit,
      'formula_draft_id', f.formula_draft_id,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_number', c.line_number,
          'ingredient_name', c.ingredient_name,
          'quantity', c.quantity,
          'unit', c.unit,
          'component_role', c.component_role
        ) order by c.line_number)
        from beverage.formula_components c
        where c.formula_version_id = f.id
      ), '[]'::jsonb)
    ) order by f.created_at desc)
    from beverage.formula_versions f
    where f.organization_id = v_org_id and f.lifecycle_status = 'draft'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.beverage_list_formula_drafts(text, text, boolean) from public, anon, authenticated;
revoke all on function public.beverage_list_pending_formula_versions(text, text, boolean) from public, anon, authenticated;
grant execute on function public.beverage_list_formula_drafts(text, text, boolean) to service_role;
grant execute on function public.beverage_list_pending_formula_versions(text, text, boolean) to service_role;
