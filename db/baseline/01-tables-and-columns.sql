-- CAPTURED BASELINE from the live database — tables and columns in schema beverage
-- Capture timestamp (database now()): 2026-08-31 01:19:18.112408+00
-- Supabase project ref: ctyxnhcljruyciebkwef
-- Schema: beverage
--
-- This file is a READ-ONLY RECORD of live database state at the timestamp above.
-- It is NOT a migration and must NOT be executed or replayed against any database.
--
-- 27 tables, 287 columns total.


-- table: beverage.agent_messages
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  session_id                             uuid                                     NOT NULL   (none)
  role                                   text                                     NOT NULL   (none)
  content                                text                                     NOT NULL   (none)
  citations                              jsonb                                    NOT NULL   '[]'::jsonb
  tool_trace                             jsonb                                    NOT NULL   '[]'::jsonb
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.agent_sessions
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  principal_id                           uuid                                     NOT NULL   (none)
  title                                  text                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  updated_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.approval_decisions
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  entity_type                            text                                     NOT NULL   (none)
  entity_id                              uuid                                     NOT NULL   (none)
  decision                               text                                     NOT NULL   (none)
  rationale                              text                                     NOT NULL   (none)
  decided_by                             uuid                                     NOT NULL   (none)
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.audit_events
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  principal_id                           uuid                                     NULL       (none)
  event_type                             text                                     NOT NULL   (none)
  entity_type                            text                                     NOT NULL   (none)
  entity_id                              uuid                                     NULL       (none)
  details                                jsonb                                    NOT NULL   '{}'::jsonb
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.batch_cost_deltas
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  cost_baseline_id                       uuid                                     NOT NULL   (none)
  label                                  text                                     NOT NULL   (none)
  delta_amount                           numeric                                  NOT NULL   (none)
  rationale                              text                                     NOT NULL   (none)
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  production_batch_id                    uuid                                     NOT NULL   (none)

-- table: beverage.batch_inputs
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  production_batch_id                    uuid                                     NOT NULL   (none)
  item_name                              text                                     NOT NULL   (none)
  external_source                        text                                     NULL       (none)
  external_record_key                    text                                     NULL       (none)
  quantity_purchased                     numeric                                  NOT NULL   (none)
  unit                                   text                                     NOT NULL   (none)
  amount_paid                            numeric                                  NOT NULL   (none)
  currency_code                          text                                     NOT NULL   'CAD'::text
  supplier                               text                                     NULL       (none)
  invoice_reference                      text                                     NULL       (none)
  purchased_on                           date                                     NULL       (none)
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   clock_timestamp()

-- table: beverage.calculation_plans
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  formula_version_id                     uuid                                     NOT NULL   (none)
  plan_type                              text                                     NOT NULL   (none)
  input_payload                          jsonb                                    NOT NULL   '{}'::jsonb
  output_payload                         jsonb                                    NOT NULL   '{}'::jsonb
  result_status                          text                                     NOT NULL   'planning_only_not_released'::text
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.cost_baseline_lines
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  cost_baseline_id                       uuid                                     NOT NULL   (none)
  line_number                            integer                                  NOT NULL   (none)
  label                                  text                                     NOT NULL   (none)
  amount                                 numeric                                  NOT NULL   (none)
  evidence_reference                     text                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.cost_baselines
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  formula_version_id                     uuid                                     NOT NULL   (none)
  currency_code                          text                                     NOT NULL   'CAD'::text
  labour_rate_per_hour                   numeric                                  NOT NULL   40
  labour_hours                           numeric                                  NOT NULL   0
  packaging_cost                         numeric                                  NOT NULL   0
  baseline_status                        text                                     NOT NULL   'draft'::text
  approved_by                            uuid                                     NULL       (none)
  approved_at                            timestamp with time zone                 NULL       (none)
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  updated_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.experiment_test_runs
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  experiment_id                          uuid                                     NOT NULL   (none)
  outcome                                text                                     NOT NULL   (none)
  sensory_notes                          text                                     NULL       (none)
  measurements                           jsonb                                    NOT NULL   '{}'::jsonb
  completed_by                           uuid                                     NOT NULL   (none)
  completed_at                           timestamp with time zone                 NOT NULL   now()

