# Brix — handoff

Beverage intelligence agent for MTL Craft Cocktails.
Written 2026-08-31. Every figure below was measured, not recalled.

Manus design/context: https://manus.im/share/5BNfPHDbcgJbvdHmeTZo9E

---

## Verified state

Updated 2026-08-31 after the knowledge-retrieval work. Knowledge detail lives in
**`docs/BRIX_KNOWLEDGE.md`**; this file stays the one-page picture.

| | |
|---|---|
| commit | see `git log` — PR #9, *Simplifier findings fixed* |
| tests | **226 passing**, 12 files |
| typecheck | `tsc --noEmit` clean |
| build | `npm run build` clean |
| database | Supabase `ctyxnhcljruyciebkwef` — shared with the CRM |
| beverage migrations | 110-114 in `db/migrations/`, all applied and registered |

Recent merges: #8 `902d105` page-text lessons · #7 `0379dd4` cited knowledge
corpus · #5 `b30712e` CRM-backed cocktail measures · #4 `ef5e408` message noun
agreement · #3 `2ad1a18` cocktail ingredient resolution, schema baseline,
`db/baseline/DRIFT.md`.

### Corpus, measured

| | |
|---|---|
| `beverage.knowledge_sources` | **71** — all `pending_review` / `reference_only`, none approved |
| `beverage.knowledge_chunks` | **380** — 336 caption + 44 page-text, all embedded |
| course CONTENT coverage | **35 of 39** — 23 captions + 12 page-text |
| course register-only | **4** — the quizzes; no knowledge to hold, none fabricated |
| course NOT COLLECTED | **0** |
| approved formulas | still **1** (`Jalapeno v1`) — unchanged, and a human step |

---

## What Brix can actually do

Brix runs from the Hermes profile at `~/.hermes/profiles/beverage/` — **not from
this repository**. `agent/beverage/` is a committed mirror, kept in sync by hand.
Telegram: https://t.me/Brix_recipe_bot

Six tools, backed by five HTTP routes in `server/hermesRoutes.ts`:

| tool | route | what it does |
|---|---|---|
| `list` | `/api/hermes/formulas` | approved formulas, with components and method |
| `drafts` | `/api/hermes/drafts` | unapproved drafts by name — **never quantities** |
| `scale` | `/api/hermes/scale` | exact rational scaling; also returns the method |
| `method` | `/api/hermes/formulas` | how an approved formula is made |
| `knowledge` | `/api/hermes/knowledge` | cited technique and theory — **never a measure** |
| `coverage` | `/api/hermes/knowledge/coverage` | what the corpus holds, and which lessons are missing |

The last two arrived 2026-08-31; see `docs/BRIX_KNOWLEDGE.md`.

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

### 1. Brix cannot retrieve any knowledge — CLOSED 2026-08-31

**Superseded by `docs/BRIX_KNOWLEDGE.md`. Read that instead of this section.**

Manus's course work was found, not missing: the share is still live and its
sandbox files survive. The session had simply run out of credits at step 2 of 4
before it could load anything. Recovered and ingested — now 71 knowledge sources and
380 course passages (336 time-coded + 44 page-text), all embedded, reachable through a fifth tool
(`knowledge`) and a sixth (`coverage`). Every answer carries a citation composed
by the service. Nothing is approved: all 71 rows remain `pending_review` or
`reference_only`.

23 of the course's 39 items have captions and 12 more carry page text — 35 with
content, 0 uncollected, and the 4 quizzes stay register-only. Run `coverage` for
the current split rather than trusting any prose.

The four findings below were accurate when written and are kept as the record of
what was true before that work.

#### The original finding (2026-08-31, now historical)

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

### 6. Simplifier review — run, findings fixed

An independent `@code-simplifier` reviewed the merged work. Two substantive
findings, both fixed in migration 114, plus three nits all fixed:

- **Coverage stubs took 45.8% of search result slots** (measured, worse than the
  review's estimate). Two questions returned 6/6 bookkeeping and no real
  content. Now 0%.
- **`citation_required` could never be corrected** after first ingest — missing
  from `on conflict do update set`.
- CSV manifest rows are now width-validated (an unquoted comma used to shift
  every field silently); `citation_required` is forwarded to the API instead of
  being dead plumbing; the TS/SQL embed-text duplication is cross-referenced in
  both files and format-pinned by a test.

A second review round covered the page-text module (written after the first
started) and found two more latent defects, both fixed: a nested `<ul>` inside
an `<li>` silently dropped text, and `&#8216;`/`&#8217;` both decoded to a
closing quote. Migrations 111 and 112 also gained `-- SUPERSEDED by …` pointers
above every function body a later migration replaced — comment-only, SQL
verified identical, recorded in `db/baseline/DRIFT.md` §7.

The reviews also checked and cleared: limit clamping, score normalization,
`formatClock`, the RLS/SECURITY DEFINER boundary, and the 111-vs-112 migration
duplication (which is the project's documented fix-forward convention working
as intended). It found no missed reuse and no over-engineering.

Note for whoever runs it next: the reviewer could not execute `vitest` because
of the known `@rollup/rollup-darwin-x64` arch drift. Prefix with
`PATH=/usr/local/bin:$PATH`.

### 7. Knowledge: what is left — added 2026-08-31

Detail in `docs/BRIX_KNOWLEDGE.md`. The short version:

- **Nothing in the corpus is approved.** All 71 sources sit `pending_review` or
  `reference_only`, by design. Promoting one is a console decision; no route
  here can do it.
- **4 of 39 course items have no content, and all four are quizzes** —
  register-only by design, never fabricated. Every non-quiz item has content.
- **The 12 page-text lessons still have uncaptured video narration.** Their
  written body is ingested and cited by section and paragraph; the spoken track
  is not there and must not be implied. Their Bunny library (177015) exposes no
  auto-caption track, so this is a source limitation, not a collection gap.
- **`Supplier.pdf`** is registered and **not** ingested — the host returns 403 to
  server-side fetch. The **USDA** publication is registered and not summarised —
  it is a 26-page scan with no text layer. The four other linked PDFs carry
  governed summaries read from the documents themselves.
- **Corpus files are not in git** (`data/knowledge/`, gitignored). The database
  is the store of record; recovery steps are in `docs/BRIX_KNOWLEDGE.md`.

### 8. Dependency vulnerabilities — pre-existing, not from this work

`npm audit`: **57 total, 2 critical, 17 high** — `@trpc/*`, `axios`, `lodash`,
`drizzle-orm`, `vite`, `vitest`, `postcss`, `nanoid`, `path-to-regexp` and
others. All inherited from the original Manus WebDev template export. The
knowledge work added **zero** runtime dependencies, so none of these are new.
Not fixed here because it is a dependency-upgrade project of its own, and doing
it inside a knowledge-retrieval change would bury it. Worth scheduling.

### 9. The exposed service-account key — resolved, with residue

Verified genuinely active, then disabled (reversible) rather than deleted;
replacement verified against the live Inventory Database sheet. Full account in
`docs/BRIX_KNOWLEDGE.md`. **Still Ashley's:** the Manus share is still public
(restricting it needs the Manus owner login), the key was pasted into the
conversation transcript so it is worth scanning that transcript for anything
else pasted the same way, deletion was not done, and an undocumented third
never-expiring key (`fa1c0c3c…`, 2025-06-26) is active and referenced nowhere.

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
- **A page chunk has no clock.** Lessons 13 and 22 are page text, not
  transcripts. `retrieval_type: "page_text_only"` and there is deliberately no
  `timestamp` key at all — do not add one, and do not let the agent infer one.
- **MasterStudy reuses content class names inside `<link>` tags.** The first
  textual match for `masterstudy-course-player-lesson-video` in a saved lesson
  page is a stylesheet URL, not the lesson. Anchor on the `<div …>`.
- **`gcloud … keys list` does not render the `disabled` column.** It prints
  blank whether or not a key is disabled. Read the JSON.

---

## Out of scope right now

Explicitly deferred by Ashley on 2026-08-31: **batch logging**
(`beverage.production_batches` and its four RPCs exist from migration 108 with 0
rows) and **unrelated hook fixes**. Do not start either.
