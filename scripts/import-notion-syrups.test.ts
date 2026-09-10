import { describe, expect, it } from "vitest";
import {
  auditWarnings,
  buildDraft,
  canonicalName,
  mergeVariants,
  parseQuantity,
} from "./import-notion-syrups";

const syrup = (over: Record<string, unknown> = {}) =>
  ({
    notion_url: "https://app.notion.com/p/" + Math.random().toString(16).slice(2),
    name: "Thing",
    ingredients: [],
    ...over,
  }) as Parameters<typeof mergeVariants>[0][number];

describe("parseQuantity", () => {
  it("reads a thousands separator as a thousands separator", () => {
    // "20,000" is twenty thousand. The same recipe stores water as both
    // "18,000" and 18000, which is what settles it.
    expect(parseQuantity("20,000")).toBe(20000);
    expect(parseQuantity("18,000")).toBe(18000);
  });

  it("reads plain and decimal numbers", () => {
    expect(parseQuantity("5400")).toBe(5400);
    expect(parseQuantity("3.6")).toBe(3.6);
    expect(parseQuantity(" 30 ")).toBe(30);
  });

  // The whole point. A quantity that cannot be read must not become a number,
  // because a plausible number in a recipe is worse than a visible hole.
  it("refuses anything it cannot read, rather than guessing", () => {
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity(null)).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
    expect(parseQuantity("a few")).toBeNull();
    expect(parseQuantity("2-3")).toBeNull();
    expect(parseQuantity("~500")).toBeNull();
    expect(parseQuantity("500g")).toBeNull();
  });
});

describe("canonicalName", () => {
  it("collapses the Mosaiq batch variants onto one name", () => {
    expect(canonicalName("Mosaiq Jalapeno (first run)")).toBe("Jalapeno");
    expect(canonicalName("Mosaiq Jalapeno (first run whole batch)")).toBe("Jalapeno");
    expect(canonicalName("Mosaiq Butterfly Pea (first run total batch)")).toBe("Butterfly Pea");
    expect(canonicalName("Jalapeno")).toBe("Jalapeno");
  });

  it("strips a leading emoji", () => {
    expect(canonicalName("🫚Mosaiq Ginger (first run)")).toBe("Ginger");
  });

  it("leaves a name that is not a variant alone", () => {
    expect(canonicalName("Lemon Super Juice")).toBe("Lemon Super Juice");
    expect(canonicalName("Simple Syrup 2:1")).toBe("Simple Syrup 2:1");
  });

  // "Spiced Cran ( big Batch )" is a batch note, but "Simple Syrup 2:1" is a
  // ratio and must survive. Only a trailing parenthetical is dropped.
  it("does not eat a meaningful suffix that is not parenthesised", () => {
    expect(canonicalName("Simple Syrup 2:1")).toContain("2:1");
  });
});

