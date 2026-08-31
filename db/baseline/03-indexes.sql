-- CAPTURED BASELINE from the live database — indexes in schema beverage (from pg_indexes)
-- Capture timestamp (database now()): 2026-08-31 01:19:18.112408+00
-- Supabase project ref: ctyxnhcljruyciebkwef
-- Schema: beverage
--
-- This file is a READ-ONLY RECORD of live database state at the timestamp above.
-- It is NOT a migration and must NOT be executed or replayed against any database.
--
-- 50 indexes total. Ordered by table name, then index name.


-- table: beverage.agent_messages
  -- agent_messages_pkey
  CREATE UNIQUE INDEX agent_messages_pkey ON beverage.agent_messages USING btree (id);

-- table: beverage.agent_sessions
  -- agent_sessions_pkey
  CREATE UNIQUE INDEX agent_sessions_pkey ON beverage.agent_sessions USING btree (id);

-- table: beverage.approval_decisions
  -- approval_decisions_pkey
  CREATE UNIQUE INDEX approval_decisions_pkey ON beverage.approval_decisions USING btree (id);
  -- beverage_approval_decisions_entity_idx
  CREATE INDEX beverage_approval_decisions_entity_idx ON beverage.approval_decisions USING btree (organization_id, entity_type, entity_id, created_at DESC);

-- table: beverage.audit_events
  -- audit_events_pkey
  CREATE UNIQUE INDEX audit_events_pkey ON beverage.audit_events USING btree (id);
  -- beverage_audit_events_org_created_idx
  CREATE INDEX beverage_audit_events_org_created_idx ON beverage.audit_events USING btree (organization_id, created_at DESC);

-- table: beverage.batch_cost_deltas
  -- batch_cost_deltas_pkey
  CREATE UNIQUE INDEX batch_cost_deltas_pkey ON beverage.batch_cost_deltas USING btree (id);

-- table: beverage.batch_inputs
  -- batch_inputs_batch_idx
  CREATE INDEX batch_inputs_batch_idx ON beverage.batch_inputs USING btree (production_batch_id);
  -- batch_inputs_pkey
  CREATE UNIQUE INDEX batch_inputs_pkey ON beverage.batch_inputs USING btree (id);

-- table: beverage.calculation_plans
  -- beverage_calculation_plans_formula_idx
  CREATE INDEX beverage_calculation_plans_formula_idx ON beverage.calculation_plans USING btree (organization_id, formula_version_id, created_at DESC);
  -- calculation_plans_pkey
  CREATE UNIQUE INDEX calculation_plans_pkey ON beverage.calculation_plans USING btree (id);

-- table: beverage.cost_baseline_lines
  -- cost_baseline_lines_cost_baseline_id_line_number_key
  CREATE UNIQUE INDEX cost_baseline_lines_cost_baseline_id_line_number_key ON beverage.cost_baseline_lines USING btree (cost_baseline_id, line_number);
  -- cost_baseline_lines_pkey
  CREATE UNIQUE INDEX cost_baseline_lines_pkey ON beverage.cost_baseline_lines USING btree (id);

-- table: beverage.cost_baselines
  -- beverage_cost_baselines_formula_idx
  CREATE INDEX beverage_cost_baselines_formula_idx ON beverage.cost_baselines USING btree (organization_id, formula_version_id, baseline_status);
  -- cost_baselines_pkey
  CREATE UNIQUE INDEX cost_baselines_pkey ON beverage.cost_baselines USING btree (id);

-- table: beverage.experiment_test_runs
  -- experiment_test_runs_pkey
  CREATE UNIQUE INDEX experiment_test_runs_pkey ON beverage.experiment_test_runs USING btree (id);

-- table: beverage.experiments
  -- experiments_pkey
  CREATE UNIQUE INDEX experiments_pkey ON beverage.experiments USING btree (id);

-- table: beverage.formula_components
  -- beverage_formula_components_version_idx
  CREATE INDEX beverage_formula_components_version_idx ON beverage.formula_components USING btree (formula_version_id, ingredient_key);
  -- formula_components_formula_version_id_line_number_key
  CREATE UNIQUE INDEX formula_components_formula_version_id_line_number_key ON beverage.formula_components USING btree (formula_version_id, line_number);
  -- formula_components_pkey
  CREATE UNIQUE INDEX formula_components_pkey ON beverage.formula_components USING btree (id);

-- table: beverage.formula_drafts
  -- beverage_formula_drafts_org_status_idx
  CREATE INDEX beverage_formula_drafts_org_status_idx ON beverage.formula_drafts USING btree (organization_id, draft_status, created_at DESC);
  -- formula_drafts_organization_id_original_source_hash_key
  CREATE UNIQUE INDEX formula_drafts_organization_id_original_source_hash_key ON beverage.formula_drafts USING btree (organization_id, original_source_hash);
  -- formula_drafts_pkey
  CREATE UNIQUE INDEX formula_drafts_pkey ON beverage.formula_drafts USING btree (id);

