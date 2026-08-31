/**
 * The whole cocktail path, on synthetic fixtures: free-text draft -> resolved
 * ingredients -> the components a version would be built from -> exact scaling,
 * with the preparation method carried alongside.
 *
 * Synthetic on purpose. These fixtures are shaped like the Notion corpus but own
 * their values, so a test failing here means the code changed, not that someone
 * edited a recipe in Notion.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveDraftIngredients,
  type CatalogEntry,
  type DraftResolution,
} from "@shared/ingredients";
import { methodForAgent, parseMethodDraft } from "@shared/method";
import { scaleFormula, type NormalizedFormula } from "./beverageScaling";

const CATALOG: CatalogEntry[] = [
  { key: "house-lime-cordial", name: "House Lime Cordial", kind: "approved_formula" },
  { key: "spiced-syrup-a", name: "Spiced Syrup", kind: "approved_formula" },
  { key: "spiced-syrup-b", name: "Spiced Syrup", kind: "approved_formula" },
  { key: null, name: "Sugar", kind: "known_ingredient" },
];

/** A cocktail written the way the one measured recipe in the corpus is written. */
const MEASURED_COCKTAIL = {
  product_category: "cocktail",
  original_recipe_json: {
    ingredients_source_text_english: [
      "60 ml white rum",
      "• 30 ml House Lime Cordial",
      "• 3/4 ml saline",
      "• Garnish: lime wheel",
    ].join("\n"),
    method_source_text:
      "SHAKE all ingredients with ice for 15 seconds.\nDouble strain into a coupe.GARNISH.",
  },
};

/** A cocktail written the way the other forty-nine are written. */
const NAMES_ONLY_COCKTAIL = {
  product_category: "cocktail",
  original_recipe_json: {
    ingredients_source_text_english: "Mint, Lime, Rum, Soda",
    method_source_text: "MUDDLE the mint. ADD everything else. GARNISH.",
  },
};

/** What `beverage_create_formula_version` would build from a resolution. */
function toFormula(name: string, resolution: DraftResolution): NormalizedFormula {
  const components = resolution.items
    .filter(item => item.role === "ingredient")
    .map((item, index) => {
      if (item.quantity === null || !item.unit) {
        throw new Error(
          `${item.name} has no quantity — the database would reject this component`
        );
      }
      return {
        lineNumber: index + 1,
        ingredientName: item.name,
        quantity: item.quantity,
        unit: item.unit,
      };
    });
  return {
    formulaVersionId: "00000000-0000-0000-0000-000000000000",
    name,
    intendedYieldValue: null,
    intendedYieldUnit: null,
    components,
  };
}

describe("cocktail flow — a measured recipe reaches an exact scale", () => {
  const resolution = resolveDraftIngredients(MEASURED_COCKTAIL, CATALOG);

  it("resolves every measured ingredient and does not block", () => {
    expect(resolution.source).toBe("free_text");
    expect(resolution.blocked).toBe(false);
    expect(
      resolution.items.filter(i => i.role === "ingredient").map(i => [i.name, i.quantity, i.unit])
    ).toEqual([
      ["white rum", "60", "ml"],
      ["House Lime Cordial", "30", "ml"],
      ["saline", "0.75", "ml"],
    ]);
  });

  it("links the one ingredient that names an approved formula", () => {
    const cordial = resolution.items.find(i => i.name === "House Lime Cordial");
    expect(cordial?.catalogKey).toBe("house-lime-cordial");
  });

  it("scales exactly, keeping the fraction rather than a rounded decimal", () => {
    const formula = toFormula("Synthetic Daiquiri", resolution);
    const result = scaleFormula(formula, { mode: "multiplier", multiplier: "7" });

    const saline = result.components.find(c => c.ingredientName === "saline");
    // 0.75 * 7 = 5.25 exactly.
    expect(saline?.scaledQuantity).toBe("5.25");
    expect(saline?.scaledQuantityIsExact).toBe(true);

    const rum = result.components.find(c => c.ingredientName === "white rum");
    expect(rum?.scaledQuantity).toBe("420");
  });

  it("scales to a limiting ingredient without converting units", () => {
    const formula = toFormula("Synthetic Daiquiri", resolution);
    const result = scaleFormula(formula, {
      mode: "limitingIngredient",
      ingredientName: "white rum",
      availableQuantity: "90",
      unit: "ml",
    });
    // 90/60 = 3/2, so the cordial goes 30 -> 45.
    expect(result.factor.exact).toBe("3/2");
    expect(
      result.components.find(c => c.ingredientName === "House Lime Cordial")?.scaledQuantity
    ).toBe("45");
  });

  it("refuses a limiting ingredient given in a different dimension", () => {
    const formula = toFormula("Synthetic Daiquiri", resolution);
    expect(() =>
      scaleFormula(formula, {
        mode: "limitingIngredient",
        ingredientName: "white rum",
        availableQuantity: "90",
        unit: "gr",
      })
    ).toThrow();
  });

  it("carries the preparation method alongside, parsed into steps", () => {
    const steps = parseMethodDraft(
      MEASURED_COCKTAIL.original_recipe_json.method_source_text
    );
    // "coupe.GARNISH." has no space after the period and still splits.
    expect(steps.map(s => s.text)).toEqual([
      "SHAKE all ingredients with ice for 15 seconds.",
      "Double strain into a coupe.",
      "GARNISH.",
    ]);

    const stored = { source: "operator" as const, steps, raw: null };
    const forAgent = methodForAgent(stored);
    expect(forAgent.recorded).toBe(true);
    expect(forAgent.reviewed).toBe(true);
    expect(forAgent.steps[0]).toBe("1. SHAKE all ingredients with ice for 15 seconds.");
  });

  it("keeps the garnish out of the scaled components", () => {
    const formula = toFormula("Synthetic Daiquiri", resolution);
    expect(formula.components.map(c => c.ingredientName)).not.toContain("lime wheel");
  });
});

