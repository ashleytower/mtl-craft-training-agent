-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260826005014
-- name: beverage_inventory_reset_action
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Add the owner-confirmed fresh-start reset to the governed inventory-action ledger.

alter table beverage.inventory_action_requests
  drop constraint if exists inventory_action_requests_action_type_check;

alter table beverage.inventory_action_requests
  add constraint inventory_action_requests_action_type_check
  check (action_type in ('pickup_add', 'usage_record', 'mark_out_of_stock', 'inventory_reset'));

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
  if p_action_type not in ('pickup_add', 'usage_record', 'mark_out_of_stock', 'inventory_reset') then raise exception 'Unsupported inventory action type'; end if;
  if jsonb_typeof(p_action_payload) <> 'object' then raise exception 'Inventory action payload must be an object'; end if;
  if btrim(coalesce(p_confirmation_digest, '')) = '' then raise exception 'Confirmation digest is required'; end if;
  if p_confirmation_expires_at <= now() then raise exception 'Confirmation must expire in the future'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  insert into beverage.inventory_action_requests (organization_id, requested_by, action_type, action_payload, confirmation_digest, confirmation_expires_at)
  values (v_org_id, v_principal_id, p_action_type, p_action_payload, p_confirmation_digest, p_confirmation_expires_at)
  returning id into v_request_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'inventory_action_previewed', 'inventory_action_request', v_request_id,
    jsonb_build_object('action_type', p_action_type, 'expires_at', p_confirmation_expires_at));
  return jsonb_build_object('request_id', v_request_id, 'status', 'previewed', 'expires_at', p_confirmation_expires_at);
end;
$$;

revoke all on function public.beverage_create_inventory_action_request(text, text, boolean, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.beverage_create_inventory_action_request(text, text, boolean, text, jsonb, text, timestamptz) to service_role;
