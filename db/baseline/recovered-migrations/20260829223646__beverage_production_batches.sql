-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260829223646
-- name: beverage_production_batches
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Migration 108 — beverage: yield and cost are outcomes, not plans.

ALTER TABLE beverage.formula_versions ALTER COLUMN intended_yield_value DROP NOT NULL;
ALTER TABLE beverage.formula_versions ALTER COLUMN intended_yield_unit DROP NOT NULL;
ALTER TABLE beverage.formula_versions DROP CONSTRAINT IF EXISTS formula_versions_intended_yield_pair_check;
ALTER TABLE beverage.formula_versions ADD CONSTRAINT formula_versions_intended_yield_pair_check
  CHECK ((intended_yield_value IS NULL AND intended_yield_unit IS NULL)
      OR (intended_yield_value IS NOT NULL AND intended_yield_unit IS NOT NULL));

CREATE TABLE IF NOT EXISTS beverage.production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES beverage.organizations(id) ON DELETE RESTRICT,
  formula_version_id uuid NOT NULL REFERENCES beverage.formula_versions(id) ON DELETE RESTRICT,
  batch_label text NOT NULL CHECK (btrim(batch_label) <> ''),
  made_on date NOT NULL,
  measured_yield_value numeric CHECK (measured_yield_value > 0),
  measured_yield_unit text CHECK (btrim(measured_yield_unit) <> ''),
  notes text,
  created_by uuid REFERENCES beverage.principals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT production_batches_measured_yield_pair_check CHECK (
    (measured_yield_value IS NULL AND measured_yield_unit IS NULL)
    OR (measured_yield_value IS NOT NULL AND measured_yield_unit IS NOT NULL)),
  CONSTRAINT production_batches_label_unique UNIQUE (organization_id, formula_version_id, batch_label)
);
CREATE INDEX IF NOT EXISTS production_batches_formula_version_idx
  ON beverage.production_batches (formula_version_id, made_on DESC);
ALTER TABLE beverage.production_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON beverage.production_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON beverage.production_batches TO service_role;

ALTER TABLE beverage.batch_cost_deltas ADD COLUMN IF NOT EXISTS production_batch_id uuid
  REFERENCES beverage.production_batches(id) ON DELETE RESTRICT;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM beverage.batch_cost_deltas WHERE production_batch_id IS NULL) THEN
    RAISE EXCEPTION 'batch_cost_deltas has rows with no production_batch_id; backfill before enforcing NOT NULL';
  END IF;
  ALTER TABLE beverage.batch_cost_deltas ALTER COLUMN production_batch_id SET NOT NULL;
END $do$;

