import { describe, expect, it } from "vitest";
import { scaleFormula, type NormalizedFormula } from "./beverageScaling";

// The formula used throughout the Manus session as the worked example:
// a jalapeno syrup whose limiting ingredient forces a non-terminating factor.
const JALAPENO: NormalizedFormula = {
  formulaVersionId: "11111111-1111-1111-1111-111111111111",
  name: "Jalapeno Syrup",
  intendedYieldValue: "20",
  intendedYieldUnit: "L",
  components: [
    { lineNumber: 1, ingredientName: "Sugar", quantity: "20", unit: "kg" },
    { lineNumber: 2, ingredientName: "Water", quantity: "18", unit: "kg" },
    { lineNumber: 3, ingredientName: "Jalapeno", quantity: "5250", unit: "gr" },
  ],
};

// A formula whose every scaled quantity terminates, for the exactness contract.
const CORDIAL: NormalizedFormula = {
  formulaVersionId: "22222222-2222-2222-2222-222222222222",
  name: "Blood Orange Cordial",
  intendedYieldValue: "4",
  intendedYieldUnit: "L",
  components: [
    { lineNumber: 1, ingredientName: "Blood Oranges", quantity: "550", unit: "gr" },
    { lineNumber: 2, ingredientName: "Sugar", quantity: "550", unit: "gr" },
  ],
};

describe("scaleFormula — release safety", () => {
  it("never releases a batch, whatever the mode", () => {
    const byMultiplier = scaleFormula(CORDIAL, { mode: "multiplier", multiplier: "2" });
    const byYield = scaleFormula(CORDIAL, { mode: "targetYield", targetYieldValue: "8" });
    const byLimit = scaleFormula(JALAPENO, {
      mode: "limitingIngredient",
      ingredientName: "Jalapeno",
      availableQuantity: "3700",
      unit: "gr",
    });

    expect(byMultiplier.status).toBe("not_released");
    expect(byYield.status).toBe("not_released");
    expect(byLimit.status).toBe("not_released");
  });
});

describe("scaleFormula — exact multiplier", () => {
  it("scales every component by an exact factor", () => {
    const result = scaleFormula(CORDIAL, { mode: "multiplier", multiplier: "2.5" });

    expect(result.factor.exact).toBe("5/2");
    expect(result.factor.decimal).toBe("2.5");
    expect(result.factor.decimalIsExact).toBe(true);
    expect(result.components).toEqual([
      {
        lineNumber: 1,
        ingredientName: "Blood Oranges",
        unit: "gr",
        originalQuantity: "550",
        scaledQuantity: "1375",
        scaledQuantityIsExact: true,
      },
      {
        lineNumber: 2,
        ingredientName: "Sugar",
        unit: "gr",
        originalQuantity: "550",
        scaledQuantity: "1375",
        scaledQuantityIsExact: true,
      },
    ]);
  });

  it("scales the planned yield alongside the components", () => {
    const result = scaleFormula(CORDIAL, { mode: "multiplier", multiplier: "2.5" });
    expect(result.scaledYield).toEqual({
      value: "10",
      unit: "L",
      isExact: true,
    });
  });
});

describe("scaleFormula — target yield", () => {
  it("derives the factor from planned yield and target yield", () => {
    const result = scaleFormula(CORDIAL, { mode: "targetYield", targetYieldValue: "10" });
    expect(result.factor.exact).toBe("5/2");
    expect(result.scaledYield.value).toBe("10");
  });
});

describe("scaleFormula — limiting ingredient", () => {
  it("derives an exact rational factor and never rounds it away", () => {
    const result = scaleFormula(JALAPENO, {
      mode: "limitingIngredient",
      ingredientName: "Jalapeno",
      availableQuantity: "3700",
      unit: "gr",
    });

    // 3700 / 5250 reduces to 74/105 — a non-terminating decimal.
    expect(result.factor.exact).toBe("74/105");
    expect(result.factor.decimalIsExact).toBe(false);
    expect(result.factor.decimal.startsWith("0.70476190476190")).toBe(true);
  });

  it("consumes the limiting ingredient exactly and marks inexact renderings", () => {
    const result = scaleFormula(JALAPENO, {
      mode: "limitingIngredient",
      ingredientName: "Jalapeno",
      availableQuantity: "3700",
      unit: "gr",
    });

    const jalapeno = result.components.find(c => c.ingredientName === "Jalapeno");
    expect(jalapeno?.scaledQuantity).toBe("3700");
    expect(jalapeno?.scaledQuantityIsExact).toBe(true);

    // 20 kg * 74/105 = 1480/105 = 296/21, which does not terminate.
    const sugar = result.components.find(c => c.ingredientName === "Sugar");
    expect(sugar?.scaledQuantityExact).toBe("296/21");
    expect(sugar?.scaledQuantityIsExact).toBe(false);
  });

  it("matches the ingredient case-insensitively but refuses a unit mismatch", () => {
    const ok = scaleFormula(JALAPENO, {
      mode: "limitingIngredient",
      ingredientName: "jalapeno",
      availableQuantity: "3700",
      unit: "gr",
    });
    expect(ok.factor.exact).toBe("74/105");

    expect(() =>
      scaleFormula(JALAPENO, {
        mode: "limitingIngredient",
        ingredientName: "Jalapeno",
        availableQuantity: "3.7",
        unit: "kg",
      })
    ).toThrow(/unit/i);
  });
});

