-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260826003107
-- name: beverage_experiment_workflow
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Governed internal experiment workflow. This is additive and confined to beverage.

create or replace function public.beverage_create_experiment(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_title text,
  p_hypothesis text,
  p_formula_version_id uuid default null,
  p_trend_card_id uuid default null
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
  v_experiment_id uuid;
begin
  if btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_hypothesis, '')) = '' then
    raise exception 'Experiment title and hypothesis are required';
  end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  if p_formula_version_id is not null and not exists (
    select 1 from beverage.formula_versions where id = p_formula_version_id and organization_id = v_org_id and lifecycle_status = 'approved'
  ) then raise exception 'Experiment formula must be an approved organization formula'; end if;
  if p_trend_card_id is not null and not exists (
    select 1 from beverage.trend_cards where id = p_trend_card_id and organization_id = v_org_id
  ) then raise exception 'Experiment trend card must belong to the organization'; end if;

  insert into beverage.experiments (organization_id, title, hypothesis, formula_version_id, trend_card_id, created_by)
  values (v_org_id, left(p_title, 300), left(p_hypothesis, 4000), p_formula_version_id, p_trend_card_id, v_principal_id)
  returning id into v_experiment_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'experiment_created', 'experiment', v_experiment_id, jsonb_build_object('status', 'draft'));
  return jsonb_build_object('experiment_id', v_experiment_id, 'status', 'draft');
end;
$$;

create or replace function public.beverage_decide_experiment(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_experiment_id uuid,
  p_status text,
  p_rationale text
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
  v_decision text;
begin
  if not p_is_owner then raise exception 'Only the MTL Craft owner may decide an experiment status'; end if;
  if p_status not in ('ready_for_internal_test', 'internal_knowledge', 'rejected', 'archived') then raise exception 'Unsupported experiment status'; end if;
  if btrim(coalesce(p_rationale, '')) = '' then raise exception 'Experiment decision rationale is required'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  if not exists (select 1 from beverage.experiments where id = p_experiment_id and organization_id = v_org_id) then raise exception 'Experiment not found'; end if;

  update beverage.experiments set status = p_status where id = p_experiment_id and organization_id = v_org_id;
  v_decision := case when p_status = 'internal_knowledge' then 'approved' when p_status = 'rejected' then 'rejected' else 'saved_reference_only' end;
  insert into beverage.approval_decisions (organization_id, entity_type, entity_id, decision, rationale, decided_by)
  values (v_org_id, 'experiment', p_experiment_id, v_decision, left(p_rationale, 1000), v_principal_id);
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'experiment_status_decided', 'experiment', p_experiment_id, jsonb_build_object('status', p_status, 'rationale', left(p_rationale, 1000)));
  return jsonb_build_object('experiment_id', p_experiment_id, 'status', p_status);
end;
$$;

create or replace function public.beverage_list_experiments(
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
      'id', id, 'title', title, 'hypothesis', hypothesis, 'status', status,
      'formula_version_id', formula_version_id, 'trend_card_id', trend_card_id,
      'safety_note', safety_note, 'created_at', created_at
    ) order by created_at desc)
    from beverage.experiments where organization_id = v_org_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.beverage_create_experiment(text, text, boolean, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.beverage_decide_experiment(text, text, boolean, uuid, text, text) from public, anon, authenticated;
revoke all on function public.beverage_list_experiments(text, text, boolean) from public, anon, authenticated;
grant execute on function public.beverage_create_experiment(text, text, boolean, text, text, uuid, uuid) to service_role;
grant execute on function public.beverage_decide_experiment(text, text, boolean, uuid, text, text) to service_role;
grant execute on function public.beverage_list_experiments(text, text, boolean) to service_role;
