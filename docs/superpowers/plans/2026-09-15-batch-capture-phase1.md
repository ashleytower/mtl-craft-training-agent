# Batch Capture (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Brix record a production batch, what was bought for it, and its measured yield — so a real batch can be captured before any costing math exists.

**Architecture:** Four RPCs already exist in the governed `beverage` schema and are currently unreachable from the app. This plan adds the three missing layers above them: typed client wrappers, plain-JSON Hermes routes, and agent commands. The yield write reuses the existing `preview` -> `confirm` fingerprint read-back, because a wrong yield silently corrupts every cost later derived from it. **No migration.**

**Tech Stack:** TypeScript, Express, Supabase RPC (`service_role`), vitest, Python 3 stdlib (`urllib`) for the agent script.

**Spec:** `docs/superpowers/specs/2026-09-15-batch-costing-design.md`

## Global Constraints

- **Brix never does arithmetic.** No quantity, sum, or conversion is computed in the agent or in prose. Phase 1 stores raw values only; all costing is Phase 2.
- **Currency is CAD**, stored explicitly in `currency_code`. Never defaulted silently.
- **Money and yields are transported as STRINGS**, never JS `number`. These land in `numeric` columns and a float round-trip quietly changes a price.
- **Refuse, never guess.** Missing or unparseable input returns HTTP 400 naming the offending field. The database's refusal is surfaced verbatim, never paraphrased.
- **Owner gating is the server's job.** `p_is_owner` comes from `BEVERAGE_OWNER_SUBJECTS`, never from request input.
- Tests: `npx vitest run <file>`. Typecheck: `npm run check`.

---

### Task 1: Client wrappers for the four batch RPCs

**Files:**
- Modify: `server/beverageClient.ts` (append near `createFormulaVersion`)
- Test: `server/beverageClient.test.ts` (append)

**Interfaces:**
- Consumes: existing `operatorArgs(identity)` and `callRpc<T>(name, args)` in the same file.
- Produces:
  - `openProductionBatch(identity, {formulaVersionId, batchLabel, madeOn, notes}) => Promise<{id: string}>`
  - `recordBatchInput(identity, {productionBatchId, itemName, quantityPurchased, unit, amountPaid, currencyCode, supplier, invoiceReference, purchasedOn, externalSource, externalRecordKey}) => Promise<{id: string}>`
  - `recordMeasuredYield(identity, {productionBatchId, measuredYieldValue, measuredYieldUnit}) => Promise<{id: string}>`
  - `recordBatchCostDelta(identity, {productionBatchId, costBaselineId, label, deltaAmount, rationale}) => Promise<{id: string}>`
  - Every numeric-valued field is a `string`.

- [ ] **Step 1: Write the failing test**

Append to `server/beverageClient.test.ts`:

