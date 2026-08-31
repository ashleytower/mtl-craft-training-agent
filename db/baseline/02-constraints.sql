-- CAPTURED BASELINE from the live database — constraints in schema beverage
-- Capture timestamp (database now()): 2026-08-31 01:19:18.112408+00
-- Supabase project ref: ctyxnhcljruyciebkwef
-- Schema: beverage
--
-- This file is a READ-ONLY RECORD of live database state at the timestamp above.
-- It is NOT a migration and must NOT be executed or replayed against any database.
--
-- 196 constraints total (primary keys, foreign keys, unique, check). Ordered by table name (text), then constraint name.


-- table: beverage.agent_messages
  agent_messages_content_check                                           CHECK ((btrim(content) <> ''::text))
  agent_messages_pkey                                                    PRIMARY KEY (id)
  agent_messages_role_check                                              CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text])))
  agent_messages_session_id_fkey                                         FOREIGN KEY (session_id) REFERENCES beverage.agent_sessions(id) ON DELETE CASCADE

-- table: beverage.agent_sessions
  agent_sessions_organization_id_fkey                                    FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  agent_sessions_pkey                                                    PRIMARY KEY (id)
  agent_sessions_principal_id_fkey                                       FOREIGN KEY (principal_id) REFERENCES beverage.principals(id) ON DELETE RESTRICT

-- table: beverage.approval_decisions
  approval_decisions_decided_by_fkey                                     FOREIGN KEY (decided_by) REFERENCES beverage.principals(id) ON DELETE RESTRICT
  approval_decisions_decision_check                                      CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text, 'superseded'::text, 'saved_reference_only'::text, 'discarded'::text])))
  approval_decisions_entity_type_check                                   CHECK ((entity_type = ANY (ARRAY['formula_version'::text, 'source'::text, 'research_candidate'::text, 'graph_edge'::text, 'experiment'::text])))
  approval_decisions_organization_id_fkey                                FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  approval_decisions_pkey                                                PRIMARY KEY (id)
  approval_decisions_rationale_check                                     CHECK ((btrim(rationale) <> ''::text))

-- table: beverage.audit_events
  audit_events_entity_type_check                                         CHECK ((btrim(entity_type) <> ''::text))
  audit_events_event_type_check                                          CHECK ((btrim(event_type) <> ''::text))
  audit_events_organization_id_fkey                                      FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  audit_events_pkey                                                      PRIMARY KEY (id)
  audit_events_principal_id_fkey                                         FOREIGN KEY (principal_id) REFERENCES beverage.principals(id) ON DELETE SET NULL

-- table: beverage.batch_cost_deltas
  batch_cost_deltas_cost_baseline_id_fkey                                FOREIGN KEY (cost_baseline_id) REFERENCES beverage.cost_baselines(id) ON DELETE RESTRICT
  batch_cost_deltas_created_by_fkey                                      FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  batch_cost_deltas_label_check                                          CHECK ((btrim(label) <> ''::text))
  batch_cost_deltas_organization_id_fkey                                 FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  batch_cost_deltas_pkey                                                 PRIMARY KEY (id)
  batch_cost_deltas_production_batch_id_fkey                             FOREIGN KEY (production_batch_id) REFERENCES beverage.production_batches(id) ON DELETE RESTRICT
  batch_cost_deltas_rationale_check                                      CHECK ((btrim(rationale) <> ''::text))

-- table: beverage.batch_inputs
  batch_inputs_amount_paid_check                                         CHECK ((amount_paid >= (0)::numeric))
  batch_inputs_created_by_fkey                                           FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  batch_inputs_currency_code_check                                       CHECK ((currency_code ~ '^[A-Z]{3}$'::text))
  batch_inputs_external_record_key_check                                 CHECK ((btrim(external_record_key) <> ''::text))
  batch_inputs_external_source_check                                     CHECK ((btrim(external_source) <> ''::text))
  batch_inputs_item_name_check                                           CHECK ((btrim(item_name) <> ''::text))
  batch_inputs_organization_id_fkey                                      FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE RESTRICT
  batch_inputs_pkey                                                      PRIMARY KEY (id)
  batch_inputs_production_batch_id_fkey                                  FOREIGN KEY (production_batch_id) REFERENCES beverage.production_batches(id) ON DELETE RESTRICT
  batch_inputs_quantity_purchased_check                                  CHECK ((quantity_purchased > (0)::numeric))
  batch_inputs_unit_check                                                CHECK ((btrim(unit) <> ''::text))

