---
name: formula-scaling
description: "Use when asked to scale a syrup or cocktail formula, batch a recipe up or down, work out quantities for a target yield, or figure out what can be made from the amount of an ingredient on hand. Also use for technique and theory questions — emulsions, acids, water activity, solubility, extraction, preservation, clear ice, flavour dosing in ppm — which are answered from a cited knowledge corpus. Reads approved formulas from the governed beverage schema; recipe quantities always come from the formula, never from the corpus."
metadata:
  version: "1.1.0"
  created_from_session: "2026-08-29 beverage intelligence rebuild"
  updated_from_session: "2026-08-31 Manus course corpus recovery and retrieval"
---

# Formula Scaling

Scale an **approved** MTL Craft formula exactly, using the beverage service.

## Trigger

- "Scale the jalapeño syrup to 25 litres."
- "I only have 3700 grams of jalapeño — how much of everything else?"
- "Double the blood orange cordial."
- "What can I make with what's left?"
- "What formulas do we have approved?"
- "Why did my emulsion separate?" → `knowledge`
- "What order do I add acid in?" → `knowledge`
- "How do I make clear ice?" → `knowledge`
- "What does the course say about water activity?" → `knowledge`

Do not use this skill to change a recipe, approve a formula, create a draft,
update inventory, or price a batch. None of those have a route here.

**A question about a house recipe is never a `knowledge` question.** "How much
sugar is in our jalapeño syrup" is `list`, even though the corpus has passages
about sugar that read like an answer. Course material explains decisions; it
never supplies an MTL Craft measure.

## Never do the arithmetic yourself

Every number comes from the script. It uses exact rational arithmetic; you do
not. Do not multiply, divide, round, or convert units in your head or in prose,
and do not "sanity check" a returned figure by recomputing it — if it looks
surprising, report it as returned and say it looked surprising.

## The tool surface, exactly

`list` takes **no arguments** and returns every approved formula. Each one
carries `product_category` (`syrup_or_related_product` or `cocktail`), so a
"syrups only" or "cocktails only" question is answered by running `list` once
and reading that field — never by asking the operator to narrow it first.

There is no search term and no filter flag. Run it and report what comes back.
Do not offer a way to narrow the call itself; that capability does not exist.

`drafts` lists UNAPPROVED recipes by name, with an optional `--search`. It
returns names, categories and whether ingredients resolved — **never
quantities**, because an unapproved draft must not be the source of a number
anyone measures.

`method` takes `--formula` and returns how an approved formula is made.

`scale` takes the flags shown below and nothing else.

## Preparation method

`method` returns a `method` object, and `list` and `scale` carry the same object
on each formula. Read three fields and say what they say:

- `recorded: false` — nothing is on file. Say so in the words of `note` and
  **stop**. Do not supply steps from general bartending knowledge; a plausible
  method presented as house practice is worse than no answer.
- `recorded: true, reviewed: true` — a person confirmed these steps when the
  version was approved. Read `steps` in order; they are already numbered.
- `recorded: true, reviewed: false` — this is raw text from the Notion intake
  that nobody has checked. Give the steps, then say the `note` out loud: it has
  not been reviewed or approved.

What you will actually see today: **every approved formula is a syrup, and no
syrup has a method from the intake** — the syrup source is an inventory and
costing sheet, not a procedure. So `recorded: false` is the ordinary answer
until someone types the method in at approval time. Say that plainly; it is not
a fault and not a gap you should fill.

Cocktails are still not yours to quote. No cocktail is approved, so `list`
returns none, and `drafts` reports `has_ingredients: false` for every one of
them because a cocktail draft carries no structured ingredients of its own.

The operator's workbench can now build a cocktail formula from the CRM's
recipes, but **you have no tool that reads a CRM recipe**. Do not describe
cocktail measures, do not say a cocktail is ready to scale, and do not infer
that a measure exists because a drink obviously has one. If a cocktail is ever
approved it will appear in `list` like anything else, and only then may you
scale it.

`drafts` reports `has_method` as a yes/no and never the text, for the same
reason it withholds quantities: an unapproved method is no safer to follow than
an unapproved number.

## Technique and theory: `knowledge`

`knowledge --query "<a plain-language question>"` searches the governed corpus
and returns passages with citations. Optional `--limit` (default 6, max 25).

What is actually in it — run `coverage` for the live numbers rather than
trusting this paragraph:

- **336 time-coded passages** from 23 lessons of the Art of Drink "Flavour &
  Beverage Development" course Ashley is enrolled in. These are `quotable` —
  the text is the real transcript and you may read it out, attributed.
- **44 page-text passages** from 12 lessons whose player exposed no captions.
  Also `quotable`, but cited by section and paragraph, never by a timestamp.
  Their **video narration is not held** — the written lesson body is. Do not
  imply you have the spoken track for these.
- **35 cite-only sources**: Kevin Kos, Jeffrey Morgenthaler's calculators,
  clear-ice methods, two FDA references (water activity, acidified foods),
  Serious Eats, the two Notion intake registers, and six documents the course
  lessons LINK (Perfumer & Flavorist articles, the FEMA GRAS list, a USDA
  publication, the course supplier list). For all of these, `text` is a
  governed summary and there is **no fuller text behind it**. Cite it, relay the
  summary, link it — do not elaborate as if you had read the original.

Two of those six were never actually read — the USDA scan has no text layer and
the course supplier PDF returns 403. Their `source_metadata` carries
`summary_grounded_in_document: false` and their summaries say so outright. Do
not describe their contents.

Each result carries:

- `citation` — already composed. **Use it exactly as given.** Do not round a
  timestamp, do not restyle it, do not attach it to a claim it did not support.
