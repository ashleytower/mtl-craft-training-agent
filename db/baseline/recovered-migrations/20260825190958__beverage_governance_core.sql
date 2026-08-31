-- CAPTURED FROM THE LIVE DATABASE — NOT A MIGRATION TO RUN
-- project: ctyxnhcljruyciebkwef   schema: beverage
-- supabase_migrations.schema_migrations version: 20260825190958
-- name: beverage_governance_core
-- captured: 2026-08-31 01:20:13.416757+00
--
-- This is a historical record of SQL that was ALREADY APPLIED to production.
-- It is reproduced verbatim so the history is reviewable in git. Do not execute
-- it, do not replay it, and do not add it to any migration runner: re-running it
-- would either fail or double-apply. New changes get a new migration file in
-- db/migrations/.

-- Dedicated MTL Craft Beverage Intelligence source of truth.
--
-- Isolation guarantee: this migration creates only the `beverage` schema and
-- one private `beverage-evidence` storage bucket. It does not alter, rename,
-- delete, or write to any existing public business table.

create extension if not exists pgcrypto;
create extension if not exists vector;

create schema if not exists beverage;
revoke all on schema beverage from public, anon, authenticated;
grant usage on schema beverage to service_role;

create table if not exists beverage.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (btrim(name) <> ''),
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists beverage.principals (
  id uuid primary key default gen_random_uuid(),
  identity_provider text not null default 'manus_oauth',
  external_subject text not null,
  display_name text,
  created_at timestamptz not null default now(),
  unique (identity_provider, external_subject)
);

create table if not exists beverage.organization_memberships (
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  principal_id uuid not null references beverage.principals(id) on delete cascade,
  role text not null check (role in ('owner', 'approver', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, principal_id)
);
create index if not exists beverage_memberships_principal_idx on beverage.organization_memberships(principal_id, organization_id);

create table if not exists beverage.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  principal_id uuid references beverage.principals(id) on delete set null,
  event_type text not null check (btrim(event_type) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists beverage_audit_events_org_created_idx on beverage.audit_events(organization_id, created_at desc);

create table if not exists beverage.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  source_key text not null check (btrim(source_key) <> ''),
  title text not null check (btrim(title) <> ''),
  publisher text,
  creator text,
  source_url text,
  authority_tier text not null check (authority_tier in ('tier_a_internal', 'tier_b_authorized_course', 'tier_c_external_practitioner', 'tier_d_inspiration')),
  rights_status text not null default 'review_required' check (rights_status in ('internal_owned', 'authorized_private', 'public_summary_only', 'public_tool_operated_in_place', 'user_provided_excerpt', 'licensed', 'blocked_rights', 'review_required')),
  operational_status text not null default 'reference_only' check (operational_status in ('approved_internal', 'pending_review', 'reference_only', 'inspiration_only', 'blocked_rights')),
  citation_required boolean not null default true,
  governed_summary text not null default '',
  source_metadata jsonb not null default '{}'::jsonb,
  created_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_key)
);
create index if not exists beverage_sources_org_status_idx on beverage.knowledge_sources(organization_id, authority_tier, operational_status);

create table if not exists beverage.recipe_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  source_id uuid references beverage.knowledge_sources(id) on delete set null,
  intake_kind text not null check (intake_kind in ('notion_export', 'spreadsheet', 'manual_entry', 'browser_asset', 'text', 'other')),
  source_label text not null check (btrim(source_label) <> ''),
  original_reference jsonb not null default '{}'::jsonb,
  parser_version text,
  parse_status text not null default 'received' check (parse_status in ('received', 'parsed_to_draft', 'needs_human_review', 'rejected', 'failed')),
  warnings jsonb not null default '[]'::jsonb,
  initiated_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists beverage_ingestion_runs_org_created_idx on beverage.recipe_ingestion_runs(organization_id, created_at desc);

create table if not exists beverage.formula_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  ingestion_run_id uuid references beverage.recipe_ingestion_runs(id) on delete set null,
  external_recipe_id text,
  name text not null check (btrim(name) <> ''),
  product_category text,
  original_recipe_json jsonb not null default '{}'::jsonb,
  original_source_hash text not null check (btrim(original_source_hash) <> ''),
  intended_yield_value numeric check (intended_yield_value is null or intended_yield_value >= 0),
  intended_yield_unit text,
  extraction_confidence numeric check (extraction_confidence is null or extraction_confidence between 0 and 1),
  draft_status text not null default 'needs_review' check (draft_status in ('needs_review', 'in_review', 'rejected', 'accepted_for_versioning')),
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, original_source_hash)
);
create index if not exists beverage_formula_drafts_org_status_idx on beverage.formula_drafts(organization_id, draft_status, created_at desc);

