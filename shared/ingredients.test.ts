import { describe, expect, it } from "vitest";
import { exactDecimal, resolveDraftIngredients, type CatalogEntry } from "./ingredients";
import type { CrmRecipe } from "./crmRecipes";

/** Stands in for what the workbench already has loaded: drafts + approved formulas. */
const CATALOG: CatalogEntry[] = [
  { key: "jalapeno", name: "Jalapeno", kind: "approved_formula" },
  { key: "orgeat", name: "Orgeat", kind: "approved_formula" },
  // Two different formulas both answer to "orgeat" in conversation. That is a
  // decision for a person, not for this resolver.
  { key: "orgeat-bought-almond-milk", name: "Orgeat", kind: "approved_formula" },
  { key: null, name: "Sugar", kind: "known_ingredient" },
  { key: null, name: "Water", kind: "known_ingredient" },
];

const structuredDraft = {
  product_category: "syrup_or_related_product",
  original_recipe_json: {
    ingredients: [
      { ingredient_name: "Jalapenos", quantity_normalized: "5400", unit_name: "gr" },
      { ingredient_name: "Water", quantity_normalized: "18000", unit_name: "ml" },
    ],
  },
} as const;

describe("exactDecimal", () => {
  it("keeps a plain decimal", () => {
    expect(exactDecimal("1")).toBe("1");
    expect(exactDecimal("0.5")).toBe("0.5");
    expect(exactDecimal("12.25")).toBe("12.25");
  });

  it("converts a fraction that terminates", () => {
    expect(exactDecimal("3/4")).toBe("0.75");
    expect(exactDecimal("1/2")).toBe("0.5");
    expect(exactDecimal("1/8")).toBe("0.125");
  });

  it("refuses a fraction that does not terminate rather than rounding it", () => {
    // 1/3 has no finite decimal. Writing 0.333 would be a quantity nobody chose.
    expect(exactDecimal("1/3")).toBeNull();
    expect(exactDecimal("2/7")).toBeNull();
  });

  it("handles a mixed number", () => {
    expect(exactDecimal("1 1/2")).toBe("1.5");
  });

  it("rejects nonsense and division by zero", () => {
    expect(exactDecimal("")).toBeNull();
    expect(exactDecimal("abc")).toBeNull();
    expect(exactDecimal("1/0")).toBeNull();
  });
});

describe("resolveDraftIngredients — structured source (syrups)", () => {
  it("passes structured rows through unchanged", () => {
    const r = resolveDraftIngredients(structuredDraft, CATALOG);
    expect(r.source).toBe("structured");
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({
      name: "Jalapenos",
      quantity: "5400",
      unit: "gr",
      role: "ingredient",
    });
    expect(r.items[0].issues).toEqual([]);
    expect(r.blocked).toBe(false);
  });

  it("matches a structured name against the catalog", () => {
    const r = resolveDraftIngredients(structuredDraft, CATALOG);
    // "Water" is a known ingredient, not a formula, so there is no key to link.
    expect(r.items[1].catalogKey).toBeNull();
    expect(r.items[1].catalogMatch).toBe("known_ingredient");
  });

  it("flags a structured row whose quantity is missing", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "syrup_or_related_product",
        original_recipe_json: {
          ingredients: [{ ingredient_name: "Water", quantity_normalized: "", unit_name: "" }],
        },
      },
      CATALOG
    );
    expect(r.items[0].quantity).toBeNull();
    expect(r.items[0].issues.map(i => i.code)).toContain("no_quantity_in_source");
    expect(r.blocked).toBe(true);
  });
});

