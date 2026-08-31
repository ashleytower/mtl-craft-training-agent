-- CAPTURED BASELINE from the live database — functions in schema public whose name starts with 'beverage' (pg_get_functiondef)
-- Capture timestamp (database now()): 2026-08-31 01:19:18.112408+00
-- Supabase project ref: ctyxnhcljruyciebkwef
-- Schema: beverage
--
-- This file is a READ-ONLY RECORD of live database state at the timestamp above.
-- It is NOT a migration and must NOT be executed or replayed against any database.
--
-- 27 functions total. Ordered by function name, then identity arguments.


-- function: public.beverage_approve_formula_version_for_subject(p_external_subject text, p_display_name text, p_is_owner boolean, p_formula_version_id uuid, p_rationale text)
CREATE OR REPLACE FUNCTION public.beverage_approve_formula_version_for_subject(p_external_subject text, p_display_name text, p_is_owner boolean, p_formula_version_id uuid, p_rationale text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
declare
  v_context jsonb;
  v_formula beverage.formula_versions;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_formula := beverage.approve_formula_version(p_formula_version_id, (v_context->>'principal_id')::uuid, p_rationale);
  return jsonb_build_object('id', v_formula.id, 'lifecycle_status', v_formula.lifecycle_status, 'approved_at', v_formula.approved_at);
end;
$function$

-- function: public.beverage_claim_inventory_action_request(p_external_subject text, p_display_name text, p_is_owner boolean, p_request_id uuid, p_confirmation_digest text)
CREATE OR REPLACE FUNCTION public.beverage_claim_inventory_action_request(p_external_subject text, p_display_name text, p_is_owner boolean, p_request_id uuid, p_confirmation_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_create_experiment(p_external_subject text, p_display_name text, p_is_owner boolean, p_title text, p_hypothesis text, p_formula_version_id uuid, p_trend_card_id uuid)
CREATE OR REPLACE FUNCTION public.beverage_create_experiment(p_external_subject text, p_display_name text, p_is_owner boolean, p_title text, p_hypothesis text, p_formula_version_id uuid DEFAULT NULL::uuid, p_trend_card_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_create_formula_version(p_external_subject text, p_display_name text, p_is_owner boolean, p_formula_draft_id uuid, p_formula_key text, p_name text, p_yield_value numeric, p_yield_unit text, p_components jsonb, p_process_steps jsonb)
CREATE OR REPLACE FUNCTION public.beverage_create_formula_version(p_external_subject text, p_display_name text, p_is_owner boolean, p_formula_draft_id uuid, p_formula_key text, p_name text, p_yield_value numeric, p_yield_unit text, p_components jsonb, p_process_steps jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
declare
  v_context jsonb; v_org_id uuid; v_principal_id uuid; v_role text;
  v_version beverage.formula_versions; v_next_version integer; v_yield_unit text;
  v_category text; v_method_raw text; v_steps jsonb; v_process jsonb;
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

  select product_category, nullif(btrim(coalesce(original_recipe_json->>'method_source_text','')),'')
    into v_category, v_method_raw
    from beverage.formula_drafts
   where id = p_formula_draft_id and organization_id = v_org_id;
  if not found then raise exception 'Formula draft not found in organization'; end if;

  -- Steps are optional, but if they are supplied they have to be usable: an
  -- unlabelled or blank instruction is worse than no method at all, because it
  -- reads as though a procedure was recorded.
  if p_process_steps is not null and jsonb_typeof(p_process_steps) <> 'null' then
    if jsonb_typeof(p_process_steps) <> 'array' then
      raise exception 'Preparation steps must be a list';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_process_steps) as e
       where jsonb_typeof(e) <> 'object'
    ) then
      raise exception 'Each preparation step must be an object with a text field';
    end if;
    select jsonb_agg(jsonb_build_object('section', s.sec, 'text', s.txt) order by s.ord)
      into v_steps
      from (
        select nullif(btrim(coalesce(elem->>'section','')),'') as sec,
               btrim(coalesce(elem->>'text','')) as txt,
               ord
          from jsonb_array_elements(p_process_steps) with ordinality as t(elem, ord)
      ) s
     where s.txt <> '';
    if v_steps is null then
      raise exception 'Preparation steps were supplied but every one of them was empty';
    end if;
  end if;

  if v_steps is not null then
    v_process := jsonb_build_object('source','operator','steps',v_steps,'raw',to_jsonb(v_method_raw));
  elsif v_method_raw is not null then
    v_process := jsonb_build_object('source','notion_draft','steps','[]'::jsonb,'raw',to_jsonb(v_method_raw));
  else
    v_process := '{}'::jsonb;
  end if;

  select coalesce(max(version_number),0)+1 into v_next_version from beverage.formula_versions where organization_id = v_org_id and formula_key = p_formula_key;
  insert into beverage.formula_versions (organization_id, formula_draft_id, formula_key, version_number, name, product_category, intended_yield_value, intended_yield_unit, process_json, lifecycle_status, created_by)
  values (v_org_id, p_formula_draft_id, p_formula_key, v_next_version, p_name, v_category, p_yield_value, v_yield_unit, v_process, 'draft', v_principal_id)
  returning * into v_version;
  insert into beverage.formula_components (formula_version_id, line_number, ingredient_name, ingredient_key, quantity, unit, component_role, optional, source_locator, notes, sub_formula_key)
  select v_version.id, x.line_number, x.ingredient_name, nullif(x.ingredient_key,''), x.quantity, x.unit,
         coalesce(nullif(x.component_role,''),'ingredient'), coalesce(x.optional,false),
         nullif(x.source_locator,''), nullif(x.notes,''), nullif(x.sub_formula_key,'')
  from jsonb_to_recordset(p_components) as x(line_number integer, ingredient_name text, ingredient_key text, quantity numeric, unit text, component_role text, optional boolean, source_locator text, notes text, sub_formula_key text);
  update beverage.formula_drafts set draft_status='accepted_for_versioning' where id = p_formula_draft_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id,'formula_version_created','formula_version', v_version.id,
          jsonb_build_object('formula_draft_id', p_formula_draft_id,
                             'method_source', coalesce(nullif(v_process->>'source',''),'none')));
  return jsonb_build_object('id', v_version.id,'lifecycle_status', v_version.lifecycle_status,'version_number', v_version.version_number,'product_category', v_version.product_category,'method_source', coalesce(nullif(v_process->>'source',''),'none'));
end; $function$

-- function: public.beverage_create_inventory_action_request(p_external_subject text, p_display_name text, p_is_owner boolean, p_action_type text, p_action_payload jsonb, p_confirmation_digest text, p_confirmation_expires_at timestamp with time zone)
CREATE OR REPLACE FUNCTION public.beverage_create_inventory_action_request(p_external_subject text, p_display_name text, p_is_owner boolean, p_action_type text, p_action_payload jsonb, p_confirmation_digest text, p_confirmation_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_create_temporary_trend_card(p_external_subject text, p_display_name text, p_is_owner boolean, p_title text, p_summary text, p_source_cluster jsonb)
CREATE OR REPLACE FUNCTION public.beverage_create_temporary_trend_card(p_external_subject text, p_display_name text, p_is_owner boolean, p_title text, p_summary text, p_source_cluster jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
declare
  v_context jsonb;
  v_org_id uuid;
  v_principal_id uuid;
  v_card_id uuid;
begin
  if btrim(coalesce(p_title, '')) = '' then raise exception 'Trend card title is required'; end if;
  if jsonb_typeof(p_source_cluster) <> 'array' then raise exception 'Trend source cluster must be an array'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  insert into beverage.trend_cards (organization_id, title, discovery_transport, retention_status, source_cluster, summary, created_by)
  values (v_org_id, p_title, 'last30days', 'temporary', p_source_cluster, coalesce(p_summary, ''), v_principal_id)
  returning id into v_card_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'trend_card_created', 'trend_card', v_card_id, jsonb_build_object('retention_status', 'temporary', 'source_count', jsonb_array_length(p_source_cluster)));
  return jsonb_build_object('trend_card_id', v_card_id, 'retention_status', 'temporary');
end;
$function$

-- function: public.beverage_dashboard(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_dashboard(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_decide_experiment(p_external_subject text, p_display_name text, p_is_owner boolean, p_experiment_id uuid, p_status text, p_rationale text)
CREATE OR REPLACE FUNCTION public.beverage_decide_experiment(p_external_subject text, p_display_name text, p_is_owner boolean, p_experiment_id uuid, p_status text, p_rationale text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_decide_research_candidate(p_external_subject text, p_display_name text, p_is_owner boolean, p_candidate_id uuid, p_decision text, p_rationale text)
CREATE OR REPLACE FUNCTION public.beverage_decide_research_candidate(p_external_subject text, p_display_name text, p_is_owner boolean, p_candidate_id uuid, p_decision text, p_rationale text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
declare
  v_context jsonb;
  v_org_id uuid;
  v_principal_id uuid;
  v_role text;
  v_candidate beverage.research_candidates;
  v_source_id uuid;
begin
  if p_decision not in ('ingest_as_reference', 'saved_research_only', 'discarded') then raise exception 'Unsupported research disposition'; end if;
  if btrim(coalesce(p_rationale, '')) = '' then raise exception 'Research disposition rationale is required'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  v_role := v_context->>'role';
  if v_role not in ('owner', 'approver') then raise exception 'Owner or approver role required'; end if;

  select * into v_candidate from beverage.research_candidates where id = p_candidate_id and organization_id = v_org_id for update;
  if not found then raise exception 'Research candidate not found'; end if;
  if v_candidate.candidate_status <> 'proposed' then raise exception 'Only proposed research candidates may receive a disposition'; end if;

  if p_decision = 'ingest_as_reference' then
    insert into beverage.knowledge_sources (
      organization_id, source_key, title, source_url, authority_tier, rights_status,
      operational_status, citation_required, governed_summary, source_metadata, created_by
    ) values (
      v_org_id, 'research-' || replace(v_candidate.id::text, '-', ''), v_candidate.title, v_candidate.source_url,
      'tier_c_external_practitioner', 'public_summary_only', 'reference_only', true,
      v_candidate.governed_summary, jsonb_build_object('research_candidate_id', v_candidate.id, 'retained_content', 'citation_and_concise_summary_only'), v_principal_id
    ) returning id into v_source_id;
  end if;

  update beverage.research_candidates
  set candidate_status = p_decision,
      source_id = v_source_id,
      decided_by = v_principal_id,
      decision_rationale = p_rationale,
      decided_at = now()
  where id = v_candidate.id;

  insert into beverage.approval_decisions (organization_id, entity_type, entity_id, decision, rationale, decided_by)
  values (v_org_id, 'research_candidate', v_candidate.id, case when p_decision = 'ingest_as_reference' then 'saved_reference_only' when p_decision = 'discarded' then 'discarded' else 'saved_reference_only' end, p_rationale, v_principal_id);
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'research_candidate_decided', 'research_candidate', v_candidate.id, jsonb_build_object('decision', p_decision, 'source_id', v_source_id));
  return jsonb_build_object('candidate_id', v_candidate.id, 'decision', p_decision, 'source_id', v_source_id);
end;
$function$

-- function: public.beverage_ensure_context(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_ensure_context(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_finish_inventory_action_request(p_external_subject text, p_display_name text, p_is_owner boolean, p_request_id uuid, p_succeeded boolean, p_result_payload jsonb, p_failure_message text)
CREATE OR REPLACE FUNCTION public.beverage_finish_inventory_action_request(p_external_subject text, p_display_name text, p_is_owner boolean, p_request_id uuid, p_succeeded boolean, p_result_payload jsonb, p_failure_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_graph_overview(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_graph_overview(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
declare
  v_context jsonb;
  v_org_id uuid;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  return jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'node_type', n.node_type, 'canonical_key', n.canonical_key, 'label', n.label, 'attributes', n.attributes, 'review_status', n.review_status, 'source_id', n.source_id, 'created_at', n.created_at) order by n.created_at desc) from beverage.graph_nodes n where n.organization_id = v_org_id), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'from_node_id', e.from_node_id, 'to_node_id', e.to_node_id, 'relationship_type', e.relationship_type, 'evidence_class', e.evidence_class, 'review_status', e.review_status, 'source_id', e.source_id, 'citation_locator', e.citation_locator, 'created_at', e.created_at) order by e.created_at desc) from beverage.graph_edges e where e.organization_id = v_org_id), '[]'::jsonb)
  );
end;
$function$

-- function: public.beverage_list_approved_formulas(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_list_approved_formulas(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
      'process_json', f.process_json,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_number', c.line_number, 'ingredient_name', c.ingredient_name,
          'ingredient_key', c.ingredient_key, 'quantity', c.quantity,
          'unit', c.unit, 'component_role', c.component_role) order by c.line_number)
        from beverage.formula_components c where c.formula_version_id = f.id), '[]'::jsonb)
    ) order by f.name, f.version_number desc)
    from beverage.formula_versions f
    where f.organization_id = v_org_id and f.lifecycle_status = 'approved'), '[]'::jsonb);
