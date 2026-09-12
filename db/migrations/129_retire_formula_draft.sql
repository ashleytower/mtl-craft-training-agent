-- 129: retiring a draft is a state, not a DELETE
--
-- `beverage_list_formula_drafts` returns every draft row this organization owns,
-- with no filter on `draft_status`. A `rejected` draft is served to Brix in full,
-- which is why the standing ruling on a duplicate has been to DELETE the row: a
-- status nobody reads is not a retirement.
--
-- Deleting is the wrong instrument and it has already cost us. `formula_versions
-- .formula_draft_id` is ON DELETE SET NULL, so removing a draft does not refuse
-- and does not cascade — it silently orphans every version that came from it,
-- and the record of where an approved formula came from is exactly what you want
-- when somebody asks why the bar is pouring what it is pouring.
--
-- So: give a draft a `retired` state, stop serving it, and make retiring one
-- call that records who and why. Nothing is destroyed and the decision is
-- auditable. The three drafts already deleted stay deleted; their backup in
-- `beverage.formula_drafts_deleted_backup` remains the record for those.
--
-- `beverage_ingest_formula_drafts` deliberately omits `draft_status` from its
-- UPDATE, so a re-import cannot drag a retired draft back to `needs_review`.
-- Retirement survives the importer without any change here.

begin;

-- 1. `retired` becomes a legal draft status.
--
-- Same shape as 128 widening `component_role`: the vocabulary the code needs and
-- the vocabulary the database accepts had drifted apart. Widening a CHECK breaks
-- no existing row and no caller.
alter table beverage.formula_drafts
  drop constraint if exists formula_drafts_draft_status_check;

alter table beverage.formula_drafts
  add constraint formula_drafts_draft_status_check
  check (draft_status = any (array[
    'needs_review'::text,
    'in_review'::text,
    'rejected'::text,
    'accepted_for_versioning'::text,
    'retired'::text
  ]));

-- 2. Stop serving what has been ruled out.
--
-- `rejected` is included deliberately. A rejected draft reaching Brix is the
-- defect that made DELETE look like the only option; this is the fix for it.
create or replace function public.beverage_list_formula_drafts(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'beverage', 'public', 'pg_temp'
as $function$
declare v_context jsonb; v_org_id uuid;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name, 'product_category', d.product_category,
      'draft_status', d.draft_status,
      'intended_yield_value', d.intended_yield_value,
      'intended_yield_unit', d.intended_yield_unit,
      'method_source_text', nullif(btrim(coalesce(d.original_recipe_json->>'method_source_text','')),''),
      'original_recipe_json', d.original_recipe_json
    ) order by d.name)
    from beverage.formula_drafts d
    where d.organization_id = v_org_id
      and d.draft_status not in ('retired', 'rejected')), '[]'::jsonb);
end; $function$;

-- 3. Retiring a draft, as one audited call.
create or replace function public.beverage_retire_formula_draft(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_draft_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'beverage', 'public', 'pg_temp'
as $function$
declare
  v_context jsonb;
  v_org_id uuid;
  v_principal_id uuid;
  v_name text;
  v_status text;
  v_approved integer;
  v_versions_retired integer := 0;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;

  -- Retiring a draft is a corpus decision, so it needs the role that makes corpus
  -- decisions. `beverage_ensure_context` resolves the role from the subject, never
  -- from anything the caller asserts about itself.
  if coalesce(v_context->>'role', '') not in ('owner', 'approver') then
    raise exception 'Owner or approver role required to retire a formula draft';
  end if;

  -- "ok" records that somebody clicked. Six characters is the same floor the
  -- owner-decision path uses, and for the same reason.
  if length(btrim(coalesce(p_reason, ''))) < 6 then
    raise exception 'A reason of at least 6 characters is required to retire a formula draft';
  end if;

  select d.name, d.draft_status into v_name, v_status
  from beverage.formula_drafts d
  where d.id = p_draft_id and d.organization_id = v_org_id;

  if v_name is null then
    raise exception 'No formula draft % in this organization', p_draft_id;
  end if;

  if v_status = 'retired' then
    return jsonb_build_object(
      'draft_id', p_draft_id, 'name', v_name,
      'retired', false, 'already_retired', true, 'versions_retired', 0);
  end if;

  -- The one refusal that matters. A draft with a live approved version is what
  -- `/api/hermes/scale` answers from; retiring it would take a recipe off the bar
  -- without anyone seeing it go. Supersede or retire the version first, on
  -- purpose, and then retire the draft.
  select count(*) into v_approved
  from beverage.formula_versions v
  where v.formula_draft_id = p_draft_id and v.lifecycle_status = 'approved';

  if v_approved > 0 then
    raise exception
      'Draft "%" has % approved formula version(s); retire or supersede them first',
      v_name, v_approved;
  end if;

  update beverage.formula_versions
  set lifecycle_status = 'retired', updated_at = now()
  where formula_draft_id = p_draft_id
    and organization_id = v_org_id
    and lifecycle_status in ('draft', 'superseded');
  get diagnostics v_versions_retired = row_count;

  update beverage.formula_drafts
  set draft_status = 'retired', updated_at = now()
  where id = p_draft_id;

  insert into beverage.audit_events (
    organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (
    v_org_id, v_principal_id, 'formula_draft_retired', 'formula_draft', p_draft_id,
    jsonb_build_object(
      'name', v_name,
      'previous_draft_status', v_status,
      'versions_retired', v_versions_retired,
      'reason', btrim(p_reason)));

  return jsonb_build_object(
    'draft_id', p_draft_id, 'name', v_name,
    'retired', true, 'already_retired', false,
    'previous_draft_status', v_status,
    'versions_retired', v_versions_retired);
end; $function$;

-- 4. Grants.
--
-- 126 had to revoke an anon EXECUTE that let anyone with the publishable key
-- write a formula version. Nothing here repeats that: the default grant to
-- PUBLIC is revoked first, and only service_role is given it back.
revoke all on function public.beverage_retire_formula_draft(text, text, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function public.beverage_retire_formula_draft(text, text, boolean, uuid, text)
  to service_role;

commit;
