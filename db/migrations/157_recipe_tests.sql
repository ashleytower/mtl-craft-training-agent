-- 157: recipe tests. Ashley makes a test of a recipe on a date, tastes it, and
-- later says which test is the confirmed recipe.
--
-- NUMBERING. 157 follows the CRM's 156 on the shared number line (live
-- supabase_migrations ledger checked 2026-10-22; no open CRM PR claims a number).
--
-- ASHLEY, 2026-10-22: "I would say like spicy mango jelly recipe October 20 then
-- I can say I made another one October 30 if I changed anything" ... "it can be
-- saved next to the old one in case I don't like the change I made and I wanna go
-- back to the old one and then when I say OK this is a confirmed recipe."
--
-- WHAT EXISTS AND IS REUSED
--
-- beverage.experiments (title, hypothesis, formula_version_id) and
-- beverage.experiment_test_runs (outcome, sensory_notes, completed_at) were built
-- in the governance core and never used (0 rows each on 2026-10-22). A test is an
-- experiment: title = the recipe family ("Spicy Mango Jelly"), hypothesis = what
-- she changed, formula_version_id = the approved "<family> - test <date>" formula
-- holding the exact lines. A tasting is a test run with her words verbatim.
--
-- WHAT IS MISSING AND ADDED HERE
--
-- 1. The date she made it. experiments has only created_at, which is when Brix
--    logged it, not when she made it. made_on is a real column so the date is
--    never written into a string or defaulted to now.
-- 2. A function that writes a tasting (none existed) and one that reads a
--    family's tests with their tastings (beverage_list_experiments returns no runs
--    and no date).
-- 3. 'jelly' as a product_category. The column has no constraint; this only
--    regroups what is already saved: every version and draft with a gelatin line.
--
-- Confirming a test needs nothing here: it is a new approved version under the
-- family's own formula key, and 127 already supersedes the previous one.

begin;

alter table beverage.experiments add column if not exists made_on date;

-- 1. Open a test. Owner only, like beverage_decide_experiment.
create or replace function public.beverage_open_recipe_test(
  p_external_subject text, p_display_name text, p_is_owner boolean,
  p_family text, p_change text, p_made_on date, p_formula_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $function$
declare
  v_context jsonb; v_org_id uuid; v_principal_id uuid; v_id uuid;
begin
  if not p_is_owner then raise exception 'Only the MTL Craft owner may log a recipe test'; end if;
  if btrim(coalesce(p_family, '')) = '' then raise exception 'A test needs the recipe it belongs to'; end if;
  if btrim(coalesce(p_change, '')) = '' then raise exception 'A test needs what changed (or "first test")'; end if;
  -- Never defaulted: she may log a test made days ago.
  if p_made_on is null then raise exception 'A test needs the date it was made'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  if not exists (
    select 1 from beverage.formula_versions
     where id = p_formula_version_id and organization_id = v_org_id and lifecycle_status = 'approved'
  ) then raise exception 'A test must point at an approved formula'; end if;

  insert into beverage.experiments (organization_id, title, hypothesis, formula_version_id, status, made_on, created_by)
  values (v_org_id, left(btrim(p_family), 300), left(p_change, 4000), p_formula_version_id,
          'ready_for_internal_test', p_made_on, v_principal_id)
  returning id into v_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'recipe_test_opened', 'experiment', v_id,
          jsonb_build_object('family', btrim(p_family), 'made_on', p_made_on));
  return jsonb_build_object('test_id', v_id, 'made_on', p_made_on);
end;
$function$;

-- 2. Record how it tasted. Her words are stored as given (the table's own check
-- already refuses blank notes on a completed run).
create or replace function public.beverage_record_recipe_tasting(
  p_external_subject text, p_display_name text, p_is_owner boolean,
  p_test_id uuid, p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $function$
declare
  v_context jsonb; v_org_id uuid; v_principal_id uuid; v_id uuid;
begin
  if not p_is_owner then raise exception 'Only the MTL Craft owner may record a tasting'; end if;
  if btrim(coalesce(p_notes, '')) = '' then raise exception 'A tasting needs what she said'; end if;
  -- Verbatim means never cut short: a note too long to store is refused, not truncated.
  if length(p_notes) > 4000 then raise exception 'A tasting note is limited to 4000 characters'; end if;
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  v_principal_id := (v_context->>'principal_id')::uuid;
  if not exists (
    select 1 from beverage.experiments
     where id = p_test_id and organization_id = v_org_id and made_on is not null
  ) then raise exception 'Recipe test not found'; end if;

  insert into beverage.experiment_test_runs (organization_id, experiment_id, outcome, sensory_notes, completed_by)
  values (v_org_id, p_test_id, 'completed', p_notes, v_principal_id)
  returning id into v_id;
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_org_id, v_principal_id, 'recipe_test_tasted', 'experiment', p_test_id,
          jsonb_build_object('tasting_id', v_id));
  return jsonb_build_object('tasting_id', v_id, 'test_id', p_test_id);
end;
$function$;

-- 3. A family's tests, oldest first, each with its tastings.
create or replace function public.beverage_list_recipe_tests(
  p_external_subject text, p_display_name text, p_is_owner boolean, p_family text
)
returns jsonb
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $function$
declare
  v_context jsonb; v_org_id uuid;
begin
  v_context := public.beverage_ensure_context(p_external_subject, p_display_name, p_is_owner);
  v_org_id := (v_context->>'organization_id')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'test_id', e.id, 'family', e.title, 'change', e.hypothesis, 'made_on', e.made_on,
      'formula_version_id', e.formula_version_id, 'logged_at', e.created_at,
      'tastings', coalesce((
        select jsonb_agg(jsonb_build_object('notes', r.sensory_notes, 'at', r.completed_at)
                         order by r.completed_at)
          from beverage.experiment_test_runs r where r.experiment_id = e.id), '[]'::jsonb)
    ) order by e.made_on, e.created_at)
    from beverage.experiments e
    where e.organization_id = v_org_id and e.made_on is not null
      and lower(btrim(e.title)) = lower(btrim(coalesce(p_family, '')))
  ), '[]'::jsonb);
end;
$function$;

-- Same grant shape as 129: no PUBLIC/anon default, service_role only.
revoke all on function public.beverage_open_recipe_test(text, text, boolean, text, text, date, uuid)
  from public, anon, authenticated;
grant execute on function public.beverage_open_recipe_test(text, text, boolean, text, text, date, uuid)
  to service_role;
revoke all on function public.beverage_record_recipe_tasting(text, text, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function public.beverage_record_recipe_tasting(text, text, boolean, uuid, text)
  to service_role;
revoke all on function public.beverage_list_recipe_tests(text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.beverage_list_recipe_tests(text, text, boolean, text)
  to service_role;

-- 4. Jellies get their own group. A gelatin line is what makes it a jelly; the
-- four jelly shots filed as syrups and the practice canvases move with the rest.
-- Same match as parseSpec's gelatin rule. Live count 2026-10-22: 45 versions, 45 drafts.
update beverage.formula_versions f set product_category = 'jelly'
 where f.product_category is distinct from 'jelly'
   and exists (select 1 from beverage.formula_components c
                where c.formula_version_id = f.id and c.ingredient_name ~* 'g[eé]latin');
update beverage.formula_drafts d set product_category = 'jelly'
 where d.product_category is distinct from 'jelly'
   and exists (select 1 from beverage.formula_versions f
                where f.formula_draft_id = d.id and f.product_category = 'jelly');

commit;