end; $function$

-- function: public.beverage_list_experiments(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_list_experiments(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_list_formula_drafts(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_list_formula_drafts(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
    where d.organization_id = v_org_id), '[]'::jsonb);
end; $function$

-- function: public.beverage_list_operator_history(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_list_operator_history(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_list_pending_formula_versions(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_list_pending_formula_versions(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
      'process_json', f.process_json,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_number', c.line_number, 'ingredient_name', c.ingredient_name,
          'quantity', c.quantity, 'unit', c.unit,
          'component_role', c.component_role, 'sub_formula_key', c.sub_formula_key) order by c.line_number)
        from beverage.formula_components c where c.formula_version_id = f.id), '[]'::jsonb)
    ) order by f.created_at desc)
    from beverage.formula_versions f
    where f.organization_id = v_org_id and f.lifecycle_status = 'draft'), '[]'::jsonb);
end; $function$

-- function: public.beverage_list_research_candidates(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_list_research_candidates(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
declare
  v_context jsonb;
  v_org_id uuid;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'source_url', c.source_url,
      'rights_status', c.rights_status,
      'candidate_status', c.candidate_status,
      'governed_summary', c.governed_summary,
      'exclusions', c.exclusions,
      'question', r.question,
      'research_transport', r.research_transport,
      'retention_mode', r.retention_mode,
      'created_at', c.created_at
    ) order by c.created_at desc)
    from beverage.research_candidates c
    join beverage.research_runs r on r.id = c.research_run_id
    where c.organization_id = v_org_id
  ), '[]'::jsonb);
