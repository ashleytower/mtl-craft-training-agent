-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260825234551
-- name: beverage_inventory_action_audit
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Governed inventory-action requests for the standalone Hermes operator.
-- This migration is additive and confined to the beverage schema.

create table if not exists beverage.inventory_action_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  requested_by uuid not null references beverage.principals(id) on delete restrict,
  action_type text not null check (action_type in ('pickup_add', 'usage_record', 'mark_out_of_stock')),
  request_status text not null default 'previewed' check (request_status in ('previewed', 'executing', 'applied', 'failed', 'expired', 'cancelled')),
  action_payload jsonb not null default '{}'::jsonb,
  confirmation_digest text not null check (btrim(confirmation_digest) <> ''),
  confirmation_expires_at timestamptz not null,
  confirmed_at timestamptz,
  completed_at timestamptz,
  result_payload jsonb not null default '{}'::jsonb,
  failure_message text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_action_requests_org_created_idx
  on beverage.inventory_action_requests (organization_id, created_at desc);

alter table beverage.inventory_action_requests enable row level security;
revoke all on beverage.inventory_action_requests from public, anon, authenticated;
grant all on beverage.inventory_action_requests to service_role;

create or replace function public.beverage_create_inventory_action_request(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_action_type text,
  p_action_payload jsonb,
  p_confirmation_digest text,
  p_confirmation_expires_at timestamptz
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
  v_request_id uuid;
begin
  if not p_is_owner then raise exception 'Only the MTL Craft owner may create inventory actions'; end if;
  if p_action_type not in ('pickup_add', 'usage_record', 'mark_out_of_stock') then raise exception 'Unsupported inventory action type'; end if;
  if jsonb_typeof(p_action_payload) <> 'object' then raise exception 'Inventory action payload must be an object'; end if;
  if btrim(coalesce(p_confirmation_digest, '')) = '' then raise exception 'Confirmation digest is required'; end if;
  if p_confirmation_expires_at <= now() then raise exception 'Confirmation must expire in the future'; end if;

  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;

  insert into beverage.inventory_action_requests (
    organization_id, requested_by, action_type, action_payload, confirmation_digest, confirmation_expires_at
  ) values (
    v_org_id, v_principal_id, p_action_type, p_action_payload, p_confirmation_digest, p_confirmation_expires_at
  ) returning id into v_request_id;

  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'inventory_action_previewed', 'inventory_action_request', v_request_id,
    jsonb_build_object('action_type', p_action_type, 'expires_at', p_confirmation_expires_at));

  return jsonb_build_object('request_id', v_request_id, 'status', 'previewed', 'expires_at', p_confirmation_expires_at);
end;
$$;

create or replace function public.beverage_claim_inventory_action_request(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_request_id uuid,
  p_confirmation_digest text
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
  v_request beverage.inventory_action_requests%rowtype;
begin
  if not p_is_owner then raise exception 'Only the MTL Craft owner may confirm inventory actions'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;

  select * into v_request
  from beverage.inventory_action_requests
  where id = p_request_id and organization_id = v_org_id and requested_by = v_principal_id
  for update;

  if not found then raise exception 'Inventory action request not found'; end if;
  if v_request.request_status <> 'previewed' then raise exception 'Inventory action request is no longer confirmable'; end if;
  if v_request.confirmation_expires_at <= now() then
    update beverage.inventory_action_requests set request_status = 'expired' where id = v_request.id;
    raise exception 'Inventory action confirmation expired';
  end if;
  if v_request.confirmation_digest <> p_confirmation_digest then raise exception 'Inventory action confirmation is invalid'; end if;

  update beverage.inventory_action_requests
  set request_status = 'executing', confirmed_at = now()
  where id = v_request.id;

  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'inventory_action_confirmed', 'inventory_action_request', v_request.id,
    jsonb_build_object('action_type', v_request.action_type));

  return jsonb_build_object('request_id', v_request.id, 'action_type', v_request.action_type, 'action_payload', v_request.action_payload);
end;
$$;

create or replace function public.beverage_finish_inventory_action_request(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_request_id uuid,
  p_succeeded boolean,
  p_result_payload jsonb,
  p_failure_message text default null
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
  v_action_type text;
begin
  if not p_is_owner then raise exception 'Only the MTL Craft owner may finish inventory actions'; end if;
  if jsonb_typeof(p_result_payload) <> 'object' then raise exception 'Inventory action result must be an object'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;

  select action_type into v_action_type
  from beverage.inventory_action_requests
  where id = p_request_id and organization_id = v_org_id and requested_by = v_principal_id and request_status = 'executing'
  for update;
  if not found then raise exception 'Inventory action request is not executing'; end if;

  update beverage.inventory_action_requests
  set request_status = case when p_succeeded then 'applied' else 'failed' end,
      result_payload = p_result_payload,
      failure_message = case when p_succeeded then null else left(coalesce(p_failure_message, 'Inventory action failed'), 1000) end,
      completed_at = now()
  where id = p_request_id;

  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id,
    case when p_succeeded then 'inventory_action_applied' else 'inventory_action_failed' end,
    'inventory_action_request', p_request_id,
    jsonb_build_object('action_type', v_action_type, 'result', p_result_payload));

  return jsonb_build_object('request_id', p_request_id, 'status', case when p_succeeded then 'applied' else 'failed' end);
end;
$$;

create or replace function public.beverage_list_operator_history(
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
    select jsonb_agg(entry order by (entry->>'occurred_at')::timestamptz desc)
    from (
      select jsonb_build_object('kind', 'calculation_plan', 'occurred_at', created_at, 'title', plan_type, 'detail', result_status, 'entity_id', id) as entry
      from beverage.calculation_plans where organization_id = v_org_id
      union all
      select jsonb_build_object('kind', 'approval', 'occurred_at', created_at, 'title', decision, 'detail', entity_type, 'entity_id', id) as entry
      from beverage.approval_decisions where organization_id = v_org_id
      union all
      select jsonb_build_object('kind', 'research', 'occurred_at', created_at, 'title', candidate_status, 'detail', title, 'entity_id', id) as entry
      from beverage.research_candidates where organization_id = v_org_id
      union all
      select jsonb_build_object('kind', 'inventory_action', 'occurred_at', created_at, 'title', action_type, 'detail', request_status, 'entity_id', id) as entry
      from beverage.inventory_action_requests where organization_id = v_org_id
      union all
      select jsonb_build_object('kind', 'audit', 'occurred_at', created_at, 'title', event_type, 'detail', entity_type, 'entity_id', id) as entry
      from beverage.audit_events where organization_id = v_org_id
    ) as events
    limit 100
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.beverage_create_inventory_action_request(text, text, boolean, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.beverage_claim_inventory_action_request(text, text, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.beverage_finish_inventory_action_request(text, text, boolean, uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.beverage_create_inventory_action_request(text, text, boolean, text, jsonb, text, timestamptz) to service_role;
grant execute on function public.beverage_claim_inventory_action_request(text, text, boolean, uuid, text) to service_role;
grant execute on function public.beverage_finish_inventory_action_request(text, text, boolean, uuid, boolean, jsonb, text) to service_role;
