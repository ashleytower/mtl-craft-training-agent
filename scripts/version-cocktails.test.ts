import { describe, expect, it } from "vitest";
import { componentsFor, duplicateKeys, planFingerprint, type ResolvedDraft } from "./version-cocktails";

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

describe("duplicate names", () => {
  // Two cocktail drafts are both called "Spicy Margarita". They slugify to one
  // formula key, so approving both made the second supersede the first —
  // migration 127 doing exactly its job on input that should never have reached
  // it. The specs were identical so nothing wrong was served, but the run
  // reported "approved 38 of 38" when 37 distinct drinks existed, and the
  // read-back agreed because it matched on name. A count that cannot tell 38
  // from 37 is not a count.
  it("finds two drinks that would collide on one formula key", () => {
    const clash = duplicateKeys([
      draft({ draftId: "a", name: "Spicy Margarita" }),
      draft({ draftId: "b", name: "spicy  margarita" }),
      draft({ draftId: "c", name: "Negroni" }),
    ]);
    expect(clash).toEqual([{ key: "spicy-margarita", names: ["Spicy Margarita", "spicy  margarita"] }]);
  });

  it("says nothing when every drink is its own formula", () => {
    expect(duplicateKeys([
      draft({ draftId: "a", name: "Negroni" }),
      draft({ draftId: "b", name: "Boulevardier" }),
    ])).toEqual([]);
  });
});