end;
$function$

-- function: public.beverage_list_trend_cards(p_external_subject text, p_display_name text, p_is_owner boolean)
CREATE OR REPLACE FUNCTION public.beverage_list_trend_cards(p_external_subject text, p_display_name text, p_is_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
declare
  v_context jsonb;
  v_org_id uuid;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from beverage.trend_cards t where t.organization_id = v_org_id), '[]'::jsonb);
end;
$function$

-- function: public.beverage_open_production_batch(p_external_subject text, p_display_name text, p_is_owner boolean, p_formula_version_id uuid, p_batch_label text, p_made_on date, p_notes text)
CREATE OR REPLACE FUNCTION public.beverage_open_production_batch(p_external_subject text, p_display_name text, p_is_owner boolean, p_formula_version_id uuid, p_batch_label text, p_made_on date, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
end; $function$

-- function: public.beverage_record_agent_interaction(p_external_subject text, p_display_name text, p_is_owner boolean, p_session_id uuid, p_user_message text, p_assistant_message text, p_citations jsonb, p_tool_trace jsonb)
CREATE OR REPLACE FUNCTION public.beverage_record_agent_interaction(p_external_subject text, p_display_name text, p_is_owner boolean, p_session_id uuid, p_user_message text, p_assistant_message text, p_citations jsonb, p_tool_trace jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
declare
  v_context jsonb;
  v_org_id uuid;
  v_principal_id uuid;
  v_session_id uuid;
begin
  if btrim(coalesce(p_user_message, '')) = '' or btrim(coalesce(p_assistant_message, '')) = '' then
    raise exception 'Agent interaction requires user and assistant content';
  end if;
  if jsonb_typeof(p_citations) <> 'array' or jsonb_typeof(p_tool_trace) <> 'array' then
    raise exception 'Citations and tool trace must be arrays';
  end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  v_session_id := p_session_id;
  if v_session_id is null then
    insert into beverage.agent_sessions (organization_id, principal_id, title)
    values (v_org_id, v_principal_id, left(p_user_message, 120))
    returning id into v_session_id;
  elsif not exists (select 1 from beverage.agent_sessions where id = v_session_id and organization_id = v_org_id and principal_id = v_principal_id) then
    raise exception 'Agent session not found for principal';
  end if;
  insert into beverage.agent_messages (session_id, role, content, citations, tool_trace)
  values (v_session_id, 'user', p_user_message, '[]'::jsonb, '[]'::jsonb),
         (v_session_id, 'assistant', p_assistant_message, p_citations, p_tool_trace);
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'agent_interaction_recorded', 'agent_session', v_session_id, jsonb_build_object('citation_count', jsonb_array_length(p_citations), 'tool_trace', p_tool_trace));
  return jsonb_build_object('session_id', v_session_id);
end;
$function$

-- function: public.beverage_record_batch_cost_delta(p_external_subject text, p_display_name text, p_is_owner boolean, p_production_batch_id uuid, p_cost_baseline_id uuid, p_label text, p_delta_amount numeric, p_rationale text)
CREATE OR REPLACE FUNCTION public.beverage_record_batch_cost_delta(p_external_subject text, p_display_name text, p_is_owner boolean, p_production_batch_id uuid, p_cost_baseline_id uuid, p_label text, p_delta_amount numeric, p_rationale text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
end; $function$

-- function: public.beverage_record_batch_input(p_external_subject text, p_display_name text, p_is_owner boolean, p_production_batch_id uuid, p_item_name text, p_quantity_purchased numeric, p_unit text, p_amount_paid numeric, p_currency_code text, p_supplier text, p_invoice_reference text, p_purchased_on date, p_external_source text, p_external_record_key text)
CREATE OR REPLACE FUNCTION public.beverage_record_batch_input(p_external_subject text, p_display_name text, p_is_owner boolean, p_production_batch_id uuid, p_item_name text, p_quantity_purchased numeric, p_unit text, p_amount_paid numeric, p_currency_code text DEFAULT 'CAD'::text, p_supplier text DEFAULT NULL::text, p_invoice_reference text DEFAULT NULL::text, p_purchased_on date DEFAULT NULL::date, p_external_source text DEFAULT NULL::text, p_external_record_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
end; $function$

-- function: public.beverage_record_calculation_plan(p_external_subject text, p_display_name text, p_is_owner boolean, p_formula_version_id uuid, p_plan_type text, p_input_payload jsonb, p_output_payload jsonb)
CREATE OR REPLACE FUNCTION public.beverage_record_calculation_plan(p_external_subject text, p_display_name text, p_is_owner boolean, p_formula_version_id uuid, p_plan_type text, p_input_payload jsonb, p_output_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_record_inventory_evidence(p_external_subject text, p_display_name text, p_is_owner boolean, p_items jsonb)
CREATE OR REPLACE FUNCTION public.beverage_record_inventory_evidence(p_external_subject text, p_display_name text, p_is_owner boolean, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
$function$

-- function: public.beverage_record_measured_yield(p_external_subject text, p_display_name text, p_is_owner boolean, p_production_batch_id uuid, p_measured_yield_value numeric, p_measured_yield_unit text)
CREATE OR REPLACE FUNCTION public.beverage_record_measured_yield(p_external_subject text, p_display_name text, p_is_owner boolean, p_production_batch_id uuid, p_measured_yield_value numeric, p_measured_yield_unit text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
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
end; $function$

-- function: public.beverage_record_research_candidates(p_external_subject text, p_display_name text, p_is_owner boolean, p_question text, p_transport text, p_candidates jsonb)
CREATE OR REPLACE FUNCTION public.beverage_record_research_candidates(p_external_subject text, p_display_name text, p_is_owner boolean, p_question text, p_transport text, p_candidates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'beverage', 'public', 'pg_temp'
AS $function$
declare
  v_context jsonb;
  v_org_id uuid;
  v_principal_id uuid;
  v_run_id uuid;
  v_candidate jsonb;
  v_candidate_ids jsonb := '[]'::jsonb;
  v_candidate_id uuid;
begin
  if btrim(coalesce(p_question, '')) = '' then raise exception 'Research question is required'; end if;
  if p_transport not in ('firecrawl', 'last30days', 'manual') then raise exception 'Unsupported research transport'; end if;
  if jsonb_typeof(p_candidates) <> 'array' then raise exception 'Research candidates must be an array'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;

  insert into beverage.research_runs (
    organization_id, question, research_transport, retention_mode, run_status, response_summary, created_by, completed_at
  ) values (
    v_org_id, p_question, p_transport, 'temporary', 'proposed',
    'Citation candidates were returned for operator review. No source content was retained.', v_principal_id, now()
  ) returning id into v_run_id;

  for v_candidate in select * from jsonb_array_elements(p_candidates)
  loop
    if btrim(coalesce(v_candidate->>'title', '')) = '' or btrim(coalesce(v_candidate->>'source_url', '')) = '' then
      raise exception 'Each research candidate requires title and source_url';
    end if;
    insert into beverage.research_candidates (
      organization_id, research_run_id, title, source_url, rights_status, candidate_status,
      governed_summary, exclusions, created_by
    ) values (
      v_org_id, v_run_id, v_candidate->>'title', v_candidate->>'source_url',
      'public_summary_only', 'proposed',
      left(coalesce(v_candidate->>'governed_summary', ''), 1000),
      'No full source text, protected course material, or book content was retained. Open the citation and choose a disposition before reuse.',
      v_principal_id
    ) returning id into v_candidate_id;
    v_candidate_ids := v_candidate_ids || to_jsonb(v_candidate_id);
  end loop;

  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'research_candidates_recorded', 'research_run', v_run_id, jsonb_build_object('transport', p_transport, 'candidate_count', jsonb_array_length(v_candidate_ids), 'temporary', true));
  return jsonb_build_object('research_run_id', v_run_id, 'candidate_ids', v_candidate_ids, 'retention_mode', 'temporary');
end;
$function$