-- table: beverage.calculation_plans
  calculation_plans_created_by_fkey                                      FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  calculation_plans_formula_version_id_fkey                              FOREIGN KEY (formula_version_id) REFERENCES beverage.formula_versions(id) ON DELETE RESTRICT
  calculation_plans_organization_id_fkey                                 FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  calculation_plans_pkey                                                 PRIMARY KEY (id)
  calculation_plans_plan_type_check                                      CHECK ((plan_type = ANY (ARRAY['exact_factor'::text, 'target_yield'::text, 'limiting_ingredient'::text, 'batch_cost'::text])))
  calculation_plans_result_status_check                                  CHECK ((result_status = 'planning_only_not_released'::text))

-- table: beverage.cost_baseline_lines
  cost_baseline_lines_amount_check                                       CHECK ((amount >= (0)::numeric))
  cost_baseline_lines_cost_baseline_id_fkey                              FOREIGN KEY (cost_baseline_id) REFERENCES beverage.cost_baselines(id) ON DELETE CASCADE
  cost_baseline_lines_cost_baseline_id_line_number_key                   UNIQUE (cost_baseline_id, line_number)
  cost_baseline_lines_label_check                                        CHECK ((btrim(label) <> ''::text))
  cost_baseline_lines_line_number_check                                  CHECK ((line_number > 0))
  cost_baseline_lines_pkey                                               PRIMARY KEY (id)

-- table: beverage.cost_baselines
  cost_baselines_approved_by_fkey                                        FOREIGN KEY (approved_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  cost_baselines_baseline_status_check                                   CHECK ((baseline_status = ANY (ARRAY['draft'::text, 'approved'::text, 'superseded'::text])))
  cost_baselines_check                                                   CHECK (((baseline_status <> 'approved'::text) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL))))
  cost_baselines_created_by_fkey                                         FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  cost_baselines_currency_code_check                                     CHECK ((currency_code ~ '^[A-Z]{3}$'::text))
  cost_baselines_formula_version_id_fkey                                 FOREIGN KEY (formula_version_id) REFERENCES beverage.formula_versions(id) ON DELETE RESTRICT
  cost_baselines_labour_hours_check                                      CHECK ((labour_hours >= (0)::numeric))
  cost_baselines_labour_rate_per_hour_check                              CHECK ((labour_rate_per_hour >= (0)::numeric))
  cost_baselines_organization_id_fkey                                    FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  cost_baselines_packaging_cost_check                                    CHECK ((packaging_cost >= (0)::numeric))
  cost_baselines_pkey                                                    PRIMARY KEY (id)

-- table: beverage.experiment_test_runs
  experiment_test_runs_check                                             CHECK (((btrim(COALESCE(sensory_notes, ''::text)) <> ''::text) OR (outcome = 'inconclusive'::text)))
  experiment_test_runs_completed_by_fkey                                 FOREIGN KEY (completed_by) REFERENCES beverage.principals(id) ON DELETE RESTRICT
  experiment_test_runs_experiment_id_fkey                                FOREIGN KEY (experiment_id) REFERENCES beverage.experiments(id) ON DELETE CASCADE
  experiment_test_runs_organization_id_fkey                              FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  experiment_test_runs_outcome_check                                     CHECK ((outcome = ANY (ARRAY['completed'::text, 'inconclusive'::text, 'failed'::text])))
  experiment_test_runs_pkey                                              PRIMARY KEY (id)