```ts
describe("batch capture", () => {
  it("sends the operator args and the batch fields openProductionBatch was given", async () => {
    rpc.mockResolvedValue({ data: { id: "batch-1" }, error: null });
    process.env.BEVERAGE_OWNER_SUBJECTS = ASHLEY.subject;

    await beverage.openProductionBatch(ASHLEY, {
      formulaVersionId: "fa96080f-00d9-461d-91c4-295962f94489",
      batchLabel: "Hibiscus 2026-09-15",
      madeOn: "2026-09-15",
      notes: null,
    });

    expect(rpc.mock.calls[0][0]).toBe("beverage_open_production_batch");
    expect(sentArgs()).toMatchObject({
      p_external_subject: ASHLEY.subject,
      p_is_owner: true,
      p_formula_version_id: "fa96080f-00d9-461d-91c4-295962f94489",
      p_batch_label: "Hibiscus 2026-09-15",
      p_made_on: "2026-09-15",
      p_notes: null,
    });
  });

  it("keeps money and quantities as strings so numeric precision survives", async () => {
    rpc.mockResolvedValue({ data: { id: "input-1" }, error: null });

    await beverage.recordBatchInput(ASHLEY, {
      productionBatchId: "batch-1",
      itemName: "Strawberries",
      quantityPurchased: "2.5",
      unit: "kg",
      amountPaid: "37.50",
      currencyCode: "CAD",
      supplier: "Jean-Talon",
      invoiceReference: "INV-9912",
      purchasedOn: "2026-09-14",
      externalSource: "google_sheets_inventory",
      externalRecordKey: "Ingredients!A42",
    });

    const args = sentArgs();
    expect(args.p_quantity_purchased).toBe("2.5");
    expect(args.p_amount_paid).toBe("37.50");
    expect(typeof args.p_amount_paid).toBe("string");
    expect(args.p_external_source).toBe("google_sheets_inventory");
    expect(args.p_external_record_key).toBe("Ingredients!A42");
  });

  it("records a measured yield against its batch", async () => {
    rpc.mockResolvedValue({ data: { id: "batch-1" }, error: null });

    await beverage.recordMeasuredYield(ASHLEY, {
      productionBatchId: "batch-1",
      measuredYieldValue: "18.4",
      measuredYieldUnit: "L",
    });

    expect(rpc.mock.calls[0][0]).toBe("beverage_record_measured_yield");
    expect(sentArgs()).toMatchObject({
      p_production_batch_id: "batch-1",
      p_measured_yield_value: "18.4",
      p_measured_yield_unit: "L",
    });
  });

  it("never asserts ownership for a subject not on the allowlist", async () => {
    rpc.mockResolvedValue({ data: { id: "batch-1" }, error: null });
    await beverage.openProductionBatch(STRANGER, {
      formulaVersionId: "v1", batchLabel: "x", madeOn: null, notes: null,
    });
    expect(sentArgs().p_is_owner).toBe(false);
  });

  it("surfaces the database refusal verbatim", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Batch label is required" } });
    await expect(
      beverage.openProductionBatch(ASHLEY, {
        formulaVersionId: "v1", batchLabel: "", madeOn: null, notes: null,
      })
    ).rejects.toThrow("Batch label is required");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/beverageClient.test.ts`
Expected: FAIL — `beverage.openProductionBatch is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `server/beverageClient.ts`:

```ts
/**
 * Batch capture. Quantities and money are strings end to end: these land in
 * `numeric` columns, and a JS number would silently round a price.
 */
export function openProductionBatch(
  identity: OperatorIdentity,
  input: {
    formulaVersionId: string;
    batchLabel: string;
    madeOn: string | null;
    notes: string | null;
  }
) {
  return callRpc<{ id: string }>("beverage_open_production_batch", {
    ...operatorArgs(identity),
    p_formula_version_id: input.formulaVersionId,
    p_batch_label: input.batchLabel,
    p_made_on: input.madeOn,
    p_notes: input.notes,
  });
}

export function recordBatchInput(
  identity: OperatorIdentity,
  input: {
    productionBatchId: string;
    itemName: string;
    quantityPurchased: string;
    unit: string;
    amountPaid: string;
    currencyCode: string;
    supplier: string | null;
    invoiceReference: string | null;
    purchasedOn: string | null;
    externalSource: string | null;
    externalRecordKey: string | null;
  }
) {
  return callRpc<{ id: string }>("beverage_record_batch_input", {
    ...operatorArgs(identity),
    p_production_batch_id: input.productionBatchId,
    p_item_name: input.itemName,
    p_quantity_purchased: input.quantityPurchased,
    p_unit: input.unit,
    p_amount_paid: input.amountPaid,
    p_currency_code: input.currencyCode,
    p_supplier: input.supplier,
    p_invoice_reference: input.invoiceReference,
    p_purchased_on: input.purchasedOn,
    p_external_source: input.externalSource,
    p_external_record_key: input.externalRecordKey,
  });
}

export function recordMeasuredYield(
  identity: OperatorIdentity,
  input: {
    productionBatchId: string;
    measuredYieldValue: string;
    measuredYieldUnit: string;
  }
) {
  return callRpc<{ id: string }>("beverage_record_measured_yield", {
    ...operatorArgs(identity),
    p_production_batch_id: input.productionBatchId,
    p_measured_yield_value: input.measuredYieldValue,
    p_measured_yield_unit: input.measuredYieldUnit,
  });
}

