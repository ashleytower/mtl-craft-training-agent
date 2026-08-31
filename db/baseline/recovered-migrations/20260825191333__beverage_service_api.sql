-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260825191333
-- name: beverage_service_api
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Service-role-only RPC boundary for the standalone WebDev backend.
-- These public functions are additive and do not read or write existing public tables.
-- Browser roles receive no EXECUTE grant; only the server-side service_role may call them.

create or replace function public.beverage_ensure_context(
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
  v_organization beverage.organizations;
  v_principal beverage.principals;
  v_role text;
begin
  if btrim(coalesce(p_external_subject, '')) = '' then
    raise exception 'Authenticated subject is required';
  end if;

  select * into v_organization from beverage.organizations where slug = 'mtl-craft-cocktails';
  if not found then raise exception 'MTL Craft beverage organization is not initialized'; end if;

  insert into beverage.principals (identity_provider, external_subject, display_name)
  values ('manus_oauth', p_external_subject, nullif(btrim(coalesce(p_display_name, '')), ''))
  on conflict (identity_provider, external_subject) do update
    set display_name = coalesce(excluded.display_name, beverage.principals.display_name)
  returning * into v_principal;

  if p_is_owner then
    insert into beverage.organization_memberships (organization_id, principal_id, role)
    values (v_organization.id, v_principal.id, 'owner')
    on conflict (organization_id, principal_id) do update set role = 'owner';
  end if;

  select role into v_role
  from beverage.organization_memberships
  where organization_id = v_organization.id and principal_id = v_principal.id;

  if v_role is null then
    raise exception 'No beverage organization membership exists for this operator';
  end if;

  return jsonb_build_object(
    'organization_id', v_organization.id,
    'organization_name', v_organization.name,
    'principal_id', v_principal.id,
    'role', v_role
  );
end;
$$;

create or replace function public.beverage_dashboard(
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
  return jsonb_build_object(
    'context', v_context,
    'pending_draft_count', (select count(*) from beverage.formula_drafts where organization_id = v_org_id and draft_status in ('needs_review', 'in_review')),
    'approved_formula_count', (select count(*) from beverage.formula_versions where organization_id = v_org_id and lifecycle_status = 'approved'),
    'planning_calculation_count', (select count(*) from beverage.calculation_plans where organization_id = v_org_id),
    'temporary_trend_count', (select count(*) from beverage.trend_cards where organization_id = v_org_id and retention_status = 'temporary')
  );
end;
$$;

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
      'created_at', created_at
    ) order by name)
    from beverage.formula_drafts
    where organization_id = v_org_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.beverage_list_approved_formulas(
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
      'id', f.id,
      'formula_key', f.formula_key,
      'version_number', f.version_number,
      'name', f.name,
      'intended_yield_value', f.intended_yield_value,
      'intended_yield_unit', f.intended_yield_unit,
      'approved_at', f.approved_at,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_number', c.line_number,
          'ingredient_name', c.ingredient_name,
          'ingredient_key', c.ingredient_key,
          'quantity', c.quantity,
          'unit', c.unit,
          'component_role', c.component_role
        ) order by c.line_number)
        from beverage.formula_components c
        where c.formula_version_id = f.id
      ), '[]'::jsonb)
    ) order by f.name, f.version_number desc)
    from beverage.formula_versions f
    where f.organization_id = v_org_id and f.lifecycle_status = 'approved'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.beverage_create_formula_version(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_formula_draft_id uuid,
  p_formula_key text,
  p_name text,
  p_yield_value numeric,
  p_yield_unit text,
  p_components jsonb
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
  v_role text;
  v_version beverage.formula_versions;
  v_next_version integer;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  v_role := v_context->>'role';
  if v_role not in ('owner', 'approver', 'operator') then raise exception 'Operator role required'; end if;
  if btrim(coalesce(p_formula_key, '')) = '' or btrim(coalesce(p_name, '')) = '' then raise exception 'Formula key and name are required'; end if;
  if p_yield_value is null or p_yield_value <= 0 or btrim(coalesce(p_yield_unit, '')) = '' then raise exception 'A positive planned yield and unit are required'; end if;
  if jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then raise exception 'At least one normalized component is required'; end if;
  if not exists (select 1 from beverage.formula_drafts where id = p_formula_draft_id and organization_id = v_org_id) then raise exception 'Formula draft not found in organization'; end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from beverage.formula_versions where organization_id = v_org_id and formula_key = p_formula_key;

  insert into beverage.formula_versions (
    organization_id, formula_draft_id, formula_key, version_number, name,
    intended_yield_value, intended_yield_unit, lifecycle_status, created_by
  ) values (
    v_org_id, p_formula_draft_id, p_formula_key, v_next_version, p_name,
    p_yield_value, p_yield_unit, 'draft', v_principal_id
  ) returning * into v_version;

  insert into beverage.formula_components (
    formula_version_id, line_number, ingredient_name, ingredient_key, quantity, unit, component_role, optional, source_locator, notes
  )
  select
    v_version.id,
    x.line_number,
    x.ingredient_name,
    nullif(x.ingredient_key, ''),
    x.quantity,
    x.unit,
    coalesce(nullif(x.component_role, ''), 'ingredient'),
    coalesce(x.optional, false),
    nullif(x.source_locator, ''),
    nullif(x.notes, '')
  from jsonb_to_recordset(p_components) as x(
    line_number integer,
    ingredient_name text,
    ingredient_key text,
    quantity numeric,
    unit text,
    component_role text,
    optional boolean,
    source_locator text,
    notes text
  );

  update beverage.formula_drafts set draft_status = 'accepted_for_versioning' where id = p_formula_draft_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'formula_version_created', 'formula_version', v_version.id, jsonb_build_object('formula_draft_id', p_formula_draft_id));
  return jsonb_build_object('id', v_version.id, 'lifecycle_status', v_version.lifecycle_status, 'version_number', v_version.version_number);
