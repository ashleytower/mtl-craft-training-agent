-- 126: take `beverage_create_formula_version` away from anon.
--
-- NUMBERING. 126 follows this repository's 125. The number line is shared with
-- the CRM repo (db/baseline/DRIFT.md §2); checked against origin refs.
--
-- WHAT IS WRONG
--
-- Every governed beverage RPC is service_role-only. All 35 of them, except one:
--
--   select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE')
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'beverage%';
--
-- `beverage_create_formula_version` came back true for anon AND authenticated.
-- It is the only one. That is an oversight in db/baseline/05-rls-and-grants.sql,
-- not a decision: nothing about creating a formula version is less governed than
-- approving one, and `beverage_approve_formula_version_for_subject` right beside
-- it is service_role-only.
--
-- WHY IT MATTERS
--
-- The function is SECURITY DEFINER and calls `beverage_ensure_context(subject,
-- name, p_is_owner)`, which INSERTS an owner membership for whatever subject it
-- is handed. So the caller supplies their own identity and the function grants
-- it. Anyone holding the publishable anon key — which is public by construction,
-- it ships in the browser bundle — could mint an owner principal and write a
-- formula version against any draft id. Formula versions are what
-- `/api/hermes/scale` reads out to whoever is standing at the bar.
--
-- The beverage SCHEMA is not exposed to PostgREST, but this function lives in
-- `public`, which is. The grant is the whole boundary here, and it was open.
--
-- WHAT BREAKS
--
-- Nothing. The only caller is server/beverageClient.ts:175, which holds the
-- service_role key. Verified by grep across the repo: no client-side, edge or
-- browser code references the function at all.
--
-- The argument list is the one `pg_get_function_identity_arguments` reports, not
-- a remembered one: a REVOKE against a signature that does not exist raises
-- rather than silently doing nothing, and the first draft of this file had it
-- wrong.

revoke all on function public.beverage_create_formula_version(text, text, boolean, uuid, text, text, numeric, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.beverage_create_formula_version(text, text, boolean, uuid, text, text, numeric, text, jsonb, jsonb)
  to service_role;