-- table: beverage.experiments
  experiments_created_by_fkey                                            FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  experiments_formula_version_id_fkey                                    FOREIGN KEY (formula_version_id) REFERENCES beverage.formula_versions(id) ON DELETE SET NULL
  experiments_hypothesis_check                                           CHECK ((btrim(hypothesis) <> ''::text))
  experiments_organization_id_fkey                                       FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  experiments_pkey                                                       PRIMARY KEY (id)
  experiments_status_check                                               CHECK ((status = ANY (ARRAY['draft'::text, 'ready_for_internal_test'::text, 'internal_knowledge'::text, 'rejected'::text, 'archived'::text])))
  experiments_title_check                                                CHECK ((btrim(title) <> ''::text))
  experiments_trend_card_id_fkey                                         FOREIGN KEY (trend_card_id) REFERENCES beverage.trend_cards(id) ON DELETE SET NULL

-- table: beverage.formula_components
  formula_components_component_role_check                                CHECK ((component_role = ANY (ARRAY['ingredient'::text, 'water'::text, 'sweetener'::text, 'acid'::text, 'preservative'::text, 'processing_aid'::text, 'packaging_loss'::text, 'intermediate'::text])))
  formula_components_formula_version_id_fkey                             FOREIGN KEY (formula_version_id) REFERENCES beverage.formula_versions(id) ON DELETE CASCADE
  formula_components_formula_version_id_line_number_key                  UNIQUE (formula_version_id, line_number)
  formula_components_ingredient_name_check                               CHECK ((btrim(ingredient_name) <> ''::text))
  formula_components_line_number_check                                   CHECK ((line_number > 0))
  formula_components_pkey                                                PRIMARY KEY (id)
  formula_components_quantity_check                                      CHECK ((quantity >= (0)::numeric))
  formula_components_sub_formula_check                                   CHECK ((((component_role = 'intermediate'::text) AND (btrim(COALESCE(sub_formula_key, ''::text)) <> ''::text)) OR ((component_role <> 'intermediate'::text) AND (sub_formula_key IS NULL))))
  formula_components_unit_check                                          CHECK ((btrim(unit) <> ''::text))

-- table: beverage.formula_drafts
  formula_drafts_created_by_fkey                                         FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  formula_drafts_draft_status_check                                      CHECK ((draft_status = ANY (ARRAY['needs_review'::text, 'in_review'::text, 'rejected'::text, 'accepted_for_versioning'::text])))
  formula_drafts_extraction_confidence_check                             CHECK (((extraction_confidence IS NULL) OR ((extraction_confidence >= (0)::numeric) AND (extraction_confidence <= (1)::numeric))))
  formula_drafts_ingestion_run_id_fkey                                   FOREIGN KEY (ingestion_run_id) REFERENCES beverage.recipe_ingestion_runs(id) ON DELETE SET NULL
  formula_drafts_intended_yield_value_check                              CHECK (((intended_yield_value IS NULL) OR (intended_yield_value >= (0)::numeric)))
  formula_drafts_name_check                                              CHECK ((btrim(name) <> ''::text))
  formula_drafts_organization_id_fkey                                    FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  formula_drafts_organization_id_original_source_hash_key                UNIQUE (organization_id, original_source_hash)
  formula_drafts_original_source_hash_check                              CHECK ((btrim(original_source_hash) <> ''::text))
  formula_drafts_pkey                                                    PRIMARY KEY (id)

-- table: beverage.formula_versions
  formula_versions_approved_by_fkey                                      FOREIGN KEY (approved_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  formula_versions_check                                                 CHECK (((lifecycle_status <> 'approved'::text) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL))))
  formula_versions_created_by_fkey                                       FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  formula_versions_formula_draft_id_fkey                                 FOREIGN KEY (formula_draft_id) REFERENCES beverage.formula_drafts(id) ON DELETE SET NULL
  formula_versions_formula_key_check                                     CHECK ((btrim(formula_key) <> ''::text))
  formula_versions_intended_yield_pair_check                             CHECK ((((intended_yield_value IS NULL) AND (intended_yield_unit IS NULL)) OR ((intended_yield_value IS NOT NULL) AND (intended_yield_unit IS NOT NULL))))
  formula_versions_intended_yield_unit_check                             CHECK ((btrim(intended_yield_unit) <> ''::text))
  formula_versions_intended_yield_value_check                            CHECK ((intended_yield_value > (0)::numeric))
  formula_versions_lifecycle_status_check                                CHECK ((lifecycle_status = ANY (ARRAY['draft'::text, 'approved'::text, 'superseded'::text, 'retired'::text])))
  formula_versions_name_check                                            CHECK ((btrim(name) <> ''::text))
  formula_versions_organization_id_fkey                                  FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  formula_versions_organization_id_formula_key_version_number_key        UNIQUE (organization_id, formula_key, version_number)
  formula_versions_pkey                                                  PRIMARY KEY (id)
  formula_versions_version_number_check                                  CHECK ((version_number > 0))

