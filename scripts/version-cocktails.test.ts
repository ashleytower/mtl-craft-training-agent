import { describe, expect, it } from "vitest";
import { componentsFor, planFingerprint, type ResolvedDraft } from "./version-cocktails";

const draft = (over: Partial<ResolvedDraft> = {}): ResolvedDraft => ({
  draftId: "d1",
  name: "Summer in Italy",
  items: [
    { name: "Gin", quantity: "1.5", unit: "oz", role: "ingredient" },
    { name: "Green Grape Skewer", quantity: "1", unit: "garnish", role: "garnish" },
  ],
  ...over,
});

describe("componentsFor", () => {
  it("numbers lines from one and keeps the resolver's order", () => {
    const c = componentsFor(draft());
    expect(c.map(x => x.line_number)).toEqual([1, 2]);
    expect(c.map(x => x.ingredient_name)).toEqual(["Gin", "Green Grape Skewer"]);
  });

  // Migration 128 exists so a skewer is not stored as an "ingredient". Collapsing
  // the two makes a measured line and a presentation line indistinguishable,
  // which is what a Tajín rim in the wrong place looked like.
  it("keeps a garnish a garnish", () => {
    const c = componentsFor(draft());
    expect(c[0].component_role).toBe("ingredient");
    expect(c[1].component_role).toBe("garnish");
  });

  it("passes the quantity through as the exact string it resolved to", () => {
    expect(componentsFor(draft()).map(c => c.quantity)).toEqual(["1.5", "1"]);
  });

  // A component with no quantity cannot be scaled and must never reach a
  // formula version. The resolver already blocks these; this is the second net.
  it("refuses a row with no quantity or no unit rather than defaulting it", () => {
    expect(() => componentsFor(draft({
      items: [{ name: "Gin", quantity: null, unit: "oz", role: "ingredient" }],
    }))).toThrow(/quantity/i);
    expect(() => componentsFor(draft({
      items: [{ name: "Gin", quantity: "1", unit: null, role: "ingredient" }],
    }))).toThrow(/unit/i);
  });

  it("refuses an empty recipe", () => {
    expect(() => componentsFor(draft({ items: [] }))).toThrow(/no components/i);
  });
});

describe("planFingerprint", () => {
  // She approves a LIST she read. If anything about any spec moved between the
  // plan and the apply, the apply must refuse rather than write something she
  // never saw.
  it("changes when any quantity changes", () => {
    const a = planFingerprint([draft()]);
    const b = planFingerprint([draft({
      items: [
        { name: "Gin", quantity: "2", unit: "oz", role: "ingredient" },
        { name: "Green Grape Skewer", quantity: "1", unit: "garnish", role: "garnish" },
      ],
    })]);
    expect(b).not.toBe(a);
  });

  it("changes when a drink joins or leaves the list", () => {
    const one = planFingerprint([draft()]);
    const two = planFingerprint([draft(), draft({ draftId: "d2", name: "Negroni" })]);
    expect(two).not.toBe(one);
  });

  it("does not change just because the drinks arrive in a different order", () => {
    const a = draft();
    const b = draft({ draftId: "d2", name: "Negroni" });
    expect(planFingerprint([a, b])).toBe(planFingerprint([b, a]));
  });

  it("is stable for the same plan", () => {
    expect(planFingerprint([draft()])).toBe(planFingerprint([draft()]));
  });
});
