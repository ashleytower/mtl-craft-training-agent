# Batch Costing for Brix

**Status:** design approved in chat 2026-09-15, pending spec review
**Goal:** "Strawberries were $25, sugar was $10, I made 3 L. My bottle cost is X."

## Where this lives, and why

**The governed `beverage` schema, reached through Brix.** Not the inventory MCP.

`beverage.batch_inputs` already carries `external_source` and `external_record_key`.
Those columns exist so a recorded cost can point back at a record in another
system. The architecture already decided this: **costing lives in the governed
schema and links out to inventory.**

The inventory MCP keeps what it owns and is good at: ingredient prices, the Price
History sheet, `process_invoice` receipt OCR (Gemini 2.0 Flash). Those are
*inputs*. It is the wrong home for costing itself: Google Sheets has no foreign
keys, no RLS, no approval or audit trail, and resolves items by fuzzy name match.
`batch_inputs` has real FKs to `organizations` and `principals` and
`ON DELETE RESTRICT` on its batch. For money, that difference is the whole point.

Receipt OCR stays where it is and writes a `batch_input` tagged with its source
and key. One costing home, many sources feeding it.

## Costs come from inventory unit prices, not typed per batch

**Corrected 2026-09-15 after Ashley clarified.** He stores a UNIT PRICE in
inventory ("1 kg of strawberries is $15") and expects Brix to look prices up and
do the arithmetic. He does NOT type "$25 of strawberries" per batch.

The inventory MCP already has the right shape. `inventory_manager.py:2446`:

    # Ingredients: Item Name | Category | Quantity | Unit | Cost (CAD) | Notes

So: formula says Sugar 12500 gr -> inventory says Sugar, kg, $1.20 ->
12.5 kg x $1.20 = $15.00. Per ingredient, summed, over yield, plus packaging.

This is what `cost_baselines` is FOR, and the first draft of this spec
under-used it:

| Table | Role |
|---|---|
| `cost_baselines` | **Standard cost** per formula version. Versioned, approvable, supersedable as prices move. |
| `cost_baseline_lines` | One line per ingredient: `label`, `amount`, and **`evidence_reference`** pointing back at the inventory row the price came from. |
| `batch_inputs` | **Actual** spend, when a real purchase differs from standard. |
| `batch_cost_deltas` | The **variance** between standard and actual. That is what "delta" means here. |

Standard-vs-actual costing, already modelled. Nothing to invent.

### Resolution rules (structural, not advisory)

Matching is the whole risk. "Sugar" must resolve to exactly one inventory item
and the units must be compatible.

- **gr <-> kg and ml <-> L convert exactly.** Same dimension, safe.
- **gr <-> ml is FORBIDDEN.** Needs density; sugar is not water. An ingredient
  priced per litre but measured in grams must REFUSE.
- An ambiguous or missing name REFUSES, naming the ingredient.

A costing run that cannot resolve an ingredient reports which one and stops. A
silently wrong bottle cost is worse than none: it is the money equivalent of the
fabricated-formula failure Brix already guards against. `shared/ingredients.ts`
already has `matchCatalog` with normalised exact matching and a
`catalogMatch: approved_formula | known_ingredient | ambiguous | none` verdict;
reuse it rather than writing a second matcher.

## The model

Two reporting moments, because bottling is not a batch-time decision. Ashley
reports the whole yield when the batch is made, then bottles later against
whatever a client needs, possibly across both SKUs, possibly weeks apart.

**Stage 1, batch made.** Record inputs (what was bought and paid) and the
measured yield. Produces **cost per litre**, the durable number.

**Stage 2, bottled, repeatable.** Name the SKU and count.

    cost/bottle = (cost per litre x bottle litres) + packaging per unit

## Decisions (Ashley, 2026-09-15)

