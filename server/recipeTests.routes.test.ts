import { describe, expect, it, vi, beforeEach } from "vitest";

// Ashley 2026-10-22: "spicy mango jelly recipe October 20 then I can say I made
// another one October 30 if I changed anything" ... "saved next to the old one in
// case I don't like the change ... then when I say OK this is a confirmed recipe."

const listApprovedFormulas = vi.fn();
const listCrmRecipes = vi.fn();
const ingestFormulaDrafts = vi.fn();
const listFormulaDrafts = vi.fn();
const createFormulaVersion = vi.fn();
const approveFormulaVersion = vi.fn();
const openRecipeTest = vi.fn();
const recordRecipeTasting = vi.fn();
const listRecipeTests = vi.fn();

vi.mock("./beverageClient", () => ({
  listApprovedFormulas: (...a: unknown[]) => listApprovedFormulas(...a),
  listCrmRecipes: (...a: unknown[]) => listCrmRecipes(...a),
  ingestFormulaDrafts: (...a: unknown[]) => ingestFormulaDrafts(...a),
  listFormulaDrafts: (...a: unknown[]) => listFormulaDrafts(...a),
  createFormulaVersion: (...a: unknown[]) => createFormulaVersion(...a),
  approveFormulaVersion: (...a: unknown[]) => approveFormulaVersion(...a),
  openRecipeTest: (...a: unknown[]) => openRecipeTest(...a),
  recordRecipeTasting: (...a: unknown[]) => recordRecipeTasting(...a),
  listRecipeTests: (...a: unknown[]) => listRecipeTests(...a),
}));

vi.mock("./_core/hermesService", () => ({
  hermesIdentityFromRequest: (req: { headers: Record<string, string> }) =>
    req.headers["x-hermes-service-token"] ? { subject: "brix" } : null,
}));

const OWNER = { subject: "ashley", email: null, displayName: "Ashley", origin: "browser" };
vi.mock("./ownerDecisions", () => ({ ownerForDecision: () => OWNER }));

import { registerRecipeTestRoutes } from "./recipeTests";