create table if not exists beverage.formula_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  formula_draft_id uuid references beverage.formula_drafts(id) on delete set null,
  formula_key text not null check (btrim(formula_key) <> ''),
  version_number integer not null check (version_number > 0),
  name text not null check (btrim(name) <> ''),
  product_category text,
  lifecycle_status text not null default 'draft' check (lifecycle_status in ('draft', 'approved', 'superseded', 'retired')),
  intended_yield_value numeric not null check (intended_yield_value > 0),
  intended_yield_unit text not null check (btrim(intended_yield_unit) <> ''),
  process_json jsonb not null default '{}'::jsonb,
  preservation_notes text,
  allergen_notes text,
  approved_by uuid references beverage.principals(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, formula_key, version_number),
  check ((lifecycle_status <> 'approved') or (approved_by is not null and approved_at is not null))
);
create index if not exists beverage_formula_versions_org_status_idx on beverage.formula_versions(organization_id, lifecycle_status, name);

create table if not exists beverage.formula_components (
  id uuid primary key default gen_random_uuid(),
  formula_version_id uuid not null references beverage.formula_versions(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  ingredient_name text not null check (btrim(ingredient_name) <> ''),
  ingredient_key text,
  quantity numeric not null check (quantity >= 0),
  unit text not null check (btrim(unit) <> ''),
  component_role text not null default 'ingredient' check (component_role in ('ingredient', 'water', 'sweetener', 'acid', 'preservative', 'processing_aid', 'packaging_loss')),
  optional boolean not null default false,
  source_locator text,
  notes text,
  created_at timestamptz not null default now(),
  unique (formula_version_id, line_number)
);
create index if not exists beverage_formula_components_version_idx on beverage.formula_components(formula_version_id, ingredient_key);

create table if not exists beverage.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('formula_version', 'source', 'research_candidate', 'graph_edge', 'experiment')),
  entity_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected', 'superseded', 'saved_reference_only', 'discarded')),
  rationale text not null check (btrim(rationale) <> ''),
  decided_by uuid not null references beverage.principals(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists beverage_approval_decisions_entity_idx on beverage.approval_decisions(organization_id, entity_type, entity_id, created_at desc);

create table if not exists beverage.calculation_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  formula_version_id uuid not null references beverage.formula_versions(id) on delete restrict,
  plan_type text not null check (plan_type in ('exact_factor', 'target_yield', 'limiting_ingredient', 'batch_cost')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  result_status text not null default 'planning_only_not_released' check (result_status = 'planning_only_not_released'),
  created_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists beverage_calculation_plans_formula_idx on beverage.calculation_plans(organization_id, formula_version_id, created_at desc);

create table if not exists beverage.cost_baselines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  formula_version_id uuid not null references beverage.formula_versions(id) on delete restrict,
  currency_code text not null default 'CAD' check (currency_code ~ '^[A-Z]{3}$'),
  labour_rate_per_hour numeric not null default 40 check (labour_rate_per_hour >= 0),
  labour_hours numeric not null default 0 check (labour_hours >= 0),
  packaging_cost numeric not null default 0 check (packaging_cost >= 0),
  baseline_status text not null default 'draft' check (baseline_status in ('draft', 'approved', 'superseded')),
  approved_by uuid references beverage.principals(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((baseline_status <> 'approved') or (approved_by is not null and approved_at is not null))
);
create index if not exists beverage_cost_baselines_formula_idx on beverage.cost_baselines(organization_id, formula_version_id, baseline_status);

create table if not exists beverage.cost_baseline_lines (
  id uuid primary key default gen_random_uuid(),
  cost_baseline_id uuid not null references beverage.cost_baselines(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  label text not null check (btrim(label) <> ''),
  amount numeric not null check (amount >= 0),
  evidence_reference text,
  created_at timestamptz not null default now(),
  unique (cost_baseline_id, line_number)
);

create table if not exists beverage.batch_cost_deltas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  cost_baseline_id uuid not null references beverage.cost_baselines(id) on delete restrict,
  label text not null check (btrim(label) <> ''),
  delta_amount numeric not null,
  rationale text not null check (btrim(rationale) <> ''),
  created_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists beverage.inventory_evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  external_source text not null default 'cocktail-inventory-mcp',
  external_record_key text,
  item_name text not null check (btrim(item_name) <> ''),
  quantity numeric,
  unit text,
  location text,
  observed_at timestamptz,
  retrieved_at timestamptz not null default now(),
  mapping_confidence numeric check (mapping_confidence is null or mapping_confidence between 0 and 1),
  unit_basis_status text not null default 'unknown' check (unit_basis_status in ('verified', 'ambiguous', 'unknown')),
  freshness_status text not null default 'unknown' check (freshness_status in ('fresh', 'stale', 'unknown')),
  read_only boolean not null default true check (read_only = true),
  raw_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists beverage_inventory_evidence_item_idx on beverage.inventory_evidence_snapshots(organization_id, item_name, retrieved_at desc);

create table if not exists beverage.research_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  question text not null check (btrim(question) <> ''),
  research_transport text not null check (research_transport in ('firecrawl', 'last30days', 'manual')),
  retention_mode text not null default 'temporary' check (retention_mode in ('temporary', 'proposed_for_review', 'retained_reference')),
  run_status text not null default 'requested' check (run_status in ('requested', 'gathering', 'proposed', 'failed', 'closed')),
  response_summary text not null default '',
  created_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists beverage.research_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  research_run_id uuid not null references beverage.research_runs(id) on delete cascade,
  source_id uuid references beverage.knowledge_sources(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  source_url text not null check (btrim(source_url) <> ''),
  rights_status text not null default 'review_required' check (rights_status in ('public_summary_only', 'public_tool_operated_in_place', 'authorized_private', 'licensed', 'blocked_rights', 'review_required')),
  candidate_status text not null default 'proposed' check (candidate_status in ('proposed', 'ingest_as_reference', 'saved_research_only', 'discarded', 'blocked')),
  governed_summary text not null default '',
  exclusions text not null default '',
  created_by uuid references beverage.principals(id) on delete set null,
  decided_by uuid references beverage.principals(id) on delete set null,
  decision_rationale text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists beverage.graph_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  node_type text not null check (node_type in ('ingredient', 'cocktail_family', 'food_profile', 'flavour_concept', 'course_context', 'trend', 'experiment')),
  canonical_key text not null check (btrim(canonical_key) <> ''),
  label text not null check (btrim(label) <> ''),
  attributes jsonb not null default '{}'::jsonb,
  review_status text not null default 'draft' check (review_status in ('draft', 'reference', 'approved', 'rejected')),
  source_id uuid references beverage.knowledge_sources(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, node_type, canonical_key)
);

create table if not exists beverage.graph_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  from_node_id uuid not null references beverage.graph_nodes(id) on delete cascade,
  to_node_id uuid not null references beverage.graph_nodes(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('family_member', 'complementary', 'contrast', 'bridge', 'cut', 'echo', 'cleanse', 'amplify_aroma', 'avoidance')),
  evidence_class text not null check (evidence_class in ('approved_internal', 'internal_validated', 'external_reference', 'inspiration')),
  source_id uuid references beverage.knowledge_sources(id) on delete set null,
  citation_locator text,
  review_status text not null default 'draft' check (review_status in ('draft', 'reference', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  check (from_node_id <> to_node_id)
);

create table if not exists beverage.trend_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  observed_window_start date,
  observed_window_end date,
  discovery_transport text not null check (discovery_transport in ('last30days', 'firecrawl', 'manual')),
  retention_status text not null default 'temporary' check (retention_status in ('temporary', 'proposed', 'retained_reference', 'discarded')),
  source_cluster jsonb not null default '[]'::jsonb,
  summary text not null default '',
  created_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists beverage.experiments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  hypothesis text not null check (btrim(hypothesis) <> ''),
  formula_version_id uuid references beverage.formula_versions(id) on delete set null,
  trend_card_id uuid references beverage.trend_cards(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'ready_for_internal_test', 'internal_knowledge', 'rejected', 'archived')),
  safety_note text not null default 'Not a production, preservation, or release decision.',
  created_by uuid references beverage.principals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists beverage.experiment_test_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  experiment_id uuid not null references beverage.experiments(id) on delete cascade,
  outcome text not null check (outcome in ('completed', 'inconclusive', 'failed')),
  sensory_notes text,
  measurements jsonb not null default '{}'::jsonb,
  completed_by uuid not null references beverage.principals(id) on delete restrict,
  completed_at timestamptz not null default now(),
  check (btrim(coalesce(sensory_notes, '')) <> '' or outcome = 'inconclusive')
);

create table if not exists beverage.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references beverage.organizations(id) on delete cascade,
  principal_id uuid not null references beverage.principals(id) on delete restrict,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists beverage.agent_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references beverage.agent_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null check (btrim(content) <> ''),
  citations jsonb not null default '[]'::jsonb,
  tool_trace jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function beverage.touch_updated_at()
returns trigger
language plpgsql
set search_path = beverage, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger beverage_organizations_touch before update on beverage.organizations for each row execute function beverage.touch_updated_at();
create trigger beverage_sources_touch before update on beverage.knowledge_sources for each row execute function beverage.touch_updated_at();
create trigger beverage_formula_drafts_touch before update on beverage.formula_drafts for each row execute function beverage.touch_updated_at();
create trigger beverage_formula_versions_touch before update on beverage.formula_versions for each row execute function beverage.touch_updated_at();
create trigger beverage_cost_baselines_touch before update on beverage.cost_baselines for each row execute function beverage.touch_updated_at();
create trigger beverage_experiments_touch before update on beverage.experiments for each row execute function beverage.touch_updated_at();
create trigger beverage_agent_sessions_touch before update on beverage.agent_sessions for each row execute function beverage.touch_updated_at();

create or replace function beverage.approve_formula_version(
  p_formula_version_id uuid,
  p_principal_id uuid,
  p_rationale text
)
returns beverage.formula_versions
language plpgsql
security definer
set search_path = beverage, pg_temp
as $$
declare
  v_formula beverage.formula_versions;
begin
  if btrim(coalesce(p_rationale, '')) = '' then
    raise exception 'Approval rationale is required';
  end if;

  select * into v_formula from beverage.formula_versions where id = p_formula_version_id for update;
  if not found then raise exception 'Formula version not found'; end if;
  if v_formula.lifecycle_status <> 'draft' then raise exception 'Only draft formula versions may be approved'; end if;
  if not exists (
    select 1 from beverage.organization_memberships
    where organization_id = v_formula.organization_id and principal_id = p_principal_id and role in ('owner', 'approver')
  ) then raise exception 'Owner or approver role required'; end if;
  if not exists (select 1 from beverage.formula_components where formula_version_id = v_formula.id) then
    raise exception 'At least one normalized component is required';
  end if;

  update beverage.formula_versions
  set lifecycle_status = 'approved', approved_by = p_principal_id, approved_at = now()
  where id = v_formula.id
  returning * into v_formula;

  insert into beverage.approval_decisions (organization_id, entity_type, entity_id, decision, rationale, decided_by)
  values (v_formula.organization_id, 'formula_version', v_formula.id, 'approved', p_rationale, p_principal_id);
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_formula.organization_id, p_principal_id, 'formula_version_approved', 'formula_version', v_formula.id, jsonb_build_object('rationale', p_rationale));
  return v_formula;
end;
$$;

insert into storage.buckets (id, name, public)
values ('beverage-evidence', 'beverage-evidence', false)
on conflict (id) do update set public = false;

alter table beverage.organizations enable row level security;
alter table beverage.principals enable row level security;
alter table beverage.organization_memberships enable row level security;
alter table beverage.audit_events enable row level security;
alter table beverage.knowledge_sources enable row level security;
alter table beverage.recipe_ingestion_runs enable row level security;
alter table beverage.formula_drafts enable row level security;
alter table beverage.formula_versions enable row level security;
alter table beverage.formula_components enable row level security;
alter table beverage.approval_decisions enable row level security;
alter table beverage.calculation_plans enable row level security;
alter table beverage.cost_baselines enable row level security;
alter table beverage.cost_baseline_lines enable row level security;
alter table beverage.batch_cost_deltas enable row level security;
alter table beverage.inventory_evidence_snapshots enable row level security;
alter table beverage.research_runs enable row level security;
alter table beverage.research_candidates enable row level security;
alter table beverage.graph_nodes enable row level security;
alter table beverage.graph_edges enable row level security;
alter table beverage.trend_cards enable row level security;
alter table beverage.experiments enable row level security;
alter table beverage.experiment_test_runs enable row level security;
alter table beverage.agent_sessions enable row level security;
alter table beverage.agent_messages enable row level security;

revoke all on all tables in schema beverage from public, anon, authenticated;
revoke all on all sequences in schema beverage from public, anon, authenticated;
revoke all on function beverage.touch_updated_at() from public, anon, authenticated;
revoke all on function beverage.approve_formula_version(uuid, uuid, text) from public, anon, authenticated;
grant all on all tables in schema beverage to service_role;
grant usage, select on all sequences in schema beverage to service_role;
grant execute on function beverage.approve_formula_version(uuid, uuid, text) to service_role;