-- table: beverage.experiments
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  title                                  text                                     NOT NULL   (none)
  hypothesis                             text                                     NOT NULL   (none)
  formula_version_id                     uuid                                     NULL       (none)
  trend_card_id                          uuid                                     NULL       (none)
  status                                 text                                     NOT NULL   'draft'::text
  safety_note                            text                                     NOT NULL   'Not a production, preservation, or release decision.'::text
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  updated_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.formula_components
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  formula_version_id                     uuid                                     NOT NULL   (none)
  line_number                            integer                                  NOT NULL   (none)
  ingredient_name                        text                                     NOT NULL   (none)
  ingredient_key                         text                                     NULL       (none)
  quantity                               numeric                                  NOT NULL   (none)
  unit                                   text                                     NOT NULL   (none)
  component_role                         text                                     NOT NULL   'ingredient'::text
  optional                               boolean                                  NOT NULL   false
  source_locator                         text                                     NULL       (none)
  notes                                  text                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  sub_formula_key                        text                                     NULL       (none)

-- table: beverage.formula_drafts
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  ingestion_run_id                       uuid                                     NULL       (none)
  external_recipe_id                     text                                     NULL       (none)
  name                                   text                                     NOT NULL   (none)
  product_category                       text                                     NULL       (none)
  original_recipe_json                   jsonb                                    NOT NULL   '{}'::jsonb
  original_source_hash                   text                                     NOT NULL   (none)
  intended_yield_value                   numeric                                  NULL       (none)
  intended_yield_unit                    text                                     NULL       (none)
  extraction_confidence                  numeric                                  NULL       (none)
  draft_status                           text                                     NOT NULL   'needs_review'::text
  warnings                               jsonb                                    NOT NULL   '[]'::jsonb
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  updated_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.formula_versions
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  formula_draft_id                       uuid                                     NULL       (none)
  formula_key                            text                                     NOT NULL   (none)
  version_number                         integer                                  NOT NULL   (none)
  name                                   text                                     NOT NULL   (none)
  product_category                       text                                     NULL       (none)
  lifecycle_status                       text                                     NOT NULL   'draft'::text
  intended_yield_value                   numeric                                  NULL       (none)
  intended_yield_unit                    text                                     NULL       (none)
  process_json                           jsonb                                    NOT NULL   '{}'::jsonb
  preservation_notes                     text                                     NULL       (none)
  allergen_notes                         text                                     NULL       (none)
  approved_by                            uuid                                     NULL       (none)
  approved_at                            timestamp with time zone                 NULL       (none)
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  updated_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.graph_edges
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  from_node_id                           uuid                                     NOT NULL   (none)
  to_node_id                             uuid                                     NOT NULL   (none)
  relationship_type                      text                                     NOT NULL   (none)
  evidence_class                         text                                     NOT NULL   (none)
  source_id                              uuid                                     NULL       (none)
  citation_locator                       text                                     NULL       (none)
  review_status                          text                                     NOT NULL   'draft'::text
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.graph_nodes
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  node_type                              text                                     NOT NULL   (none)
  canonical_key                          text                                     NOT NULL   (none)
  label                                  text                                     NOT NULL   (none)
  attributes                             jsonb                                    NOT NULL   '{}'::jsonb
  review_status                          text                                     NOT NULL   'draft'::text
  source_id                              uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.inventory_action_requests
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  requested_by                           uuid                                     NOT NULL   (none)
  action_type                            text                                     NOT NULL   (none)
  request_status                         text                                     NOT NULL   'previewed'::text
  action_payload                         jsonb                                    NOT NULL   '{}'::jsonb
  confirmation_digest                    text                                     NOT NULL   (none)
  confirmation_expires_at                timestamp with time zone                 NOT NULL   (none)
  confirmed_at                           timestamp with time zone                 NULL       (none)
  completed_at                           timestamp with time zone                 NULL       (none)
  result_payload                         jsonb                                    NOT NULL   '{}'::jsonb
  failure_message                        text                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.inventory_evidence_snapshots
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  external_source                        text                                     NOT NULL   'cocktail-inventory-mcp'::text
  external_record_key                    text                                     NULL       (none)
  item_name                              text                                     NOT NULL   (none)
  quantity                               numeric                                  NULL       (none)
  unit                                   text                                     NULL       (none)
  location                               text                                     NULL       (none)
  observed_at                            timestamp with time zone                 NULL       (none)
  retrieved_at                           timestamp with time zone                 NOT NULL   now()
  mapping_confidence                     numeric                                  NULL       (none)
  unit_basis_status                      text                                     NOT NULL   'unknown'::text
  freshness_status                       text                                     NOT NULL   'unknown'::text
  read_only                              boolean                                  NOT NULL   true
  raw_evidence                           jsonb                                    NOT NULL   '{}'::jsonb
  created_at                             timestamp with time zone                 NOT NULL   now()
  production_batch_id                    uuid                                     NULL       (none)

