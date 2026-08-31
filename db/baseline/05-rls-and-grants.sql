-- CAPTURED BASELINE from the live database — RLS status, policies, and grants in schema beverage
-- Capture timestamp (database now()): 2026-08-31 01:19:18.112408+00
-- Supabase project ref: ctyxnhcljruyciebkwef
-- Schema: beverage
--
-- This file is a READ-ONLY RECORD of live database state at the timestamp above.
-- It is NOT a migration and must NOT be executed or replayed against any database.


-- (a) Per-table RLS status (from pg_class), ordered by table name
-- 27 tables total
  agent_messages                           relrowsecurity=TRUE   relforcerowsecurity=FALSE
  agent_sessions                           relrowsecurity=TRUE   relforcerowsecurity=FALSE
  approval_decisions                       relrowsecurity=TRUE   relforcerowsecurity=FALSE
  audit_events                             relrowsecurity=TRUE   relforcerowsecurity=FALSE
  batch_cost_deltas                        relrowsecurity=TRUE   relforcerowsecurity=FALSE
  batch_inputs                             relrowsecurity=TRUE   relforcerowsecurity=FALSE
  calculation_plans                        relrowsecurity=TRUE   relforcerowsecurity=FALSE
  cost_baseline_lines                      relrowsecurity=TRUE   relforcerowsecurity=FALSE
  cost_baselines                           relrowsecurity=TRUE   relforcerowsecurity=FALSE
  experiment_test_runs                     relrowsecurity=TRUE   relforcerowsecurity=FALSE
  experiments                              relrowsecurity=TRUE   relforcerowsecurity=FALSE
  formula_components                       relrowsecurity=TRUE   relforcerowsecurity=FALSE
  formula_drafts                           relrowsecurity=TRUE   relforcerowsecurity=FALSE
  formula_versions                         relrowsecurity=TRUE   relforcerowsecurity=FALSE
  graph_edges                              relrowsecurity=TRUE   relforcerowsecurity=FALSE
  graph_nodes                              relrowsecurity=TRUE   relforcerowsecurity=FALSE
  inventory_action_requests                relrowsecurity=TRUE   relforcerowsecurity=FALSE
  inventory_evidence_snapshots             relrowsecurity=TRUE   relforcerowsecurity=FALSE
  knowledge_sources                        relrowsecurity=TRUE   relforcerowsecurity=FALSE
  organization_memberships                 relrowsecurity=TRUE   relforcerowsecurity=FALSE
  organizations                            relrowsecurity=TRUE   relforcerowsecurity=FALSE
  principals                               relrowsecurity=TRUE   relforcerowsecurity=FALSE
  production_batches                       relrowsecurity=TRUE   relforcerowsecurity=FALSE
  recipe_ingestion_runs                    relrowsecurity=TRUE   relforcerowsecurity=FALSE
  research_candidates                      relrowsecurity=TRUE   relforcerowsecurity=FALSE
  research_runs                            relrowsecurity=TRUE   relforcerowsecurity=FALSE
  trend_cards                              relrowsecurity=TRUE   relforcerowsecurity=FALSE

-- (b) Policies (from pg_policies where schemaname='beverage')
-- none found — ZERO policies exist on any table in the beverage schema.
--
-- Because every table above has relrowsecurity=TRUE and there are no policies,
-- ordinary roles (anon, authenticated, and any role without BYPASSRLS) have NO
-- direct row access to any beverage table via PostgREST or a plain client query.
-- The only access path is through the beverage_* SECURITY DEFINER functions,
-- which run as their owning role (a role that bypasses RLS), not as the caller.

-- (c) Table grants (from information_schema.role_table_grants where table_schema='beverage')
-- 369 rows total. Ordered by table name, grantee, privilege type.
  -- table: beverage.agent_messages
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.agent_sessions
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.approval_decisions
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.audit_events
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.batch_cost_deltas
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.batch_inputs
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    INSERT       grantable=NO
    service_role    SELECT       grantable=NO

  -- table: beverage.calculation_plans
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.cost_baseline_lines
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.cost_baselines
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.experiment_test_runs
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.experiments
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.formula_components
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.formula_drafts
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.formula_versions
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.graph_edges
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.graph_nodes
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.inventory_action_requests
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.inventory_evidence_snapshots
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.knowledge_sources
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.organization_memberships
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.organizations
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.principals
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.production_batches
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    INSERT       grantable=NO
    service_role    SELECT       grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.recipe_ingestion_runs
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.research_candidates
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.research_runs
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

  -- table: beverage.trend_cards
    postgres        DELETE       grantable=YES
    postgres        INSERT       grantable=YES
    postgres        REFERENCES   grantable=YES
    postgres        SELECT       grantable=YES
    postgres        TRIGGER      grantable=YES
    postgres        TRUNCATE     grantable=YES
    postgres        UPDATE       grantable=YES
    service_role    DELETE       grantable=NO
    service_role    INSERT       grantable=NO
    service_role    REFERENCES   grantable=NO
    service_role    SELECT       grantable=NO
    service_role    TRIGGER      grantable=NO
    service_role    TRUNCATE     grantable=NO
    service_role    UPDATE       grantable=NO

-- (c) Routine grants (from information_schema.role_routine_grants where routine_name like 'beverage%')
-- 57 rows total. Ordered by routine name, grantee, privilege type.
  -- routine: public.beverage_approve_formula_version_for_subject
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_claim_inventory_action_request
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_create_experiment
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_create_formula_version
    PUBLIC          EXECUTE      grantable=NO
    anon            EXECUTE      grantable=NO
    authenticated   EXECUTE      grantable=NO
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_create_inventory_action_request
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_create_temporary_trend_card
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_dashboard
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_decide_experiment
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_decide_research_candidate
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_ensure_context
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_finish_inventory_action_request
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_graph_overview
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_list_approved_formulas
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_list_experiments
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_list_formula_drafts
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_list_operator_history
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_list_pending_formula_versions
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_list_research_candidates
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_list_trend_cards
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_open_production_batch
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_record_agent_interaction
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_record_batch_cost_delta
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_record_batch_input
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_record_calculation_plan
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_record_inventory_evidence
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_record_measured_yield
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO

  -- routine: public.beverage_record_research_candidates
    postgres        EXECUTE      grantable=YES
    service_role    EXECUTE      grantable=NO