describe("cocktail flow — a names-only recipe stops, visibly", () => {
  const resolution = resolveDraftIngredients(NAMES_ONLY_COCKTAIL, CATALOG);

  it("names every ingredient so nobody retypes them", () => {
    expect(resolution.items.map(i => i.name)).toEqual(["Mint", "Lime", "Rum", "Soda"]);
  });

  it("blocks, and the reason names the count rather than saying 'unresolved'", () => {
    expect(resolution.blocked).toBe(true);
    expect(resolution.blockedReason).toContain("4 of 4");
  });

  it("cannot be turned into components — the database would reject it", () => {
    expect(() => toFormula("Synthetic Mojito", resolution)).toThrow(/no quantity/);
  });

  it("still carries its method, because method and quantity are independent", () => {
    const steps = parseMethodDraft(
      NAMES_ONLY_COCKTAIL.original_recipe_json.method_source_text
    );
    expect(steps).toHaveLength(3);
  });
});

describe("cocktail flow — ambiguity is surfaced, never decided", () => {
  it("refuses to pick between two approved formulas of the same name", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "30 ml Spiced Syrup" },
      },
      CATALOG
    );
    const item = r.items[0];
    expect(item.quantity).toBe("30");
    expect(item.catalogKey).toBeNull();
    expect(item.catalogMatch).toBe("ambiguous");
    // The quantity is usable; only the link is withheld.
    expect(r.blocked).toBe(false);
  });
});

describe("cocktail flow — running it again changes nothing", () => {
  it("is byte-identical on a second pass", () => {
    const a = resolveDraftIngredients(MEASURED_COCKTAIL, CATALOG);
    const b = resolveDraftIngredients(MEASURED_COCKTAIL, CATALOG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not duplicate components when the same draft is resolved repeatedly", () => {
    const runs = [1, 2, 3].map(() => resolveDraftIngredients(NAMES_ONLY_COCKTAIL, CATALOG));
    for (const run of runs) expect(run.items).toHaveLength(4);
  });

  it("drops an ingredient the source repeated verbatim", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "Rum, Rum, Lime" },
      },
      CATALOG
    );
    expect(r.items.map(i => i.name)).toEqual(["Rum", "Lime"]);
    expect(r.duplicatesDropped).toBe(1);
  });
});

describe("resolution is not approval", () => {
  it("emits no field that could carry a lifecycle decision", () => {
    // `catalogMatch: "approved_formula"` is a read-only classification of what
    // an ingredient points at, so a keyword scan would be misleading. What
    // matters is the shape: there is no field here a writer could act on.
    const r = resolveDraftIngredients(MEASURED_COCKTAIL, CATALOG);
    expect(Object.keys(r).sort()).toEqual([
      "blocked",
      "blockedReason",
      "duplicatesDropped",
      "items",
      "language",
      "source",
    ]);
    for (const item of r.items) {
      expect(Object.keys(item).sort()).toEqual([
        "catalogKey",
        "catalogMatch",
        "issues",
        "name",
        "quantity",
        "role",
        "unit",
      ]);
    }
  });

  it("cannot reach a writer, because it imports nothing that can write", () => {
    // Structural. The resolver is pure: units in, parsed items out. If someone
    // later imports the supabase client or the tRPC router here, resolving a
    // draft could start having side effects, and this is the line that stops it.
    const source = readFileSync(new URL("../shared/ingredients.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map(m => m[1]);
    expect(imports).toEqual(["./units"]);
    expect(source).not.toMatch(/\brpc\(|supabase|fetch\(|mutation/i);
  });
});