function harness() {
  const table = new Map<string, Function>();
  const app = {
    get: (p: string, h: Function) => table.set(`GET ${p}`, h),
    post: (p: string, h: Function) => table.set(`POST ${p}`, h),
  };
  registerRecipeTestRoutes(app as never);
  return async (path: string, body: unknown, authed = true) => {
    const handler = table.get(`POST ${path}`);
    if (!handler) throw new Error(`no route POST ${path}`);
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

const mangoLines = [
  { ingredient_name: "Mango puree", quantity: "200", unit: "gr" },
  { ingredient_name: "Sugar", quantity: "90", unit: "gr" },
  { ingredient_name: "Silver gelatin sheets", quantity: "20", unit: "gr" },
];

// A tiny in-memory beverage service: approved formulas and tests.
let approved: Array<Record<string, any>>;
let tests: Array<Record<string, any>>;

beforeEach(() => {
  approved = [];
  tests = [];
  let n = 0;
  let stored: unknown[] = [];
  listApprovedFormulas.mockReset().mockImplementation(async () => approved);
  listCrmRecipes.mockReset().mockResolvedValue([]);
  ingestFormulaDrafts.mockReset().mockImplementation(async (_o, p: { drafts: Array<Record<string, unknown>> }) => {
    stored = p.drafts.map(d => ({ id: `draft-${d.name}`, ...d }));
    return {};
  });
  listFormulaDrafts.mockReset().mockImplementation(async () => stored);
  createFormulaVersion.mockReset().mockImplementation(async (_o, v: Record<string, any>) => {
    n += 1;
    const prior = approved.filter(a => a.formula_key === v.formulaKey).length;
    const row = {
      id: `v${n}`, formula_key: v.formulaKey, name: v.name, version_number: prior + 1,
      product_category: (stored[0] as any)?.product_category,
      process_json: { source: "notion_draft", steps: [], raw: (stored[0] as any)?.original_recipe_json?.method_source_text ?? null },
      components: v.components,
    };
    (createFormulaVersion as any).last = row;
    return row;
  });
  approveFormulaVersion.mockReset().mockImplementation(async (_o, a: { formulaVersionId: string }) => {
    const row = (createFormulaVersion as any).last;
    // migration 127: approving supersedes every other approved version of the key
    approved = approved.filter(x => x.formula_key !== row.formula_key).concat([row]);
    return {};
  });
  openRecipeTest.mockReset().mockImplementation(async (_o, t: Record<string, any>) => {
    const row = { test_id: `t${tests.length + 1}`, family: t.family, change: t.change, made_on: t.madeOn,
                  formula_version_id: t.formulaVersionId, tastings: [] };
    tests.push(row);
    return { test_id: row.test_id, made_on: row.made_on };
  });
  recordRecipeTasting.mockReset().mockImplementation(async (_o, t: { testId: string; notes: string }) => {
    tests.find(x => x.test_id === t.testId)!.tastings.push({ notes: t.notes, at: "now" });
    return { tasting_id: "r1", test_id: t.testId };
  });
  listRecipeTests.mockReset().mockImplementation(async (_o, family: string) =>
    tests.filter(t => t.family.toLowerCase() === family.trim().toLowerCase()));
});

const test1 = {
  family: "Spicy Mango Jelly", made_on: "2026-10-20", change: "first test",
  product_category: "jelly", items: mangoLines, method: "Bloom, warm, set.",
};

describe("POST /api/hermes/recipe/test", () => {
  it("saves the lines as '<family> - test <date>' next to the others and logs the test with its date", async () => {
    const call = harness();
    const r = await call("/api/hermes/recipe/test", test1);
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("Spicy Mango Jelly - test 2026-10-20");
    expect(r.body.made_on).toBe("2026-10-20");
    expect(openRecipeTest).toHaveBeenCalledWith(OWNER, expect.objectContaining({
      family: "Spicy Mango Jelly", change: "first test", madeOn: "2026-10-20", formulaVersionId: "v1",
    }));
    // the confirmed recipe is not touched by a test
    expect(approved.map(a => a.name)).toEqual(["Spicy Mango Jelly - test 2026-10-20"]);
  });

  it("refuses a missing or impossible date instead of defaulting to today", async () => {
    const call = harness();
    for (const made_on of [undefined, "", "Oct 20", "2026-02-30"]) {
      const r = await call("/api/hermes/recipe/test", { ...test1, made_on });
      expect(r.status).toBe(400);
    }
    expect(openRecipeTest).not.toHaveBeenCalled();
    expect(createFormulaVersion).not.toHaveBeenCalled();
  });

  it("refuses a second test on the same day for the same recipe (name already saved)", async () => {
    const call = harness();
    await call("/api/hermes/recipe/test", test1);
    const r = await call("/api/hermes/recipe/test", test1);
    expect(r.status).toBe(409);
    expect(openRecipeTest).toHaveBeenCalledTimes(1);
  });

  it("needs the service token", async () => {
    const r = await harness()("/api/hermes/recipe/test", test1, false);
    expect(r.status).toBe(401);
  });
});

describe("POST /api/hermes/recipe/taste", () => {
  it("stores her words verbatim on the test made that day", async () => {
    const call = harness();
    await call("/api/hermes/recipe/test", test1);
    const r = await call("/api/hermes/recipe/taste", {
      family: "spicy mango jelly", made_on: "2026-10-20", notes: "  Too sweet, not spicy enough  ",
    });
    expect(r.status).toBe(200);
    expect(recordRecipeTasting).toHaveBeenCalledWith(OWNER, { testId: "t1", notes: "  Too sweet, not spicy enough  " });
  });

  it("says which dates exist when there is no test that day", async () => {
    const call = harness();
    await call("/api/hermes/recipe/test", test1);
    const r = await call("/api/hermes/recipe/taste", { family: "Spicy Mango Jelly", made_on: "2026-10-21", notes: "ok" });
    expect(r.status).toBe(404);
    expect(r.body.test_dates).toEqual(["2026-10-20"]);
    expect(recordRecipeTasting).not.toHaveBeenCalled();
  });

  it("refuses blank notes", async () => {
    const call = harness();
    await call("/api/hermes/recipe/test", test1);
    const r = await call("/api/hermes/recipe/taste", { family: "Spicy Mango Jelly", made_on: "2026-10-20", notes: "  " });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/hermes/recipe/confirm and /tests", () => {
  const test2 = {
    ...test1, made_on: "2026-10-30", change: "less sugar",
    items: [mangoLines[0], { ingredient_name: "Sugar", quantity: "70", unit: "gr" }, mangoLines[2]],
  };

  it("confirming a test makes it the recipe under the family name; confirming another replaces it; tests stay", async () => {
    const call = harness();
    await call("/api/hermes/recipe/test", test1);
    await call("/api/hermes/recipe/test", test2);

    const c1 = await call("/api/hermes/recipe/confirm", { family: "Spicy Mango Jelly", made_on: "2026-10-30" });
    expect(c1.status).toBe(200);
    expect(c1.body.name).toBe("Spicy Mango Jelly");
    let confirmed = approved.find(a => a.name === "Spicy Mango Jelly")!;
    expect(confirmed.components.map((c: any) => [c.ingredient_name, c.quantity, c.unit]))
      .toEqual([["Mango puree", "200", "gr"], ["Sugar", "70", "gr"], ["Silver gelatin sheets", "20", "gr"]]);

    // She didn't like it: go back to the Oct 20 test.
    const c2 = await call("/api/hermes/recipe/confirm", { family: "Spicy Mango Jelly", made_on: "2026-10-20" });
    expect(c2.status).toBe(200);
    confirmed = approved.find(a => a.name === "Spicy Mango Jelly")!;
    expect(confirmed.components[1].quantity).toBe("90");
    expect(approved.filter(a => a.name === "Spicy Mango Jelly")).toHaveLength(1);
    // both tests are still saved
    expect(approved.map(a => a.name).sort()).toEqual([
      "Spicy Mango Jelly", "Spicy Mango Jelly - test 2026-10-20", "Spicy Mango Jelly - test 2026-10-30",
    ]);

    const h = await call("/api/hermes/recipe/tests", { family: "Spicy Mango Jelly" });
    expect(h.status).toBe(200);
    expect(h.body.tests.map((t: any) => [t.made_on, t.change, t.is_confirmed])).toEqual([
      ["2026-10-20", "first test", true],
      ["2026-10-30", "less sugar", false],
    ]);
    expect(h.body.tests[1].lines).toEqual([
      "Mango puree 200 gr", "Sugar 70 gr", "Silver gelatin sheets 20 gr",
    ]);
    expect(h.body.confirmed.name).toBe("Spicy Mango Jelly");
  });

  it("a cocktail the CRM owns cannot be confirmed here", async () => {
    const call = harness();
    await call("/api/hermes/recipe/test", { ...test1, family: "Margarita", product_category: "cocktail" });
    listCrmRecipes.mockResolvedValue([{ name: "Margarita" }]);
    const r = await call("/api/hermes/recipe/confirm", { family: "Margarita", made_on: "2026-10-20" });
    expect(r.status).toBe(409);
    expect(approved.some(a => a.name === "Margarita")).toBe(false);
  });

  it("tests for a recipe with none says so plainly", async () => {
    const r = await harness()("/api/hermes/recipe/tests", { family: "Nope" });
    expect(r.status).toBe(200);
    expect(r.body.tests).toEqual([]);
    expect(r.body.confirmed).toBeNull();
  });
});

// A grant, not a deny list: any new beverage call here fails until it is argued for.
describe("what the recipe test routes may call", () => {
  it("reads formulas and tests, writes tests and tastings, and approves only through saveApproved", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "recipeTests.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const calls = [...new Set([...src.matchAll(/\bbeverage\.([A-Za-z]+)\s*\(/g)].map(m => m[1]))].sort();
    expect(calls).toEqual(["listApprovedFormulas", "listRecipeTests", "openRecipeTest", "recordRecipeTasting"]);
    expect(src).not.toMatch(/approveFormulaVersion|createFormulaVersion|ingestFormulaDrafts/);
  });
});
