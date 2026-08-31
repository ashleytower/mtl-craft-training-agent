# Brix — handoff

Beverage intelligence agent for MTL Craft Cocktails.
Written 2026-08-31. Every figure below was measured, not recalled.

Manus design/context: https://manus.im/share/5BNfPHDbcgJbvdHmeTZo9E

---

## Verified state

| | |
|---|---|
| commit | `b30712efab24b5e65957b4873f8bfc929c0ca2ca` (2026-08-31 07:33 -0400) |
| | merge of PR #5, *CRM as the source of truth for cocktail measures* |
| tests | **151 passing**, 8 files |
| typecheck | `tsc --noEmit` clean |
| working tree | clean, one remote branch (`main`) |
| database | Supabase `ctyxnhcljruyciebkwef` — shared with the CRM |

Recent merges: #5 `b30712e` CRM-backed cocktail measures · #4 `ef5e408` message
noun agreement · #3 `2ad1a18` cocktail ingredient resolution, schema baseline,
`db/baseline/DRIFT.md`.

---

## What Brix can actually do

Brix runs from the Hermes profile at `~/.hermes/profiles/beverage/` — **not from
this repository**. `agent/beverage/` is a committed mirror, kept in sync by hand.
Telegram: https://t.me/Brix_recipe_bot

Four tools, backed by three HTTP routes in `server/hermesRoutes.ts`:

| tool | route | what it does |
|---|---|---|
| `list` | `/api/hermes/formulas` | approved formulas, with components and method |
| `drafts` | `/api/hermes/drafts` | unapproved drafts by name — **never quantities** |
| `scale` | `/api/hermes/scale` | exact rational scaling; also returns the method |
| `method` | `/api/hermes/formulas` | how an approved formula is made |

Guarantees that hold today:

- **Exact arithmetic.** Quantities are BigInt rationals. `74/105` stays a
  fraction; the decimal is flagged when truncated. Each component also carries
  `measurable` (2 dp) so the agent never has to choose a rounding.
- **No unit invention.** Spelling is normalised (`gram`→`gr`); dimension never
  is. `oz` is deliberately unconvertible — ambiguous between weight and volume.
- **Unapproved work cannot be measured from.** `drafts` returns names and
  categories only.
- **It says when it does not know.** An absent method returns a finished
  sentence rather than an empty list.
- **Its own identity.** Principal `88c41f59-786b-4512-b09c-92bf8f88802c`, role
  `operator`, distinct from Ashley's in the audit trail.

---

## Recipes: available vs awaiting approval

**Brix can quote exactly one formula.**

| state | count | which |
|---|---|---|
| approved — Brix can scale and describe | **1** | `Jalapeno v1` (syrup) |
| awaiting approval — invisible to Brix | **3** | `Orgeat v1`, `Orgeat (bought almond milk) v1`, `Toasted Almond Milk v1` |
| raw drafts, never versioned | **126** | 76 syrup, 50 cocktail |
| CRM cocktail recipes available to the workbench | **83** | `public.recipes` |

Approval decisions recorded: 1. **Approval is a separate human step and must stay
one** — the CRM supplying a measure is not an approval.

Where a draft's measures come from, across all 126:

| resolution | drafts | |
|---|---|---|
| `structured` | 59 | syrups with normalised rows |
| `crm_recipe` | 38 | cocktail rows matching a CRM recipe by exact name (37 distinct names — Spicy Margarita is duplicated) |
| `free_text` | 12 | cocktails with no CRM recipe |
| `none` | 17 | syrups with neither structured rows nor source text |

**CRM is authoritative for ingredients, quantities and units.** Read through the
service-role client already in `server/beverageClient.ts` — no migration, no new
credential, no importer. Nothing writes back toward the CRM, and a test asserts
the resolver's whole import closure cannot reach a writer.

**The Notion measurement importer is closed** (Ashley, 2026-08-31). Do not build
it, do not reconcile CRM against Notion, do not overwrite CRM recipes from Notion.

---

## Remaining gaps

### 1. Brix cannot retrieve any knowledge — this is the next priority

Ask Brix how to make something it has not been given, or anything about
technique, and it correctly says it does not know. Four separate reasons, all
verified:

**a. No retrieval tool exists.** The agent surface is four tools; none of them
searches anything. No knowledge or graph RPC is called anywhere in this repo.

**b. There is no corpus to retrieve.** `beverage.knowledge_sources` holds **5
rows and no content column** — only `governed_summary`, 156–319 characters each:

| key | tier | status |
|---|---|---|
| `notion-master-cocktail-recipes` | tier_a_internal | pending_review |
| `notion-syrups-hq-master` | tier_a_internal | pending_review |
| `PUB-FS-001` Water Activity (FDA) | tier_c_external | reference_only |
| `PUB-FS-002` Acidified & Low-Acid Canned Foods (FDA) | tier_c_external | reference_only |
| `PUB-GR-001` Cocktail 101 (Serious Eats) | tier_c_external | reference_only |

All five have `citation_required = true`, so a citation contract already exists
in the schema — there is simply nothing to cite from.

**c. The graph is empty.** `graph_nodes` 0, `graph_edges` 0, `research_runs` 0,
`research_candidates` 0, `trend_cards` 0, `experiments` 0. The RPCs exist
(`beverage_graph_overview`, `beverage_list_research_candidates`,
`beverage_record_research_candidates`, …) and are wired to nothing.

**d. Existing knowledge lives outside Brix's reach.** Three stores exist and
none is on the agent surface:

- `knowledge-base-sop.md` (3.9 KB) — served by the `sops.get` tRPC route
- Google Sheets (`server/googleSheets.ts`: `getCocktails`,
  `searchCocktailsByName`, `getIngredients`, `getPreparationSteps`) — the
  original Le Fou Fou voice agent's knowledge base, reachable via the
  `cocktails.*` tRPC routes
- `beverage.knowledge_sources` — the five citations above

**Infrastructure that already exists and could be reused:** pgvector **0.8.0**
is installed, and `public.memory` demonstrates the pattern working in this same
database — 1,213 rows, **1,183 embedded**, with a `tsvector` alongside for
hybrid search. But that table is the CRM/Max memory system (`mem0_migration`,
`sms_correction`, `business_audit`), **not** a beverage course corpus. Reuse the
pattern, not the content.

**So: before building anything, find Manus's course/RAG work.** Start from the
Manus link at the top. The Art of Drink course and the extraction/preservation
material were designed there and were never ingested here. Trace whether that
work produced artifacts that can be reused rather than rebuilt, and answer why
they never reached `knowledge_sources`. Any answer Brix gives from that corpus
must carry a source citation — the schema already requires it.

### 2. Cocktails exist but none is approved

38 cocktail draft rows now resolve with real CRM measures in the workbench, and
their method comes from the CRM too. None has been turned into a formula version
and approved, so `list` still returns only Jalapeno. That is a human step, not a
missing capability.

### 3. `has_ingredients` is honest but narrow

`/api/hermes/drafts` computes it from the draft's own structured rows, so it
reports `false` for every cocktail even where the CRM holds a full recipe. True
about the draft, potentially misleading about the drink. Only worth changing if
Brix is meant to see CRM-backed drafts — today it is not.

### 4. Reported CRM data defects — not this repo's to fix

Verified inside the CRM, reported rather than changed:

| recipe | description says | ingredients measure |
|---|---|---|
| `Dark and Stormy` | Dark Rum | **Vodka 2 oz** |
| `Margarita` | Agave | Simple Syrup |
| `Roman Holiday` | Lemon | Lime Juice |

`Whiskey Smash` types `Dehydrated Citrus` as `juice` while its unit stays
`garnish`; the same ingredient is typed `garnish` in 38 other rows. Surfaced
in-app as `type_unit_mismatch` rather than guessed at. Separately, bitters is
named in 18 descriptions and itemised in 5 (eggwhite 12/9, soda 14/12) — gaps
rather than a house convention, since each is itemised sometimes.

### 5. Preparation method

`process_json` is populated for a CRM-backed cocktail and for anything an
operator types. Syrups carry no method in any source — the Notion syrup
collection is an inventory and costing sheet — so `recorded: false` is the
ordinary answer there, not a fault.

---

## Traps worth knowing

- **Check `server/hermesRoutes.ts` before editing `SKILL.md`.** Claiming a
  capability the tools do not expose is the original "please choose" defect. It
  was reintroduced during PR #5 and caught in review; the skill now states only
  what the four tools return.
- **The database is shared with the CRM.** 98 migrations, 15 of them beverage.
  Two repositories write one migration number line with nothing coordinating
  them — see `db/baseline/DRIFT.md` §2 before numbering anything.
- **All 27 beverage tables have RLS enabled with zero policies.** That is the
  design: access only through `SECURITY DEFINER` functions run by a role that
  bypasses RLS. Do not "fix" the missing policies.
- **`node` on this machine is x64** and breaks vitest/tsx. Prefix commands with
  `PATH=/usr/local/bin:$PATH`.
- **A bot cannot appear in a Telegram chat list until the user messages it first.**

---

## Out of scope right now

Explicitly deferred by Ashley on 2026-08-31: **batch logging**
(`beverage.production_batches` and its four RPCs exist from migration 108 with 0
rows) and **unrelated hook fixes**. Do not start either.
