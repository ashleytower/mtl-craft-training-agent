import { describe, expect, it } from "vitest";
import {
  auditWarnings,
  buildDraft,
  canonicalName,
  isBlocking,
  mergeVariants,
  parseQuantity,
} from "./import-notion-syrups";
import { resolveDraftIngredients } from "../shared/ingredients";

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

  // Notion's yields are not imported at all now, so the audit's job changed:
  // it must SAY what Notion claimed and that it was rejected, so nobody later
  // assumes the blank yield means Notion had none.
  it("reports a Notion yield as seen-but-not-imported", () => {
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
    expect(w.join(" ")).toContain("NOT imported");
    expect(w.join(" ")).toContain("1 L");
  });

  it("says the same for a plausible-looking yield, because none are trusted", () => {
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
    expect(w.join(" ")).toContain("NOT imported");
  });

  it("says target-yield scaling will refuse when there is no yield", () => {
    const w = auditWarnings(merged({ name: "Simple syrup", ingredients: [{ name: "Sugar", qty: "6000", unit: "gr" }] }));
    expect(w.join(" ")).toContain("Set one in Supabase after a real batch");
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
    // Mutate an INGREDIENT, not the yield. Yields stopped being part of the
    // stored content when Ashley ruled that every Notion spec is wrong, so a
    // yield edit legitimately no longer moves the hash. An ingredient edit must.
    const edited = {
      ...m,
      chosen: {
        ...m.chosen,
        ingredients: [
          { name: "Sugar", qty: "21,000", unit: "gr" },
          { name: "Jalapenos", qty: "5400", unit: "gr" },
        ],
      },
    };
    const b = buildDraft(edited);
    expect(b.original_source_hash).toBe(a.original_source_hash);
    // ...but the content hash moves, which is how a re-run reports a change.
    expect(b.original_recipe_json.content_sha256).not.toBe(
      a.original_recipe_json.content_sha256
    );
  });

  // These two asserted `name` / `quantity`, which is what the importer used to
  // store and is exactly the field-name bug: nothing that reads a draft looks
  // for those keys. They now assert the contract in shared/ingredients.ts.
  it("normalises the thousands separator into the stored quantity", () => {
    const d = buildDraft(m);
    const sugar = (
      d.original_recipe_json.ingredients as Array<{
        ingredient_name: string;
        quantity_normalized: string;
      }>
    ).find(i => i.ingredient_name === "Sugar");
    expect(sugar?.quantity_normalized).toBe("20000");
  });

  it("keeps the raw quantity beside the parsed one", () => {
    const d = buildDraft(m);
    const sugar = (
      d.original_recipe_json.ingredients as Array<{
        ingredient_name: string;
        quantity_raw: string;
      }>
    ).find(i => i.ingredient_name === "Sugar");
    expect(sugar?.quantity_raw).toBe("20,000");
  });

  it("imports no yield at all, however confident Notion looks", () => {
    const d = buildDraft(m);
    expect(d.intended_yield_value).toBeNull();
    expect(d.intended_yield_unit).toBeNull();
  });

  it("is deterministic", () => {
    expect(buildDraft(m)).toEqual(buildDraft(m));
  });
});

