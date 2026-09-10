# Brix — handoff

Beverage intelligence agent for MTL Craft Cocktails.
Written 2026-08-31. Every figure below was measured, not recalled.

Manus design/context: https://manus.im/share/5BNfPHDbcgJbvdHmeTZo9E

---

## Verified state

Updated 2026-09-09 after the runtime restoration. Knowledge detail lives in
**`docs/BRIX_KNOWLEDGE.md`**; the per-source inventory is generated into
**`docs/BRIX_SOURCE_INVENTORY.md`**; this file stays the one-page picture.

| | |
|---|---|
| commit | see `git log` |
| tests | **341 passing**, 18 files |
| typecheck | `tsc --noEmit` clean |
| build | `npm run build` clean, and stamps `dist/REVISION` |
| database | Supabase `ctyxnhcljruyciebkwef` — shared with the CRM |
| beverage migrations | 110-118 and **124** in `db/migrations/`, all applied; **124** is the live `beverage_knowledge_coverage` |
| runtime | gateway + API both supervised by launchd; `scripts/brix-status.sh` is the gate |

**Migration numbering.** 124 follows 118 because the CRM holds 119-123 on the
shared number line (`db/baseline/DRIFT.md` §2). Check the CRM's **origin** refs,
not its local files, before numbering the next one.

**The ledger under-reports.** `supabase_migrations.schema_migrations` lists this
project's beverage migrations only to 117, yet 118 is demonstrably live —
`items_mixed` and `items_with_page_text` appear in no earlier migration and the
running function returns both. Read `pg_get_functiondef`, not the ledger, when
you need to know what is applied.

Recent merges: #8 `902d105` page-text lessons · #7 `0379dd4` cited knowledge
corpus · #5 `b30712e` CRM-backed cocktail measures · #4 `ef5e408` message noun
agreement · #3 `2ad1a18` cocktail ingredient resolution, schema baseline,
`db/baseline/DRIFT.md`.

### Corpus, measured

| | |
|---|---|
| `beverage.knowledge_sources` | **71** — 38 `pending_review`, 32 `reference_only`, 1 `inspiration_only`; **none approved** |
| `beverage.knowledge_chunks` | **513** — 386 time-coded (336 publisher captions + **50 local transcript**) + 127 page-text, all embedded |
| course CONTENT coverage | **35 of 39** — 30 with a clock + 5 page-text-only |
| lessons holding page text | **24** — 5 page-only + **19 mixed** (both kinds under one source) |
| course register-only | **4** — the quizzes; no knowledge to hold, none fabricated |
| course NOT COLLECTED | **0** |
| approved formulas | still **1** (`Jalapeno v1`) — unchanged, and a human step |

---

## Runtime — how Brix stays up

Added 2026-09-09, after Brix had been unreachable in Telegram since
**2026-09-08 09:04** for a reason that was neither the profile, the bot token,
nor the corpus.

**The cause.** `~/Library/LaunchAgents/ai.hermes.gateway-beverage.plist` had a
bare `<array>` as its root element instead of a `<dict>` carrying
`Label`/`ProgramArguments`/`RunAtLoad`/`KeepAlive`. `plutil -lint` passes on it —
it is valid XML — but launchd requires a dict with a Label, so the job was never
registered at all and `launchctl print` reported no such service. Meanwhile the
gateway deliberately exits code 1 on a signal shutdown *so that a supervisor will
revive it*, logging "Exiting with code 1 … so systemd Restart=on-failure can
revive the gateway". Its supervisor had never been loadable, so nothing did.

A plist that lints is not a plist that loads. Check
`launchctl print gui/$(id -u)/<label>` after installing one.

**What supervises what now.** Both plists are versioned in `launchd/`, following
the `max2-hermes/launchd/` convention, and copied to `~/Library/LaunchAgents/`:

| label | what it runs |
|---|---|
| `ai.hermes.gateway-beverage` | the Hermes gateway for the `beverage` profile |
| `ai.mtlcraft.beverage-api` | `node dist/index.js` — the beverage API on port 3000 |

