-- 110: carry the preparation method into the formula version.
--
-- `formula_versions.process_json` has existed since the schema was created and
-- was NULL on every row, because `beverage_create_formula_version` never had a
-- parameter for it. So "how do I make this?" had no answer even for an approved
-- formula. This is the same defect shape as 109 (product_category): the column
-- was there, the intake had the data, the create function dropped it.
--
-- Where the data comes from differs by category, and only one half is plumbing:
--   * cocktails  — 45 of 50 drafts carry `method_source_text` from Notion.
--   * syrups     — 0 of 76. The Notion syrup collection is an inventory and
--                  costing table (yield, bags, bottles, labour hours, selling
--                  price); it holds no procedure at all. For a syrup the method
--                  can only come from the operator typing it at normalize time.
--
-- The two sets are DISJOINT, which decides which path actually runs today:
-- 0 drafts have both a method and resolved ingredients. Cocktails carry method
-- but no ingredients, so they cannot be versioned at all (the function requires
-- at least one component); syrups carry ingredients but no method. So the
-- 'notion_draft' inheritance branch below, and the backfill, are correct but
-- DORMANT — they start mattering the day cocktail ingredients get resolved.
-- Every version created today takes the operator-typed or the empty path.
--
-- CORRECTION (2026-08-31): the note that stood here was wrong on both counts.
-- It claimed migrations 097-109 were applied with no source file anywhere and
-- should be recovered via pg_get_functiondef. In fact 097-104 are CRM
-- migrations that have always had files in the CRM repository, and the beverage
-- migrations are recoverable verbatim from supabase_migrations.schema_migrations,
-- which carries tables, constraints, grants and backfills that a function dump
-- cannot see. They are recovered in db/baseline/recovered-migrations/.
-- See db/baseline/DRIFT.md. Corrected here rather than left standing because
-- the original wording sent a reader off to do recovery work that was already
-- done and could not have worked the way it described.

-- ---------------------------------------------------------------------------
-- process_json contract
--
--   { "source": "operator" | "notion_draft",
--     "steps":  [ { "section": text|null, "text": text }, ... ],
--     "raw":    text|null }
--
--   steps non-empty            -> a procedure a human confirmed at normalize time
--   steps empty, raw present   -> intake text carried through, never reviewed
--   {}                         -> nothing recorded; say so, never invent one
--
-- The empty case is `{}`, NOT null: process_json is NOT NULL with default
-- '{}'::jsonb. Writing null there raises a not-null violation, which would have
-- made every syrup impossible to version — a syrup has no intake method, so it
-- is exactly the row that takes the empty path.
--
-- `source` is set here rather than accepted from the caller, so provenance
-- cannot be asserted by whoever is calling. The function takes only the steps.
-- ---------------------------------------------------------------------------

drop function if exists public.beverage_create_formula_version(
  text, text, boolean, uuid, text, text, numeric, text, jsonb);

