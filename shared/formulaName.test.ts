import { describe, expect, it } from "vitest";
import { cleanFormulaName, stripBatchQualifier } from "./formulaName";

describe("cleanFormulaName", () => {
  it("strips the venue/programme prefix", () => {
    expect(cleanFormulaName("Mosaiq Jalapeno")).toBe("Jalapeno");
    expect(cleanFormulaName("Kosher Orgeat")).toBe("Orgeat");
    expect(cleanFormulaName("KOSHER Mint")).toBe("Mint");
  });

  it("strips batch qualifiers", () => {
    expect(cleanFormulaName("Mosaiq Jalapeno (first run)")).toBe("Jalapeno");
    expect(cleanFormulaName("Mosaiq Jalapeno (first run whole batch)")).toBe("Jalapeno");
    expect(cleanFormulaName("Mosaiq Butterfly Pea (first run total batch)")).toBe(
      "Butterfly Pea"
    );
    expect(cleanFormulaName("Spiced Cran ( big Batch )")).toBe("Spiced Cran");
  });

  it("strips leading emoji from the intake", () => {
    expect(cleanFormulaName("🫚Mosaiq Ginger (first run)")).toBe("Ginger");
  });

  // The distinction that matters: a meaningful bracket is not noise.
  it("keeps a bracket that names a real variant", () => {
    expect(cleanFormulaName("Orgeat (bought almond milk)")).toBe(
      "Orgeat (bought almond milk)"
    );
    expect(cleanFormulaName("Blood Oranges ( Fresh )")).toBe("Blood Oranges ( Fresh )");
  });

  it("leaves an already-clean name alone", () => {
    expect(cleanFormulaName("Hibiscus")).toBe("Hibiscus");
    expect(cleanFormulaName("Blood Orange Cordial")).toBe("Blood Orange Cordial");
  });

  it("never returns an empty name", () => {
    expect(cleanFormulaName("Mosaiq")).toBe("Mosaiq");
    expect(cleanFormulaName("(first run)")).toBe("(first run)");
  });
});

describe("stripBatchQualifier removes a batch qualifier and nothing else", () => {
  it("removes the batch qualifiers the Notion intake adds", () => {
    expect(stripBatchQualifier("Salted Grapefruit (first run whole batch)")).toBe("Salted Grapefruit");
    expect(stripBatchQualifier("Butterfly Pea (first run)")).toBe("Butterfly Pea");
    expect(stripBatchQualifier("Thing (big batch)")).toBe("Thing");
  });

  // The reason this list is explicit. A trailing bracket that is part of the
  // name must survive: two recipes flattened onto one name become one formula
  // key, and the second silently supersedes the first. That is what happened to
  // both "Spicy Margarita" drafts.
  it("keeps a trailing bracket that is part of the name", () => {
    expect(stripBatchQualifier("Salted Grapefruit (Quick)")).toBe("Salted Grapefruit (Quick)");
    expect(stripBatchQualifier("Orgeat (bought almond milk)")).toBe("Orgeat (bought almond milk)");
    expect(stripBatchQualifier("Mint ( 4 bunches approx )")).toBe("Mint ( 4 bunches approx )");
  });

  it("leaves a name with no bracket alone", () => {
    expect(stripBatchQualifier("Salted Grapefruit Quick")).toBe("Salted Grapefruit Quick");
    expect(stripBatchQualifier("Simple Syrup 2:1")).toBe("Simple Syrup 2:1");
  });
});
