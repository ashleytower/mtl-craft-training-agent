-- CAPTURED BASELINE from the live database — non-internal triggers in schema beverage
-- Capture timestamp (database now()): 2026-08-31 01:19:18.112408+00
-- Supabase project ref: ctyxnhcljruyciebkwef
-- Schema: beverage
--
-- This file is a READ-ONLY RECORD of live database state at the timestamp above.
-- It is NOT a migration and must NOT be executed or replayed against any database.
--
-- 7 triggers total. Ordered by table name, then trigger name. Trigger function name is noted alongside each definition.


-- table: beverage.agent_sessions  |  trigger: beverage_agent_sessions_touch  |  function: touch_updated_at
  CREATE TRIGGER beverage_agent_sessions_touch BEFORE UPDATE ON beverage.agent_sessions FOR EACH ROW EXECUTE FUNCTION beverage.touch_updated_at();

-- table: beverage.cost_baselines  |  trigger: beverage_cost_baselines_touch  |  function: touch_updated_at
  CREATE TRIGGER beverage_cost_baselines_touch BEFORE UPDATE ON beverage.cost_baselines FOR EACH ROW EXECUTE FUNCTION beverage.touch_updated_at();

-- table: beverage.experiments  |  trigger: beverage_experiments_touch  |  function: touch_updated_at
  CREATE TRIGGER beverage_experiments_touch BEFORE UPDATE ON beverage.experiments FOR EACH ROW EXECUTE FUNCTION beverage.touch_updated_at();

-- table: beverage.formula_drafts  |  trigger: beverage_formula_drafts_touch  |  function: touch_updated_at
  CREATE TRIGGER beverage_formula_drafts_touch BEFORE UPDATE ON beverage.formula_drafts FOR EACH ROW EXECUTE FUNCTION beverage.touch_updated_at();

-- table: beverage.formula_versions  |  trigger: beverage_formula_versions_touch  |  function: touch_updated_at
  CREATE TRIGGER beverage_formula_versions_touch BEFORE UPDATE ON beverage.formula_versions FOR EACH ROW EXECUTE FUNCTION beverage.touch_updated_at();

-- table: beverage.knowledge_sources  |  trigger: beverage_sources_touch  |  function: touch_updated_at
  CREATE TRIGGER beverage_sources_touch BEFORE UPDATE ON beverage.knowledge_sources FOR EACH ROW EXECUTE FUNCTION beverage.touch_updated_at();

-- table: beverage.organizations  |  trigger: beverage_organizations_touch  |  function: touch_updated_at
  CREATE TRIGGER beverage_organizations_touch BEFORE UPDATE ON beverage.organizations FOR EACH ROW EXECUTE FUNCTION beverage.touch_updated_at();
