import { describe, expect, it } from "vitest";
import { formulaKey } from "./version-syrups";
import { componentsFor, duplicateKeys, planFingerprint } from "./version-cocktails";

const draft = (name: string, items: Array<[string, string, string]>) => ({
  draftId: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  items: items.map(([n, q, u]) => ({ name: n, quantity: q, unit: u, role: "ingredient" as const })),
});

describe("the six acid and seasoning formulas get distinct keys", () => {
  // The whole failure class this corpus has already hit twice: two names that
  // collapse to one formula key, so approving the second retires the first.
  it("gives every one of them its own key", () => {
    const names = [
      "Saline Solution", "Citric Acid Solution", "Acid-Adjusted Orange Juice",
      "Acid-Adjusted Grapefruit Juice", "Lemon Citric Acid", "Lime Citric Acid",
    ];
    const keys = names.map(formulaKey);
    expect(new Set(keys).size).toBe(names.length);
    expect(keys).toEqual([
      "saline-solution", "citric-acid-solution", "acid-adjusted-orange-juice",
      "acid-adjusted-grapefruit-juice", "lemon-citric-acid", "lime-citric-acid",
    ]);
  });

  it("keeps the dosing solution distinct from the juice-strength ones", () => {
    expect(formulaKey("Citric Acid Solution")).not.toBe(formulaKey("Lemon Citric Acid"));
    expect(formulaKey("Citric Acid Solution")).not.toBe(formulaKey("Lime Citric Acid"));
  });

  it("still catches a clash if two syrups ever collapse to one key", () => {
    const clashes = duplicateKeys([
      draft("Saline Solution", [["Salt", "200", "gr"]]),
      draft("saline solution", [["Salt", "100", "gr"]]),
    ]);
    expect(clashes).toHaveLength(1);
  });
});

describe("a syrup cannot be versioned without a measurable line", () => {
  it("refuses a component with no quantity", () => {
    expect(() => componentsFor(draft("X", [["Citric Acid", "", "gr"]]))).toThrow(/no quantity/);
  });

  it("refuses a component with no unit", () => {
    expect(() => componentsFor(draft("X", [["Citric Acid", "100", ""]]))).toThrow(/no unit/);
  });

  it("numbers the lines in order", () => {
    const c = componentsFor(draft("Saline Solution", [["Salt", "200", "gr"], ["Water", "800", "ml"]]));
    expect(c.map(x => [x.line_number, x.ingredient_name, x.quantity, x.unit])).toEqual([
      [1, "Salt", "200", "gr"],
      [2, "Water", "800", "ml"],
    ]);
  });
});

describe("the fingerprint is what her yes attaches to", () => {
  it("changes when a quantity changes", () => {
    const a = planFingerprint([draft("Lime Citric Acid", [["Citric Acid", "120", "gr"]])]);
    const b = planFingerprint([draft("Lime Citric Acid", [["Citric Acid", "100", "gr"]])]);
    expect(a).not.toBe(b);
  });

  it("changes when an ingredient is added", () => {
    const a = planFingerprint([draft("Lime Citric Acid", [["Citric Acid", "120", "gr"]])]);
    const b = planFingerprint([
      draft("Lime Citric Acid", [["Citric Acid", "120", "gr"], ["Malic Acid ( Lime )", "60", "gr"]]),
    ]);
    expect(a).not.toBe(b);
  });

  it("is stable for the same plan", () => {
    const d = [draft("Saline Solution", [["Salt", "200", "gr"], ["Water", "800", "ml"]])];
    expect(planFingerprint(d)).toBe(planFingerprint(d));
  });
});