-- table: beverage.graph_edges
  graph_edges_check                                                      CHECK ((from_node_id <> to_node_id))
  graph_edges_evidence_class_check                                       CHECK ((evidence_class = ANY (ARRAY['approved_internal'::text, 'internal_validated'::text, 'external_reference'::text, 'inspiration'::text])))
  graph_edges_from_node_id_fkey                                          FOREIGN KEY (from_node_id) REFERENCES beverage.graph_nodes(id) ON DELETE CASCADE
  graph_edges_organization_id_fkey                                       FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  graph_edges_pkey                                                       PRIMARY KEY (id)
  graph_edges_relationship_type_check                                    CHECK ((relationship_type = ANY (ARRAY['family_member'::text, 'complementary'::text, 'contrast'::text, 'bridge'::text, 'cut'::text, 'echo'::text, 'cleanse'::text, 'amplify_aroma'::text, 'avoidance'::text])))
  graph_edges_review_status_check                                        CHECK ((review_status = ANY (ARRAY['draft'::text, 'reference'::text, 'approved'::text, 'rejected'::text])))
  graph_edges_source_id_fkey                                             FOREIGN KEY (source_id) REFERENCES beverage.knowledge_sources(id) ON DELETE SET NULL
  graph_edges_to_node_id_fkey                                            FOREIGN KEY (to_node_id) REFERENCES beverage.graph_nodes(id) ON DELETE CASCADE

-- table: beverage.graph_nodes
  graph_nodes_canonical_key_check                                        CHECK ((btrim(canonical_key) <> ''::text))
  graph_nodes_label_check                                                CHECK ((btrim(label) <> ''::text))
  graph_nodes_node_type_check                                            CHECK ((node_type = ANY (ARRAY['ingredient'::text, 'cocktail_family'::text, 'food_profile'::text, 'flavour_concept'::text, 'course_context'::text, 'trend'::text, 'experiment'::text])))
  graph_nodes_organization_id_fkey                                       FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  graph_nodes_organization_id_node_type_canonical_key_key                UNIQUE (organization_id, node_type, canonical_key)
  graph_nodes_pkey                                                       PRIMARY KEY (id)
  graph_nodes_review_status_check                                        CHECK ((review_status = ANY (ARRAY['draft'::text, 'reference'::text, 'approved'::text, 'rejected'::text])))
  graph_nodes_source_id_fkey                                             FOREIGN KEY (source_id) REFERENCES beverage.knowledge_sources(id) ON DELETE SET NULL

-- table: beverage.inventory_action_requests
  inventory_action_requests_action_type_check                            CHECK ((action_type = ANY (ARRAY['pickup_add'::text, 'usage_record'::text, 'mark_out_of_stock'::text, 'inventory_reset'::text])))
  inventory_action_requests_confirmation_digest_check                    CHECK ((btrim(confirmation_digest) <> ''::text))
  inventory_action_requests_organization_id_fkey                         FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  inventory_action_requests_pkey                                         PRIMARY KEY (id)
  inventory_action_requests_request_status_check                         CHECK ((request_status = ANY (ARRAY['previewed'::text, 'executing'::text, 'applied'::text, 'failed'::text, 'expired'::text, 'cancelled'::text])))
  inventory_action_requests_requested_by_fkey                            FOREIGN KEY (requested_by) REFERENCES beverage.principals(id) ON DELETE RESTRICT

