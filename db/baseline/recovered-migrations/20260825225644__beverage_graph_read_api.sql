-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260825225644
-- name: beverage_graph_read_api
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

create or replace function public.beverage_graph_overview(
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
  return jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'node_type', n.node_type, 'canonical_key', n.canonical_key, 'label', n.label, 'attributes', n.attributes, 'review_status', n.review_status, 'source_id', n.source_id, 'created_at', n.created_at) order by n.created_at desc) from beverage.graph_nodes n where n.organization_id = v_org_id), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'from_node_id', e.from_node_id, 'to_node_id', e.to_node_id, 'relationship_type', e.relationship_type, 'evidence_class', e.evidence_class, 'review_status', e.review_status, 'source_id', e.source_id, 'citation_locator', e.citation_locator, 'created_at', e.created_at) order by e.created_at desc) from beverage.graph_edges e where e.organization_id = v_org_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.beverage_graph_overview(text, text, boolean) from public, anon, authenticated;
grant execute on function public.beverage_graph_overview(text, text, boolean) to service_role;
