import { describe, expect, it } from "vitest";
import {
  crmRecipeToIngredients,
  findCrmRecipe,
  type CrmRecipe,
} from "./ingredients";

/** Shaped exactly like a row of public.recipes.data, with its own values. */
const DAIQUIRI: CrmRecipe = {
  id: "synthetic-daiquiri",
  name: "Synthetic Daiquiri",
  englishDescription: "Lime, Simple Syrup, White Rum",
  method: "Add rum, syrup and lime to a shaker. Shake. Double strain.",
  ingredients: [
    { name: "Rum", type: "alcohol", quantityPerDrink: 1.5, unit: "oz" },
    { name: "Simple Syrup", type: "syrup", quantityPerDrink: 0.75, unit: "oz" },
    { name: "Lime Juice", type: "juice", quantityPerDrink: 0.75, unit: "oz" },
    { name: "Dehydrated Citrus", type: "garnish", quantityPerDrink: 1, unit: "garnish" },
    { name: "Low Ball", type: "glass", quantityPerDrink: 1, unit: "glass" },
  ],
};

describe("crmRecipeToIngredients", () => {
  it("takes quantity and unit from the CRM record, not from prose", () => {
    const items = crmRecipeToIngredients(DAIQUIRI);
    expect(
      items.filter(i => i.role === "ingredient").map(i => [i.name, i.quantity, i.unit])
    ).toEqual([
      ["Rum", "1.5", "oz"],
      ["Simple Syrup", "0.75", "oz"],
      ["Lime Juice", "0.75", "oz"],
    ]);
  });

  it("keeps a garnish as a garnish and drops glassware entirely", () => {
    const items = crmRecipeToIngredients(DAIQUIRI);
    expect(items.filter(i => i.role === "garnish").map(i => i.name)).toEqual([
      "Dehydrated Citrus",
    ]);
    // Glassware is neither an ingredient nor a garnish; it must never reach a
    // formula component, because a batch sheet would then list a glass to weigh.
    expect(items.map(i => i.name)).not.toContain("Low Ball");
  });

  it("flags oz as unconvertible without refusing the quantity", () => {
    const rum = crmRecipeToIngredients(DAIQUIRI)[0];
    expect(rum.quantity).toBe("1.5");
    expect(rum.issues.map(i => i.code)).toEqual(["unit_not_recognised"]);
  });

  it("carries a number through as an exact decimal string", () => {
    // The earlier note here claimed the scaler needs a string and must not get
    // a float. Both are false: beverageScaling types Quantity as string|number
    // and stringifies it itself. The real reason is that ParsedIngredient
    // .quantity is a string the operator edits as text in the dialog.
    const items = crmRecipeToIngredients({
      ...DAIQUIRI,
      ingredients: [{ name: "X", type: "syrup", quantityPerDrink: 0.5, unit: "ml" }],
    });
    expect(items[0].quantity).toBe("0.5");
  });

  it("validates a string quantity rather than passing it straight through", () => {
    // Every row in the corpus is a JSON number, but the column is jsonb and a
    // string is exactly the case that needs checking — "1/3" has no exact
    // decimal form and must not reach an approved formula unflagged.
    const items = crmRecipeToIngredients({
      ...DAIQUIRI,
      ingredients: [{ name: "X", type: "syrup", quantityPerDrink: "1/3", unit: "ml" }],
    });
    expect(items[0].quantity).toBeNull();
    expect(items[0].issues.map(i => i.code)).toContain("quantity_not_exact");
  });

  it("refuses a row whose quantity is missing or unusable rather than inventing one", () => {
    const items = crmRecipeToIngredients({
      ...DAIQUIRI,
      ingredients: [
        { name: "A", type: "syrup", quantityPerDrink: null, unit: "oz" },
        { name: "B", type: "syrup", quantityPerDrink: 0, unit: "oz" },
      ],
    });
    expect(items[0].quantity).toBeNull();
    expect(items[0].issues.map(i => i.code)).toContain("no_quantity_in_source");
    expect(items[1].issues.map(i => i.code)).toContain("quantity_is_zero");
  });

  it("flags a row whose unit contradicts its type instead of quietly measuring it", () => {
    // Real in the CRM: one recipe types "Dehydrated Citrus" as a juice while
    // its unit stays "garnish" — the same ingredient is typed garnish in 38
    // other rows. Deciding which field is right is not this module's call, so
    // it keeps the row as typed and says the two disagree.
    const items = crmRecipeToIngredients({
      ...DAIQUIRI,
      ingredients: [
        { name: "Dehydrated Citrus", type: "juice", quantityPerDrink: 1, unit: "garnish" },
      ],
    });
    expect(items[0].role).toBe("ingredient");
    expect(items[0].issues.map(i => i.code)).toContain("type_unit_mismatch");
  });

  it("does not flag a garnish measured in garnishes", () => {
    const items = crmRecipeToIngredients({
      ...DAIQUIRI,
      ingredients: [
        { name: "Mint", type: "garnish", quantityPerDrink: 1, unit: "garnish" },
      ],
    });
    expect(items[0].issues.map(i => i.code)).not.toContain("type_unit_mismatch");
  });

  it("does not nag about the unit on a garnish", () => {
    // A garnish measured in "garnish" is not a unit problem. Reporting it puts
    // noise in the very list an operator reads to find real problems.
    const items = crmRecipeToIngredients(DAIQUIRI);
    const garnish = items.find(i => i.role === "garnish");
    expect(garnish?.issues).toEqual([]);
  });

  it("returns nothing for a recipe with no ingredients", () => {
    expect(crmRecipeToIngredients({ ...DAIQUIRI, ingredients: [] })).toEqual([]);
  });
});

describe("findCrmRecipe", () => {
  const recipes: CrmRecipe[] = [
    DAIQUIRI,
    { ...DAIQUIRI, id: "b", name: "Negroni Synthetic" },
    { ...DAIQUIRI, id: "c", name: "Twin" },
    { ...DAIQUIRI, id: "d", name: "twin" },
  ];

  it("matches a draft name exactly, ignoring case and punctuation", () => {
    expect(findCrmRecipe("Synthetic Daiquiri", recipes)?.id).toBe("synthetic-daiquiri");
    expect(findCrmRecipe("synthetic-daiquiri!", recipes)?.id).toBe("synthetic-daiquiri");
  });

  it("returns nothing rather than a near match", () => {
    // "Daiquiri" is not "Synthetic Daiquiri". A near match would silently
    // attach the wrong measures to a drink.
    expect(findCrmRecipe("Daiquiri", recipes)).toBeNull();
    expect(findCrmRecipe("Negroni", recipes)).toBeNull();
  });

  it("refuses to choose when two CRM recipes share a name", () => {
    expect(findCrmRecipe("Twin", recipes)).toBeNull();
  });

  it("handles an empty catalogue", () => {
    expect(findCrmRecipe("anything", [])).toBeNull();
  });
});