-- table: beverage.inventory_evidence_snapshots
  inventory_evidence_snapshots_freshness_status_check                    CHECK ((freshness_status = ANY (ARRAY['fresh'::text, 'stale'::text, 'unknown'::text])))
  inventory_evidence_snapshots_item_name_check                           CHECK ((btrim(item_name) <> ''::text))
  inventory_evidence_snapshots_mapping_confidence_check                  CHECK (((mapping_confidence IS NULL) OR ((mapping_confidence >= (0)::numeric) AND (mapping_confidence <= (1)::numeric))))
  inventory_evidence_snapshots_organization_id_fkey                      FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  inventory_evidence_snapshots_pkey                                      PRIMARY KEY (id)
  inventory_evidence_snapshots_production_batch_id_fkey                  FOREIGN KEY (production_batch_id) REFERENCES beverage.production_batches(id) ON DELETE SET NULL
  inventory_evidence_snapshots_read_only_check                           CHECK ((read_only = true))
  inventory_evidence_snapshots_unit_basis_status_check                   CHECK ((unit_basis_status = ANY (ARRAY['verified'::text, 'ambiguous'::text, 'unknown'::text])))

-- table: beverage.knowledge_sources
  knowledge_sources_authority_tier_check                                 CHECK ((authority_tier = ANY (ARRAY['tier_a_internal'::text, 'tier_b_authorized_course'::text, 'tier_c_external_practitioner'::text, 'tier_d_inspiration'::text])))
  knowledge_sources_created_by_fkey                                      FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  knowledge_sources_operational_status_check                             CHECK ((operational_status = ANY (ARRAY['approved_internal'::text, 'pending_review'::text, 'reference_only'::text, 'inspiration_only'::text, 'blocked_rights'::text])))
  knowledge_sources_organization_id_fkey                                 FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  knowledge_sources_organization_id_source_key_key                       UNIQUE (organization_id, source_key)
  knowledge_sources_pkey                                                 PRIMARY KEY (id)
  knowledge_sources_rights_status_check                                  CHECK ((rights_status = ANY (ARRAY['internal_owned'::text, 'authorized_private'::text, 'public_summary_only'::text, 'public_tool_operated_in_place'::text, 'user_provided_excerpt'::text, 'licensed'::text, 'blocked_rights'::text, 'review_required'::text])))
  knowledge_sources_source_key_check                                     CHECK ((btrim(source_key) <> ''::text))
  knowledge_sources_title_check                                          CHECK ((btrim(title) <> ''::text))

-- table: beverage.organization_memberships
  organization_memberships_organization_id_fkey                          FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  organization_memberships_pkey                                          PRIMARY KEY (organization_id, principal_id)
  organization_memberships_principal_id_fkey                             FOREIGN KEY (principal_id) REFERENCES beverage.principals(id) ON DELETE CASCADE
  organization_memberships_role_check                                    CHECK ((role = ANY (ARRAY['owner'::text, 'approver'::text, 'operator'::text, 'viewer'::text])))

-- table: beverage.organizations
  organizations_name_check                                               CHECK ((btrim(name) <> ''::text))
  organizations_pkey                                                     PRIMARY KEY (id)
  organizations_slug_check                                               CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'::text))
  organizations_slug_key                                                 UNIQUE (slug)
  organizations_status_check                                             CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text])))

-- table: beverage.principals
  principals_identity_provider_external_subject_key                      UNIQUE (identity_provider, external_subject)
  principals_pkey                                                        PRIMARY KEY (id)

-- table: beverage.production_batches
  production_batches_batch_label_check                                   CHECK ((btrim(batch_label) <> ''::text))
  production_batches_created_by_fkey                                     FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  production_batches_formula_version_id_fkey                             FOREIGN KEY (formula_version_id) REFERENCES beverage.formula_versions(id) ON DELETE RESTRICT
  production_batches_label_unique                                        UNIQUE (organization_id, formula_version_id, batch_label)
  production_batches_measured_yield_pair_check                           CHECK ((((measured_yield_value IS NULL) AND (measured_yield_unit IS NULL)) OR ((measured_yield_value IS NOT NULL) AND (measured_yield_unit IS NOT NULL))))
  production_batches_measured_yield_unit_check                           CHECK ((btrim(measured_yield_unit) <> ''::text))
  production_batches_measured_yield_value_check                          CHECK ((measured_yield_value > (0)::numeric))
  production_batches_organization_id_fkey                                FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE RESTRICT
  production_batches_pkey                                                PRIMARY KEY (id)

