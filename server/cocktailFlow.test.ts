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
      "crmRecipe",
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

  it("cannot reach a writer, across its whole import closure", () => {
    // Structural. The resolver is pure: units and records in, parsed items out.
    // If someone later imports the supabase client or the tRPC router into any
    // of these, resolving a draft could start having side effects.
    //
    // Checked transitively rather than on one file, because adding a module was
    // all it took to slip past the single-file version of this test.
    // Two files, no cycle. This was briefly a three-file whitelist that had to
    // permit ingredients.ts and crmRecipes.ts importing each other — the review
    // pointed out that a whitelist admitting a cycle is a weaker guarantee than
    // the one it replaced, so the modules were folded back together.
    const allowed: Record<string, string[]> = {
      "shared/ingredients.ts": ["./units"],
      "shared/units.ts": [],
    };
    for (const [file, expected] of Object.entries(allowed)) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const imports = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map(m => m[1]);
      expect(imports.sort()).toEqual([...expected].sort());
      // Comments stripped first: these files describe the Supabase integration
      // in prose, and a scan that cannot tell a sentence from a call would fail
      // on the documentation rather than on any real dependency.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/\brpc\(|supabase|fetch\(|mutation/i);
    }
  });
});

describe("CRM-backed cocktail — scaling and preparation, end to end", () => {
  /** Shaped like a row of public.recipes, with its own values. */
  const CRM_RECIPES = [
    {
      id: "synthetic-sour",
      name: "Synthetic Sour",
      englishDescription: "Lemon, Simple Syrup, Bourbon, Eggwhites",
      method:
        "ADD all ingredients to the shaker. DRY SHAKE for 15 seconds.\nADD ice and SHAKE again.STRAIN into a glass.",
      ingredients: [
        { name: "Bourbon", type: "alcohol", quantityPerDrink: 2, unit: "oz" },
        { name: "Simple Syrup", type: "syrup", quantityPerDrink: 0.5, unit: "oz" },
        { name: "Lemon Juice", type: "juice", quantityPerDrink: 0.75, unit: "oz" },
        { name: "Eggwhite", type: "juice", quantityPerDrink: 1, unit: "splash" },
        { name: "Dehydrated Citrus", type: "garnish", quantityPerDrink: 1, unit: "garnish" },
        { name: "Low Ball", type: "glass", quantityPerDrink: 1, unit: "glass" },
      ],
    },
  ];

  const draft = {
    name: "Synthetic Sour",
    product_category: "cocktail",
    original_recipe_json: {
      ingredients_source_text_english: "Lemon, Simple Syrup, Bourbon, Eggwhites",
      method_source_text: "older intake wording that the CRM supersedes",
    },
  };

  const resolution = resolveDraftIngredients(draft, CATALOG, CRM_RECIPES);

  it("is backed by the CRM, not by the intake prose", () => {
    expect(resolution.source).toBe("crm_recipe");
    expect(resolution.crmRecipe?.name).toBe("Synthetic Sour");
    expect(resolution.blocked).toBe(false);
  });

  it("scales every CRM quantity exactly, for a party of 40", () => {
    const formula = toFormula("Synthetic Sour", resolution);
    const result = scaleFormula(formula, { mode: "multiplier", multiplier: "40" });

    const byName = Object.fromEntries(
      result.components.map(c => [c.ingredientName, c.scaledQuantity])
    );
    expect(byName["Bourbon"]).toBe("80");
    expect(byName["Simple Syrup"]).toBe("20");
    expect(byName["Lemon Juice"]).toBe("30");
    expect(byName["Eggwhite"]).toBe("40");
    for (const c of result.components) expect(c.scaledQuantityIsExact).toBe(true);
  });

  it("scales to a limiting bottle without inventing a conversion", () => {
    const formula = toFormula("Synthetic Sour", resolution);
    const result = scaleFormula(formula, {
      mode: "limitingIngredient",
      ingredientName: "Bourbon",
      availableQuantity: "26",
      unit: "oz",
    });
    // 26/2 = 13 drinks.
    expect(result.factor.exact).toBe("13");
    expect(
      result.components.find(c => c.ingredientName === "Lemon Juice")?.scaledQuantity
    ).toBe("9.75");
  });

  it("refuses to scale a CRM oz recipe against a gram measure", () => {
    const formula = toFormula("Synthetic Sour", resolution);
    expect(() =>
      scaleFormula(formula, {
        mode: "limitingIngredient",
        ingredientName: "Bourbon",
        availableQuantity: "750",
        unit: "gr",
      })
    ).toThrow();
  });

  it("takes the preparation method from the CRM, superseding the intake text", () => {
    const steps = parseMethodDraft(resolution.crmRecipe?.method ?? null);
    expect(steps.map(s => s.text)).toEqual([
      "ADD all ingredients to the shaker.",
      "DRY SHAKE for 15 seconds.",
      "ADD ice and SHAKE again.",
      "STRAIN into a glass.",
    ]);
    // The intake wording must not leak through.
    expect(JSON.stringify(steps)).not.toContain("older intake wording");
  });

  it("presents that method to the agent as reviewed once an operator confirms it", () => {
    const steps = parseMethodDraft(resolution.crmRecipe?.method ?? null);
    const forAgent = methodForAgent({ source: "operator", steps, raw: null });
    expect(forAgent.recorded).toBe(true);
    expect(forAgent.reviewed).toBe(true);
    expect(forAgent.steps[0]).toBe("1. ADD all ingredients to the shaker.");
  });

  it("keeps glassware out of the batch sheet and garnish out of the components", () => {
    const formula = toFormula("Synthetic Sour", resolution);
    const names = formula.components.map(c => c.ingredientName);
    expect(names).not.toContain("Low Ball");
    expect(names).not.toContain("Dehydrated Citrus");
    expect(names).toHaveLength(4);
  });

  it("resolving a CRM-backed draft still approves nothing", () => {
    // The CRM supplying measures does not make a formula approved. Approval
    // remains a separate, human, audited step.
    expect(JSON.stringify(resolution)).not.toMatch(/lifecycle|"approved"/i);
    expect(Object.keys(resolution)).not.toContain("approvedAt");
  });
});
