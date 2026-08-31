# Production schema drift — beverage schema

Captured 2026-08-30 from Supabase project `ctyxnhcljruyciebkwef`.

This file records what is true of the live database versus what is in git. It is
a finding, not a plan, and nothing here has been changed as a result of writing
it. Read it before proposing any further database change.

## 1. The database is shared with the CRM

`ctyxnhcljruyciebkwef` is not this repository's database. It is the
`mtl-craft-cocktails-ai` production database, and the `beverage` schema is a
tenant inside it. As of capture it holds **98 applied migrations**, of which
**15 are beverage** and the rest belong to the CRM.

This matters more than it first looks. Two repositories write migrations into
one database, and neither can see the other's pending work.

## 2. One numbered sequence, two repositories, nothing coordinating them

The CRM keeps numbered migration files in
`~/GitHub/mtl-craft-cocktails-ai/supabase_migrations/` — 115 files, highest
`104_atomic_packing_adjustment_command.sql`.

The beverage migrations continue that same number line — 108, 109, 110 — but
live in a different repository (`db/migrations/` here). Nothing enforces the
shared sequence. If the CRM's next migration is numbered 108 it will collide
with `beverage_production_batches`, and the collision will only be visible in
the database, after both are applied.

**Before adding a beverage migration, check the CRM's highest number as well as
this repository's.** A durable fix would be to stop borrowing the CRM's number
line and name beverage migrations by timestamp, the way the database already
records them internally.

## 3. The CRM has its own gap: 105, 106, 107

Applied to the database, no file in the CRM repository (whose highest file is
104):

| applied version | name |
|---|---|
| 20260827044057 | canonical_menu_print_content_105 |
| 20260828033312 | atomic_proposal_sent_and_acceptance_106 |
| 20260828040426 | email_thread_uuid_adapter_107 |

Not this repository's to fix, but it is the same class of drift and someone
should know.

## 4. Correction to the 2026-08-30 handoff

That handoff said migrations "097-109 were applied to prod with no source file
in any repository" and should be "recovered from `pg_get_functiondef`". Both
halves were wrong:

- **097-104 are not missing.** They are numbered CRM migrations and they have
  files, in the CRM repository. They were never this repository's concern.
- **`pg_get_functiondef` was the wrong tool.** The full original SQL of every
  beverage migration is stored in `supabase_migrations.schema_migrations`
  (`statements text[]`). That is strictly better: it carries the tables,
  constraints, grants, triggers and data backfills that a function dump cannot
  see. The 15 beverage migrations recovered this way total ~119 KB and are in
  `db/baseline/recovered-migrations/`.

## 4b. The one file-vs-database difference, and how it happened

`db/migrations/110_formula_version_process.sql` does not byte-match what the
database stored for that migration. The **SQL is identical** — verified by
stripping comments and diffing, no statement differs. Only the comments differ.

The cause is worth recording because it is the whole problem in miniature: the
migration was applied first, and explanatory comments were added to the file
afterwards. Nothing re-synced, and nothing would have noticed. A comment is
harmless; the same sequence with a `where` clause would not be.

The rule that follows: if a migration file is edited after it is applied, either
re-apply it (when the change is real) or leave the file alone and put the new
understanding in a document (when it is only commentary). Editing an applied
migration in place makes git and the database disagree about what ran.

**One deliberate exception, taken with evidence.** That file's header carried a
factual claim that was wrong — that migrations 097-109 had no source file
anywhere and should be recovered via `pg_get_functiondef`. It was left standing
for a few hours and in that time it misled a reader, who read it and reported
"097-109 still need recovering" as outstanding work. A comment that assigns
someone real work that is already done, by a method that could not have worked,
is not harmless commentary. It was replaced in place with a correction that
points here.

That widens the comment-only gap between this file and the database. The SQL
still matches exactly, and the trade was made knowingly: a stale falsehood in the
file people actually open is worse than a larger diff against a comment block
nobody executes.

## 5. What is genuinely unrecoverable from the database

Five migrations store a `sha256:` placeholder instead of their SQL:

| version | name | recoverable from git? |
|---|---|---|
| 20260817233001 | 087_column_sensitive_language_owner_refresh | yes — `087_commercial_amendment_language_owner.sql` |
| 20260817233002 | 092_normalize_legacy_expired_proposals | yes |
| 20260817233003 | 093_menu_patch_designation_authority | yes |
| 20260817233004 | 094_column_sensitive_amendment_lifecycle | yes |
| 20260826031848 | 103_atomic_linked_proposal_event_patch | yes |

All five are CRM migrations and all five have files in the CRM repository, so
nothing is actually lost. Worth knowing that the database alone is not a
complete record.

## 6. RLS is on everywhere, with zero policies

All **27** beverage tables have row-level security enabled. There are **zero**
policies on any of them.

That combination denies every ordinary role. The schema is reachable only
through `SECURITY DEFINER` functions executed by a role that bypasses RLS
(`service_role`), which is the design the client layer describes — every rule
lives in Postgres, and the application marshals arguments rather than enforcing
anything. It is load-bearing and invisible: adding a single permissive policy,
or granting direct table access, would silently route around every check in
those functions.

Do not "fix" the missing policies. They are absent on purpose.

## 7. What this repository tracks today

Updated 2026-08-31 by the knowledge-retrieval work.

| | in git | applied to the database |
|---|---|---|
| beverage migrations | 4 (`db/migrations/110`, `111`, `112`, `113`) | 18 |
| recovered for the record | 15 (`db/baseline/recovered-migrations/`) | — |

111-113 were written as files first and applied from those files, so unlike
110 there is no comment-only drift between git and the database. They continue
the shared number line described in §2; the CRM's highest file was still 104 at
the time, checked before numbering. The baseline files in §8 were captured
before them and therefore describe 27 tables, not the 28 that now exist —
`beverage.knowledge_chunks` is the addition, and `knowledge_sources` gained an
`embedding` column. See `docs/BRIX_KNOWLEDGE.md`.

The recovered files are a historical record, clearly labelled, and must never be
executed or added to a migration runner. Replaying them would fail or
double-apply. New work goes in `db/migrations/`.

## 8. Baseline contents

Captured alongside this file, all read-only:

| file | what |
|---|---|
| `01-tables-and-columns.sql` | 27 tables, 287 columns, types, nullability, defaults |
| `02-constraints.sql` | 196 constraints — keys, foreign keys, unique, check |
| `03-indexes.sql` | 50 indexes |
| `04-triggers.sql` | 7 triggers and their functions |
| `05-rls-and-grants.sql` | per-table RLS state, the zero policies, table and routine grants |
| `06-functions.sql` | all 27 `beverage_*` functions, ~51 KB |
| `recovered-migrations/` | the 15 applied beverage migrations, verbatim |

A `supabase db dump` would have been the better capture and was tried first; it
requires Docker, which is not installed on this machine, so the baseline was
read out of the system catalogues instead. If Docker is ever available, prefer
`supabase db dump --linked --schema beverage` and replace these files.