describe("resolveDraftIngredients — free text with quantities (Enzoni)", () => {
  const enzoni = {
    product_category: "cocktail",
    original_recipe_json: {
      ingredients_source_text_english:
        "1 oz dry gin\n• 1 oz Campari\n• 3/4 oz lemon juice\n• 1/2 oz grape syrup\n• Garnish: orange slice, green grape",
    },
  };

  it("reads quantity, unit and name off each bulleted line", () => {
    const r = resolveDraftIngredients(enzoni, CATALOG);
    expect(r.source).toBe("free_text");
    expect(r.items.slice(0, 4).map(i => [i.name, i.quantity, i.unit])).toEqual([
      ["dry gin", "1", "oz"],
      ["Campari", "1", "oz"],
      ["lemon juice", "0.75", "oz"],
      ["grape syrup", "0.5", "oz"],
    ]);
  });

  it("marks oz as a unit it will not reason about", () => {
    const r = resolveDraftIngredients(enzoni, CATALOG);
    // oz is ambiguous between weight and fluid volume. The quantity is still
    // read — only the ability to convert it is withheld.
    expect(r.items[0].issues.map(i => i.code)).toEqual(["unit_not_recognised"]);
    expect(r.items[0].quantity).toBe("1");
  });

  it("keeps a garnish line as garnish, and does not split it into the ingredient list", () => {
    const r = resolveDraftIngredients(enzoni, CATALOG);
    const garnish = r.items.filter(i => i.role === "garnish");
    expect(garnish.map(i => i.name)).toEqual(["orange slice", "green grape"]);
    expect(r.items.filter(i => i.role === "ingredient")).toHaveLength(4);
  });

  it("does not report a garnish as missing a quantity", () => {
    // A garnish has no measure by nature; calling that a defect would bury the
    // rows that genuinely need one.
    const r = resolveDraftIngredients(enzoni, CATALOG);
    for (const g of r.items.filter(i => i.role === "garnish")) {
      expect(g.issues.map(i => i.code)).not.toContain("no_quantity_in_source");
    }
  });
});

describe("resolveDraftIngredients — a word after a number is only a unit if it is one", () => {
  // Found by probing, not by a fixture: the first pass took ANY word after the
  // number as the unit, so "6 Mint leaves" resolved to name "leaves" with unit
  // "Mint". That is the worst defect this module could have — the ingredient's
  // identity silently becomes a unit, and the row still looks plausible.
  it("keeps a descriptive word as part of the name", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: {
          ingredients_source_text_english: "6 Mint leaves\n• 3 Egg whites\n• 2 Fresh limes",
        },
      },
      CATALOG
    );
    expect(r.items.map(i => [i.name, i.quantity, i.unit])).toEqual([
      ["Mint leaves", "6", null],
      ["Egg whites", "3", null],
      ["Fresh limes", "2", null],
    ]);
  });

  it("still reads a real measure word as the unit", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: {
          ingredients_source_text_english: "1 oz dry gin\n• 2 dashes bitters\n• 30 ml rum",
        },
      },
      CATALOG
    );
    expect(r.items.map(i => [i.name, i.quantity, i.unit])).toEqual([
      ["dry gin", "1", "oz"],
      ["bitters", "2", "dashes"],
      ["rum", "30", "ml"],
    ]);
  });

  it("flags a measure it cannot convert, but does not flag one it can", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: {
          ingredients_source_text_english: "1 oz gin\n• 30 ml rum",
        },
      },
      CATALOG
    );
    expect(r.items[0].issues.map(i => i.code)).toEqual(["unit_not_recognised"]);
    expect(r.items[1].issues).toEqual([]);
  });

  it("does not treat a bare count as missing a quantity", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "1 Lime" },
      },
      CATALOG
    );
    expect(r.items[0]).toMatchObject({ name: "Lime", quantity: "1", unit: null });
    // No unit at all still blocks: the column is NOT NULL.
    expect(r.blocked).toBe(true);
  });
});