-- table: beverage.knowledge_sources
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  source_key                             text                                     NOT NULL   (none)
  title                                  text                                     NOT NULL   (none)
  publisher                              text                                     NULL       (none)
  creator                                text                                     NULL       (none)
  source_url                             text                                     NULL       (none)
  authority_tier                         text                                     NOT NULL   (none)
  rights_status                          text                                     NOT NULL   'review_required'::text
  operational_status                     text                                     NOT NULL   'reference_only'::text
  citation_required                      boolean                                  NOT NULL   true
  governed_summary                       text                                     NOT NULL   ''::text
  source_metadata                        jsonb                                    NOT NULL   '{}'::jsonb
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  updated_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.organization_memberships
-- column                                   type                                     nullable   default
  organization_id                        uuid                                     NOT NULL   (none)
  principal_id                           uuid                                     NOT NULL   (none)
  role                                   text                                     NOT NULL   (none)
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.organizations
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  slug                                   text                                     NOT NULL   (none)
  name                                   text                                     NOT NULL   (none)
  status                                 text                                     NOT NULL   'active'::text
  created_at                             timestamp with time zone                 NOT NULL   now()
  updated_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.principals
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  identity_provider                      text                                     NOT NULL   'manus_oauth'::text
  external_subject                       text                                     NOT NULL   (none)
  display_name                           text                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.production_batches
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  formula_version_id                     uuid                                     NOT NULL   (none)
  batch_label                            text                                     NOT NULL   (none)
  made_on                                date                                     NOT NULL   (none)
  measured_yield_value                   numeric                                  NULL       (none)
  measured_yield_unit                    text                                     NULL       (none)
  notes                                  text                                     NULL       (none)
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   clock_timestamp()
  updated_at                             timestamp with time zone                 NOT NULL   clock_timestamp()

-- table: beverage.recipe_ingestion_runs
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  source_id                              uuid                                     NULL       (none)
  intake_kind                            text                                     NOT NULL   (none)
  source_label                           text                                     NOT NULL   (none)
  original_reference                     jsonb                                    NOT NULL   '{}'::jsonb
  parser_version                         text                                     NULL       (none)
  parse_status                           text                                     NOT NULL   'received'::text
  warnings                               jsonb                                    NOT NULL   '[]'::jsonb
  initiated_by                           uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  completed_at                           timestamp with time zone                 NULL       (none)

-- table: beverage.research_candidates
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  research_run_id                        uuid                                     NOT NULL   (none)
  source_id                              uuid                                     NULL       (none)
  title                                  text                                     NOT NULL   (none)
  source_url                             text                                     NOT NULL   (none)
  rights_status                          text                                     NOT NULL   'review_required'::text
  candidate_status                       text                                     NOT NULL   'proposed'::text
  governed_summary                       text                                     NOT NULL   ''::text
  exclusions                             text                                     NOT NULL   ''::text
  created_by                             uuid                                     NULL       (none)
  decided_by                             uuid                                     NULL       (none)
  decision_rationale                     text                                     NULL       (none)
  decided_at                             timestamp with time zone                 NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()

-- table: beverage.research_runs
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  question                               text                                     NOT NULL   (none)
  research_transport                     text                                     NOT NULL   (none)
  retention_mode                         text                                     NOT NULL   'temporary'::text
  run_status                             text                                     NOT NULL   'requested'::text
  response_summary                       text                                     NOT NULL   ''::text
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
  completed_at                           timestamp with time zone                 NULL       (none)

-- table: beverage.trend_cards
-- column                                   type                                     nullable   default
  id                                     uuid                                     NOT NULL   gen_random_uuid()
  organization_id                        uuid                                     NOT NULL   (none)
  title                                  text                                     NOT NULL   (none)
  observed_window_start                  date                                     NULL       (none)
  observed_window_end                    date                                     NULL       (none)
  discovery_transport                    text                                     NOT NULL   (none)
  retention_status                       text                                     NOT NULL   'temporary'::text
  source_cluster                         jsonb                                    NOT NULL   '[]'::jsonb
  summary                                text                                     NOT NULL   ''::text
  created_by                             uuid                                     NULL       (none)
  created_at                             timestamp with time zone                 NOT NULL   now()
