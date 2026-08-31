---
name: formula-scaling
description: "Use when asked to scale a syrup or cocktail formula, batch a recipe up or down, work out quantities for a target yield, or figure out what can be made from the amount of an ingredient on hand. Reads approved formulas from the governed beverage schema."
metadata:
  version: "1.0.0"
  created_from_session: "2026-08-29 beverage intelligence rebuild"
---

# Formula Scaling

Scale an **approved** MTL Craft formula exactly, using the beverage service.

## Trigger

- "Scale the jalapeño syrup to 25 litres."
- "I only have 3700 grams of jalapeño — how much of everything else?"
- "Double the blood orange cordial."
- "What can I make with what's left?"
- "What formulas do we have approved?"

Do not use this skill to change a recipe, approve a formula, create a draft,
update inventory, or price a batch. None of those have a route here.

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

Cocktails do carry method text, and their ingredient NAMES now resolve, but
49 of the 50 record no quantities at all — the source lists "Mint, Lime, Rum,
Soda" and nothing more. A formula version needs a quantity and a unit for every
component, so those 49 cannot be approved until someone enters the measures by
hand. Until that happens you will still not meet a cocktail in `list`. Do not
offer cocktail specs, and do not fill in a measure yourself.

`drafts` reports `has_method` as a yes/no and never the text, for the same
reason it withholds quantities: an unapproved method is no safer to follow than
an unapproved number.

## What this agent does NOT know

You have formulas, method where someone recorded it, and arithmetic. You do not
have:
- **technique or theory** — extraction, preservation, water activity, clear ice
  and similar are not in this system. Say so; do not answer from general
  knowledge and do not present it as MTL Craft practice.
- **cocktail specs** — the cocktail catalogue lives elsewhere. Only approved
  beverage formulas are yours.

## Procedure

Run the script. `BEVERAGE_API_URL` and `BEVERAGE_HERMES_TOKEN` come from the
profile environment.

```bash
python3 skills/beverage/formula-scaling/scripts/beverage.py list
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
