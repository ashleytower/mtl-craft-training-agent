# Brix — the knowledge corpus

How Brix came to have technique and theory to answer from, what is actually in
it, and what is still missing. Written 2026-08-31. Every count below was
measured against production, not recalled.

This closes gap #1 of `BRIX_HANDOFF.md` ("Brix cannot retrieve any knowledge").

---

## The corpus was never missing — it was stranded

`BRIX_HANDOFF.md` said to find Manus's course work before building anything.
It is all still there. The Manus share is live and its sandbox files survive:

> https://manus.im/share/5BNfPHDbcgJbvdHmeTZo9E → "View all files in this task"

**Why it never reached the database.** The Manus session ran out of credits
mid-run. The share's own task tracker still reads *"Synthesize architecture…
2 / 4"*, with steps 3 and 4 — writing and delivering the handoff — never
started. The corpus had been built the day before, on 2026-08-23; nobody was
left to load it. Nothing was lost and nothing needed rebuilding.

### The five artifacts recovered (2026-08-31)

| file | size | what it is |
|---|---|---|
| `art_of_drink_knowledge_chunks.jsonl` | 232 KB | **158 time-coded citation records**, 12 lessons |
| `art_of_drink_lesson_manifest.csv` | 5 KB | the full 39-item course curriculum |
| `Art_of_Drink_Ingestion_Batch_1.zip` | 599 KB | 13 raw `.en-auto.vtt` tracks, 14 lesson pages, `downloadable_assets.tsv`, and the two scripts that produced the corpus |
| `Public_External_Knowledge_Records.jsonl` | 28 KB | **24 governed summaries** of public practitioner sources |
| `Preservation_Knowledge_Source_Intake_Template.csv` | 1 KB | an intake template — three example rows, no real content |

The corpus files are **not committed**. They are Tier B material held
`authorized_private` — Ashley's own paid enrolment — and a private repo is still
the wrong home for a verbatim copy of somebody's course. `data/knowledge/` is
gitignored; the database is the store of record. To re-ingest from scratch,
recover the five files from the share above into `data/knowledge/` and run the
ingest.

---

## What is in the database now

```
beverage.knowledge_sources   42 rows   (5 pre-existing + 1 course + 12 lessons + 24 external)
beverage.knowledge_chunks   158 rows   all embedded, all full-text indexed
```

| tier | rows | what |
|---|---|---|
| `tier_b_authorized_course` | 13 | the course, and one source per collected lesson |
| `tier_c_external_practitioner` | 26 | Kevin Kos, Morgenthaler, clear ice, FDA, Serious Eats, Notion registers |
| `tier_d_inspiration` | 1 | The Alchemist — recorded, deliberately not ingested |

**Every row is `pending_review` or `reference_only`. Nothing is an approved
control.** Retrievability is not approval; that stayed a separate human step,
and the ingest never overwrites `rights_status`, `operational_status` or
`review_status` on a re-run.

### Course coverage: 12 of 39 items

Captions exist for lessons 1, 5, 6, 7, 14, 16, 18, 23, 27, 31, 32 and 36 —
Introduction, Safety, Food Grade Ingredients, Regulations, Solubility,
Emulsions, Density, Prototyping a Flavour, Flavour Levels and Calculations,
Sugar, Acids & Acidity, and Putting It All Together.

**27 items have no captions and were never collected**, including What is
Flavour?, Chemistry of Beverages, Science of Taste, Solvents for Flavours,
Terpenes, HLB, Natural vs Artificial Flavours, Equipment and Ingredients,
Documentation, Essences, Extracts, Tincture, Ageing Flavours, Flavourist
Formulating, Mineral Salts, Bitterness, Suppliers, and all four quizzes.

Do not read that list back to anyone — run `coverage`. The list is true today
and stale the moment someone collects lesson 13. Two lessons (13 Solvents,
22 Documentation) exposed no caption track at all; Manus preserved their page
text in `authorized_lesson_pages/` and it is **not** ingested, because page text
has no timestamps and must not be dressed up as a transcript.

To collect more: `extract_authorized_course_caption.sh` and
`vtt_to_knowledge_records.py` in the zip are the reproducible path. Both were
read before use and neither touches this database — the shell script fetches a
caption track from an already-saved lesson page, the Python script is a pure
VTT-to-JSONL transform. Save the lesson page from an authorised browser session,
run the two, drop the new records into `data/knowledge/`, re-run the ingest.

---

## How retrieval works

```
beverage.py knowledge --query "why did my emulsion separate"
  → GET /api/hermes/knowledge?q=…
    → embed the question locally (nomic-embed-text, 768-dim, via Ollama)
      → public.beverage_search_knowledge(…)
```

**Hybrid, over infrastructure that already existed.** pgvector 0.8.0 was already
installed and `public.memory` had been running the same `vector(768)` +
`tsvector` pattern in this database for months. `nomic-embed-text` was already
pulled into the local Ollama. So this added no API key, no vendor and no
per-call cost. The CRM memory *pattern* is reused; none of its 1,213 rows are.

Score is `0.6 × cosine similarity + 0.4 × clamped ts_rank` — weighted toward
meaning, because nobody asks a question in the caption's vocabulary.