describe("isBlocking", () => {
  // A report where every row is flagged flags nothing. Before this split, all
  // 56 formulas carried a warning — every one has a merge note or a rejected
  // Notion yield — so "needs a look" meant "everything" and therefore nothing.
  it("blocks on things only Ashley can supply", () => {
    expect(isBlocking("NO INGREDIENTS in Notion — cannot be approved until a recipe is supplied.")).toBe(true);
    expect(isBlocking('"Water" has no usable quantity in Notion (raw: "").')).toBe(true);
    expect(isBlocking('"Sugar" has a quantity but no unit in Notion.')).toBe(true);
    expect(isBlocking("Ingredient points at a deleted Notion page: UNKNOWN (…)")).toBe(true);
    expect(isBlocking("Two merged rows were equally complete — confirm the kept one is right.")).toBe(true);
  });

  it("does not block on context she does not need to act on", () => {
    expect(isBlocking('Collapsed 3 Notion rows into one formula. Kept "x" (5 complete ingredients); merged away "y" (3).')).toBe(false);
    expect(isBlocking("Notion claims a yield of 1 L. NOT imported — Notion specs are unreliable.")).toBe(false);
    expect(isBlocking("No yield in Notion. Set one in Supabase after a real batch.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The contract between this importer and everything that reads a draft.
//
// These exist because the first version of this importer wrote
// {name, quantity, unit} while `resolveDraftIngredients`, the console and the
// versioning path all read {ingredient_name, quantity_normalized, unit_name}.
// Every unit test passed. All 56 formulas landed in the database. And not one
// of them could be opened, because nothing on the reading side could see a
// single ingredient. A test that only checks what the importer produces cannot
// catch that; it has to run the real reader over the real output.
// ---------------------------------------------------------------------------
describe("what buildDraft writes is what the reader reads", () => {
  const jalapeno = mergeVariants([
    syrup({
      name: "Mosaiq Jalapeno (first run)",
      ingredients: [
        { name: "Sugar", qty: "20,000", unit: "gr" },
        { name: "Jalapenos", qty: "5400", unit: "gr" },
        { name: "Water", qty: "18,000", unit: "ml" },
      ],
    }),
  ])[0];

  it("hands resolveDraftIngredients a recipe it can actually read", () => {
    const resolved = resolveDraftIngredients(buildDraft(jalapeno) as never, []);
    expect(resolved.source).toBe("structured");
    expect(resolved.items).toHaveLength(3);
    expect(resolved.blocked).toBe(false);
  });

  it("carries the quantity across as an exact decimal, not a float", () => {
    const resolved = resolveDraftIngredients(buildDraft(jalapeno) as never, []);
    const sugar = resolved.items.find(i => i.name === "Sugar");
    expect(sugar?.quantity).toBe("20000");
    expect(sugar?.unit).toBe("gr");
    expect(sugar?.issues).toEqual([]);
  });

  it("keeps the raw Notion string beside the parsed one, for provenance", () => {
    const ings = buildDraft(jalapeno).original_recipe_json.ingredients as Array<{
      quantity_raw: string | null;
    }>;
    expect(ings[0].quantity_raw).toBe("20,000");
  });

  // A blank quantity must survive as a VISIBLE hole all the way to the reader,
  // not quietly become a zero or vanish.
  it("passes a blank quantity through as blocked, not as a number", () => {
    const m = mergeVariants([
      syrup({
        name: "Blood Orange Cordial",
        ingredients: [{ name: "Water", qty: "", unit: null }],
      }),
    ])[0];
    const resolved = resolveDraftIngredients(buildDraft(m) as never, []);
    expect(resolved.blocked).toBe(true);
    expect(resolved.items[0].quantity).toBeNull();
  });
});

describe("merge order", () => {
  // Notion decides what order it hands us pages in. If that order decides which
  // row wins, a re-extraction silently INSERTS duplicate drafts under new source
  // hashes and strands the current ones — so the merge has to be a function of
  // the content, not of the arrival order.
  const rows = [
    syrup({
      notion_url: "https://app.notion.com/p/bbb",
      name: "Butterfly Pea",
      ingredients: [{ name: "A", qty: "1", unit: "gr" }],
    }),
    syrup({
      notion_url: "https://app.notion.com/p/aaa",
      name: "Mosaiq Butterfly Pea (first run)",
      ingredients: [{ name: "B", qty: "2", unit: "gr" }],
    }),
  ];

  it("picks the same row whichever order Notion returns the pages in", () => {
    const forward = mergeVariants(rows);
    const reversed = mergeVariants([...rows].reverse());
    expect(reversed[0].chosen.notion_url).toBe(forward[0].chosen.notion_url);
  });

  it("produces the same content hash whichever order the pages arrive in", () => {
    const forward = buildDraft(mergeVariants(rows)[0]);
    const reversed = buildDraft(mergeVariants([...rows].reverse())[0]);
    expect(reversed.original_source_hash).toBe(forward.original_source_hash);
    expect(reversed.original_recipe_json.content_sha256).toBe(
      forward.original_recipe_json.content_sha256
    );
  });

  // A row whose ingredient is a deleted Notion page is not "complete". Counting
  // it as complete let the Espresso merge keep the row with the deleted page and
  // discard the row that still had "Espresso 600 gr" in it.
  it("does not count a deleted Notion page as a complete ingredient", () => {
    const merged = mergeVariants([
      syrup({
        name: "Mosaiq Espresso Syrup (first run whole batch)",
        ingredients: [
          { name: "Coffee", qty: "28000", unit: "gr" },
          { name: "UNKNOWN (deleted ingredient page, was x)", qty: "600", unit: "ml" },
        ],
      }),
      syrup({
        name: "Mosaiq Espresso Syrup (first run)",
        ingredients: [
          { name: "Coffee", qty: "28000", unit: "gr" },
          { name: "Espresso", qty: "600", unit: "gr" },
        ],
      }),
    ]);
    expect(merged[0].chosen.ingredients.map(i => i.name)).toContain("Espresso");
  });
});

describe("zero quantities", () => {
  // Blood Orange Cordial genuinely carries "Blood Oranges ( Fresh ) 0 gr" beside
  // a 550 gr row. Zero grams of an ingredient is not a measurement, and
  // parseQuantity reads "0" as a perfectly good number, so the audit has to be
  // the thing that catches it.
  it("blocks on a zero quantity", () => {
    const w = auditWarnings(
      mergeVariants([
        syrup({
          name: "Blood Orange Cordial",
          ingredients: [{ name: "Blood Oranges ( Fresh )", qty: "0", unit: "gr" }],
        }),
      ])[0]
    );
    expect(w.join(" ")).toContain("quantity of 0");
    expect(w.filter(isBlocking).length).toBeGreaterThan(0);
  });

  it("still reads a real quantity of zero-point-something", () => {
    const w = auditWarnings(
      mergeVariants([
        syrup({ name: "X", ingredients: [{ name: "Citric acid", qty: "0.5", unit: "gr" }] }),
      ])[0]
    );
    expect(w.join(" ")).not.toContain("quantity of 0");
  });
});

describe("the content hash covers everything that gets stored", () => {
  // `warnings` is stored ON the draft row, and the ingest RPC skips a row whose
  // content hash is unchanged. So anything stored but left out of the hash can
  // never be repaired by a re-run: fix the audit, re-import, and the RPC
  // correctly reports "unchanged" while the wrong warnings sit there forever.
  // This is the same shape as the yield bug that an earlier test caught.
  it("moves when only the warnings change", () => {
    const m = mergeVariants([
      syrup({
        notion_url: "https://app.notion.com/p/hash-check",
        name: "Thing",
        ingredients: [{ name: "Sugar", qty: "1000", unit: "gr" }],
      }),
    ])[0];

    const before = buildDraft(m);
    // Same recipe, different derived warnings — exactly what a fix to
    // auditWarnings produces.
    const after = buildDraft({ ...m, warnings: [...m.warnings, "a new audit finding"] });

    expect(after.original_source_hash).toBe(before.original_source_hash);
    expect(after.warnings).not.toEqual(before.warnings);
    expect(after.original_recipe_json.content_sha256).not.toBe(
      before.original_recipe_json.content_sha256
    );
  });
});