export function recordBatchCostDelta(
  identity: OperatorIdentity,
  input: {
    productionBatchId: string;
    costBaselineId: string;
    label: string;
    deltaAmount: string;
    rationale: string;
  }
) {
  return callRpc<{ id: string }>("beverage_record_batch_cost_delta", {
    ...operatorArgs(identity),
    p_production_batch_id: input.productionBatchId,
    p_cost_baseline_id: input.costBaselineId,
    p_label: input.label,
    p_delta_amount: input.deltaAmount,
    p_rationale: input.rationale,
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run server/beverageClient.test.ts && npm run check`
Expected: PASS, no type errors

- [ ] **Step 5: Commit**

```bash
git add server/beverageClient.ts server/beverageClient.test.ts
git commit -m "feat(beverage): client wrappers for batch capture RPCs"
```

---

### Task 2: Yield claim parsing and read-back token

**Files:**
- Create: `server/batchYield.ts`
- Test: `server/batchYield.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `type YieldClaim = { productionBatchId: string; value: string; unit: string }`
  - `parseYieldClaim(body: unknown): { claim: YieldClaim | null; error?: string }`
  - `yieldFingerprint(claim: YieldClaim): string` — 12 hex chars
  - `yieldToken(claim: YieldClaim): string` — first 6, what Ashley says back
  - `YIELD_UNITS: readonly string[]`

- [ ] **Step 1: Write the failing test**

Create `server/batchYield.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseYieldClaim, yieldFingerprint, yieldToken } from "./batchYield";

const CLAIM = { productionBatchId: "batch-1", value: "18.4", unit: "L" };

describe("parseYieldClaim", () => {
  it("accepts a positive decimal in a known unit", () => {
    const { claim, error } = parseYieldClaim({
      production_batch_id: "batch-1", value: "18.4", unit: "L",
    });
    expect(error).toBeUndefined();
    expect(claim).toEqual(CLAIM);
  });

  it("refuses a zero yield rather than storing a divide-by-zero", () => {
    const { claim, error } = parseYieldClaim({
      production_batch_id: "batch-1", value: "0", unit: "L",
    });
    expect(claim).toBeNull();
    expect(error).toMatch(/greater than zero/i);
  });

  it("refuses a negative yield", () => {
    expect(parseYieldClaim({
      production_batch_id: "batch-1", value: "-2", unit: "L",
    }).error).toMatch(/number/i);
  });

  it("refuses a non-numeric value instead of coercing it", () => {
    expect(parseYieldClaim({
      production_batch_id: "batch-1", value: "about 18", unit: "L",
    }).error).toMatch(/number/i);
  });

  it("refuses an unknown unit and names the ones it takes", () => {
    const { error } = parseYieldClaim({
      production_batch_id: "batch-1", value: "18", unit: "buckets",
    });
    expect(error).toMatch(/L, ml, kg, gr/);
  });

  it("requires the batch id", () => {
    expect(parseYieldClaim({ value: "18", unit: "L" }).error)
      .toMatch(/production_batch_id/);
  });
});

describe("yield read-back token", () => {
  it("is stable for the same claim", () => {
    expect(yieldToken(CLAIM)).toBe(yieldToken({ ...CLAIM }));
  });

  it("changes when the value changes, so a misheard number cannot confirm", () => {
    expect(yieldToken(CLAIM)).not.toBe(yieldToken({ ...CLAIM, value: "18.5" }));
  });

  it("changes when the unit changes", () => {
    expect(yieldToken(CLAIM)).not.toBe(yieldToken({ ...CLAIM, unit: "kg" }));
  });

  it("is six characters, short enough to read off a phone", () => {
    expect(yieldToken(CLAIM)).toHaveLength(6);
    expect(yieldFingerprint(CLAIM)).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/batchYield.test.ts`
Expected: FAIL — cannot resolve `./batchYield`

- [ ] **Step 3: Write minimal implementation**

Create `server/batchYield.ts`:

```ts
/**
 * A measured yield is read back before it is saved.
 *
 * Every cost later derived from a batch divides by this number, so a misheard
 * "eighteen four" becomes a wrong bottle cost on every bottle forever. Same
 * shape as `specFingerprint` in ./recipeProposals: the agent previews, Ashley
 * says the token back, and the server recomputes the hash from the claim it is
 * asked to store. If a digit moved in between, the hashes differ and it refuses.
 */
import { createHash } from "node:crypto";

export type YieldClaim = {
  productionBatchId: string;
  value: string;
  unit: string;
};

/** Volume or mass. A syrup is sometimes weighed, per the hot-fill method. */
export const YIELD_UNITS = ["L", "ml", "kg", "gr"] as const;

export function yieldFingerprint(claim: YieldClaim): string {
  const canonical = [claim.productionBatchId, claim.value.trim(), claim.unit];
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 12);
}

/** What she says out loud. Six characters: unambiguous, readable off a phone. */
export function yieldToken(claim: YieldClaim): string {
  return yieldFingerprint(claim).slice(0, 6);
}

export function parseYieldClaim(
  body: unknown
): { claim: YieldClaim | null; error?: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const productionBatchId =
    typeof b.production_batch_id === "string" ? b.production_batch_id.trim() : "";
  if (!productionBatchId) {
    return { claim: null, error: "production_batch_id is required" };
  }

  const value = typeof b.value === "string" ? b.value.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(value)) {
    return {
      claim: null,
      error: `value must be a number, in digits, not "${String(b.value)}"`,
    };
  }
  if (Number(value) <= 0) {
    return { claim: null, error: "value must be greater than zero" };
  }

  const unit = typeof b.unit === "string" ? b.unit.trim() : "";
  if (!(YIELD_UNITS as readonly string[]).includes(unit)) {
    return { claim: null, error: `unit must be one of ${YIELD_UNITS.join(", ")}` };
  }

  return { claim: { productionBatchId, value, unit } };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run server/batchYield.test.ts && npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/batchYield.ts server/batchYield.test.ts
git commit -m "feat(beverage): yield claim parsing with read-back token"
```

---

### Task 3: Hermes routes for batch open, input and yield

**Files:**
- Modify: `server/hermesRoutes.ts` (module docstring, imports, four new routes)
- Test: `server/hermesRoutes.batch.test.ts`

**Interfaces:**
- Consumes: Task 1's `openProductionBatch`, `recordBatchInput`, `recordMeasuredYield`; Task 2's `parseYieldClaim`, `yieldToken`.
- Produces: `POST /api/hermes/batch/open`, `/batch/input`, `/batch/yield/preview`, `/batch/yield/confirm`.

- [ ] **Step 1: Correct the stale module docstring**

`server/hermesRoutes.ts` opens by claiming the surface is "deliberately read-and-calculate only: there is no route here that creates or approves a formula version, so the agent cannot perform a governed write even if it is instructed to." That was already untrue before this task — `/api/hermes/research` and `/recipe/confirm` both write — and this task adds four more. A comment that denies the writes beneath it is exactly how the `beverage.py` docstring convinced a reader that batch capture was impossible.

Replace the docstring with:

```ts
/**
 * Plain REST surface for the Hermes agent.
 *
 * tRPC's batching and superjson encoding are awkward to call from a skill
 * script, so the agent gets a small, explicit JSON API instead.
 *
 * Most of it is read-and-calculate. The writes it does allow are narrow and
 * each carries its own gate: queued research candidates (nothing citable until
 * approved), a dictated recipe behind a spoken fingerprint, and batch capture —
 * where the measured yield is read back before it is stored. Approving a
 * formula version is NOT among them; that lives behind `humanProcedure` in the
 * tRPC router.
 */
```

- [ ] **Step 2: Write the failing test**

Create `server/hermesRoutes.batch.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { yieldToken } from "./batchYield";

const openProductionBatch = vi.fn();
const recordBatchInput = vi.fn();
const recordMeasuredYield = vi.fn();

vi.mock("./beverageClient", () => ({
  openProductionBatch: (...a: unknown[]) => openProductionBatch(...a),
  recordBatchInput: (...a: unknown[]) => recordBatchInput(...a),
  recordMeasuredYield: (...a: unknown[]) => recordMeasuredYield(...a),
  listApprovedFormulas: vi.fn(),
  listFormulaDrafts: vi.fn(),
  searchKnowledge: vi.fn(),
  knowledgeCoverage: vi.fn(),
  recordResearchCandidates: vi.fn(),
  listResearchCandidates: vi.fn(),
  decideResearchCandidate: vi.fn(),
  recordCalculationPlan: vi.fn(),
}));

const IDENTITY = { subject: "ashley", displayName: "Ashley", email: null };
vi.mock("./_core/hermesService", () => ({
  hermesIdentityFromRequest: (req: { headers: Record<string, string> }) =>
    req.headers["x-hermes-service-token"] ? IDENTITY : null,
}));

import * as routes from "./hermesRoutes";

// Minimal Express double: records handlers, then invokes them directly.
function harness() {
  const table = new Map<string, Function>();
  const app = {
    get: (p: string, h: Function) => table.set(`GET ${p}`, h),
    post: (p: string, h: Function) => table.set(`POST ${p}`, h),
  };
  const register = (routes as Record<string, unknown>).registerHermesRoutes
    ?? (routes as Record<string, unknown>).default;
  (register as (a: unknown) => void)(app);
  return async (method: string, path: string, body: unknown, authed = true) => {
    const handler = table.get(`${method} ${path}`);
    if (!handler) throw new Error(`no route ${method} ${path}`);
    let status = 200;
    let payload: unknown;
    const res = {
      status(code: number) { status = code; return this; },
      json(p: unknown) { payload = p; return this; },
    };
    await handler(
      { body, headers: authed ? { "x-hermes-service-token": "t" } : {} },
      res
    );
    return { status, body: payload as Record<string, unknown> };
  };
}

beforeEach(() => {
  openProductionBatch.mockReset().mockResolvedValue({ id: "batch-1" });
  recordBatchInput.mockReset().mockResolvedValue({ id: "input-1" });
  recordMeasuredYield.mockReset().mockResolvedValue({ id: "batch-1" });
});

describe("POST /api/hermes/batch/open", () => {
  it("requires the service token", async () => {
    const r = await harness()("POST", "/api/hermes/batch/open", {}, false);
    expect(r.status).toBe(401);
  });

  it("requires a formula version id", async () => {
    const r = await harness()("POST", "/api/hermes/batch/open", { batch_label: "x" });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/formula_version_id/);
  });

  it("opens the batch and returns its id", async () => {
    const r = await harness()("POST", "/api/hermes/batch/open", {
      formula_version_id: "v1", batch_label: "Hibiscus 2026-09-15",
    });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe("batch-1");
  });
});

describe("POST /api/hermes/batch/input", () => {
  it("refuses a missing amount rather than storing zero", async () => {
    const r = await harness()("POST", "/api/hermes/batch/input", {
      production_batch_id: "batch-1", item_name: "Sugar",
      quantity_purchased: "10", unit: "kg",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/amount_paid/);
  });

  it("passes money through as a string and defaults currency to CAD", async () => {
    await harness()("POST", "/api/hermes/batch/input", {
      production_batch_id: "batch-1", item_name: "Sugar",
      quantity_purchased: "10", unit: "kg", amount_paid: "12.00",
    });
    expect(recordBatchInput.mock.calls[0][1].amountPaid).toBe("12.00");
    expect(recordBatchInput.mock.calls[0][1].currencyCode).toBe("CAD");
  });
});

describe("yield read-back", () => {
  const claim = { production_batch_id: "batch-1", value: "18.4", unit: "L" };
  const good = { productionBatchId: "batch-1", value: "18.4", unit: "L" };

  it("preview writes nothing and returns the token to say back", async () => {
    const r = await harness()("POST", "/api/hermes/batch/yield/preview", claim);
    expect(r.status).toBe(200);
    expect(r.body.token).toBe(yieldToken(good));
    expect(recordMeasuredYield).not.toHaveBeenCalled();
  });

  it("confirm stores it when the token matches", async () => {
    const r = await harness()("POST", "/api/hermes/batch/yield/confirm", {
      ...claim, fingerprint: yieldToken(good),
    });
    expect(r.status).toBe(200);
    expect(recordMeasuredYield).toHaveBeenCalledOnce();
  });

  it("REFUSES when the number changed since the preview", async () => {
    const r = await harness()("POST", "/api/hermes/batch/yield/confirm", {
      ...claim, value: "18.5", fingerprint: yieldToken(good),
    });
    expect(r.status).toBe(409);
    expect(recordMeasuredYield).not.toHaveBeenCalled();
    expect(String(r.body.error)).toMatch(/did not match/i);
  });

  it("refuses a zero yield at preview", async () => {
    const r = await harness()("POST", "/api/hermes/batch/yield/preview", {
      ...claim, value: "0",
    });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/hermesRoutes.batch.test.ts`
Expected: FAIL — `no route POST /api/hermes/batch/open`

> If it fails instead on resolving the registration function, read the actual
> export at the top of `server/hermesRoutes.ts` and use that name in the
> harness. Do NOT change the source to match the test.

- [ ] **Step 4: Write the routes**

Add to the imports in `server/hermesRoutes.ts`:

```ts
import { parseYieldClaim, yieldToken } from "./batchYield";
```

Add inside the same registration function as the existing routes:

```ts
  app.post("/api/hermes/batch/open", async (req: Request, res: Response) => {
    const identity = hermesIdentityFromRequest(req);
    if (!identity) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }
    const formulaVersionId =
      typeof req.body?.formula_version_id === "string"
        ? req.body.formula_version_id.trim() : "";
    if (!formulaVersionId) {
      res.status(400).json({ error: "formula_version_id is required" });
      return;
    }
    const batchLabel =
      typeof req.body?.batch_label === "string" ? req.body.batch_label.trim() : "";
    if (!batchLabel) {
      res.status(400).json({ error: "batch_label is required" });
      return;
    }
    try {
      const opened = await beverage.openProductionBatch(identity, {
        formulaVersionId,
        batchLabel,
        madeOn: typeof req.body?.made_on === "string" ? req.body.made_on : null,
        notes: typeof req.body?.notes === "string" ? req.body.notes : null,
      });
      res.json(opened);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "could not open batch",
      });
    }
  });

  app.post("/api/hermes/batch/input", async (req: Request, res: Response) => {
    const identity = hermesIdentityFromRequest(req);
    if (!identity) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }
    const str = (k: string) =>
      typeof req.body?.[k] === "string" ? String(req.body[k]).trim() : "";
    // Money and quantity stay strings: `numeric` columns, and a float
    // round-trip would quietly change a price.
    for (const required of [
      "production_batch_id", "item_name", "quantity_purchased", "unit", "amount_paid",
    ]) {
      if (!str(required)) {
        res.status(400).json({ error: `${required} is required` });
        return;
      }
    }
    try {
      const recorded = await beverage.recordBatchInput(identity, {
        productionBatchId: str("production_batch_id"),
        itemName: str("item_name"),
        quantityPurchased: str("quantity_purchased"),
        unit: str("unit"),
        amountPaid: str("amount_paid"),
        currencyCode: str("currency_code") || "CAD",
        supplier: str("supplier") || null,
        invoiceReference: str("invoice_reference") || null,
        purchasedOn: str("purchased_on") || null,
        externalSource: str("external_source") || null,
        externalRecordKey: str("external_record_key") || null,
      });
      res.json(recorded);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "could not record input",
      });
    }
  });

  /** Writes nothing. Returns the token she says back. */
  app.post("/api/hermes/batch/yield/preview", async (req: Request, res: Response) => {
    const identity = hermesIdentityFromRequest(req);
    if (!identity) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }
    const { claim, error } = parseYieldClaim(req.body);
    if (!claim) {
      res.status(400).json({ error });
      return;
    }
    res.json({
      claim: { ...claim },
      token: yieldToken(claim),
      note:
        `Read back: ${claim.value} ${claim.unit}. Nothing is stored until she ` +
        "says the token, then call /api/hermes/batch/yield/confirm with it.",
    });
  });

  app.post("/api/hermes/batch/yield/confirm", async (req: Request, res: Response) => {
    const identity = hermesIdentityFromRequest(req);
    if (!identity) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }
    const { claim, error } = parseYieldClaim(req.body);
    if (!claim) {
      res.status(400).json({ error });
      return;
    }
    const claimed =
      typeof req.body?.fingerprint === "string" ? req.body.fingerprint.trim() : "";
    if (!claimed) {
      res.status(400).json({ error: "fingerprint is required; preview it first" });
      return;
    }
    if (claimed !== yieldToken(claim)) {
      res.status(409).json({
        error:
          "the token did not match this yield — the number changed since the " +
          "preview. Re-run the preview and read it out again.",
      });
      return;
    }
    try {
      const recorded = await beverage.recordMeasuredYield(identity, {
        productionBatchId: claim.productionBatchId,
        measuredYieldValue: claim.value,
        measuredYieldUnit: claim.unit,
      });
      res.json({ ...recorded, recorded: `${claim.value} ${claim.unit}` });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "could not record yield",
      });
    }
  });
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run server/hermesRoutes.batch.test.ts && npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/hermesRoutes.ts server/hermesRoutes.batch.test.ts
git commit -m "feat(beverage): hermes routes for batch open, input and read-back yield"
```

---

### Task 4: Agent commands

**Files:**
- Modify: `agent/beverage/skills/formula-scaling/scripts/beverage.py`
- Modify: `agent/beverage/skills/formula-scaling/SKILL.md`
- Deploy: copy both into `~/.hermes/profiles/beverage/skills/beverage/formula-scaling/`

**Interfaces:**
- Consumes: Task 3's four routes.
- Produces: `batch-open`, `batch-input`, `batch-yield-preview`, `batch-yield`. All reach the API through the existing `_config()`, so they inherit the profile `.env` loading.

- [ ] **Step 1: Add the command functions**

Insert before `def main()` in `beverage.py`:

```python
def cmd_batch_open(args):
    """Start a batch against an APPROVED formula version."""
    base, token = _config()
    body = {
        "formula_version_id": args.formula_version_id,
        "batch_label": args.label,
    }
    if args.made_on:
        body["made_on"] = args.made_on
    if args.notes:
        body["notes"] = args.notes
    result = _call(f"{base}/api/hermes/batch/open", token, body)
    print(json.dumps({"ok": True, **result}, indent=2))


def cmd_batch_input(args):
    """Record what was bought for a batch. Amounts stay exactly as written."""
    base, token = _config()
    body = {
        "production_batch_id": args.batch,
        "item_name": args.item,
        "quantity_purchased": args.quantity,
        "unit": args.unit,
        "amount_paid": args.amount,
    }
    for value, key in (
        (args.currency, "currency_code"), (args.supplier, "supplier"),
        (args.invoice, "invoice_reference"), (args.purchased_on, "purchased_on"),
        (args.source, "external_source"), (args.record_key, "external_record_key"),
    ):
        if value:
            body[key] = value
    result = _call(f"{base}/api/hermes/batch/input", token, body)
    print(json.dumps({"ok": True, **result}, indent=2))


def cmd_batch_yield_preview(args):
    """Read a yield back to her. Writes NOTHING. She must say the token."""
    base, token = _config()
    result = _call(
        f"{base}/api/hermes/batch/yield/preview",
        token,
        {"production_batch_id": args.batch, "value": args.value, "unit": args.unit},
    )
    print(json.dumps({"ok": True, **result}, indent=2))


def cmd_batch_yield(args):
    """Store the yield she confirmed by token.

    Run ONLY after she has said the token back. Pass the SAME value and unit you
    previewed. If a digit moved, the server refuses rather than storing a number
    that every later cost divides by.
    """
    base, token = _config()
    result = _call(
        f"{base}/api/hermes/batch/yield/confirm",
        token,
        {
            "production_batch_id": args.batch,
            "value": args.value,
            "unit": args.unit,
            "fingerprint": args.fingerprint,
        },
    )
    print(json.dumps({"ok": True, **result}, indent=2))
```

- [ ] **Step 2: Register the subparsers**

Insert in `main()`, immediately before `args = parser.parse_args()`:

```python
    bopen = sub.add_parser("batch-open", help="Start a batch from an approved formula")
    bopen.add_argument("--formula-version-id", required=True, dest="formula_version_id")
    bopen.add_argument("--label", required=True, help="What to call this batch")
    bopen.add_argument("--made-on", default=None, dest="made_on", help="YYYY-MM-DD")
    bopen.add_argument("--notes", default=None)
    bopen.set_defaults(func=cmd_batch_open)

    binput = sub.add_parser("batch-input", help="Record something bought for a batch")
    binput.add_argument("--batch", required=True, help="Batch id from batch-open")
    binput.add_argument("--item", required=True)
    binput.add_argument("--quantity", required=True, help="As written, e.g. 2.5")
    binput.add_argument("--unit", required=True, help="kg, gr, L, ml or unit")
    binput.add_argument("--amount", required=True, help="What was paid, e.g. 37.50")
    binput.add_argument("--currency", default=None, help="Defaults to CAD")
    binput.add_argument("--supplier", default=None)
    binput.add_argument("--invoice", default=None)
    binput.add_argument("--purchased-on", default=None, dest="purchased_on")
    binput.add_argument("--source", default=None, help="e.g. google_sheets_inventory")
    binput.add_argument("--record-key", default=None, dest="record_key")
    binput.set_defaults(func=cmd_batch_input)

    bprev = sub.add_parser(
        "batch-yield-preview", help="Read a yield back to her. Writes nothing.")
    bprev.add_argument("--batch", required=True)
    bprev.add_argument("--value", required=True, help="Digits, e.g. 18.4")
    bprev.add_argument("--unit", required=True, choices=["L", "ml", "kg", "gr"])
    bprev.set_defaults(func=cmd_batch_yield_preview)

    byield = sub.add_parser("batch-yield", help="Store the yield she confirmed")
    byield.add_argument("--batch", required=True)
    byield.add_argument("--value", required=True)
    byield.add_argument("--unit", required=True, choices=["L", "ml", "kg", "gr"])
    byield.add_argument(
        "--fingerprint", required=True, help="The token she said back to you")
    byield.set_defaults(func=cmd_batch_yield)
```

- [ ] **Step 3: Verify the script parses and the commands appear**

```bash
cd ~/GitHub/mtl-craft-training-agent
python3 -m py_compile agent/beverage/skills/formula-scaling/scripts/beverage.py
python3 agent/beverage/skills/formula-scaling/scripts/beverage.py --help | grep batch
```
Expected: the four `batch-*` commands listed, no syntax error.

- [ ] **Step 4: Document the commands in SKILL.md**

Add to the tool-surface section of `SKILL.md`, in the existing voice:

```markdown
`batch-open` starts a batch against an approved formula version and returns its
id. `batch-input` records one thing bought for it — item, quantity, unit, amount
paid — and takes `--source`/`--record-key` when the price came from the
inventory sheet.

A yield is NEVER stored in one step. `batch-yield-preview` reads the number back
and returns a six-character token; she says it; only then does `batch-yield`
store it, passing the SAME value and unit plus `--fingerprint`. If a digit moved
in between, the server refuses. Every cost divides by this number, so a misheard
yield is wrong money on every bottle forever.

Phase 1 stores. It does not cost anything yet — there is no cost command, and
you must not compute one in prose.
```

- [ ] **Step 5: Deploy to the live profile and smoke test**

The repo copy and the live profile copy are separate real files kept identical
(see `agent/beverage/README.md`).

```bash
cp ~/GitHub/mtl-craft-training-agent/agent/beverage/skills/formula-scaling/scripts/beverage.py \
   ~/.hermes/profiles/beverage/skills/beverage/formula-scaling/scripts/beverage.py
cp ~/GitHub/mtl-craft-training-agent/agent/beverage/skills/formula-scaling/SKILL.md \
   ~/.hermes/profiles/beverage/skills/beverage/formula-scaling/SKILL.md

# Prove it from the gateway's own environment, with NO token exported:
env -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/local/bin" \
    HERMES_HOME="$HOME/.hermes/profiles/beverage" \
    python3 ~/.hermes/profiles/beverage/skills/beverage/formula-scaling/scripts/beverage.py --help \
    | grep batch
```
Expected: the four commands listed. The `env -i` form is the one that matters —
it is how launchd runs the gateway, and it is precisely what was broken on
2026-09-15.

- [ ] **Step 6: Commit**

```bash
git add agent/beverage/skills/formula-scaling/scripts/beverage.py \
        agent/beverage/skills/formula-scaling/SKILL.md
git commit -m "feat(brix): batch-open, batch-input and read-back yield commands"
```

---

## Done when

- `npx vitest run` is green and `npm run check` is clean
- A batch can be opened, an input recorded and a yield stored through the agent
  script against the real API
- A yield whose digits changed since preview is REFUSED, not stored
- No migration was applied; `db/migrations` still tops out at 129

## Not in this plan

Costing, `packaging_skus`, `batch_bottlings`, migration 130 and
`server/batchCosting.ts`. Those are Phase 2 and get their own plan once this one
is in use.
