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
  const register = (routes as Record<string, unknown>).registerHermesRoutes;
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

  it("requires made_on", async () => {
    const r = await harness()("POST", "/api/hermes/batch/open", {
      formula_version_id: "v1", batch_label: "Hibiscus 2026-09-15",
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/made_on/);
  });

  it("opens the batch and returns its id", async () => {
    const r = await harness()("POST", "/api/hermes/batch/open", {
      formula_version_id: "v1", batch_label: "Hibiscus 2026-09-15", made_on: "2026-09-15",
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