describe("mergeVariants", () => {
  it("keeps the richest row, not the base row", () => {
    // The real case: `Espresso Syrup` has zero ingredients in Notion while the
    // Mosaiq row has the actual recipe. Collapsing onto the base name would
    // have thrown away the only surviving copy.
    const merged = mergeVariants([
      syrup({ name: "Espresso Syrup", ingredients: [] }),
      syrup({
        name: "Mosaiq Espresso Syrup (first run whole batch)",
        ingredients: [
          { name: "Coffee", qty: "28000", unit: "gr" },
          { name: "Sugar", qty: "20000", unit: "gr" },
        ],
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].canonical).toBe("Espresso Syrup");
    expect(merged[0].chosen.ingredients).toHaveLength(2);
  });

  it("counts an ingredient as complete only with name, quantity and unit", () => {
    const merged = mergeVariants([
      syrup({
        name: "Kiwi",
        ingredients: [
          { name: "Kiwi", qty: "1000", unit: "gr" },
          { name: "Xanthan Gum", qty: "", unit: null },
        ],
      }),
      syrup({
        name: "Mosaiq Kiwi (first run)",
        ingredients: [
          { name: "Kiwi", qty: "1000", unit: "gr" },
          { name: "Sugar", qty: "1000", unit: "gr" },
        ],
      }),
    ]);
    // Two complete beats one complete plus one blank.
    expect(merged[0].chosen.ingredients.map(i => i.name)).toEqual(["Kiwi", "Sugar"]);
  });

  it("says what it merged away, so a collapse is never silent", () => {
    const merged = mergeVariants([
      syrup({ name: "Jalapeno", ingredients: [{ name: "Jalapenos", qty: "5400", unit: "gr" }] }),
      syrup({
        name: "Mosaiq Jalapeno (first run)",
        ingredients: [
          { name: "Jalapenos", qty: "5400", unit: "gr" },
          { name: "Sugar", qty: "20000", unit: "gr" },
        ],
      }),
    ]);
    expect(merged[0].mergedFrom).toHaveLength(2);
    expect(merged[0].warnings.join(" ")).toContain("Collapsed 2 Notion rows");
    expect(merged[0].warnings.join(" ")).toContain("merged away");
  });

  it("flags a tie so a human confirms which row was kept", () => {
    const merged = mergeVariants([
      syrup({ name: "Tie", ingredients: [{ name: "A", qty: "1", unit: "gr" }] }),
      syrup({ name: "Mosaiq Tie (first run)", ingredients: [{ name: "B", qty: "2", unit: "gr" }] }),
    ]);
    expect(merged[0].warnings.join(" ")).toContain("equally complete");
  });

  it("does not merge two genuinely different syrups", () => {
    const merged = mergeVariants([
      syrup({ name: "Simple syrup" }),
      syrup({ name: "Simple Syrup 2:1" }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("auditWarnings", () => {
  const merged = (over: Record<string, unknown>) =>
    mergeVariants([syrup(over)])[0];

  it("refuses to let an empty recipe look approvable", () => {
    const w = auditWarnings(merged({ name: "Syrup Recipe", ingredients: [] }));
    expect(w.join(" ")).toContain("NO INGREDIENTS");
  });

  it("names an ingredient whose quantity Notion left blank", () => {
    const w = auditWarnings(
      merged({
        name: "Blood Orange Cordial",
        ingredients: [{ name: "Water", qty: "", unit: null }],
        yield_value: 4,
        yield_unit: "L",
      })
    );
    expect(w.join(" ")).toContain('"Water" has no usable quantity');
  });

  it("names an ingredient pointing at a deleted Notion page", () => {
    const w = auditWarnings(
      merged({
        name: "Espresso Syrup",
        ingredients: [{ name: "UNKNOWN (deleted ingredient page, was x)", qty: "600", unit: "ml" }],
      })
    );
    expect(w.join(" ")).toContain("deleted Notion page");
  });

  // Notion's yields are demonstrably unreliable: the jalapeño row claimed 6 L
  // for a batch holding 18 L of water. Import the number, never trust it.
  it("catches a yield far too small for its ingredients", () => {
    const w = auditWarnings(
      merged({
        name: "Salted Grapefruit",
        ingredients: [
          { name: "Sugar", qty: "26000", unit: "gr" },
          { name: "Grapefruit Juice", qty: "13500", unit: "ml" },
        ],
        yield_value: 1,
        yield_unit: "L",
      })
    );
    expect(w.join(" ")).toContain("looks too small");
  });

  it("does not cry wolf on a plausible yield", () => {
    const w = auditWarnings(
      merged({
        name: "Jalapeno",
        ingredients: [
          { name: "Sugar", qty: "20000", unit: "gr" },
          { name: "Water", qty: "18000", unit: "ml" },
        ],
        yield_value: 30,
        yield_unit: "L",
      })
    );
    expect(w.join(" ")).not.toContain("looks too small");
  });

  it("says target-yield scaling will refuse when there is no yield", () => {
    const w = auditWarnings(merged({ name: "Simple syrup", ingredients: [{ name: "Sugar", qty: "6000", unit: "gr" }] }));
    expect(w.join(" ")).toContain("target-yield scaling will refuse");
  });
});

describe("buildDraft", () => {
  const m = mergeVariants([
    syrup({
      notion_url: "https://app.notion.com/p/abc123",
      name: "Mosaiq Jalapeno (first run)",
      yield_value: 30,
      yield_unit: "L",
      ingredients: [
        { name: "Sugar", qty: "20,000", unit: "gr" },
        { name: "Jalapenos", qty: "5400", unit: "gr" },
      ],
    }),
  ])[0];

  it("names the formula canonically and never approves it", () => {
    const d = buildDraft(m);
    expect(d.name).toBe("Jalapeno");
    expect(d.product_category).toBe("syrup_or_related_product");
    expect(Object.keys(d)).not.toContain("draft_status");
    expect(Object.keys(d)).not.toContain("lifecycle_status");
  });

  it("hashes the SOURCE identity, not the content, so one page stays one draft", () => {
    const a = buildDraft(m);
    const edited = { ...m, chosen: { ...m.chosen, yield_value: 31 } };
    const b = buildDraft(edited);
    expect(b.original_source_hash).toBe(a.original_source_hash);
    // ...but the content hash moves, which is how a re-run reports a change.
    expect(b.original_recipe_json.content_sha256).not.toBe(
      a.original_recipe_json.content_sha256
    );
  });

  it("normalises the thousands separator into the stored quantity", () => {
    const d = buildDraft(m);
    const sugar = (d.original_recipe_json.ingredients as Array<{ name: string; quantity: number }>)
      .find(i => i.name === "Sugar");
    expect(sugar?.quantity).toBe(20000);
  });

  it("keeps the raw quantity beside the parsed one", () => {
    const d = buildDraft(m);
    const sugar = (
      d.original_recipe_json.ingredients as Array<{ name: string; quantity_raw: string }>
    ).find(i => i.name === "Sugar");
    expect(sugar?.quantity_raw).toBe("20,000");
  });

  it("marks the yield unverified", () => {
    expect(buildDraft(m).original_recipe_json.yield_verified).toBe(false);
  });

  it("is deterministic", () => {
    expect(buildDraft(m)).toEqual(buildDraft(m));
  });
});