Both `RunAtLoad` + `KeepAlive`, `ThrottleInterval` 30, `ExitTimeOut` 25. The API
plist's `WorkingDirectory` is the repo root so `dotenv/config` finds the existing
gitignored `.env`; **no secret appears in either plist**. `node` is pinned to
`/usr/local/bin/node` because `~/.local/bin/node` is x64 on this arm64 machine
and is the documented cause of arch drift here.

The broken plist is archived at `~/.hermes/retired-launchd/` — outside
`LaunchAgents/`, so it cannot be picked up again.

**Port drift was the same class of invisible failure.** `findAvailablePort`
scanned 3000-3019 and silently bound the next free port while still logging
"Server running". Brix reaches the API at a fixed `BEVERAGE_API_URL` of
`localhost:3000`, so a drifted port left the agent pointing at nothing with no
error anywhere. The supervised service sets `BEVERAGE_API_STRICT_PORT=true` and
now binds 3000 or exits non-zero saying why; development keeps the old scanning.

**`scripts/brix-status.sh` is the gate.** One script, because the five things it
checks only mean something together — a green gateway in front of a dead API
answers nothing, and a live API running last week's bundle answers wrongly:

```
scripts/brix-status.sh                            # gateway, telegram, api, mirror, corpus
scripts/brix-status.sh --expect-revision <sha>    # and the exact loaded revision
```

`--expect-revision` accepts a match only when the process reports it from a
**build stamp**. `npm run build` writes `dist/REVISION`; a dirty tree stamps
nothing and deletes any stale stamp, because a SHA naming a commit whose code was
not the code bundled is worse than admitting the revision is unknown.

`scripts/brix-live-qa.ts` runs 78 assertions against the live API — retrieval per
corpus group, citation stability, exact scaling, honest refusal, and the
approval boundary.

## What Brix can actually do

Brix runs from the Hermes profile at `~/.hermes/profiles/beverage/` — **not from
this repository**. `agent/beverage/` is a committed mirror; `brix-status.sh`
proves it still matches the live profile rather than leaving that to trust.
Telegram: https://t.me/Brix_recipe_bot (`@Brix_recipe_bot`, id 8974405041).
`TELEGRAM_ALLOWED_USERS` is Ashley's chat alone, so the Telegram surface cannot
reach anybody else.

Six tools, backed by five HTTP routes in `server/hermesRoutes.ts`:

| tool | route | what it does |
|---|---|---|
| `list` | `/api/hermes/formulas` | approved formulas, with components and method |
| `drafts` | `/api/hermes/drafts` | unapproved drafts by name — **never quantities** |
| `scale` | `/api/hermes/scale` | exact rational scaling; also returns the method |
| `method` | `/api/hermes/formulas` | how an approved formula is made |
| `knowledge` | `/api/hermes/knowledge` | cited technique and theory — **never a measure** |
| `coverage` | `/api/hermes/knowledge/coverage` | what the corpus holds, per source and per lesson |

Plus one route that is not a tool: `GET /api/hermes/health` — unauthenticated,
touches no database, and reports the exact revision the process has loaded.

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
| raw drafts, never versioned | **123** | 73 syrup, 50 cocktail |
| CRM cocktail recipes available to the workbench | **84** | `public.recipes` — measured 2026-09-09; this said 83 |

*(Re-measured 2026-09-09. `formula_drafts` holds **126** rows; 3 of them have
been turned into the versions above, leaving **123** never versioned. The earlier
"126 / 76 syrup" counted the versioned three twice.)*

Approval decisions recorded: 1. **Approval is a separate human step and must stay
one** — the CRM supplying a measure is not an approval.

**This backlog is not a corpus-coverage number and must not be reported as one.**
Corpus coverage is 35 of 39 course items with content and 71 sources retrievable.
Recipe approval is 1 of 4 versioned formulas approved, with 123 drafts never
versioned. The two are unrelated: ingesting more knowledge will never approve a
formula, and approving a formula will never widen the corpus.