describe("resolveDraftIngredients — commas separate items even when measured", () => {
  // Not in today's corpus — Enzoni puts each measured line on its own row — but
  // it is the obvious next shape an import could take, and getting it wrong
  // silently merges three ingredients into one with the first one's quantity.
  it("splits a measured comma list into one item each", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: {
          ingredients_source_text_english: "1 oz gin, 2 oz rum, 1/2 oz lime",
        },
      },
      CATALOG
    );
    expect(r.items.map(i => [i.name, i.quantity, i.unit])).toEqual([
      ["gin", "1", "oz"],
      ["rum", "2", "oz"],
      ["lime", "0.5", "oz"],
    ]);
  });

  it("handles a list that mixes measured and unmeasured items", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "1 oz gin, mint" },
      },
      CATALOG
    );
    expect(r.items.map(i => [i.name, i.quantity])).toEqual([
      ["gin", "1"],
      ["mint", null],
    ]);
    // One of the two still has no measure, so it is still blocked.
    expect(r.blocked).toBe(true);
  });

  it("does not leave a repeated Garnish label inside a garnish name", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: {
          ingredients_source_text_english: "Garnish: lime, Garnish: mint",
        },
      },
      CATALOG
    );
    expect(r.items.map(i => [i.role, i.name])).toEqual([
      ["garnish", "lime"],
      ["garnish", "mint"],
    ]);
  });

  it("produces nothing from punctuation alone", () => {
    const r = resolveDraftIngredients(
      { product_category: "cocktail", original_recipe_json: { ingredients_source_text_english: ",,," } },
      CATALOG
    );
    expect(r.items).toEqual([]);
    expect(r.source).toBe("none");
  });
});

describe("resolveDraftIngredients — free text without quantities (49 of 50)", () => {
  const mojito = {
    product_category: "cocktail",
    original_recipe_json: { ingredients_source_text_english: "Mint, Lime, Rum, Soda" },
  };

  it("splits a comma list into named ingredients", () => {
    const r = resolveDraftIngredients(mojito, CATALOG);
    expect(r.items.map(i => i.name)).toEqual(["Mint", "Lime", "Rum", "Soda"]);
  });

  it("leaves every quantity null and says why, per item", () => {
    const r = resolveDraftIngredients(mojito, CATALOG);
    for (const item of r.items) {
      expect(item.quantity).toBeNull();
      expect(item.unit).toBeNull();
      expect(item.issues.map(i => i.code)).toEqual(["no_quantity_in_source"]);
    }
  });

  it("blocks versioning and explains it in one sentence", () => {
    const r = resolveDraftIngredients(mojito, CATALOG);
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toMatch(/4 of 4/);
    expect(r.blockedReason).toMatch(/quantity/i);
  });

  it("reads correctly when only one ingredient is missing a quantity", () => {
    // The common syrup case is a single blank row, and "1 ingredients have"
    // reads like a bug in the very message meant to build confidence.
    const r = resolveDraftIngredients(
      {
        product_category: "syrup_or_related_product",
        original_recipe_json: {
          ingredients: [
            { ingredient_name: "Sugar", quantity_normalized: "550", unit_name: "gr" },
            { ingredient_name: "Water", quantity_normalized: "", unit_name: "" },
          ],
        },
      },
      CATALOG
    );
    // The wording changed when the multi-reason case was fixed; what this test
    // protects is that the singular case reads correctly, not the exact phrase.
    expect(r.blockedReason).toContain("1 of 2 ingredients cannot be used yet");
    expect(r.blockedReason).toContain("It has no quantity in the source");
    expect(r.blockedReason).not.toMatch(/1 ingredients have|They have/);
  });

  it("never invents a quantity, a unit or a substitution", () => {
    const r = resolveDraftIngredients(mojito, CATALOG);
    const serialised = JSON.stringify(r);
    expect(serialised).not.toMatch(/\b(1|2|30|45|60)\s*(oz|ml|gr)\b/);
    expect(r.items.every(i => i.quantity === null && i.unit === null)).toBe(true);
  });
});