ALTER TABLE beverage.inventory_evidence_snapshots ADD COLUMN IF NOT EXISTS production_batch_id uuid
  REFERENCES beverage.production_batches(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS beverage.batch_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES beverage.organizations(id) ON DELETE RESTRICT,
  production_batch_id uuid NOT NULL REFERENCES beverage.production_batches(id) ON DELETE RESTRICT,
  item_name text NOT NULL CHECK (btrim(item_name) <> ''),
  external_source text CHECK (btrim(external_source) <> ''),
  external_record_key text CHECK (btrim(external_record_key) <> ''),
  quantity_purchased numeric NOT NULL CHECK (quantity_purchased > 0),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  amount_paid numeric NOT NULL CHECK (amount_paid >= 0),
  currency_code text NOT NULL DEFAULT 'CAD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  supplier text,
  invoice_reference text,
  purchased_on date,
  created_by uuid REFERENCES beverage.principals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS batch_inputs_batch_idx ON beverage.batch_inputs (production_batch_id);
ALTER TABLE beverage.batch_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON beverage.batch_inputs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON beverage.batch_inputs TO service_role;

ALTER TABLE beverage.formula_components ADD COLUMN IF NOT EXISTS sub_formula_key text;
ALTER TABLE beverage.formula_components DROP CONSTRAINT IF EXISTS formula_components_component_role_check;
ALTER TABLE beverage.formula_components ADD CONSTRAINT formula_components_component_role_check
  CHECK (component_role = ANY (ARRAY['ingredient','water','sweetener','acid','preservative','processing_aid','packaging_loss','intermediate']));
ALTER TABLE beverage.formula_components DROP CONSTRAINT IF EXISTS formula_components_sub_formula_check;
ALTER TABLE beverage.formula_components ADD CONSTRAINT formula_components_sub_formula_check
  CHECK ((component_role = 'intermediate' AND btrim(coalesce(sub_formula_key,'')) <> '')
      OR (component_role <> 'intermediate' AND sub_formula_key IS NULL));

CREATE OR REPLACE FUNCTION public.beverage_create_formula_version(
  p_external_subject text, p_display_name text, p_is_owner boolean,
  p_formula_draft_id uuid, p_formula_key text, p_name text,
  p_yield_value numeric, p_yield_unit text, p_components jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'beverage','public','pg_temp' AS $function$
declare
  v_context jsonb; v_org_id uuid; v_principal_id uuid; v_role text;
  v_version beverage.formula_versions; v_next_version integer; v_yield_unit text;
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
  if not exists (select 1 from beverage.formula_drafts where id = p_formula_draft_id and organization_id = v_org_id) then raise exception 'Formula draft not found in organization'; end if;
  select coalesce(max(version_number),0)+1 into v_next_version from beverage.formula_versions where organization_id = v_org_id and formula_key = p_formula_key;
  insert into beverage.formula_versions (organization_id, formula_draft_id, formula_key, version_number, name, intended_yield_value, intended_yield_unit, lifecycle_status, created_by)
  values (v_org_id, p_formula_draft_id, p_formula_key, v_next_version, p_name, p_yield_value, v_yield_unit, 'draft', v_principal_id)
  returning * into v_version;
  insert into beverage.formula_components (formula_version_id, line_number, ingredient_name, ingredient_key, quantity, unit, component_role, optional, source_locator, notes, sub_formula_key)
  select v_version.id, x.line_number, x.ingredient_name, nullif(x.ingredient_key,''), x.quantity, x.unit,
         coalesce(nullif(x.component_role,''),'ingredient'), coalesce(x.optional,false),
         nullif(x.source_locator,''), nullif(x.notes,''), nullif(x.sub_formula_key,'')
  from jsonb_to_recordset(p_components) as x(line_number integer, ingredient_name text, ingredient_key text, quantity numeric, unit text, component_role text, optional boolean, source_locator text, notes text, sub_formula_key text);
  update beverage.formula_drafts set draft_status='accepted_for_versioning' where id = p_formula_draft_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id,'formula_version_created','formula_version', v_version.id, jsonb_build_object('formula_draft_id', p_formula_draft_id));
  return jsonb_build_object('id', v_version.id,'lifecycle_status', v_version.lifecycle_status,'version_number', v_version.version_number);
end; $function$;

CREATE OR REPLACE FUNCTION public.beverage_open_production_batch(
  p_external_subject text, p_display_name text, p_is_owner boolean,
  p_formula_version_id uuid, p_batch_label text, p_made_on date, p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'beverage','public','pg_temp' AS $function$
declare v_context jsonb; v_org_id uuid; v_principal_id uuid; v_batch beverage.production_batches;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  if btrim(coalesce(p_batch_label,'')) = '' then raise exception 'A batch label is required'; end if;
  if p_made_on is null then raise exception 'The date the batch was made is required'; end if;
  if not exists (select 1 from beverage.formula_versions where id = p_formula_version_id and organization_id = v_org_id and lifecycle_status='approved') then
    raise exception 'Only an approved formula version can be produced'; end if;
  insert into beverage.production_batches (organization_id, formula_version_id, batch_label, made_on, notes, created_by)
  values (v_org_id, p_formula_version_id, btrim(p_batch_label), p_made_on, nullif(btrim(coalesce(p_notes,'')),''), v_principal_id)
  returning * into v_batch;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id,'production_batch_opened','production_batch', v_batch.id, jsonb_build_object('formula_version_id', p_formula_version_id,'batch_label', v_batch.batch_label));
  return jsonb_build_object('id', v_batch.id,'batch_label', v_batch.batch_label,'made_on', v_batch.made_on);
end; $function$;

CREATE OR REPLACE FUNCTION public.beverage_record_measured_yield(
  p_external_subject text, p_display_name text, p_is_owner boolean,
  p_production_batch_id uuid, p_measured_yield_value numeric, p_measured_yield_unit text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'beverage','public','pg_temp' AS $function$
declare v_context jsonb; v_org_id uuid; v_principal_id uuid; v_batch beverage.production_batches;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  if p_measured_yield_value is null or p_measured_yield_value <= 0 then raise exception 'A measured yield must be a positive number'; end if;
  if btrim(coalesce(p_measured_yield_unit,'')) = '' then raise exception 'A measured yield needs a unit'; end if;
  select * into v_batch from beverage.production_batches where id = p_production_batch_id and organization_id = v_org_id for update;
  if not found then raise exception 'Production batch not found'; end if;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id,'production_batch_yield_recorded','production_batch', v_batch.id,
          jsonb_build_object('previous_value', v_batch.measured_yield_value,'previous_unit', v_batch.measured_yield_unit,'value', p_measured_yield_value,'unit', btrim(p_measured_yield_unit)));
  update beverage.production_batches set measured_yield_value = p_measured_yield_value,
    measured_yield_unit = btrim(p_measured_yield_unit), updated_at = clock_timestamp()
  where id = v_batch.id returning * into v_batch;
  return jsonb_build_object('id', v_batch.id,'batch_label', v_batch.batch_label,'measured_yield_value', v_batch.measured_yield_value,'measured_yield_unit', v_batch.measured_yield_unit);
end; $function$;

CREATE OR REPLACE FUNCTION public.beverage_record_batch_cost_delta(
  p_external_subject text, p_display_name text, p_is_owner boolean,
  p_production_batch_id uuid, p_cost_baseline_id uuid, p_label text,
  p_delta_amount numeric, p_rationale text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'beverage','public','pg_temp' AS $function$
declare v_context jsonb; v_org_id uuid; v_principal_id uuid; v_delta beverage.batch_cost_deltas;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  if btrim(coalesce(p_label,'')) = '' then raise exception 'A cost label is required'; end if;
  if btrim(coalesce(p_rationale,'')) = '' then raise exception 'A rationale is required for a cost delta'; end if;
  if p_delta_amount is null then raise exception 'A delta amount is required'; end if;
  if not exists (select 1 from beverage.production_batches where id = p_production_batch_id and organization_id = v_org_id) then raise exception 'Production batch not found'; end if;
  if not exists (select 1 from beverage.cost_baselines where id = p_cost_baseline_id and organization_id = v_org_id) then raise exception 'Cost baseline not found'; end if;
  insert into beverage.batch_cost_deltas (organization_id, cost_baseline_id, production_batch_id, label, delta_amount, rationale, created_by)
  values (v_org_id, p_cost_baseline_id, p_production_batch_id, btrim(p_label), p_delta_amount, btrim(p_rationale), v_principal_id)
  returning * into v_delta;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id,'batch_cost_delta_recorded','batch_cost_delta', v_delta.id, jsonb_build_object('production_batch_id', p_production_batch_id,'label', v_delta.label,'delta_amount', v_delta.delta_amount));
  return jsonb_build_object('id', v_delta.id,'label', v_delta.label,'delta_amount', v_delta.delta_amount);
end; $function$;

CREATE OR REPLACE FUNCTION public.beverage_record_batch_input(
  p_external_subject text, p_display_name text, p_is_owner boolean,
  p_production_batch_id uuid, p_item_name text, p_quantity_purchased numeric,
  p_unit text, p_amount_paid numeric, p_currency_code text DEFAULT 'CAD',
  p_supplier text DEFAULT NULL, p_invoice_reference text DEFAULT NULL,
  p_purchased_on date DEFAULT NULL, p_external_source text DEFAULT NULL,
  p_external_record_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'beverage','public','pg_temp' AS $function$
declare v_context jsonb; v_org_id uuid; v_principal_id uuid; v_input beverage.batch_inputs;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  if btrim(coalesce(p_item_name,'')) = '' then raise exception 'An item name is required'; end if;
  if btrim(coalesce(p_unit,'')) = '' then raise exception 'A unit is required'; end if;
  if p_quantity_purchased is null or p_quantity_purchased <= 0 then raise exception 'A purchased quantity must be positive'; end if;
  if p_amount_paid is null or p_amount_paid < 0 then raise exception 'An amount paid is required and cannot be negative'; end if;
  if not exists (select 1 from beverage.production_batches where id = p_production_batch_id and organization_id = v_org_id) then raise exception 'Production batch not found'; end if;
  insert into beverage.batch_inputs (organization_id, production_batch_id, item_name, external_source, external_record_key, quantity_purchased, unit, amount_paid, currency_code, supplier, invoice_reference, purchased_on, created_by)
  values (v_org_id, p_production_batch_id, btrim(p_item_name), nullif(btrim(coalesce(p_external_source,'')),''), nullif(btrim(coalesce(p_external_record_key,'')),''),
          p_quantity_purchased, btrim(p_unit), p_amount_paid, upper(coalesce(p_currency_code,'CAD')),
          nullif(btrim(coalesce(p_supplier,'')),''), nullif(btrim(coalesce(p_invoice_reference,'')),''), p_purchased_on, v_principal_id)
  returning * into v_input;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id,'batch_input_recorded','batch_input', v_input.id,
          jsonb_build_object('production_batch_id', p_production_batch_id,'item_name', v_input.item_name,'quantity_purchased', v_input.quantity_purchased,'unit', v_input.unit,'amount_paid', v_input.amount_paid));
  return jsonb_build_object('id', v_input.id,'item_name', v_input.item_name,'quantity_purchased', v_input.quantity_purchased,'unit', v_input.unit,'amount_paid', v_input.amount_paid,'currency_code', v_input.currency_code);
end; $function$;

REVOKE ALL ON FUNCTION public.beverage_open_production_batch(text, text, boolean, uuid, text, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.beverage_record_measured_yield(text, text, boolean, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.beverage_record_batch_cost_delta(text, text, boolean, uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.beverage_record_batch_input(text, text, boolean, uuid, text, numeric, text, numeric, text, text, text, date, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.beverage_open_production_batch(text, text, boolean, uuid, text, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.beverage_record_measured_yield(text, text, boolean, uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.beverage_record_batch_cost_delta(text, text, boolean, uuid, uuid, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.beverage_record_batch_input(text, text, boolean, uuid, text, numeric, text, numeric, text, text, text, date, text, text) TO service_role;