| Decision | Choice |
|---|---|
| Tax | **Pre-tax.** GST/QST returns as input tax credits, so pre-tax is real COGS. |
| Bottling | **Persisted**, not just computed. Enables remaining-volume tracking. |
| Bottle price | **One current price per SKU**, overwritten on change... |
| ...with | **...the resolved unit cost SNAPSHOT onto each bottling row**, so historical batches keep what was actually paid and a price update only affects future bottlings. Simplicity without drift. |
| Labour | **Report both.** Headline = ingredients + packaging (hard cash cost). Labour a separate line once a rate exists. |

## Known packaging costs (pre-tax, 2026-09-15)

| SKU | Size | Bottle | Cap | Per unit | Per litre |
|---|---|---|---|---|---|
| BSB-002 | 1 L PET Bullet 28/410 | $0.75 | $0.25 | **$1.00** | $1.00 |
| BSB-056 | 16 oz PET Boston Round 24/410 | $0.68 | $0.25 | **$0.93** | $1.97 |

16 oz = 473.176 ml nominal. The 16 oz costs ~2x per litre; surfacing that
automatically is a reason this system earns its keep.

## Constraints

**Brix never does the arithmetic.** `SOUL.md` already forbids it for scaling and
`/api/hermes/scale` uses exact rational arithmetic. Costing gets identical
treatment: exact decimal server-side, agent reports what it returns. A plausible
hallucinated number does real damage here.

**The costing module is one cell.** Inputs, yield, labour and packaging in;
numbers out. No writes, no lookups, no LLM. Over-reach structurally impossible
rather than rule-suppressed.

**Yield is read back before it is saved**, reusing the existing `preview` ->
`confirm` fingerprint pattern already in `beverage.py`. A wrong yield silently
corrupts every cost derived from it.

## Phases

### Phase 1, capture (NO migration)

Every RPC already exists. Ships independently and is useful alone: the 500 g
hibiscus batch can be recorded before any costing math lands.

- `beverageClient.ts`: wrappers for `beverage_open_production_batch`,
  `beverage_record_batch_input`, `beverage_record_measured_yield`,
  `beverage_record_batch_cost_delta` (0 of 4 currently wired)
- `hermesRoutes.ts`: `POST /api/hermes/batch/open`, `/batch/input`,
  `/batch/yield` (with read-back), following the existing route shape
- `beverage.py`: `batch-open`, `batch-input`, `batch-yield` commands

All 11 existing commands funnel through `_config()` (confirmed by
`graphify affected "_config()"`), so new commands inherit the profile `.env`
loading fixed on 2026-09-15.

### Phase 2, costing (migration 130)

`db/migrations` is at 129 with no duplicates; 130 is free.

- Migration 130: `packaging_skus` (sku, label, bottle_ml, bottle_cost, cap_cost,
  currency) and `batch_bottlings` (batch, sku, count, bottled_on,
  **unit_packaging_cost snapshot**)
- RPCs: `beverage_record_batch_bottling`, `beverage_upsert_packaging_sku`
- `server/batchCosting.ts`: the pure module, exact decimal
- Baseline build: resolve formula components against inventory unit prices,
  write `cost_baseline_lines` with `evidence_reference`
- `GET /api/hermes/batch/cost`, `beverage.py batch-cost`

## Testing

Tests are the spec and are written first. The costing module is pure, so it
tests directly with no fixtures:

- Unit-price resolution: Sugar 12500 gr against inventory "Sugar, kg, $1.20"
  -> $15.00 (exercises gr->kg)
- Arithmetic case (numbers illustrative, Ashley's shape): $25 + $10 over 3 L
  -> $11.67/L; 1 L -> **$12.67**; 16 oz -> **$6.45**
- gr<->ml conversion REFUSES, naming the ingredient
- Ambiguous or unmatched ingredient REFUSES, naming the ingredient
- Snapshot behaviour: change a SKU price, re-read an old bottling, cost unchanged
- Zero or absent yield must refuse; never divide by zero, never guess
- Mixed SKUs from one batch cost independently
- Labour excluded from the headline, present as its own line

## Out of scope

Client pricing, margin, inventory depletion from the Google Sheet, multi-currency.
`currency_code` is stored but CAD only for now.