-- table: beverage.formula_versions
  -- beverage_formula_versions_org_status_idx
  CREATE INDEX beverage_formula_versions_org_status_idx ON beverage.formula_versions USING btree (organization_id, lifecycle_status, name);
  -- formula_versions_organization_id_formula_key_version_number_key
  CREATE UNIQUE INDEX formula_versions_organization_id_formula_key_version_number_key ON beverage.formula_versions USING btree (organization_id, formula_key, version_number);
  -- formula_versions_pkey
  CREATE UNIQUE INDEX formula_versions_pkey ON beverage.formula_versions USING btree (id);

-- table: beverage.graph_edges
  -- graph_edges_pkey
  CREATE UNIQUE INDEX graph_edges_pkey ON beverage.graph_edges USING btree (id);

-- table: beverage.graph_nodes
  -- graph_nodes_organization_id_node_type_canonical_key_key
  CREATE UNIQUE INDEX graph_nodes_organization_id_node_type_canonical_key_key ON beverage.graph_nodes USING btree (organization_id, node_type, canonical_key);
  -- graph_nodes_pkey
  CREATE UNIQUE INDEX graph_nodes_pkey ON beverage.graph_nodes USING btree (id);

-- table: beverage.inventory_action_requests
  -- inventory_action_requests_org_created_idx
  CREATE INDEX inventory_action_requests_org_created_idx ON beverage.inventory_action_requests USING btree (organization_id, created_at DESC);
  -- inventory_action_requests_pkey
  CREATE UNIQUE INDEX inventory_action_requests_pkey ON beverage.inventory_action_requests USING btree (id);

-- table: beverage.inventory_evidence_snapshots
  -- beverage_inventory_evidence_item_idx
  CREATE INDEX beverage_inventory_evidence_item_idx ON beverage.inventory_evidence_snapshots USING btree (organization_id, item_name, retrieved_at DESC);
  -- inventory_evidence_snapshots_pkey
  CREATE UNIQUE INDEX inventory_evidence_snapshots_pkey ON beverage.inventory_evidence_snapshots USING btree (id);

-- table: beverage.knowledge_sources
  -- beverage_sources_org_status_idx
  CREATE INDEX beverage_sources_org_status_idx ON beverage.knowledge_sources USING btree (organization_id, authority_tier, operational_status);
  -- knowledge_sources_organization_id_source_key_key
  CREATE UNIQUE INDEX knowledge_sources_organization_id_source_key_key ON beverage.knowledge_sources USING btree (organization_id, source_key);
  -- knowledge_sources_pkey
  CREATE UNIQUE INDEX knowledge_sources_pkey ON beverage.knowledge_sources USING btree (id);

-- table: beverage.organization_memberships
  -- beverage_memberships_principal_idx
  CREATE INDEX beverage_memberships_principal_idx ON beverage.organization_memberships USING btree (principal_id, organization_id);
  -- organization_memberships_pkey
  CREATE UNIQUE INDEX organization_memberships_pkey ON beverage.organization_memberships USING btree (organization_id, principal_id);

-- table: beverage.organizations
  -- organizations_pkey
  CREATE UNIQUE INDEX organizations_pkey ON beverage.organizations USING btree (id);
  -- organizations_slug_key
  CREATE UNIQUE INDEX organizations_slug_key ON beverage.organizations USING btree (slug);

-- table: beverage.principals
  -- principals_identity_provider_external_subject_key
  CREATE UNIQUE INDEX principals_identity_provider_external_subject_key ON beverage.principals USING btree (identity_provider, external_subject);
  -- principals_pkey
  CREATE UNIQUE INDEX principals_pkey ON beverage.principals USING btree (id);

-- table: beverage.production_batches
  -- production_batches_formula_version_idx
  CREATE INDEX production_batches_formula_version_idx ON beverage.production_batches USING btree (formula_version_id, made_on DESC);
  -- production_batches_label_unique
  CREATE UNIQUE INDEX production_batches_label_unique ON beverage.production_batches USING btree (organization_id, formula_version_id, batch_label);
  -- production_batches_pkey
  CREATE UNIQUE INDEX production_batches_pkey ON beverage.production_batches USING btree (id);

-- table: beverage.recipe_ingestion_runs
  -- beverage_ingestion_runs_org_created_idx
  CREATE INDEX beverage_ingestion_runs_org_created_idx ON beverage.recipe_ingestion_runs USING btree (organization_id, created_at DESC);
  -- recipe_ingestion_runs_pkey
  CREATE UNIQUE INDEX recipe_ingestion_runs_pkey ON beverage.recipe_ingestion_runs USING btree (id);

-- table: beverage.research_candidates
  -- research_candidates_pkey
  CREATE UNIQUE INDEX research_candidates_pkey ON beverage.research_candidates USING btree (id);

-- table: beverage.research_runs
  -- research_runs_pkey
  CREATE UNIQUE INDEX research_runs_pkey ON beverage.research_runs USING btree (id);

-- table: beverage.trend_cards
  -- trend_cards_pkey
  CREATE UNIQUE INDEX trend_cards_pkey ON beverage.trend_cards USING btree (id);