-- table: beverage.recipe_ingestion_runs
  recipe_ingestion_runs_initiated_by_fkey                                FOREIGN KEY (initiated_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  recipe_ingestion_runs_intake_kind_check                                CHECK ((intake_kind = ANY (ARRAY['notion_export'::text, 'spreadsheet'::text, 'manual_entry'::text, 'browser_asset'::text, 'text'::text, 'other'::text])))
  recipe_ingestion_runs_organization_id_fkey                             FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  recipe_ingestion_runs_parse_status_check                               CHECK ((parse_status = ANY (ARRAY['received'::text, 'parsed_to_draft'::text, 'needs_human_review'::text, 'rejected'::text, 'failed'::text])))
  recipe_ingestion_runs_pkey                                             PRIMARY KEY (id)
  recipe_ingestion_runs_source_id_fkey                                   FOREIGN KEY (source_id) REFERENCES beverage.knowledge_sources(id) ON DELETE SET NULL
  recipe_ingestion_runs_source_label_check                               CHECK ((btrim(source_label) <> ''::text))

-- table: beverage.research_candidates
  research_candidates_candidate_status_check                             CHECK ((candidate_status = ANY (ARRAY['proposed'::text, 'ingest_as_reference'::text, 'saved_research_only'::text, 'discarded'::text, 'blocked'::text])))
  research_candidates_created_by_fkey                                    FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  research_candidates_decided_by_fkey                                    FOREIGN KEY (decided_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  research_candidates_organization_id_fkey                               FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  research_candidates_pkey                                               PRIMARY KEY (id)
  research_candidates_research_run_id_fkey                               FOREIGN KEY (research_run_id) REFERENCES beverage.research_runs(id) ON DELETE CASCADE
  research_candidates_rights_status_check                                CHECK ((rights_status = ANY (ARRAY['public_summary_only'::text, 'public_tool_operated_in_place'::text, 'authorized_private'::text, 'licensed'::text, 'blocked_rights'::text, 'review_required'::text])))
  research_candidates_source_id_fkey                                     FOREIGN KEY (source_id) REFERENCES beverage.knowledge_sources(id) ON DELETE SET NULL
  research_candidates_source_url_check                                   CHECK ((btrim(source_url) <> ''::text))
  research_candidates_title_check                                        CHECK ((btrim(title) <> ''::text))

-- table: beverage.research_runs
  research_runs_created_by_fkey                                          FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  research_runs_organization_id_fkey                                     FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  research_runs_pkey                                                     PRIMARY KEY (id)
  research_runs_question_check                                           CHECK ((btrim(question) <> ''::text))
  research_runs_research_transport_check                                 CHECK ((research_transport = ANY (ARRAY['firecrawl'::text, 'last30days'::text, 'manual'::text])))
  research_runs_retention_mode_check                                     CHECK ((retention_mode = ANY (ARRAY['temporary'::text, 'proposed_for_review'::text, 'retained_reference'::text])))
  research_runs_run_status_check                                         CHECK ((run_status = ANY (ARRAY['requested'::text, 'gathering'::text, 'proposed'::text, 'failed'::text, 'closed'::text])))

-- table: beverage.trend_cards
  trend_cards_created_by_fkey                                            FOREIGN KEY (created_by) REFERENCES beverage.principals(id) ON DELETE SET NULL
  trend_cards_discovery_transport_check                                  CHECK ((discovery_transport = ANY (ARRAY['last30days'::text, 'firecrawl'::text, 'manual'::text])))
  trend_cards_organization_id_fkey                                       FOREIGN KEY (organization_id) REFERENCES beverage.organizations(id) ON DELETE CASCADE
  trend_cards_pkey                                                       PRIMARY KEY (id)
  trend_cards_retention_status_check                                     CHECK ((retention_status = ANY (ARRAY['temporary'::text, 'proposed'::text, 'retained_reference'::text, 'discarded'::text])))
  trend_cards_title_check                                                CHECK ((btrim(title) <> ''::text))
