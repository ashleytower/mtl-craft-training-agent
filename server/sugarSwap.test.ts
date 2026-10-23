import { describe, expect, it } from "vitest";
import { swapSugar } from "./sugarSwap";
import type { NormalizedFormula } from "./beverageScaling";

// Ashley 2026-10-22: when she wants to use her syrup in a jelly, Brix says how much.
// Her rule for this (2026-10-23): count 1 ml of WATER as 1 g. Nothing else converts.
// Every recipe below is a real approved recipe, copied line for line.

function formula(name: string, lines: Array<[string, string, string]>): NormalizedFormula {
  return {
    formulaVersionId: `id-${name}`,
    name,
    intendedYieldValue: null,
    intendedYieldUnit: null,
    components: lines.map(([ingredientName, quantity, unit], i) => ({
      lineNumber: i + 1, ingredientName, quantity, unit,
    })),
  };
}

const PEACH_SYRUP = formula("Peach Syrup (Solid Wiggles)", [
  ["Peach puree", "250", "gr"], ["Water", "250", "gr"], ["Sugar", "416", "gr"],
]);
const SIMPLE = formula("Simple Syrup", [["Sugar", "6000", "gr"], ["Water", "6000", "ml"]]);
const SIMPLE_2_1 = formula("Simple Syrup 2:1", [["Sugar", "800", "gr"], ["Water", "400", "ml"]]);
const MANGO_SYRUP = formula("Mango Syrup", [
  ["Mango Juice", "1000", "ml"], ["Sugar", "1000", "gr"], ["Water", "1000", "ml"],
]);
const LEMON_JUICE = formula("Lemon Juice", [["Lemon Juice", "1000", "ml"]]);

const CANVAS = formula("Blank Practice Canvas (6-inch Round)", [
  ["Water", "348", "gr"], ["Sugar", "122", "gr"], ["Gelatin", "21", "gr"],
]);
const PALOMA = formula("Paloma Jelly Shot", [
  ["Lime juice, strained", "105", "gr"], ["Water", "88", "gr"],
  ["Grapefruit juice, strained", "60", "gr"], ["Blanco tequila", "42", "gr"],
  ["Sugar", "104", "gr"], ["Citric acid", "5.6", "gr"], ["Silver gelatin (6 sheets)", "14.1", "gr"],
]);
const GIN_TONIC = formula("Gin + Tonic", [
  ["Tonic water", "187", "gr"], ["Lime juice, strained, 100%", "90", "gr"], ["Gin", "56", "gr"],
  ["Sugar", "52", "gr"], ["Silver sheet gelatin", "14.1", "gr"],
]);
const MULE = formula("Moscow Mule Jelly (6-inch Round)", [
  ["Clarified lime juice (lime-vodka layer)", "187", "gr"], ["Vodka (lime-vodka layer)", "94", "gr"],
  ["Water (lime-vodka layer)", "80", "gr"], ["Sugar (lime-vodka layer)", "118", "gr"],
  ["Silver gelatin sheets (lime-vodka layer)", "20", "gr"],
  ["Clarified or strained lime juice (ginger beer layer)", "22", "gr"],
  ["Ginger beer (ginger beer layer)", "152", "gr"], ["Sugar (ginger beer layer)", "18", "gr"],
  ["Silver gelatin sheets (ginger beer layer)", "8", "gr"],
]);

const line = (r: ReturnType<typeof swapSugar>, name: string) =>
  r.lines.find(l => l.ingredient_name === name);

