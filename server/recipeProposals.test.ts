import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  confirmToken, draftFor, formulaKey, parseSpec, renderReadback, specFingerprint,
  type RecipeSpec,
} from "./recipeProposals";
import { resolveDraftIngredients } from "../shared/ingredients";

const source = readFileSync(resolve(__dirname, "recipeProposals.ts"), "utf8");

const spec = (over: Partial<RecipeSpec> = {}): RecipeSpec => ({
  name: "Saline Solution",
  product_category: "syrup_or_related_product",
  items: [
    { ingredient_name: "Salt", quantity: "200", unit: "gr", role: "ingredient" },
    { ingredient_name: "Water", quantity: "800", unit: "ml", role: "ingredient" },
  ],
  method: "Mix until it dissolves.",
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  name: "Saline Solution",
  product_category: "syrup_or_related_product",
  items: [{ ingredient_name: "Salt", quantity: "200", unit: "gr" }],
  ...over,
});

describe("a dictated recipe must be measurable before it is anything", () => {
  it("accepts a well formed spec", () => {
    const { spec: s, error } = parseSpec(body());
    expect(error).toBeNull();
    expect(s?.items[0]).toEqual({
      ingredient_name: "Salt", quantity: "200", unit: "gr", role: "ingredient",
    });
  });

  it("refuses a recipe with no name, no category, or no ingredients", () => {
    expect(parseSpec(body({ name: "  " })).error).toMatch(/needs a name/);
    expect(parseSpec(body({ product_category: "potion" })).error).toMatch(/product_category/);
    expect(parseSpec(body({ items: [] })).error).toMatch(/at least one ingredient/);
  });

  // Every one of these is a line somebody would have to measure at the bar.
  it("refuses a quantity that is missing, not a number, or not positive", () => {
    expect(parseSpec(body({ items: [{ ingredient_name: "Salt", unit: "gr" }] })).error)
      .toMatch(/no quantity/);
    expect(parseSpec(body({ items: [{ ingredient_name: "Salt", quantity: "some", unit: "gr" }] })).error)
      .toMatch(/not a number/);
    expect(parseSpec(body({ items: [{ ingredient_name: "Salt", quantity: "0", unit: "gr" }] })).error)
      .toMatch(/quantity of 0/);
  });

  it("refuses a unit the scaler cannot reason about", () => {
    expect(parseSpec(body({ items: [{ ingredient_name: "Salt", quantity: "2", unit: "cups" }] })).error)
      .toMatch(/not one of gr, ml, unit/);
    expect(parseSpec(body({ items: [{ ingredient_name: "Salt", quantity: "2" }] })).error)
      .toMatch(/not one of gr, ml, unit/);
  });

  it("refuses a list longer than a recipe", () => {
    const items = Array.from({ length: 41 }, (_, i) => ({
      ingredient_name: `x${i}`, quantity: "1", unit: "gr",
    }));
    expect(parseSpec(body({ items })).error).toMatch(/at most 40/);
  });
});

describe("her confirmation is bound to the bytes she was read", () => {
  it("changes when any measurable thing changes", () => {
    const base = specFingerprint(spec());
    expect(specFingerprint(spec({ name: "Saline Solution 2" }))).not.toBe(base);
    expect(specFingerprint(spec({ method: "Something else." }))).not.toBe(base);
    expect(specFingerprint(spec({
      items: [
        { ingredient_name: "Salt", quantity: "201", unit: "gr", role: "ingredient" },
        { ingredient_name: "Water", quantity: "800", unit: "ml", role: "ingredient" },
      ],
    }))).not.toBe(base);
  });

  // The agent echoes the spec back; harmless drift in how it echoes must not
  // read as a different recipe, or she could never confirm anything.
  it("survives whitespace and casing drift in the echo", () => {
    expect(specFingerprint(spec({ name: "  saline solution  " }))).toBe(specFingerprint(spec()));
  });

  // Line order IS part of a recipe.
  it("changes when the lines are reordered", () => {
    const flipped = spec({ items: [spec().items[1], spec().items[0]] });
    expect(specFingerprint(flipped)).not.toBe(specFingerprint(spec()));
  });

  it("is what she says out loud", () => {
    expect(confirmToken(spec())).toBe(specFingerprint(spec()).slice(0, 6));
    expect(renderReadback(spec())).toContain(`confirm ${confirmToken(spec())}`);
  });

  // The point of the step: she is read the whole component list, not a summary.
  it("reads back every line and the method", () => {
    const text = renderReadback(spec());
    expect(text).toContain("Salt — 200 gr");
    expect(text).toContain("Water — 800 ml");
    expect(text).toContain("Mix until it dissolves.");
  });
});

describe("what gets written can be read by the thing that reads it", () => {
  // The 56-syrup bug: the writer used {name, quantity, unit} and every reader
  // wanted {ingredient_name, quantity_normalized, unit_name}. 36 unit tests
  // passed and not one stored recipe could be opened. This runs the REAL reader
  // over the REAL draft shape rather than asserting on the writer's own output.
  it("resolves through resolveDraftIngredients", () => {
    const s = spec();
    const draft = draftFor(s, specFingerprint(s));
    const resolved = resolveDraftIngredients(draft as never, []);
    expect(resolved.blocked).toBeFalsy();
    expect(resolved.items.map(i => [i.name, i.quantity, i.unit])).toEqual([
      ["Salt", "200", "gr"],
      ["Water", "800", "ml"],
    ]);
  });

  it("carries the method where the versioning RPC actually looks for it", () => {
    const s = spec();
    expect(draftFor(s, "x").original_recipe_json.method_source_text).toBe("Mix until it dissolves.");
  });

  // Re-confirming the same recipe must update one draft, not accumulate copies.
  it("hashes its source identity from the name, so a re-run is the same row", () => {
    const a = draftFor(spec(), "aaaa");
    const b = draftFor(spec({ method: "different" }), "bbbb");
    expect(a.original_source_hash).toBe(b.original_source_hash);
    expect(a.external_recipe_id).toBe("brix-dictated:saline-solution");
  });

  it("gives each recipe its own formula key", () => {
    expect(formulaKey("Saline Solution")).toBe("saline-solution");
    expect(formulaKey("Lemon Citric Acid")).not.toBe(formulaKey("Citric Acid Solution"));
  });
});

describe("the blast radius of this file", () => {
  // The owner subject IS the authorisation. A body-supplied one would let
  // anything reaching the route name itself owner.
  it("reads the owner from the server env and never from the request", () => {
    expect(source).toMatch(/ownerForDecision\(\)/);
    expect(source).not.toMatch(/req\.body[^\n]*subject/i);
    expect(source).not.toMatch(/body\.owner/i);
  });

  // Migration 127 makes approval supersede every other version under the key.
  it("refuses a formula key that is already approved", () => {
    expect(source).toMatch(/already has an approved formula/);
  });

  it("refuses to overrule the CRM on a cocktail", () => {
    expect(source).toMatch(/CRM is authoritative/);
  });

  it("reaches no payment, messaging, CRM writer or batch release", () => {
    for (const forbidden of [
      /stripe/i, /sendEmail/i, /sendSms/i, /twilio/i, /releaseBatch/i, /createQuote/i, /createInvoice/i,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });
});
