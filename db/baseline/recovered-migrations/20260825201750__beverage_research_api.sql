-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260825201750
-- name: beverage_research_api
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Citation-first research controls. Firecrawl requests are user-triggered and candidates
-- remain proposed until an owner or approver selects a disposition with rationale.

create or replace function public.beverage_record_research_candidates(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_question text,
  p_transport text,
  p_candidates jsonb
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
$$;

create or replace function public.beverage_decide_research_candidate(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_candidate_id uuid,
  p_decision text,
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
$$;

revoke all on function public.beverage_record_research_candidates(text, text, boolean, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.beverage_decide_research_candidate(text, text, boolean, uuid, text, text) from public, anon, authenticated;
grant execute on function public.beverage_record_research_candidates(text, text, boolean, text, text, jsonb) to service_role;
grant execute on function public.beverage_decide_research_candidate(text, text, boolean, uuid, text, text) to service_role;
