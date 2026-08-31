-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260825201825
-- name: beverage_research_review_api
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

create or replace function public.beverage_list_research_candidates(
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
$$;

revoke all on function public.beverage_list_research_candidates(text, text, boolean) from public, anon, authenticated;
grant execute on function public.beverage_list_research_candidates(text, text, boolean) to service_role;
