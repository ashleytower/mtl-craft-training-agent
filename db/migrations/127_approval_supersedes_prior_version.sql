-- 127: approving a formula version retires the one it replaces.
--
-- NUMBERING. 127 follows this repository's 126. The number line is shared with
-- the CRM repo (db/baseline/DRIFT.md §2); checked against origin refs.
--
-- WHAT IS WRONG
--
-- `beverage.approve_formula_version` flips one row to `approved` and stops.
-- `beverage_list_approved_formulas` selects every row where
-- `lifecycle_status = 'approved'`, with no "latest version only" filter:
--
--   from beverage.formula_versions f
--   where f.organization_id = v_org_id and f.lifecycle_status = 'approved'
--
-- So approving Jalapeno v2 while v1 is still approved does not correct the
-- recipe Brix serves. It gives Brix TWO Jalapenos and no way to choose — and
-- `/api/hermes/scale` reads that list out to whoever is standing at the bar.
-- Correcting a formula would make the situation worse than leaving it wrong.
--
-- The immediate case: approved Jalapeno v1 carries Citric acid, Jalapenos,
-- Preservative and Water, and no sugar. Ashley, 2026-09-10, confirming the
-- recipe: "jalapeno has the sugar, obviously."
--
-- WHY IT IS FIXED HERE AND NOT IN THE CALLER
--
-- Because a caller that has to remember is a rule, and this is a behaviour that
-- can be code. Superseding by hand after each approval works exactly until
-- somebody approves through the console instead, or a later script forgets.
-- One formula_key can now hold at most one approved version by construction.
--
-- `superseded` is one of the four values formula_versions_lifecycle_status_check
-- already allows, so this introduces no new vocabulary. The superseded row keeps
-- its `approved_by` and `approved_at`: it WAS approved, and erasing that would
-- make the batches produced from it look like they came from nothing.

create or replace function beverage.approve_formula_version(
  p_formula_version_id uuid,
  p_principal_id uuid,
  p_rationale text
)
returns beverage.formula_versions
language plpgsql
security definer
set search_path = beverage, public, pg_temp
as $$
declare
  v_formula beverage.formula_versions;
  v_superseded uuid[];
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

  -- Everything else approved under this formula key is now the previous recipe.
  -- Locked before the update so a concurrent approval of a third version cannot
  -- interleave and leave two rows approved.
  with prior as (
    select id from beverage.formula_versions
     where organization_id = v_formula.organization_id
       and formula_key = v_formula.formula_key
       and id <> v_formula.id
       and lifecycle_status = 'approved'
     order by id
     for update
  ), retired as (
    update beverage.formula_versions f
       set lifecycle_status = 'superseded', updated_at = now()
      from prior
     where f.id = prior.id
    returning f.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_superseded from retired;

  insert into beverage.approval_decisions (organization_id, entity_type, entity_id, decision, rationale, decided_by)
  values (v_formula.organization_id, 'formula_version', v_formula.id, 'approved', p_rationale, p_principal_id);
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  values (v_formula.organization_id, p_principal_id, 'formula_version_approved', 'formula_version', v_formula.id,
          jsonb_build_object('rationale', p_rationale, 'superseded', to_jsonb(v_superseded)));

  -- One event per retired version, so "why did this stop being the recipe"
  -- is answerable from the superseded row itself and not only from its successor.
  insert into beverage.audit_events (organization_id, principal_id, event_type, entity_type, entity_id, details)
  select v_formula.organization_id, p_principal_id, 'formula_version_superseded', 'formula_version', s,
         jsonb_build_object('superseded_by', v_formula.id, 'formula_key', v_formula.formula_key)
    from unnest(v_superseded) as s;

  return v_formula;
end;
$$;