describe("resolveDraftIngredients — catalog matching", () => {
  it("links an ingredient that names exactly one approved formula", () => {
    const r = resolveDraftIngredients(
      { product_category: "cocktail", original_recipe_json: { ingredients_source_text_english: "Jalapeno, Lime" } },
      CATALOG
    );
    expect(r.items[0].catalogKey).toBe("jalapeno");
    expect(r.items[0].catalogMatch).toBe("approved_formula");
  });

  it("refuses to choose when two catalog entries share a name", () => {
    const r = resolveDraftIngredients(
      { product_category: "cocktail", original_recipe_json: { ingredients_source_text_english: "Orgeat, Lemon" } },
      CATALOG
    );
    const orgeat = r.items[0];
    expect(orgeat.catalogKey).toBeNull();
    expect(orgeat.catalogMatch).toBe("ambiguous");
    const issue = orgeat.issues.find(i => i.code === "ambiguous_catalog_match");
    expect(issue).toBeDefined();
    expect((issue as { candidates: string[] }).candidates.sort()).toEqual([
      "orgeat",
      "orgeat-bought-almond-milk",
    ]);
  });

  it("leaves an ingredient the catalog has never seen as plain text, without an issue", () => {
    // Not knowing "Campari" is normal — ingredient_key is nullable and unused
    // on every existing component. It is not a defect to report.
    const r = resolveDraftIngredients(
      { product_category: "cocktail", original_recipe_json: { ingredients_source_text_english: "Campari" } },
      CATALOG
    );
    expect(r.items[0].catalogMatch).toBe("none");
    expect(r.items[0].issues.map(i => i.code)).toEqual(["no_quantity_in_source"]);
  });

  it("matches case- and accent-insensitively without fuzzy guessing", () => {
    const r = resolveDraftIngredients(
      { product_category: "cocktail", original_recipe_json: { ingredients_source_text_english: "JALAPENO, Jalapenos" } },
      CATALOG
    );
    expect(r.items[0].catalogKey).toBe("jalapeno");
    // "Jalapenos" is a different string. No stemming, no near-match.
    expect(r.items[1].catalogMatch).toBe("none");
  });
});

describe("resolveDraftIngredients — determinism and repeat runs", () => {
  const draft = {
    product_category: "cocktail",
    original_recipe_json: { ingredients_source_text_english: "Mint, Lime, Rum, Soda" },
  };

  it("produces identical output when run again", () => {
    const a = resolveDraftIngredients(draft, CATALOG);
    const b = resolveDraftIngredients(draft, CATALOG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not accumulate items across calls", () => {
    expect(resolveDraftIngredients(draft, CATALOG).items).toHaveLength(4);
    expect(resolveDraftIngredients(draft, CATALOG).items).toHaveLength(4);
  });

  it("collapses a repeated ingredient rather than emitting it twice", () => {
    const r = resolveDraftIngredients(
      { product_category: "cocktail", original_recipe_json: { ingredients_source_text_english: "Lime, Lime, Rum" } },
      CATALOG
    );
    expect(r.items.map(i => i.name)).toEqual(["Lime", "Rum"]);
    expect(r.duplicatesDropped).toBe(1);
  });

  it("keeps two genuinely different ingredients that merely start alike", () => {
    const r = resolveDraftIngredients(
      { product_category: "cocktail", original_recipe_json: { ingredients_source_text_english: "Lime, Lime juice" } },
      CATALOG
    );
    expect(r.items.map(i => i.name)).toEqual(["Lime", "Lime juice"]);
    expect(r.duplicatesDropped).toBe(0);
  });
});

describe("resolveDraftIngredients — nothing to read", () => {
  it("reports no source rather than an empty success", () => {
    const r = resolveDraftIngredients(
      { product_category: "cocktail", original_recipe_json: {} },
      CATALOG
    );
    expect(r.source).toBe("none");
    expect(r.items).toEqual([]);
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toMatch(/no ingredient/i);
  });

  it("ignores a blank source text", () => {
    const r = resolveDraftIngredients(
      { product_category: "cocktail", original_recipe_json: { ingredients_source_text_english: "   " } },
      CATALOG
    );
    expect(r.source).toBe("none");
  });

  it("survives a null original_recipe_json", () => {
    const r = resolveDraftIngredients({ product_category: "cocktail", original_recipe_json: null }, CATALOG);
    expect(r.source).toBe("none");
    expect(r.items).toEqual([]);
  });

  it("prefers English and never mixes the two languages", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: {
          ingredients_source_text_english: "Mint, Lime",
          ingredients_source_text_french: "Menthe, Citron vert, Rhum",
        },
      },
      CATALOG
    );
    expect(r.items.map(i => i.name)).toEqual(["Mint", "Lime"]);
    expect(r.language).toBe("en");
  });

  it("falls back to French only when English is absent, and says so", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_french: "Menthe, Citron vert" },
      },
      CATALOG
    );
    expect(r.items.map(i => i.name)).toEqual(["Menthe", "Citron vert"]);
    expect(r.language).toBe("fr");
  });
});