end;
$$;

create or replace function public.beverage_approve_formula_version_for_subject(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_formula_version_id uuid,
  p_rationale text
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $$
declare
  v_context jsonb;
  v_formula beverage.formula_versions;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_formula := beverage.approve_formula_version(p_formula_version_id, (v_context->>'principal_id')::uuid, p_rationale);
  return jsonb_build_object('id', v_formula.id, 'lifecycle_status', v_formula.lifecycle_status, 'approved_at', v_formula.approved_at);
end;
$$;

create or replace function public.beverage_record_calculation_plan(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_formula_version_id uuid,
  p_plan_type text,
  p_input_payload jsonb,
  p_output_payload jsonb
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
  v_plan beverage.calculation_plans;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  if not exists (select 1 from beverage.formula_versions where id = p_formula_version_id and organization_id = v_org_id and lifecycle_status = 'approved') then
    raise exception 'Planning tools require an approved formula version';
  end if;
  insert into beverage.calculation_plans (organization_id, formula_version_id, plan_type, input_payload, output_payload, result_status, created_by)
  values (v_org_id, p_formula_version_id, p_plan_type, coalesce(p_input_payload, '{}'::jsonb), coalesce(p_output_payload, '{}'::jsonb), 'planning_only_not_released', v_principal_id)
  returning * into v_plan;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'calculation_plan_recorded', 'calculation_plan', v_plan.id, jsonb_build_object('plan_type', p_plan_type));
  return jsonb_build_object('id', v_plan.id, 'result_status', v_plan.result_status, 'created_at', v_plan.created_at);
end;
$$;

revoke all on function public.beverage_ensure_context(text, text, boolean) from public, anon, authenticated;
revoke all on function public.beverage_dashboard(text, text, boolean) from public, anon, authenticated;
revoke all on function public.beverage_list_formula_drafts(text, text, boolean) from public, anon, authenticated;
revoke all on function public.beverage_list_approved_formulas(text, text, boolean) from public, anon, authenticated;
revoke all on function public.beverage_create_formula_version(text, text, boolean, uuid, text, text, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.beverage_approve_formula_version_for_subject(text, text, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.beverage_record_calculation_plan(text, text, boolean, uuid, text, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.beverage_ensure_context(text, text, boolean) to service_role;
grant execute on function public.beverage_dashboard(text, text, boolean) to service_role;
grant execute on function public.beverage_list_formula_drafts(text, text, boolean) to service_role;
grant execute on function public.beverage_list_approved_formulas(text, text, boolean) to service_role;
grant execute on function public.beverage_create_formula_version(text, text, boolean, uuid, text, text, numeric, text, jsonb) to service_role;
grant execute on function public.beverage_approve_formula_version_for_subject(text, text, boolean, uuid, text) to service_role;
grant execute on function public.beverage_record_calculation_plan(text, text, boolean, uuid, text, jsonb, jsonb) to service_role;
