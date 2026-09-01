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
beverage.knowledge_chunks   513 rows   386 time-coded (336 captions + 50 local transcript) + 127 page-text, all embedded
```

| tier | rows | what |
|---|---|---|
| `tier_b_authorized_course` | 36 | the course, and one source per collected lesson |
| `tier_c_external_practitioner` | 26 | Kevin Kos, Morgenthaler, clear ice, FDA, Serious Eats, Notion registers |
| `tier_d_inspiration` | 1 | The Alchemist — recorded, deliberately not ingested |

**Nothing is an approved control** — 38 `pending_review`, 32 `reference_only`,
1 `inspiration_only` (`PUB-ALCH-001`, The Alchemist, a *lower* trust tier than
reference_only, not an approval). Retrievability is not approval; that stayed a separate human step,
and the ingest never overwrites `rights_status`, `operational_status` or
`review_status` on a re-run.

### Course coverage: 35 of 39 items HAVE CONTENT

Collected 2026-08-31 from Ashley's authenticated Art of Drink session. **Content
coverage and manifest coverage are still different numbers** and are still
reported separately by `beverage_knowledge_coverage`:

| | |
|---|---|
| manifest items | **39** |
| **with content** | **35** — 11 captions only, 19 **mixed**, 5 page-text only |
| lessons holding page text | **24** — the honest total; `items_with_page_text` |
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
`<video>` elements, so their written body is the whole lesson. Two more
(Solvents for Flavours, Documentation) were added to the page-text set on
2026-09-01, bringing it to 12; see the per-lesson evidence table below.

**Page text is no longer a fallback (2026-09-01).** The ingest used to skip a
lesson's written page whenever that lesson had captions. It no longer does, so
the 12 lessons that always had captions gained the pages already collected for
them — 83 more passages, taking page-text chunks 44 → **127** and the corpus to
**463**. Those 12 lessons now hold both kinds under one source row and are
classified `mixed`; a lesson's page passages are still cited by section and
paragraph, never by the clock its transcript carries.

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

#### A clock does not mean the publisher said it

Two things now carry a timestamp: the publisher's own caption track, and a
transcript this machine produced. They are not the same evidence, and
`citationFor` marks the difference in the citation string itself —
`(local transcript, unreviewed machine output)` — not only in the source row's
summary. The summary is written once per lesson at ingest; the citation is what
a reader sees against an actual quote, so the disclaimer has to be there too.
`chunks.local_transcript` in the coverage response counts them.

## The captionless lessons: what has video, and what does not

Established 2026-09-01, against the live authenticated session. The earlier
handoff called these "the 12 captionless lesson videos". **Only 7 of the 12 are
videos at all.**

| lesson | # | title | media | evidence |
|---|---|---|---|---|
| 4906 | 10 | What is Flavour? | video 23:26 | Bunny embed, library 177015 |
| 5446 | 12 | Science of Taste | video 5:19 | Bunny embed |
| 6066 | 13 | Solvents for Flavours | video 10:21 | Bunny embed |
| 6381 | 15 | Terpenes | video 7:27 | Bunny embed |
| 5551 | 22 | Documentation | video 3:52 | Bunny embed |
| 4776 | 26 | Tincture | video 2:50 | Bunny embed |
| 5256 | 28 | Ageing Flavours | video 7:20 | Bunny embed |
| 7966 | 8 | Safety Summary | **none** | 0 iframes, 0 UUIDs, no CDN reference |
| 7736 | 17 | HLB | **none** | 0 iframes; its 1 UUID is a `notionvc:` comment |
| 5726 | 39 | Flavour Starter Kit | **none** | 0 iframes, 0 UUIDs |
| 5136 | 4 | Jargon File | **none** | manifest `lesson_type: text` |
| 7561 | 38 | Suppliers | **none** | manifest `lesson_type: text` |

7966, 7736 and 5726 are marked `video` in the manifest **with a duration**, which
is what produced the wrong count. Their pages carry no player. An early check
read 0 iframes for several of these while Cloudflare was still serving its
interstitial; every row above was re-read after an 8-second settle, and the three
that genuinely have no player were additionally confirmed by scanning the full
page source for `mediadelivery`, `bunny` and any UUID.

**There is no caption track to collect for the 7 that do have video.** Their
embed document contains no `.vtt` reference of any kind — library 4056's embeds
do. That is a property of the library, not of the collection method.

### Audio is collected and duration-verified

All 7 were pulled from the enrolled session — the embed is referrer-locked
(a direct fetch returns 403), so acquisition replicates the lesson-page referer
the browser sends, then takes the audio stream only. Every duration matches the
manifest:

```
lesson  measured   manifest
4906    23:26      23 minutes
5446     5:19      5 min
6066    10:21      10 minutes
6381     7:27      7 minutes
5551     3:52      4 minutes
4776     2:50      3 minutes
5256     7:20      7 minutes
                   total 60.6 minutes
