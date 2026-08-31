-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260825201318
-- name: beverage_inventory_evidence_api
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- User-triggered, read-only inventory evidence recording.
-- This function records a source snapshot only; it does not call or expose any inventory write endpoint.

create or replace function public.beverage_record_inventory_evidence(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_items jsonb
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
  v_item jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Inventory evidence must be an array'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if btrim(coalesce(v_item->>'item_name', '')) = '' then raise exception 'Inventory evidence item name is required'; end if;
    insert into beverage.inventory_evidence_snapshots (
      organization_id, external_source, external_record_key, item_name, quantity, unit, location,
      observed_at, retrieved_at, mapping_confidence, unit_basis_status, freshness_status, read_only, raw_evidence
    ) values (
      v_org_id,
      coalesce(nullif(v_item->>'external_source', ''), 'cocktail-inventory-mcp'),
      nullif(v_item->>'external_record_key', ''),
      v_item->>'item_name',
      nullif(v_item->>'quantity', '')::numeric,
      nullif(v_item->>'unit', ''),
      nullif(v_item->>'location', ''),
      nullif(v_item->>'observed_at', '')::timestamptz,
      coalesce(nullif(v_item->>'retrieved_at', '')::timestamptz, now()),
      nullif(v_item->>'mapping_confidence', '')::numeric,
      coalesce(nullif(v_item->>'unit_basis_status', ''), 'unknown'),
      coalesce(nullif(v_item->>'freshness_status', ''), 'unknown'),
      true,
      coalesce(v_item->'raw_evidence', '{}'::jsonb)
    );
    v_count := v_count + 1;
  end loop;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, details)
  values (v_org_id, v_principal_id, 'inventory_evidence_recorded', 'inventory_evidence_snapshot', jsonb_build_object('count', v_count, 'read_only', true));
  return jsonb_build_object('recorded_count', v_count, 'read_only', true);
end;
$$;

revoke all on function public.beverage_record_inventory_evidence(text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.beverage_record_inventory_evidence(text, text, boolean, jsonb) to service_role;
