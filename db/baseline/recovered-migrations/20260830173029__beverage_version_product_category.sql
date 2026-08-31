-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260830173029
-- name: beverage_version_product_category
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Migration 109 — a formula version must know what kind of product it is.
--
-- beverage_create_formula_version never carried product_category over from the
-- draft, so every version had it NULL. The agent was consequently asked to
-- distinguish syrups from cocktails using data that did not exist, and offered
-- the user a choice the system could not act on. Inherit it, backfill what was
-- already created, and return it so a listing answers the question directly
-- rather than asking.

CREATE OR REPLACE FUNCTION public.beverage_create_formula_version(
  p_external_subject text, p_display_name text, p_is_owner boolean,
  p_formula_draft_id uuid, p_formula_key text, p_name text,
  p_yield_value numeric, p_yield_unit text, p_components jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'beverage','public','pg_temp' AS $function$
declare
  v_context jsonb; v_org_id uuid; v_principal_id uuid; v_role text;
  v_version beverage.formula_versions; v_next_version integer; v_yield_unit text;
  v_category text;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  v_role := v_context->>'role';
  if v_role not in ('owner','approver','operator') then raise exception 'Operator role required'; end if;
  if btrim(coalesce(p_formula_key,'')) = '' or btrim(coalesce(p_name,'')) = '' then raise exception 'Formula key and name are required'; end if;
  v_yield_unit := nullif(btrim(coalesce(p_yield_unit,'')),'');
  if (p_yield_value is null) <> (v_yield_unit is null) then
    raise exception 'A planned yield needs both a value and a unit, or neither'; end if;
  if p_yield_value is not null and p_yield_value <= 0 then
    raise exception 'A planned yield must be positive when it is supplied'; end if;
  if jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then raise exception 'At least one normalized component is required'; end if;

  select product_category into v_category from beverage.formula_drafts
   where id = p_formula_draft_id and organization_id = v_org_id;
  if not found then raise exception 'Formula draft not found in organization'; end if;

  select coalesce(max(version_number),0)+1 into v_next_version from beverage.formula_versions where organization_id = v_org_id and formula_key = p_formula_key;
  insert into beverage.formula_versions (organization_id, formula_draft_id, formula_key, version_number, name, product_category, intended_yield_value, intended_yield_unit, lifecycle_status, created_by)
  values (v_org_id, p_formula_draft_id, p_formula_key, v_next_version, p_name, v_category, p_yield_value, v_yield_unit, 'draft', v_principal_id)
  returning * into v_version;
  insert into beverage.formula_components (formula_version_id, line_number, ingredient_name, ingredient_key, quantity, unit, component_role, optional, source_locator, notes, sub_formula_key)
  select v_version.id, x.line_number, x.ingredient_name, nullif(x.ingredient_key,''), x.quantity, x.unit,
         coalesce(nullif(x.component_role,''),'ingredient'), coalesce(x.optional,false),
         nullif(x.source_locator,''), nullif(x.notes,''), nullif(x.sub_formula_key,'')
  from jsonb_to_recordset(p_components) as x(line_number integer, ingredient_name text, ingredient_key text, quantity numeric, unit text, component_role text, optional boolean, source_locator text, notes text, sub_formula_key text);
  update beverage.formula_drafts set draft_status='accepted_for_versioning' where id = p_formula_draft_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id,'formula_version_created','formula_version', v_version.id, jsonb_build_object('formula_draft_id', p_formula_draft_id));
  return jsonb_build_object('id', v_version.id,'lifecycle_status', v_version.lifecycle_status,'version_number', v_version.version_number,'product_category', v_version.product_category);
end; $function$;

UPDATE beverage.formula_versions v
   SET product_category = d.product_category
  FROM beverage.formula_drafts d
 WHERE d.id = v.formula_draft_id AND v.product_category IS NULL;

CREATE OR REPLACE FUNCTION public.beverage_list_approved_formulas(
  p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'beverage','public','pg_temp' AS $function$
declare v_context jsonb; v_org_id uuid;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'formula_key', f.formula_key, 'version_number', f.version_number,
      'name', f.name, 'product_category', f.product_category,
      'intended_yield_value', f.intended_yield_value,
      'intended_yield_unit', f.intended_yield_unit, 'approved_at', f.approved_at,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_number', c.line_number, 'ingredient_name', c.ingredient_name,
          'ingredient_key', c.ingredient_key, 'quantity', c.quantity,
          'unit', c.unit, 'component_role', c.component_role) order by c.line_number)
        from beverage.formula_components c where c.formula_version_id = f.id), '[]'::jsonb)
    ) order by f.name, f.version_number desc)
    from beverage.formula_versions f
    where f.organization_id = v_org_id and f.lifecycle_status = 'approved'), '[]'::jsonb);
end; $function$;

CREATE OR REPLACE FUNCTION public.beverage_list_pending_formula_versions(
  p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'beverage','public','pg_temp' AS $function$
declare v_context jsonb; v_org_id uuid; v_role text;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_role := v_context->>'role';
  if v_role not in ('owner','approver') then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'formula_key', f.formula_key, 'version_number', f.version_number,
      'name', f.name, 'product_category', f.product_category,
      'intended_yield_value', f.intended_yield_value,
      'intended_yield_unit', f.intended_yield_unit,
      'formula_draft_id', f.formula_draft_id,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_number', c.line_number, 'ingredient_name', c.ingredient_name,
          'quantity', c.quantity, 'unit', c.unit,
          'component_role', c.component_role, 'sub_formula_key', c.sub_formula_key) order by c.line_number)
        from beverage.formula_components c where c.formula_version_id = f.id), '[]'::jsonb)
    ) order by f.created_at desc)
    from beverage.formula_versions f
    where f.organization_id = v_org_id and f.lifecycle_status = 'draft'), '[]'::jsonb);
end; $function$;