// Postgres numerics arrive from jsonb_build_object as JSON numbers, not
// strings. The whole suite used string fixtures and missed this until the
// first real formula reached the scaler in a browser.
describe("scaleFormula — quantities that arrive as numbers", () => {
  const NUMERIC_JALAPENO = {
    formulaVersionId: "33333333-3333-3333-3333-333333333333",
    name: "Mosaiq Jalapeno",
    intendedYieldValue: null,
    intendedYieldUnit: null,
    components: [
      { lineNumber: 1, ingredientName: "Jalapenos", quantity: 5400 as unknown as string, unit: "gr" },
      { lineNumber: 2, ingredientName: "Water", quantity: 18000 as unknown as string, unit: "ml" },
      { lineNumber: 3, ingredientName: "Citric acid", quantity: 30 as unknown as string, unit: "gr" },
    ],
  } satisfies NormalizedFormula;

  it("accepts a numeric quantity without throwing", () => {
    const result = scaleFormula(NUMERIC_JALAPENO, {
      mode: "limitingIngredient",
      ingredientName: "Jalapenos",
      availableQuantity: "3700",
      unit: "gr",
    });
    // 3700/5400 reduces to 37/54 — the non-terminating case.
    expect(result.factor.exact).toBe("37/54");
    expect(result.factor.decimalIsExact).toBe(false);
  });

  it("accepts a numeric available quantity too", () => {
    const result = scaleFormula(NUMERIC_JALAPENO, {
      mode: "limitingIngredient",
      ingredientName: "Jalapenos",
      availableQuantity: 2700 as unknown as string,
      unit: "gr",
    });
    expect(result.factor.exact).toBe("1/2");
  });

  it("accepts a numeric multiplier", () => {
    const result = scaleFormula(NUMERIC_JALAPENO, {
      mode: "multiplier",
      multiplier: 2 as unknown as string,
    });
    expect(result.factor.exact).toBe("2");
  });
});

// "grams" and "gr" are the same unit spelled differently. Refusing that is
// pedantry, not safety. Converting kg to gr would be a different matter and is
// still refused.
describe("scaleFormula — unit spelling vs unit dimension", () => {
  it("accepts a different spelling of the same unit", () => {
    for (const spelling of ["gr", "g", "gram", "grams", "GRAMS", " Grams "]) {
      const result = scaleFormula(JALAPENO, {
        mode: "limitingIngredient",
        ingredientName: "Jalapeno",
        availableQuantity: "3700",
        unit: spelling,
      });
      expect(result.factor.exact).toBe("74/105");
    }
  });

  it("still refuses a genuine dimension change", () => {
    expect(() =>
      scaleFormula(JALAPENO, {
        mode: "limitingIngredient",
        ingredientName: "Jalapeno",
        availableQuantity: "3.7",
        unit: "kg",
      })
    ).toThrow(/does not convert units/i);
  });

  it("never treats oz as a synonym of anything — it is ambiguous", () => {
    const ozFormula: NormalizedFormula = {
      ...CORDIAL,
      components: [
        { lineNumber: 1, ingredientName: "Sugar", quantity: "16", unit: "oz" },
      ],
    };
    expect(() =>
      scaleFormula(ozFormula, {
        mode: "limitingIngredient",
        ingredientName: "Sugar",
        availableQuantity: "453.6",
        unit: "gr",
      })
    ).toThrow(/does not convert units/i);
  });
});

describe("scaleFormula — refusals", () => {
  it("refuses a non-positive multiplier", () => {
    expect(() => scaleFormula(CORDIAL, { mode: "multiplier", multiplier: "0" })).toThrow(
      /positive/i
    );
    expect(() => scaleFormula(CORDIAL, { mode: "multiplier", multiplier: "-1" })).toThrow(
      /positive/i
    );
  });

  it("refuses a formula with no components", () => {
    const empty: NormalizedFormula = { ...CORDIAL, components: [] };
    expect(() => scaleFormula(empty, { mode: "multiplier", multiplier: "2" })).toThrow(
      /component/i
    );
  });

  it("refuses an unknown limiting ingredient", () => {
    expect(() =>
      scaleFormula(JALAPENO, {
        mode: "limitingIngredient",
        ingredientName: "Habanero",
        availableQuantity: "100",
        unit: "gr",
      })
    ).toThrow(/not a component/i);
  });

  it("refuses a component quantity that is not a number", () => {
    const broken: NormalizedFormula = {
      ...CORDIAL,
      components: [{ lineNumber: 1, ingredientName: "Water", quantity: "", unit: "gr" }],
    };
    expect(() => scaleFormula(broken, { mode: "multiplier", multiplier: "2" })).toThrow(
      /quantity/i
    );
  });

  it("refuses a target yield when the formula has no planned yield", () => {
    const noYield: NormalizedFormula = { ...CORDIAL, intendedYieldValue: null };
    expect(() =>
      scaleFormula(noYield, { mode: "targetYield", targetYieldValue: "10" })
    ).toThrow(/planned yield/i);
  });
});