describe("swapSugar", () => {
  it("counts water ml as grams: 1:1 simple syrup is double the sugar", () => {
    const r = swapSugar(CANVAS, SIMPLE);
    expect(r.syrup_sugar_share.exact).toBe("1/2");
    expect(r.syrup_g.exact).toBe("244");
    expect(r.added_besides_sugar_g.exact).toBe("122");
    // Her water is shown, never changed: that is her call.
    expect(r.jelly_water_lines).toEqual([{ ingredient_name: "Water", quantity: "348", unit: "gr" }]);
    expect(r.lines).toEqual([
      { ingredient_name: "Water", quantity: "348", unit: "gr" },
      { ingredient_name: "Simple Syrup", quantity: "244", unit: "gr" },
      { ingredient_name: "Gelatin", quantity: "21", unit: "gr" },
    ]);
  });

  it("uses exact fractions, never floats (Peach Syrup is 104/229 sugar)", () => {
    const r = swapSugar(PALOMA, PEACH_SYRUP);
    expect(r.syrup_sugar_share.exact).toBe("104/229");
    expect(r.syrup_g.exact).toBe("229");
    expect(r.added_besides_sugar_g.exact).toBe("125");
    expect(line(r, "Sugar")).toBeUndefined();
    expect(r.lines.map(l => l.ingredient_name)).toEqual([
      "Lime juice, strained", "Water", "Grapefruit juice, strained", "Blanco tequila",
      "Peach Syrup (Solid Wiggles)", "Citric acid", "Silver gelatin (6 sheets)",
    ]);
    expect(line(r, "Water")?.quantity).toBe("88");
  });

  it("counts a water line in gr and in ml the same way", () => {
    expect(swapSugar(GIN_TONIC, SIMPLE_2_1).syrup_g.exact).toBe("78");
    expect(swapSugar(GIN_TONIC, SIMPLE_2_1).added_besides_sugar_g.exact).toBe("26");
    expect(swapSugar(GIN_TONIC, SIMPLE_2_1).jelly_water_lines).toEqual([]);
  });

  it("gives a non-terminating amount exactly, and says when the 2-decimal figure is cut short", () => {
    const even = swapSugar(formula("J", [["Sugar", "10", "gr"]]),
      formula("S1", [["Sugar", "1", "gr"], ["Water", "2", "ml"]]));
    expect(even.syrup_g).toMatchObject({ exact: "30", measurable: "30", truncated: false });
    const odd = swapSugar(formula("J2", [["Sugar", "10", "gr"]]),
      formula("S", [["Sugar", "3", "gr"], ["Water", "4", "ml"]]));
    expect(odd.syrup_g).toMatchObject({ exact: "70/3", measurable: "23.33", truncated: true });
    expect(line(odd, "S")?.quantity).toBe("23.33");
  });

  it("refuses a syrup with a non-water ml line, naming it, and gives no number", () => {
    expect(() => swapSugar(CANVAS, MANGO_SYRUP)).toThrow(/Mango Juice.*1000 ml/);
  });

  it("does not count a line that only contains the word water as water", () => {
    const tonic = formula("Tonic Syrup", [["Sugar", "100", "gr"], ["Tonic water", "100", "ml"]]);
    expect(() => swapSugar(CANVAS, tonic)).toThrow(/Tonic water.*100 ml/);
  });

  it("refuses a syrup with no Sugar line, and never reads Sugar syrup as sugar", () => {
    expect(() => swapSugar(CANVAS, LEMON_JUICE)).toThrow(/no Sugar line/i);
    const invert = formula("Invert", [["Sugar syrup", "100", "gr"], ["Water", "10", "ml"]]);
    expect(() => swapSugar(CANVAS, invert)).toThrow(/no Sugar line/i);
  });

  it("refuses sugar not in grams", () => {
    const kg = formula("Kg Syrup", [["Sugar", "1", "kg"], ["Water", "1000", "ml"]]);
    expect(() => swapSugar(CANVAS, kg)).toThrow(/Sugar.*kg/);
  });

  it("asks which layer when a layered jelly has two sugar lines", () => {
    expect(() => swapSugar(MULE, SIMPLE)).toThrow(
      /Sugar \(lime-vodka layer\).*Sugar \(ginger beer layer\)/
    );
  });

  it("swaps only the chosen layer and keeps the layer on the syrup line", () => {
    const top = swapSugar(MULE, SIMPLE, "Sugar (lime-vodka layer)");
    expect(top.syrup_g.exact).toBe("236");
    expect(line(top, "Simple Syrup (lime-vodka layer)")?.quantity).toBe("236");
    expect(line(top, "Sugar (ginger beer layer)")?.quantity).toBe("18");
    expect(top.jelly_water_lines).toEqual([
      { ingredient_name: "Water (lime-vodka layer)", quantity: "80", unit: "gr" },
    ]);
    const bottom = swapSugar(MULE, SIMPLE, "sugar (ginger beer layer)");
    expect(bottom.syrup_g.exact).toBe("36");
    expect(line(bottom, "Sugar (lime-vodka layer)")?.quantity).toBe("118");
  });

  it("lists only the chosen layer's water when both layers have water", () => {
    const two = formula("Naked + Famous Jelly (6-inch Round)", [
      ["Water (lime-mezcal layer)", "74", "gr"], ["Sugar (lime-mezcal layer)", "74", "gr"],
      ["Water (Aperol-lime-Chartreuse layer)", "25", "gr"],
      ["Sugar (Aperol-lime-Chartreuse layer)", "38", "gr"],
    ]);
    const r = swapSugar(two, SIMPLE, "Sugar (Aperol-lime-Chartreuse layer)");
    expect(r.jelly_water_lines).toEqual([
      { ingredient_name: "Water (Aperol-lime-Chartreuse layer)", quantity: "25", unit: "gr" },
    ]);
    expect(swapSugar(CANVAS, SIMPLE).jelly_water_lines).toHaveLength(1);
  });

  it("refuses a sugar_line that is not a Sugar line of the recipe", () => {
    expect(() => swapSugar(MULE, SIMPLE, "Honey")).toThrow(/Honey.*not a Sugar line/);
  });

  it("refuses a jelly with no Sugar line", () => {
    const peach = formula("Peach-Lime-Bitters Jelly Layer (6-inch Round)", [
      ["Peach Syrup (Solid Wiggles)", "107", "gr"], ["Water", "52", "gr"],
    ]);
    expect(() => swapSugar(peach, SIMPLE)).toThrow(/no Sugar line/i);
  });

  it("states what the number does not count", () => {
    expect(swapSugar(CANVAS, SIMPLE).assumption).toMatch(/fruit.*own sugar.*cooked off/i);
  });
});