```

One file was caught truncated: an interrupted run left `5446.wav` at 188s. The
tell was a surviving `embed_5446.html` — the fetch script deletes that marker
only on clean completion — and the re-fetch produced the correct 319s. That
marker convention is why the truncation did not reach the corpus.

### Transcription: done, and what it cost to get there

All 7 transcribed 2026-09-01 with `small.en`, primed with the course glossary.
**546 cues over 60.6 minutes, 50 chunks.**

| lesson | cues | transcript ends | media | overshoot | coverage |
|---|---|---|---|---|---|
| 4776 Tincture | 25 | 170.00s | 170.13s | −0.13s | 99.9% |
| 4906 What is Flavour? | 214 | 1414.32s | 1406.61s | **+7.71s** | 100.5% |
| 5256 Ageing Flavours | 66 | 440.14s | 440.28s | −0.14s | 100.0% |
| 5446 Science of Taste | 50 | 323.92s | 319.02s | **+4.90s** | 101.5% |
| 5551 Documentation | 38 | 231.52s | 232.02s | −0.50s | 99.8% |
| 6066 Solvents for Flavours | 91 | 621.32s | 621.95s | −0.63s | 99.9% |
| 6381 Terpenes | 62 | 447.20s | 447.49s | −0.29s | 99.9% |

**Two transcripts legitimately end after their audio does.** Whisper decodes in
30-second windows and pads the last one with silence, so a correct transcript
can overshoot. An earlier one-second tolerance would have rejected lessons 10
and 12 — 264 good cues. `assertTranscriptCoversMedia` now allows one decode
window, which is the principled ceiling because the overshoot can only come
from that padded window; a mismatched file or runaway clock is wrong by
minutes. It also refuses a transcript covering under half its recording, which
is what transcription dying partway looks like.

#### The machine, not the method, was the blocker

Whisper could not run at all on 2026-09-01 until Docker was stopped. Measured:

```
small.en, 170s clip, two passes in parallel   >20 min, no output   load 27
small.en, 170s clip, single pass              >35 min, no output   load 48
small.en, 170s clip, greedy decoding           400s timeout        load 45
tiny.en   170s clip (39 MB model)              300s timeout        load 62
--- Docker Desktop VM and colima stopped ---
small.en, 170s clip                            489s complete
small.en, 1406s lesson                        1516s complete       (1.08x)
small.en, 622s lesson                          329s complete       (0.53x)
```

`tiny.en` timing out is the decisive datum: a 39 MB model cannot be
memory-bound, so the constraint was **CPU starvation**. Docker Desktop's VM was
running `--cpus 10 --memoryMiB 8092` — every logical core and half the RAM —
with colima holding a second VM beside it. Idle CPU sat at 0.3-1.6%. After
stopping the 6 `supabase_*_qa-env` containers and colima, throughput went from
never-finishing to **0.5-1.1x realtime**.

Diagnose with `top -l 1 -n 0 | grep -E "CPU usage|PhysMem"` before a run; the
tell is idle near 0% with 60-75% in `sys`. Note `chroma-mcp` (claude-mem's
vector store, ~1.2 GB) respawns within seconds of being killed because
`uv tool uvx` supervises it — killing it is not a fix.

The audio must **not** go to a cloud transcription service: it is
`authorized_private` material under Ashley's enrolment.

### How the glossary prompt is kept honest

Whisper is primed with an `--initial_prompt` built from the course's own Jargon
File (lesson 5136) plus domain terms grepped out of the saved lesson pages —
every biased term is attested in real course material, none invented, and a
test pins that. The pilot showed why it is needed: unprimed `small.en` rendered
**gentian** as "genshin", and gentian appears in lesson 6066's own page.

Bias can also put a word where nobody said one, so
`scripts/verify-transcript-terms.py` checks every occurrence twice.

**Result, 2026-09-01 — all 57 occurrences checked, not a sample:**

```
biased-term occurrences across 7 transcripts:   57
distinct terms used:                            10
attested in the course's own written material:  10/10
prompt echoes:                                   0

audio re-checked against UNPRIMED decoding:     57 of 57
  confirmed  decoder produced the term itself   55
  variant    same word, different spelling       2
  ABSENT     audio does not support it           0
```

| term | occ | term | occ |
|---|---|---|---|
| terpenes | 29 | gentian | 3 |
| tincture | 6 | emulsion | 2 |
| solvent | 5 | macerated | 1 |
| ABV | 5 | FEMA | 1 |
| limonene | 4 | shelf stable | 1 |

**Zero `absent`.** No term in any transcript lacks support in the recording.

#### Why three verdicts and not two

The two `variant` rows are both `gentian ~ genshin` in lesson 26, and they are
the reason a pass/fail check is not good enough. Unprimed Whisper writes
"genshin"; an exact-match test calls that a failure and files the prime's most
valuable correction beside a genuine fabrication, where nobody can tell them
apart.

The third gentian occurrence settles it. At 97.04s the **unprimed** decoder
produced "gentian" correctly on its own. So the speaker does say the word, the
unprimed model gets it right sometimes and wrong others, and the prime only
made the spelling consistent. That is the bias doing exactly what it is allowed
to do — and it is evidence in `term_verification.json`, not an assertion.

Only `absent` — nothing in the unprimed audio resembling the term — is evidence
of a possible insertion, and there are none. The similarity threshold (0.65)
was set from measured pairs: gentian/genshin 0.71 and terpenes/terpines 0.88
against tincture/store 0.29 and gentian/stand 0.17. Real variants cluster at
0.7-0.9, unrelated words below 0.4; 0.65 sits in the gap.

A cue where the decoder recites its own glossary is refused outright by the
ingest rather than dropped, because such a cue would otherwise enter the corpus
as a timestamped quotable passage and then pass every term check — the words in
a recited glossary being, by construction, the exact vocabulary the checker
treats as attested.

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