describe("resolveDraftIngredients — review findings", () => {
  it("says a unit is missing rather than calling it a missing quantity", () => {
    // "2 Fresh limes" has a quantity and no unit. Reporting that as "no
    // quantity in the source" sends the operator to check a source that plainly
    // records the 2.
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "2 Fresh limes" },
      },
      CATALOG
    );
    expect(r.items[0].quantity).toBe("2");
    expect(r.items[0].issues.map(i => i.code)).toEqual(["no_unit_in_source"]);
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toMatch(/unit/i);
    expect(r.blockedReason).not.toMatch(/no quantity/i);
  });

  it("does not claim the source is silent when it recorded an unusable fraction", () => {
    // The source says "1/3". It is not missing; it has no exact decimal form.
    const r = resolveDraftIngredients(
      {
        product_category: "syrup_or_related_product",
        original_recipe_json: {
          ingredients: [{ ingredient_name: "Campari", quantity_normalized: "1/3", unit_name: "ml" }],
        },
      },
      CATALOG
    );
    expect(r.items[0].issues.map(i => i.code)).toEqual(["quantity_not_exact"]);
    expect(r.blocked).toBe(true);
    expect(r.blockedReason).toMatch(/no exact decimal form/i);
    expect(r.blockedReason).not.toMatch(/does not record/i);
  });

  it("flags a zero quantity, which is real in the corpus and meaningless in a formula", () => {
    // Blood Orange Cordial genuinely carries a 0 gr row beside a 550 gr row.
    const r = resolveDraftIngredients(
      {
        product_category: "syrup_or_related_product",
        original_recipe_json: {
          ingredients: [
            { ingredient_name: "Blood Oranges ( Fresh )", quantity_normalized: "0", unit_name: "gr" },
            { ingredient_name: "Blood Oranges ( Fresh )", quantity_normalized: "550", unit_name: "gr" },
          ],
        },
      },
      CATALOG
    );
    expect(r.items[0].issues.map(i => i.code)).toEqual(["quantity_is_zero"]);
    expect(r.items[1].issues).toEqual([]);
    // Both rows are kept — they are different quantities, not a duplicate.
    expect(r.items).toHaveLength(2);
    expect(r.blocked).toBe(true);
  });

  it("normalises a zero-padded integer", () => {
    expect(exactDecimal("007")).toBe("7");
    expect(exactDecimal("0")).toBe("0");
    expect(exactDecimal("0.50")).toBe("0.5");
  });

  it("reads a garnish line that has no colon", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "Garnish orange wheel" },
      },
      CATALOG
    );
    expect(r.items).toEqual([
      expect.objectContaining({ role: "garnish", name: "orange wheel" }),
    ]);
  });

  it("does not mistake an ingredient that merely starts with the word garnish", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "Garnishing syrup" },
      },
      CATALOG
    );
    expect(r.items[0].role).toBe("ingredient");
    expect(r.items[0].name).toBe("Garnishing syrup");
  });

  it("does not read as more broken rows than there are, when one row has two problems", () => {
    // Two ingredients, four problems between them. The first wording counted
    // each reason separately — "2 have no unit. 1 has no exact decimal form.
    // 1 is recorded as zero." — which reads as four bad rows out of two.
    const r = resolveDraftIngredients(
      {
        product_category: "syrup_or_related_product",
        original_recipe_json: {
          ingredients: [
            { ingredient_name: "A", quantity_normalized: "0", unit_name: "" },
            { ingredient_name: "B", quantity_normalized: "1/3", unit_name: "" },
          ],
        },
      },
      CATALOG
    );
    expect(r.blockedReason).toMatch(/^2 of 2 ingredients cannot be used yet/);
    // The reasons overlap on a single ingredient, and the sentence says so.
    expect(r.blockedReason).toMatch(/can overlap/i);
  });

  it("never states a reason count higher than the number of blocked ingredients", () => {
    // The leading number is the count of ingredients; the reason numbers are
    // attributes of those same ingredients. If a reason could exceed the lead,
    // the sentence would be arithmetically impossible on its face.
    const shapes = [
      [{ ingredient_name: "A", quantity_normalized: "0", unit_name: "" }],
      [
        { ingredient_name: "A", quantity_normalized: "1/3", unit_name: "" },
        { ingredient_name: "B", quantity_normalized: "", unit_name: "gr" },
        { ingredient_name: "C", quantity_normalized: "0", unit_name: "gr" },
      ],
      [{ ingredient_name: "A", quantity_normalized: "5", unit_name: "gr" }],
    ];
    for (const ingredients of shapes) {
      const r = resolveDraftIngredients(
        { product_category: "syrup_or_related_product", original_recipe_json: { ingredients } },
        CATALOG
      );
      if (!r.blockedReason) continue;
      const [lead, ...rest] = [...r.blockedReason.matchAll(/\d+/g)].map(m => Number(m[0]));
      // lead is "N of M"; the first two numbers are N and M.
      const blockedCount = lead;
      for (const n of rest.slice(1)) {
        expect(n).toBeLessThanOrEqual(blockedCount);
      }
    }
  });

  it("never renders a reason list that is empty while ingredients are blocked", () => {
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "Mint, Lime" },
      },
      CATALOG
    );
    expect(r.blocked).toBe(true);
    // A dangling "2 of 2 ingredients cannot be used yet." with no reason after
    // it would be worse than no message.
    expect(r.blockedReason).toMatch(/cannot be used yet\.? (It has|They have|—)/);
  });

  it("agrees the noun with the total, not just the verb with the count", () => {
    // A one-ingredient draft is ordinary — Butterfly Pea has exactly one — and
    // "1 of 1 ingredients" is the kind of wrong that makes a reader distrust
    // the rest of the sentence.
    const r = resolveDraftIngredients(
      {
        product_category: "syrup_or_related_product",
        original_recipe_json: {
          ingredients: [{ ingredient_name: "Water", quantity_normalized: "", unit_name: "" }],
        },
      },
      CATALOG
    );
    expect(r.blockedReason).toContain("1 of 1 ingredient cannot be used yet");
    expect(r.blockedReason).not.toContain("1 of 1 ingredients");
  });

  it("KNOWN LIMIT: a real unit word starting an ingredient name is taken as the unit", () => {
    // "1 Cup Cordial" resolves to 1 cup of "Cordial". The parser cannot tell
    // that "Cup" belongs to the name without an ingredient dictionary, and
    // guessing is worse than a documented limit. This test exists so the
    // behaviour is explicit and a future fix has a target — it is NOT an
    // endorsement. The operator sees the name field and can correct it.
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "1 Cup Cordial" },
      },
      CATALOG
    );
    expect(r.items[0]).toMatchObject({ name: "Cordial", quantity: "1", unit: "Cup" });
  });

  it("KNOWN LIMIT: a qualifier after a comma becomes its own named row", () => {
    // "Salt, to taste" yields a row named "to taste" with no quantity. It can
    // never become a component (quantity is NOT NULL) and the operator deletes
    // it. Recognising the idiom would mean guessing which comma is a separator.
    const r = resolveDraftIngredients(
      {
        product_category: "cocktail",
        original_recipe_json: { ingredients_source_text_english: "Salt, to taste" },
      },
      CATALOG
    );
    expect(r.items.map(i => i.name)).toEqual(["Salt", "to taste"]);
    expect(r.blocked).toBe(true);
  });
});

