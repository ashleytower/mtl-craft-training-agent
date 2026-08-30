import { describe, expect, it } from "vitest";
import { methodForAgent, parseMethodDraft, methodToLines } from "./method";

describe("parseMethodDraft", () => {
  it("returns nothing for absent or blank source text", () => {
    expect(parseMethodDraft(undefined)).toEqual([]);
    expect(parseMethodDraft(null)).toEqual([]);
    expect(parseMethodDraft("   \n  ")).toEqual([]);
  });

  it("reads a numbered list under section headers", () => {
    const raw = [
      "TO BATCH",
      "1. Add all ingredients to large vessel.",
      "2. Mix to ensure all ingredients are combined.",
      "TO SERVE",
      "1. Measure out 6 oz into shaker",
      "2. Top with ice and shake",
    ].join("\n");

    expect(parseMethodDraft(raw)).toEqual([
      { section: "TO BATCH", text: "Add all ingredients to large vessel." },
      { section: "TO BATCH", text: "Mix to ensure all ingredients are combined." },
      { section: "TO SERVE", text: "Measure out 6 oz into shaker" },
      { section: "TO SERVE", text: "Top with ice and shake" },
    ]);
  });

  it("splits a verb-led run that shares one line", () => {
    const raw =
      "RIM half the glass with tajin. ADD all ingredients to the shaker and fill with ice. SHAKE for 15 seconds.";

    expect(parseMethodDraft(raw)).toEqual([
      { section: null, text: "RIM half the glass with tajin." },
      { section: null, text: "ADD all ingredients to the shaker and fill with ice." },
      { section: null, text: "SHAKE for 15 seconds." },
    ]);
  });

  it("treats a trailing one-word instruction as a step, not a heading", () => {
    // "GARNISH." is an instruction. "TO SERVE" is a heading. The period and the
    // absence of following content are what separate them.
    const raw = "TOP with more ice if needed. GARNISH.";

    expect(parseMethodDraft(raw)).toEqual([
      { section: null, text: "TOP with more ice if needed." },
      { section: null, text: "GARNISH." },
    ]);
  });

  it("keeps a sentence that merely starts with a capitalised word intact", () => {
    const raw = "For mocktails : Replace alcool measurement with water.";
    expect(parseMethodDraft(raw)).toEqual([
      { section: null, text: "For mocktails : Replace alcool measurement with water." },
    ]);
  });

  it("does not mistake a numbered step for a heading when it is upper case", () => {
    const raw = "1. ADD THE SUGAR\n2. Stir";
    expect(parseMethodDraft(raw)).toEqual([
      { section: null, text: "ADD THE SUGAR" },
      { section: null, text: "Stir" },
    ]);
  });

  // The three shapes below are taken verbatim from the Notion corpus. Hand
  // written fixtures missed all of them.
  it("splits when the period has no space after it", () => {
    // "STRAIN into glass.GARNISH" — real, and it appears twice.
    expect(parseMethodDraft("STRAIN into glass.GARNISH")).toEqual([
      { section: null, text: "STRAIN into glass." },
      { section: null, text: "GARNISH" },
    ]);
  });

  it("splits a method written in sentence case", () => {
    // Several recipes use no upper-case verbs at all.
    const raw =
      "Add all ingredients into your shaker and hard shake. Strain into a coupe glass. Add 4 drops of bitters on top";
    expect(parseMethodDraft(raw)).toEqual([
      { section: null, text: "Add all ingredients into your shaker and hard shake." },
      { section: null, text: "Strain into a coupe glass." },
      { section: null, text: "Add 4 drops of bitters on top" },
    ]);
  });

  it("does not split a decimal", () => {
    expect(parseMethodDraft("Pour 1.5 oz into the glass.")).toEqual([
      { section: null, text: "Pour 1.5 oz into the glass." },
    ]);
  });

  it("leaves an unpunctuated run alone rather than guessing", () => {
    // "and stir ADD more ice" has no sentence boundary. Splitting on a bare
    // capitalised word would be a guess, and the operator edits the prefill
    // anyway, so the honest move is to leave it in one piece.
    const raw = "ADD lots of ice and stir ADD more ice and top with club soda. GARNISH";
    expect(parseMethodDraft(raw)).toEqual([
      { section: null, text: "ADD lots of ice and stir ADD more ice and top with club soda." },
      { section: null, text: "GARNISH" },
    ]);
  });

  it("drops a heading that has no steps under it", () => {
    // A heading is only meaningful as a label for something.
    expect(parseMethodDraft("TO BATCH")).toEqual([]);
  });
});

describe("methodToLines", () => {
  it("numbers steps within each section", () => {
    const steps = [
      { section: "TO BATCH", text: "Add all ingredients." },
      { section: "TO BATCH", text: "Mix." },
      { section: "TO SERVE", text: "Shake." },
    ];
    expect(methodToLines(steps)).toEqual([
      "TO BATCH",
      "1. Add all ingredients.",
      "2. Mix.",
      "TO SERVE",
      "1. Shake.",
    ]);
  });

  it("numbers a sectionless method straight through", () => {
    const steps = [
      { section: null, text: "RIM the glass." },
      { section: null, text: "SHAKE." },
    ];
    expect(methodToLines(steps)).toEqual(["1. RIM the glass.", "2. SHAKE."]);
  });
});

describe("methodForAgent", () => {
  it("says plainly that nothing is recorded for an empty method", () => {
    // `{}` is the untouched value for process_json, and null covers a caller
    // that never selected the column.
    for (const empty of [{}, null, undefined]) {
      expect(methodForAgent(empty)).toEqual({
        recorded: false,
        reviewed: false,
        source: null,
        steps: [],
        note: "No preparation method has been recorded for this formula.",
      });
    }
  });

  it("marks operator-confirmed steps as reviewed", () => {
    const result = methodForAgent({
      source: "operator",
      raw: "anything",
      steps: [
        { section: "TO BATCH", text: "Steep the jalapenos." },
        { section: "TO BATCH", text: "Strain." },
      ],
    });
    expect(result.recorded).toBe(true);
    expect(result.reviewed).toBe(true);
    expect(result.source).toBe("operator");
    expect(result.steps).toEqual(["TO BATCH", "1. Steep the jalapenos.", "2. Strain."]);
    expect(result.note).toBeNull();
  });

  it("falls back to the intake text and flags that nobody reviewed it", () => {
    const result = methodForAgent({
      source: "notion_draft",
      raw: "SHAKE for 15 seconds. STRAIN into a glass.",
      steps: [],
    });
    expect(result.recorded).toBe(true);
    expect(result.reviewed).toBe(false);
    expect(result.steps).toEqual(["1. SHAKE for 15 seconds.", "2. STRAIN into a glass."]);
    // The agent has to be able to say this out loud, not just carry a flag.
    expect(result.note).toMatch(/not been reviewed/i);
  });

  it("does not claim a method when the intake text is empty", () => {
    expect(methodForAgent({ source: "notion_draft", raw: null, steps: [] }).recorded).toBe(
      false
    );
  });
});
