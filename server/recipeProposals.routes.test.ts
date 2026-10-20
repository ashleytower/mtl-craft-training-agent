import { describe, expect, it, vi, beforeEach } from "vitest";

// Ashley 2026-10-20: "I don't want to have to approve". A recipe she sends Brix
// is saved and approved in one call; there is no read-back token to say back.

const listApprovedFormulas = vi.fn();
const listCrmRecipes = vi.fn();
const ingestFormulaDrafts = vi.fn();
const listFormulaDrafts = vi.fn();
const createFormulaVersion = vi.fn();
const approveFormulaVersion = vi.fn();

vi.mock("./beverageClient", () => ({
  listApprovedFormulas: (...a: unknown[]) => listApprovedFormulas(...a),
  listCrmRecipes: (...a: unknown[]) => listCrmRecipes(...a),
  ingestFormulaDrafts: (...a: unknown[]) => ingestFormulaDrafts(...a),
  listFormulaDrafts: (...a: unknown[]) => listFormulaDrafts(...a),
  createFormulaVersion: (...a: unknown[]) => createFormulaVersion(...a),
  approveFormulaVersion: (...a: unknown[]) => approveFormulaVersion(...a),
}));

vi.mock("./_core/hermesService", () => ({
  hermesIdentityFromRequest: (req: { headers: Record<string, string> }) =>
    req.headers["x-hermes-service-token"] ? { subject: "brix" } : null,
}));

const OWNER = { subject: "ashley", email: null, displayName: "Ashley", origin: "browser" };
vi.mock("./ownerDecisions", () => ({ ownerForDecision: () => OWNER }));

import { registerRecipeProposalRoutes } from "./recipeProposals";

function harness() {
  const table = new Map<string, Function>();
  const app = {
    get: (p: string, h: Function) => table.set(`GET ${p}`, h),
    post: (p: string, h: Function) => table.set(`POST ${p}`, h),
  };
  registerRecipeProposalRoutes(app as never);
  const call = async (path: string, body: unknown, authed = true) => {
    const handler = table.get(`POST ${path}`);
    if (!handler) throw new Error(`no route POST ${path}`);
    let status = 200;
    let payload: unknown;
    const res = {
      status(code: number) { status = code; return this; },
      json(p: unknown) { payload = p; return this; },
    };
    await handler({ body, headers: authed ? { "x-hermes-service-token": "t" } : {} }, res);
    return { status, body: payload as Record<string, unknown> };
  };
  return { table, call };
}

const lemonDrop = {
  name: "Lemon Drop Jelly Shot",
  product_category: "cocktail",
  items: [
    { ingredient_name: "Gelatin sheets", quantity: "6", unit: "unit" },
    { ingredient_name: "Vodka", quantity: "120", unit: "ml" },
    { ingredient_name: "Lemon juice", quantity: "60", unit: "ml" },
  ],
  method: "Bloom the gelatin, warm, add the rest, set overnight.",
};

beforeEach(() => {
  listApprovedFormulas.mockReset().mockResolvedValue([]);
  listCrmRecipes.mockReset().mockResolvedValue([]);
  createFormulaVersion.mockReset().mockResolvedValue({ id: "v1", version_number: 1 });
  approveFormulaVersion.mockReset().mockResolvedValue({});
  // Whatever was ingested is what the list reads back.
  let stored: unknown[] = [];
  ingestFormulaDrafts.mockReset().mockImplementation(async (_o, payload: { drafts: Array<Record<string, unknown>> }) => {
    stored = payload.drafts.map(d => ({ id: "draft-1", ...d }));
    return {};
  });
  listFormulaDrafts.mockReset().mockImplementation(async () => stored);
});

describe("POST /api/hermes/recipe/save", () => {
  it("saves and approves a recipe in one call, with no token to say back", async () => {
    listApprovedFormulas
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ formula_key: "lemon-drop-jelly-shot", components: [{}, {}, {}] }]);
    const r = await harness().call("/api/hermes/recipe/save", lemonDrop);

    expect(r.status).toBe(200);
    expect(r.body.approved).toBe(true);
    expect(r.body.formula_key).toBe("lemon-drop-jelly-shot");
    expect(r.body.scalable).toBe(true);
    expect(createFormulaVersion).toHaveBeenCalledTimes(1);
    expect(approveFormulaVersion).toHaveBeenCalledTimes(1);
    expect(approveFormulaVersion.mock.calls[0][0]).toBe(OWNER);
    expect(String(approveFormulaVersion.mock.calls[0][1].rationale)).toMatch(/sent this to Brix/);
  });

  it("returns every saved line so Brix can show her what went in", async () => {
    const r = await harness().call("/api/hermes/recipe/save", lemonDrop);
    const saved = String(r.body.saved);
    expect(saved).toContain("Gelatin sheets — 6 unit");
    expect(saved).toContain("Vodka — 120 ml");
    expect(saved).toContain("Lemon juice — 60 ml");
    expect(saved).not.toMatch(/confirm/i);
  });

  it("requires the service token", async () => {
    const r = await harness().call("/api/hermes/recipe/save", lemonDrop, false);
    expect(r.status).toBe(401);
    expect(ingestFormulaDrafts).not.toHaveBeenCalled();
  });

  it("refuses a line with no measurable unit and writes nothing", async () => {
    const r = await harness().call("/api/hermes/recipe/save", {
      ...lemonDrop,
      items: [{ ingredient_name: "Vodka", quantity: "4", unit: "oz" }],
    });
    expect(r.status).toBe(400);
    expect(ingestFormulaDrafts).not.toHaveBeenCalled();
    expect(approveFormulaVersion).not.toHaveBeenCalled();
  });

  it("refuses a name that is already approved and writes nothing", async () => {
    listApprovedFormulas.mockResolvedValue([{ formula_key: "lemon-drop-jelly-shot" }]);
    const r = await harness().call("/api/hermes/recipe/save", lemonDrop);
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toMatch(/already has an approved formula/);
    expect(ingestFormulaDrafts).not.toHaveBeenCalled();
  });

  it("leaves no preview or confirm route behind", () => {
    const { table } = harness();
    expect([...table.keys()]).toEqual(["POST /api/hermes/recipe/save"]);
  });
});