**The way to reduce the backlog is the console, not a bypass.** Verified present
in `client/src/pages/BeverageIntelligence.tsx`: it normalizes a CRM-backed draft
(`normalizing` → `beverage.createFormulaVersion`) and approves a version through
`beverage.approveVersion` behind a **required** approval rationale field
(`Approval rationale (required)`). Both are `humanProcedure` tRPC routes. Nothing
on Brix's REST surface can reach either — `server/knowledgeBoundary.test.ts`
proves it, and proves it by failing when a writer is wired in. "Only Jalapeño" is
a queue of human decisions, not a missing capability.

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
463 course passages (336 time-coded + 127 page-text), all embedded, reachable through a fifth tool
(`knowledge`) and a sixth (`coverage`). Every answer carries a citation composed
by the service. Nothing is approved: all 71 rows remain `pending_review` or
`reference_only`.

23 of the course's 39 items have time-coded text and 24 hold page text (12 of
them holding both) — 35 with content, 0 uncollected, and the 4 quizzes stay
register-only. Run `coverage` for the current split rather than trusting any
prose.

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
- **Only 7 of the 12 page-text lessons actually have video** — corrected
  2026-09-01. The earlier wording implied all 12 had uncaptured narration. Five
  do not: **7966** (Safety Summary), **7736** (HLB) and **5726** (Flavour
  Starter Kit) are marked `video` in the manifest with a duration, but their
  pages contain no player, no iframe, and no CDN reference after a full page
  settle; **5136** (Jargon File) and **7561** (Suppliers) are manifest
  `lesson_type: text`. 7736's page holds one UUID, and it is a `notionvc:`
  comment left in pasted content, not a video id. For these five the page text
  is not a substitute for narration — there is no narration.
- **The 7 that do have video have no caption track to collect.** Their Bunny
  library (177015) serves an embed containing no `.vtt` reference of any kind,
  where library 4056's embeds do. This is a source limitation, not a
  collection gap.
- **All 7 are transcribed and ingested** (2026-09-01). 546 cues over 60.6
  minutes, 50 chunks, every transcript inside the media guard. Each of the
  seven now holds BOTH its transcript and its page text under one source row —
  `content_kind: mixed` — so a lesson can be quoted with a clock or cited by
  paragraph, and the citation says which.
- **Every citation from a transcript carries its provenance.** `citationFor`
  appends *(local transcript, unreviewed machine output)*, so a Whisper guess
  never reads as the publisher's own caption track. `chunks.local_transcript`
  in the coverage response counts them: 50 of 386 time-coded chunks.
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
- **A page chunk has no clock.** `retrieval_type: "page_text_only"` and there is
  deliberately no `timestamp` key at all — do not add one, and do not let the
  agent infer one. This now holds for 24 lessons, 12 of which also carry
  time-coded passages under the same source row.
- **Local transcription needs real idle CPU, and Docker will take all of it.**
  Docker Desktop's VM runs `--cpus 10 --memoryMiB 8092` — every logical core and
  half the RAM — and colima can be holding a second VM beside it. With both up,
  Whisper could not transcribe 170 seconds of audio in 420; `tiny.en` (39 MB)
  timed out too, which proves CPU starvation rather than model size. Stopping
  the qa-env containers and colima took it to 0.5-1.1x realtime. Check
  `top -l 1 -n 0 | grep -E "CPU usage|PhysMem"` first: the tell is idle near 0%
  with 60-75% in `sys`. `chroma-mcp` (~1.2 GB) **respawns within seconds of
  being killed** because `uv tool uvx` supervises it, so killing it is not a fix.
- **Do not send this audio to a cloud transcription service.** It is
  `authorized_private` course material under Ashley's enrolment. Local-only is
  a rights constraint, not a preference — an offline machine is the fix, not a
  faster API.
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
