# Recovered beverage migrations

The 15 SQL files in this directory are captured records of SQL that was
**already applied** to the production Supabase project
(`ctyxnhcljruyciebkwef`). They were recovered by querying
`supabase_migrations.schema_migrations` directly — reading the `version`,
`name`, and `statements` columns for each row and reproducing the SQL text
verbatim, byte for byte, with no reformatting, no reindentation, and no
"improvements."

## This is not a runnable migration sequence

Do not point a migration runner at this directory. Do not execute any of
these files against any database. Every statement in them has already run
against production; re-running them would either fail outright (tables,
functions, and constraints already exist) or double-apply changes that
should only happen once (backfills, data updates). Each file carries a
header saying the same thing.

They exist purely so this history is reviewable in git — so a human or an
agent can read what actually happened to the `beverage` schema over time
without needing direct database access or a `pg_dump`.

## Why these files, and only these

The database backing this project is shared with the CRM system. As of this
capture, `supabase_migrations.schema_migrations` holds 98 total migrations.
The 15 files here are only the **beverage** subset — the ones whose name is
prefixed `beverage_` (plus the two most recent, `beverage_version_product_category`
and `110_formula_version_process`, which touch the same schema). The
remaining ~83 rows belong to the CRM system and are out of scope for this
capture.

## File naming

Files are named `<version>__<name>.sql`, where `<version>` is the migration
timestamp from `schema_migrations.version` (e.g. `20260825190958`) and
`<name>` is the migration's name column. The version prefix is what a
timestamp-based tool would use to sort them chronologically — it is **not**
a sequence number, and these files must never be renamed to look like a
numbered migration series (no `001_`, `097_`, etc.). Two migrations
(`beverage_version_product_category` and `110_formula_version_process`)
happen to have migration numbers embedded in their own names or bodies —
that numbering came from the original author, not from this capture, and is
preserved verbatim rather than reflected in the filename scheme.

## New work goes elsewhere

Any new schema change — beverage or otherwise — belongs in
`db/migrations/`, as a proper migration meant to be applied going forward.
Nothing in `db/baseline/recovered-migrations/` should ever be copied,
edited, or reused as a starting point for a new migration; treat it as a
read-only historical record.