- `quotable` — `true` for course transcript, `false` for summary-only.
- `authority_tier` — `tier_b_authorized_course` is the course; `tier_c_*` is an
  outside practitioner; `tier_a_internal` is an MTL Craft intake register.
- `review_status` — every row is `pending_review` or `reference_only` today.
  Nothing in this corpus is an approved control. Say so when it matters.

The response also carries `boundary`, the same sentence every time: this
material must never alter a formula, approve an ingredient, authorise a
shelf-life claim, determine a preservation plan, or release a batch.

`search_mode` tells you how the search actually ran. `hybrid` means meaning and
wording both counted. `text_only` means the embedding service was down and only
wording counted — results are narrower, so if they look thin, say the search ran
in text-only mode rather than concluding the corpus is empty.

**When it returns nothing**, say the corpus has nothing on that topic. Do not
answer from general bartending knowledge, and never present your own knowledge
as MTL Craft practice or as course content.

## `coverage` — content coverage is NOT manifest coverage

`coverage` takes no arguments. It reports the two separately, and you must never
conflate them:

- `items_total` — rows in the 39-item manifest. **All 39 have always existed.**
  This number says nothing about what can be answered.
- `items_with_content` — items that actually carry retrievable material. **This
  is the real coverage number.**
- `items_register_only` — items with no knowledge to hold. Today that is the
  four quizzes; the course's own guidance is that a quiz is course metadata, not
  material to answer from. Counting one as a gap would misreport it, and
  inventing content for one to move the number would be worse.
- `items_not_collected` — the genuine gap.

Each lesson carries `content_kind`: `captions`, `page_text`, `register_only` or
`none`. **Read `content_kind`, not `ingested`** — `ingested` only means the row
has some chunk, and is true for a page-text lesson and a fully captioned one
alike.

**Never say the course is complete because every manifest row exists.** If asked
how much of the course is covered, run `coverage` and give
`items_with_content` of `items_total`, then name the gap. If someone asks about
an item whose `content_kind` is `none`, say it exists in the course but was
never collected — and do not guess at its content from the title.

Run `coverage` rather than reciting numbers; the moment someone collects another
lesson, any number written here is stale and the tool is not.

## What this agent does NOT know

You have formulas, method where someone recorded it, arithmetic, and the cited
corpus above. You do not have:
- **cocktail specs** — the cocktail catalogue lives elsewhere. Only approved
  beverage formulas are yours.
- **anything the corpus does not cover.** A `knowledge` search that comes back
  empty is a complete answer. Say it is not in the corpus.

## Procedure

Run the script. `BEVERAGE_API_URL` and `BEVERAGE_HERMES_TOKEN` come from the
profile environment.

```bash
python3 skills/beverage/formula-scaling/scripts/beverage.py list
```

```bash
# technique and theory, with citations
python3 skills/beverage/formula-scaling/scripts/beverage.py knowledge \
  --query "why did my emulsion separate"

# what the corpus holds, and which course lessons were never collected
python3 skills/beverage/formula-scaling/scripts/beverage.py coverage
```

```bash
# how it is made
python3 skills/beverage/formula-scaling/scripts/beverage.py method \
  --formula "Jalapeno"
```

```bash
# by exact multiplier
python3 skills/beverage/formula-scaling/scripts/beverage.py scale \
  --formula "Blood Orange Cordial" --mode multiplier --value 2.5

# to a target yield
python3 skills/beverage/formula-scaling/scripts/beverage.py scale \
  --formula "Jalapeno Syrup" --mode target-yield --value 25

# to what is actually on hand
python3 skills/beverage/formula-scaling/scripts/beverage.py scale \
  --formula "Jalapeno Syrup" --mode have \
  --ingredient Jalapeno --quantity 3700 --unit gr
```

## Reading the result

- `factor.exact` is the answer of record — a fraction such as `74/105`.
- `factor.decimal` is a convenience. When `decimalIsExact` is `false` it has
  been **truncated, not rounded**, so the true value is slightly higher.
- Each component carries `measurable` — the number to say out loud. Lead with
  it. `scaledQuantity` is the same value to 28 places and is not for reading to
  a person.
- When `scaledQuantityIsExact` is false, `scaledQuantityExact` holds the true
  fraction. Give it in brackets after the measurable number, e.g.
  "Citric acid 20.55 gr (exactly 185/9)". Never give the fraction alone —
  nobody can weigh 185/9 grams.
- `status` is always `not_released`. Say so. Scaling produces numbers to work
  from, never permission to run the batch.

## Refusals you should relay, not work around

The service refuses on purpose. Pass the reason through in plain language:

- **Unit mismatch** — it will not convert kg to gr. Ask for the quantity
  restated in the formula's unit.
- **Not an approved formula** — before saying it does not exist, run
  `drafts --search <name>`. A recipe that exists as an unapproved draft is a
  very different answer from one that does not exist at all. Say which it is:
  "Strawberry exists as a draft but is not approved, so I cannot give
  quantities" beats "there isn't one". `drafts` deliberately returns no
  quantities — an unapproved number must never be measured from.
- **Ambiguous name** — two approved formulas share that name. Ask which
  version; never pick one.
- **No components** — the formula has no normalized ingredient rows and cannot
  be scaled. Many drafts from the Notion intake are in this state.
- **API unreachable** — say so and stop. Never answer a formula question from
  memory or from the public web.

## Answer shape

Lead with the factor and the quantities. Keep it phone-readable — someone is
standing in a prep kitchen. For example:

> Jalapeño Syrup at 74/105 (0.70476…, truncated).
> Jalapeño 3700 gr · Sugar 296/21 kg · Water 444/35 kg.
> Not released — that's the math, not a go-ahead.

Flag anything non-obvious: a truncated decimal, a component that came back as a
fraction, a formula with no planned yield.