create function public.beverage_create_formula_version(
  p_external_subject text,
  p_display_name text,
  p_is_owner boolean,
  p_formula_draft_id uuid,
  p_formula_key text,
  p_name text,
  p_yield_value numeric,
  p_yield_unit text,
  p_components jsonb,
  p_process_steps jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'beverage', 'public', 'pg_temp'
as $function$
declare
  v_context jsonb; v_org_id uuid; v_principal_id uuid; v_role text;
  v_version beverage.formula_versions; v_next_version integer; v_yield_unit text;
  v_category text; v_method_raw text; v_steps jsonb; v_process jsonb;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  v_role := v_context->>'role';
  if v_role not in ('owner','approver','operator') then raise exception 'Operator role required'; end if;
  if btrim(coalesce(p_formula_key,'')) = '' or btrim(coalesce(p_name,'')) = '' then raise exception 'Formula key and name are required'; end if;
  v_yield_unit := nullif(btrim(coalesce(p_yield_unit,'')),'');
  if (p_yield_value is null) <> (v_yield_unit is null) then
    raise exception 'A planned yield needs both a value and a unit, or neither'; end if;
  if p_yield_value is not null and p_yield_value <= 0 then
    raise exception 'A planned yield must be positive when it is supplied'; end if;
  if jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then raise exception 'At least one normalized component is required'; end if;

  select product_category, nullif(btrim(coalesce(original_recipe_json->>'method_source_text','')),'')
    into v_category, v_method_raw
    from beverage.formula_drafts
   where id = p_formula_draft_id and organization_id = v_org_id;
  if not found then raise exception 'Formula draft not found in organization'; end if;

  -- Steps are optional, but if they are supplied they have to be usable: an
  -- unlabelled or blank instruction is worse than no method at all, because it
  -- reads as though a procedure was recorded.
  if p_process_steps is not null and jsonb_typeof(p_process_steps) <> 'null' then
    if jsonb_typeof(p_process_steps) <> 'array' then
      raise exception 'Preparation steps must be a list';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_process_steps) as e
       where jsonb_typeof(e) <> 'object'
    ) then
      raise exception 'Each preparation step must be an object with a text field';
    end if;
    select jsonb_agg(jsonb_build_object('section', s.sec, 'text', s.txt) order by s.ord)
      into v_steps
      from (
        select nullif(btrim(coalesce(elem->>'section','')),'') as sec,
               btrim(coalesce(elem->>'text','')) as txt,
               ord
          from jsonb_array_elements(p_process_steps) with ordinality as t(elem, ord)
      ) s
     where s.txt <> '';
    if v_steps is null then
      raise exception 'Preparation steps were supplied but every one of them was empty';
    end if;
  end if;

  if v_steps is not null then
    v_process := jsonb_build_object('source','operator','steps',v_steps,'raw',to_jsonb(v_method_raw));
  elsif v_method_raw is not null then
    v_process := jsonb_build_object('source','notion_draft','steps','[]'::jsonb,'raw',to_jsonb(v_method_raw));
  else
    v_process := '{}'::jsonb;
  end if;

  select coalesce(max(version_number),0)+1 into v_next_version from beverage.formula_versions where organization_id = v_org_id and formula_key = p_formula_key;
  insert into beverage.formula_versions (organization_id, formula_draft_id, formula_key, version_number, name, product_category, intended_yield_value, intended_yield_unit, process_json, lifecycle_status, created_by)
  values (v_org_id, p_formula_draft_id, p_formula_key, v_next_version, p_name, v_category, p_yield_value, v_yield_unit, v_process, 'draft', v_principal_id)
  returning * into v_version;
  insert into beverage.formula_components (formula_version_id, line_number, ingredient_name, ingredient_key, quantity, unit, component_role, optional, source_locator, notes, sub_formula_key)
  select v_version.id, x.line_number, x.ingredient_name, nullif(x.ingredient_key,''), x.quantity, x.unit,
         coalesce(nullif(x.component_role,''),'ingredient'), coalesce(x.optional,false),
         nullif(x.source_locator,''), nullif(x.notes,''), nullif(x.sub_formula_key,'')
  from jsonb_to_recordset(p_components) as x(line_number integer, ingredient_name text, ingredient_key text, quantity numeric, unit text, component_role text, optional boolean, source_locator text, notes text, sub_formula_key text);
  update beverage.formula_drafts set draft_status='accepted_for_versioning' where id = p_formula_draft_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id,'formula_version_created','formula_version', v_version.id,
          jsonb_build_object('formula_draft_id', p_formula_draft_id,
                             'method_source', coalesce(nullif(v_process->>'source',''),'none')));
  return jsonb_build_object('id', v_version.id,'lifecycle_status', v_version.lifecycle_status,'version_number', v_version.version_number,'product_category', v_version.product_category,'method_source', coalesce(nullif(v_process->>'source',''),'none'));
end; $function$;

