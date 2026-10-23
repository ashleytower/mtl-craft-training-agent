import { describe, expect, it, vi, beforeEach } from "vitest";

// Ashley 2026-10-22: "this is your syrup recipe ... try this amount". Read-only:
// the route resolves two approved recipes and calls swapSugar. It writes nothing.

const { listApprovedFormulas, writers } = vi.hoisted(() => ({
  listApprovedFormulas: vi.fn(),
  writers: {
    openProductionBatch: vi.fn(), recordBatchInput: vi.fn(), recordMeasuredYield: vi.fn(),
    recordResearchCandidates: vi.fn(), decideResearchCandidate: vi.fn(), recordCalculationPlan: vi.fn(),
  },
}));

vi.mock("./beverageClient", () => ({
  ...writers,
  listApprovedFormulas: (...a: unknown[]) => listApprovedFormulas(...a),
  listFormulaDrafts: vi.fn(),
  searchKnowledge: vi.fn(),
  knowledgeCoverage: vi.fn(),
  listResearchCandidates: vi.fn(),
}));

vi.mock("./_core/hermesService", () => ({
  hermesIdentityFromRequest: (req: { headers: Record<string, string> }) =>
    req.headers["x-hermes-service-token"] ? { subject: "brix" } : null,
}));

import { registerHermesRoutes } from "./hermesRoutes";

function harness() {
  const table = new Map<string, Function>();
  const app = {
    get: (p: string, h: Function) => table.set(`GET ${p}`, h),
    post: (p: string, h: Function) => table.set(`POST ${p}`, h),
  };
  registerHermesRoutes(app as never);
  return async (body: unknown, authed = true) => {
    const handler = table.get("POST /api/hermes/recipe/swap-sugar");
    if (!handler) throw new Error("no swap-sugar route");
    let status = 200;
    let payload: unknown;
    const res = {
      status(code: number) { status = code; return this; },
      json(p: unknown) { payload = p; return this; },
    };
    await handler({ body, headers: authed ? { "x-hermes-service-token": "t" } : {} }, res);
    return { status, body: payload as Record<string, any> };
  };
}

function approved(id: string, name: string, lines: Array<[string, string, string]>) {
  return {
    id, name, version_number: 1, product_category: null,
    intended_yield_value: null, intended_yield_unit: null, process_json: null,
    components: lines.map(([ingredient_name, quantity, unit], i) => ({
      line_number: i + 1, ingredient_name, quantity, unit,
    })),
  };
}

const CANVAS = approved("j1", "Blank Practice Canvas (6-inch Round)", [
  ["Water", "348", "gr"], ["Sugar", "122", "gr"], ["Gelatin", "21", "gr"],
]);
const MULE = approved("j2", "Moscow Mule Jelly (6-inch Round)", [
  ["Water (lime-vodka layer)", "80", "gr"], ["Sugar (lime-vodka layer)", "118", "gr"],
  ["Sugar (ginger beer layer)", "18", "gr"],
]);
const SIMPLE = approved("s1", "Simple Syrup", [["Sugar", "6000", "gr"], ["Water", "6000", "ml"]]);
const MANGO = approved("s2", "Mango Syrup", [
  ["Mango Juice", "1000", "ml"], ["Sugar", "1000", "gr"], ["Water", "1000", "ml"],
]);

beforeEach(() => {
  listApprovedFormulas.mockReset().mockResolvedValue([CANVAS, MULE, SIMPLE, MANGO]);
  Object.values(writers).forEach(w => w.mockReset());
});

describe("POST /api/hermes/recipe/swap-sugar", () => {
  it("requires the service token", async () => {
    expect((await harness()({ jelly: "x", syrup: "y" }, false)).status).toBe(401);
  });

  it("requires both names", async () => {
    const r = await harness()({ jelly: "Blank Practice Canvas (6-inch Round)" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/syrup/);
  });

  it("names the approved recipes when one is not found", async () => {
    const r = await harness()({ jelly: "Spicy Mango Jelly", syrup: "Simple Syrup" });
    expect(r.status).toBe(404);
    expect(r.body.approved_names).toContain("Blank Practice Canvas (6-inch Round)");
  });

  it("gives the syrup amount and writes nothing", async () => {
    const r = await harness()({ jelly: "blank practice canvas (6-inch round)", syrup: "Simple Syrup" });
    expect(r.status).toBe(200);
    expect(r.body.syrup_g.exact).toBe("244");
    expect(r.body.added_besides_sugar_g.exact).toBe("122");
    expect(r.body.lines).toContainEqual({ ingredient_name: "Simple Syrup", quantity: "244", unit: "gr" });
    Object.values(writers).forEach(w => expect(w).not.toHaveBeenCalled());
  });

  it("refuses a syrup with juice in ml, naming the line", async () => {
    const r = await harness()({ jelly: "j1", syrup: "Mango Syrup" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Mango Juice 1000 ml/);
  });

  it("asks which sugar line on a layered jelly, then uses the one named", async () => {
    const ask = await harness()({ jelly: "j2", syrup: "s1" });
    expect(ask.status).toBe(409);
    expect(ask.body.error).toMatch(/Sugar \(ginger beer layer\)/);
    const r = await harness()({ jelly: "j2", syrup: "s1", sugar_line: "Sugar (ginger beer layer)" });
    expect(r.status).toBe(200);
    expect(r.body.syrup_g.exact).toBe("36");
  });
});
