-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260825202237
-- name: beverage_operator_history_api
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Governed history and trend-card service boundary. All browser roles remain fail-closed.

create or replace function public.beverage_record_agent_interaction(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_session_id uuid,
  p_user_message text,
  p_assistant_message text,
  p_citations jsonb,
  p_tool_trace jsonb
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
      select jsonb_build_object('kind', 'audit', 'occurred_at', created_at, 'title', event_type, 'detail', entity_type, 'entity_id', id) as entry
      from beverage.audit_events where organization_id = v_org_id
    ) as events
    limit 100
  ), '[]'::jsonb);
end;
$$;

create or replace function public.beverage_list_trend_cards(
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
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from beverage.trend_cards t where t.organization_id = v_org_id), '[]'::jsonb);
end;
$$;

create or replace function public.beverage_create_temporary_trend_card(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_title text,
  p_summary text,
  p_source_cluster jsonb
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
$$;

revoke all on function public.beverage_record_agent_interaction(text, text, boolean, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.beverage_list_operator_history(text, text, boolean) from public, anon, authenticated;
revoke all on function public.beverage_list_trend_cards(text, text, boolean) from public, anon, authenticated;
revoke all on function public.beverage_create_temporary_trend_card(text, text, boolean, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.beverage_record_agent_interaction(text, text, boolean, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function public.beverage_list_operator_history(text, text, boolean) to service_role;
grant execute on function public.beverage_list_trend_cards(text, text, boolean) to service_role;
grant execute on function public.beverage_create_temporary_trend_card(text, text, boolean, text, text, jsonb) to service_role;