-- ---------------------------------------------------------------------------
-- Backfill. Existing versions predate the parameter, so they carry whatever
-- their originating draft had. `steps` stays empty: nobody has reviewed these,
-- and marking them 'operator' would claim a human approved a procedure they
-- never saw.
-- ---------------------------------------------------------------------------
update beverage.formula_versions v
   set process_json = jsonb_build_object(
         'source', 'notion_draft',
         'steps', '[]'::jsonb,
         'raw', to_jsonb(nullif(btrim(d.original_recipe_json->>'method_source_text'), ''))
       ),
       updated_at = now()
  from beverage.formula_drafts d
 where d.id = v.formula_draft_id
   -- '{}' is the untouched value, not null. `process_json is null` matches
   -- nothing here and would make this whole statement dead code.
   and coalesce(v.process_json, '{}'::jsonb) = '{}'::jsonb
   and nullif(btrim(coalesce(d.original_recipe_json->>'method_source_text','')), '') is not null;

-- ---------------------------------------------------------------------------
-- Expose it. Without this the agent and the workbench cannot see the method
-- even once it is stored.
-- ---------------------------------------------------------------------------
create or replace function public.beverage_list_approved_formulas(p_external_subject text, p_display_name text, p_is_owner boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'beverage', 'public', 'pg_temp'
as $function$
declare v_context jsonb; v_org_id uuid;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'formula_key', f.formula_key, 'version_number', f.version_number,
      'name', f.name, 'product_category', f.product_category,
      'intended_yield_value', f.intended_yield_value,
      'intended_yield_unit', f.intended_yield_unit, 'approved_at', f.approved_at,
      'process_json', f.process_json,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_number', c.line_number, 'ingredient_name', c.ingredient_name,
          'ingredient_key', c.ingredient_key, 'quantity', c.quantity,
          'unit', c.unit, 'component_role', c.component_role) order by c.line_number)
        from beverage.formula_components c where c.formula_version_id = f.id), '[]'::jsonb)
    ) order by f.name, f.version_number desc)
    from beverage.formula_versions f
    where f.organization_id = v_org_id and f.lifecycle_status = 'approved'), '[]'::jsonb);
end; $function$;

create or replace function public.beverage_list_pending_formula_versions(p_external_subject text, p_display_name text, p_is_owner boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'beverage', 'public', 'pg_temp'
as $function$
declare v_context jsonb; v_org_id uuid; v_role text;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_role := v_context->>'role';
  if v_role not in ('owner','approver') then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'formula_key', f.formula_key, 'version_number', f.version_number,
      'name', f.name, 'product_category', f.product_category,
      'intended_yield_value', f.intended_yield_value,
      'intended_yield_unit', f.intended_yield_unit,
      'formula_draft_id', f.formula_draft_id,
      'process_json', f.process_json,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
          'line_number', c.line_number, 'ingredient_name', c.ingredient_name,
          'quantity', c.quantity, 'unit', c.unit,
          'component_role', c.component_role, 'sub_formula_key', c.sub_formula_key) order by c.line_number)
        from beverage.formula_components c where c.formula_version_id = f.id), '[]'::jsonb)
    ) order by f.created_at desc)
    from beverage.formula_versions f
    where f.organization_id = v_org_id and f.lifecycle_status = 'draft'), '[]'::jsonb);
end; $function$;

-- The drafts listing carries the source text so the workbench can prefill the
-- method editor without a second round trip.
create or replace function public.beverage_list_formula_drafts(p_external_subject text, p_display_name text, p_is_owner boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'beverage', 'public', 'pg_temp'
as $function$
declare v_context jsonb; v_org_id uuid;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name, 'product_category', d.product_category,
      'draft_status', d.draft_status,
      'intended_yield_value', d.intended_yield_value,
      'intended_yield_unit', d.intended_yield_unit,
      'method_source_text', nullif(btrim(coalesce(d.original_recipe_json->>'method_source_text','')),''),
      'original_recipe_json', d.original_recipe_json
    ) order by d.name)
    from beverage.formula_drafts d
    where d.organization_id = v_org_id), '[]'::jsonb);
end; $function$;