describe("resolveDraftIngredients — the CRM is the source of truth", () => {
  const CRM: CrmRecipe[] = [
    {
      id: "r1",
      name: "Synthetic Mojito",
      englishDescription: "Mint, Lime, Rum, Soda",
      method: "MUDDLE the mint. ADD everything else. GARNISH.",
      ingredients: [
        { name: "White Rum", type: "alcohol", quantityPerDrink: 2, unit: "oz" },
        { name: "Lime Juice", type: "juice", quantityPerDrink: 0.75, unit: "oz" },
        { name: "Simple Syrup", type: "syrup", quantityPerDrink: 0.5, unit: "oz" },
        { name: "Club Soda", type: "soda", quantityPerDrink: 2, unit: "oz" },
        { name: "Mint", type: "garnish", quantityPerDrink: 1, unit: "garnish" },
        { name: "Highball", type: "glass", quantityPerDrink: 1, unit: "glass" },
      ],
    },
  ];

  const mojitoDraft = {
    name: "Synthetic Mojito",
    product_category: "cocktail",
    original_recipe_json: {
      ingredients_source_text_english: "Mint, Lime, Rum, Soda",
      method_source_text: "Some older wording from the intake.",
    },
  };

  it("uses the CRM record instead of the draft's free text", () => {
    const r = resolveDraftIngredients(mojitoDraft, CATALOG, CRM);
    expect(r.source).toBe("crm_recipe");
    expect(
      r.items.filter(i => i.role === "ingredient").map(i => [i.name, i.quantity, i.unit])
    ).toEqual([
      ["White Rum", "2", "oz"],
      ["Lime Juice", "0.75", "oz"],
      ["Simple Syrup", "0.5", "oz"],
      ["Club Soda", "2", "oz"],
    ]);
  });

  it("is no longer blocked, because the CRM records every measure", () => {
    const r = resolveDraftIngredients(mojitoDraft, CATALOG, CRM);
    expect(r.blocked).toBe(false);
    expect(r.blockedReason).toBeNull();
  });

  it("records which CRM recipe it came from, so the provenance is visible", () => {
    const r = resolveDraftIngredients(mojitoDraft, CATALOG, CRM);
    expect(r.crmRecipe).toEqual({
      id: "r1",
      name: "Synthetic Mojito",
      method: "MUDDLE the mint. ADD everything else. GARNISH.",
    });
  });

  it("falls back to the draft's own text when the CRM has no such recipe", () => {
    const r = resolveDraftIngredients(
      { ...mojitoDraft, name: "Not In The CRM" },
      CATALOG,
      CRM
    );
    expect(r.source).toBe("free_text");
    expect(r.crmRecipe).toBeNull();
    expect(r.blocked).toBe(true);
  });

  it("still prefers a structured draft over the CRM, because that draft was normalised already", () => {
    const r = resolveDraftIngredients(
      {
        name: "Synthetic Mojito",
        product_category: "syrup_or_related_product",
        original_recipe_json: {
          ingredients: [
            { ingredient_name: "Jalapenos", quantity_normalized: "5400", unit_name: "gr" },
          ],
        },
      },
      CATALOG,
      CRM
    );
    expect(r.source).toBe("structured");
    expect(r.items[0].name).toBe("Jalapenos");
  });


});