**When the embedding service is down**, search still runs on full text alone and
the response says `search_mode: "text_only"`. A narrower answer is still an
answer; a silent downgrade would read as a thin corpus.

### Two result kinds, and the difference is a rights boundary

- **`quotable: true`** — course transcript. `text` is the real caption and may
  be read out, attributed.
- **`quotable: false`** — a public source we may only cite. `text` is a governed
  summary someone already wrote, and **there is no fuller text behind it**.

### Citations are composed by the service, not the model

Every result carries a finished `citation`:

> `Flavour & Beverage Development Course, lesson 32 "Acids & Acidity" at 2:15-3:30 — https://edu.artofdrink.com/…/4801`

built from the stored locator in `hermesRoutes.ts`. A model asked to cite a
lesson and timestamp will mostly do it and occasionally invent a plausible one,
and a fabricated timestamp on a real lesson is worse than no citation — it looks
checkable. So the string is handed over finished. Verified: the citation above
matches cue `00:02:15.120` of `lesson_4801.en-auto.vtt` verbatim.

---

## The boundary, and where quantities come from

The course's own ingestion handoff set the rule, and it is returned on every
search response as `boundary` rather than left for the agent to remember:

> Tier B training reference material. It must never silently alter a formula,
> approve an ingredient, authorize a shelf-life claim, determine a preservation
> plan, or release a batch.

**CRM stays authoritative for recipe quantities.** Nothing in migrations 111-113
reads or writes `formula_versions`, `formula_components`, `formula_drafts` or
`public.recipes`. The knowledge lane and the formula lane share only an identity
check. Verified: asked "how much sugar goes in the jalapeño syrup", the
knowledge route returns Tier B/C reference passages and no measure, while
`/api/hermes/formulas` still returns the approved `Jalapeno v1` —
Citric acid 30 gr · Jalapenos 5400 gr · Preservative 30 gr · Water 18000 ml.

---

## Migrations

| file | what |
|---|---|
| `111_beverage_knowledge_retrieval.sql` | `knowledge_chunks`, ingest RPCs, `beverage_search_knowledge`, `beverage_knowledge_coverage` |
| `112_knowledge_source_embeddings.sql` | source embeddings — fixes a real defect 111 shipped with, see below |
| `113_backfill_source_embeddings.sql` | embed any source some other path created |

All three applied to `ctyxnhcljruyciebkwef` and registered in
`supabase_migrations.schema_migrations`. They continue the shared number line —
CRM's highest file is still 104. See `db/baseline/DRIFT.md` §2.

### The defect 111 shipped with

111 gave chunks and sources different reach. Chunks were pulled in wholesale
whenever an embedding was supplied, so they had full semantic recall; sources
matched on full text only. `websearch_to_tsquery` ANDs its terms, so *"how do I
make clear ice at home"* became `'make' & 'clear' & 'ice' & 'home'` — which one
source satisfied, while the bare phrase *"clear ice"* matched three.

Measured before 112: that question returned three Art of Drink chunks about
sugar and tasting, and **zero** of the three clear-ice sources. The corpus held
exactly the right material and the search could not reach it. 112 embeds the
title, summary and topics — text already stored, so no new text about anyone's
work — and makes both kinds reachable the same way. After: all three clear-ice
sources return first.

---

## Verification

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` | **182 passing**, 10 files (was 151/8) |
| ingest idempotency | second run `0 inserted, 37 updated`; third identical |
| citation accuracy | spot-checked against `lesson_4801.en-auto.vtt` cue `00:02:15.120` — exact |
| recipe boundary | knowledge route returns no MTL Craft measure; formula route unchanged |
| live agent path | `beverage.py knowledge` and `coverage` verified against Brix's own configured URL |

### Questions that now answer well, with citations

- *"What order should I add acid in?"* → lesson 32 at 2:15 — "you should always
  add your acid at the end"
- *"Why did my emulsion separate and go cloudy?"* → lesson 16, three passages
- *"How do I make clear ice at home?"* → all three clear-ice sources, cite-only
- *"What is super juice and how does it work?"* → four Kevin Kos sources
- *"How do I fix a syrup that came out too thin?"* → Morgenthaler's Syrup Fixer
- *"What ppm should I dose a flavour at?"* → lesson 27 at 8:03

---

## Still open

1. **Nothing is approved.** All 42 sources are `pending_review` or
   `reference_only`. That is correct and deliberate — promoting one is a human
   decision in the console, and no route here can do it.
2. **21 video lessons have no captions**, plus 2 with page text only and 4
   quizzes. The collection path is reproducible; it needs an authorised browser
   session per lesson.
3. **`Supplier.pdf`** (33 KB, lesson 6) and five linked FEMA/Perfumer & Flavorist
   PDFs are registered in `transcripts/downloadable_assets.tsv` and not
   ingested. The course host is Cloudflare-protected against server-side fetch.
4. **The Simplifier review has not run.** `~/.claude/CLAUDE.md` requires
   `@code-simplifier` on the final diff of a non-trivial build; this session was
   instructed not to spawn subagents, so it is outstanding rather than skipped.
5. **The leaked service-account key** in `.manus-recovery/SOURCES.md` is still
   Ashley's to handle — the share link is public and still live, which is how
   this recovery was possible. Unchanged by this work, but the two facts are the
   same fact.
