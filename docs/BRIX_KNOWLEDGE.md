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
| `art_of_drink_knowledge_chunks.jsonl` | 232 KB | **158 time-coded citation records**, 12 lessons — *as recovered; the file now holds 336 records across 23 lessons after the 2026-08-31 collection* |
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
beverage.knowledge_sources   71 rows   (5 pre-existing + 1 course + 35 lessons + 24 external + 6 linked docs)
beverage.knowledge_chunks   380 rows   336 caption + 44 page-text, all embedded and full-text indexed
```

| tier | rows | what |
|---|---|---|
| `tier_b_authorized_course` | 36 | the course, and one source per collected lesson |
| `tier_c_external_practitioner` | 26 | Kevin Kos, Morgenthaler, clear ice, FDA, Serious Eats, Notion registers |
| `tier_d_inspiration` | 1 | The Alchemist — recorded, deliberately not ingested |

**Every row is `pending_review` or `reference_only`. Nothing is an approved
control.** Retrievability is not approval; that stayed a separate human step,
and the ingest never overwrites `rights_status`, `operational_status` or
`review_status` on a re-run.

### Course coverage: 35 of 39 items HAVE CONTENT

Collected 2026-08-31 from Ashley's authenticated Art of Drink session. **Content
coverage and manifest coverage are still different numbers** and are still
reported separately by `beverage_knowledge_coverage`:

| | |
|---|---|
| manifest items | **39** |
| **with content** | **35** — 23 captions + 12 page-text |
| register-only | **4** — the four quizzes |
| **not collected** | **0** |

**The four quizzes are the only items without content, and that is correct.** A
quiz carries no knowledge to hold; the course's own ingestion guidance is that
quizzes are indexed as course metadata, not as material to answer from.
Fabricating content for them to reach 39/39 would be the exact dishonesty this
whole coverage split exists to prevent.

#### How the remaining 21 items were collected

The lesson pages gave up the Bunny player id; the existing
`extract_authorized_course_caption.sh` logic then fetched the player and the
caption track. Two Bunny libraries are in play and they behave differently:

- **library 4056** — auto-caption tracks exist. All newly captioned lessons came
  from here.
- **library 177015** — newer, and exposes **no** `en-auto.vtt`. Those lessons
  fall back to page text.

**11 lessons yielded real caption tracks**: About Your Instructor, How to Develop
a Beverage, Chemistry of Beverages, Natural vs Artificial Flavours, Equipment and
Ingredients, Essences, Extracts, Flavourist Formulating, Mineral Salts,
Bitterness, Completion & What is Next. Caption chunks went 158 → **336**.

**10 lessons had no caption track and were ingested as page text**: What is
Flavour?, Science of Taste, Terpenes, HLB, Tincture, Ageing Flavours, Safety
Summary, Jargon File, Suppliers, Flavour Starter Kit. Page-text chunks went
9 → **44**.

Five of those ten have **no video on the page at all** — Safety Summary, HLB,
Flavour Starter Kit, Jargon File and Suppliers returned zero `<iframe>` and zero
`<video>` elements, so their written body is the whole lesson.

#### The method was verified against known-good data before it was trusted

Before concluding that any lesson lacked captions, the URL-construction was run
against **lesson 6486, which was already collected**. The reconstructed URL
returned HTTP 200 and the file's md5 (`526b7113…`) **matched the stored VTT
byte-for-byte**. Only then was a 404 read as "this lesson genuinely has no
caption track" rather than "the method is broken".

#### The reconstructed pages were checked against the live page

The 10 page-text lessons could not be curled (the course is Cloudflare-protected)
so their bodies were read out of the authenticated browser in slices and
reassembled. That hand-assembly is the least deterministic step in the whole
job, so it was verified rather than assumed: the stored text was compared to a
fresh read of the live page, sampling head, tail **and a mid-offset** — a
dropped or duplicated slice shifts every later offset, so a matching mid-sample
is the real proof.

| lesson | stored | live | drift |
|---|---|---|---|
| 5446 Science of Taste (8 slices) | 4838 | 4838 | **0** |
| 4906 What is Flavour? (9 slices) | 5681 | 5680 | +1 |
| 5136 Jargon File (7 slices) | 3856 | 3854 | +2 |

Head, mid and tail samples matched in all three. The 1-2 character drift is
inline-tag spacing (`<a>`, `<sub>`), not lost content. All ten bodies are within
3% of the length the browser reported, the shortfalls being trailing
`<p>&nbsp;</p>` blocks deliberately dropped.

#### Every timestamp was checked against its source

All **336** caption chunks were re-verified against the raw `.vtt` files: each
chunk's `start_seconds` and `end_seconds` must coincide with a real cue boundary
in the source transcript.

```
caption chunks checked:                                   336
timestamps matching a REAL cue boundary in the source:    336
mismatches:                                                 0
```

And in the database: **0** page-text chunks carry a `timestamp` or
`start_seconds` key, **0** caption chunks are missing one, **0** chunks or
sources are unembedded, **0** duplicate chunk keys, **0** approved sources.

## Linked course documents — citations, not text

`batch1/transcripts/downloadable_assets.tsv` records six documents the lessons
link. They are now registered as **citation-only sources with no chunks**, which
is the rights position rather than a shortcut: Perfumer & Flavorist articles
belong to Allured Business Media and the GRAS list to FEMA. We may cite and
summarise; we may not hold their text.

| key | linked from | document | read? |
|---|---|---|---|
| `AOD-ASSET-4761-1` | 27 Flavour Levels | *A Novel Approach to Flavor Development: Using an Equation to Make Flavors* — Frank Fischetti, Jr. | yes |
| `AOD-ASSET-4761-2` | 27 Flavour Levels | FEMA GRAS substances 2001-3124 | yes |
| `AOD-ASSET-4746-1` | 16 Emulsions | *Stability of Beverage Flavor Emulsions* — Tan & Holmes, IFF | yes |
| `AOD-ASSET-6476-1` | 23 Prototyping | *…Using the Categorizing Technique to Make Flavors* — Fischetti | yes |
| `AOD-ASSET-4736-1` | 7 Regulations | USDA ARS publication, 26 pages | **no — scanned, no text layer** |
| `AOD-ASSET-5841-1` | 6 Food Grade Ingredients | course `Supplier.pdf` | **no — HTTP 403, needs the session** |

Every title and author above was read from the actual PDF's first page, not
inferred from its URL. The two that could not be read carry
`summary_grounded_in_document: false` and say so in their summary — they are
registered so the gap is visible, not to imply knowledge nobody has.

## The access blocker — resolved 2026-08-31

The 21 uncollected items needed an authenticated Art of Drink session, which the
environment did not have; `user-account/` rendered a Sign In form and entering
the password was never an option. Ashley signed in, and collection then ran
through the existing pipeline with no new code.

Two things worth keeping for next time:

- The **LMS curriculum API is not a shortcut**. `/wp-json/masterstudy-lms/v2/
  courses/3206/curriculum` returns `unauthorized_access` even from inside an
  authenticated browser session — it wants a nonce. Per-lesson it is.
- **Cloudflare clears itself.** The interstitial resolves on its own within
  ~10s; it was never bypassed, and it intermittently reappears mid-run, so a
  retry is normal.

## Still open

1. **Nothing is approved.** All 71 sources are `pending_review` or
   `reference_only`. That is correct and deliberate — promoting one is a human
   decision in the console, and no route here can do it.
2. **4 course items have no content, and all four are quizzes** — correctly
   register-only, not a gap and not fabricated. Every non-quiz item now carries
   content.
   **12 of the 35 are page text rather than transcript**, because their Bunny
   library (177015) exposes no auto-caption track. Their **video narration
   remains uncaptured**; the written body is what is held, and it is cited by
   section and paragraph, never by a timestamp.
3. **`Supplier.pdf`** (33 KB, lesson 6) and five linked FEMA/Perfumer & Flavorist
   PDFs are registered in `transcripts/downloadable_assets.tsv` and not
   ingested. The course host is Cloudflare-protected against server-side fetch.
