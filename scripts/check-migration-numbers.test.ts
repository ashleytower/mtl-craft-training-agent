import { describe, expect, it } from "vitest";
import {
  ACCEPTED_COLLISIONS,
  migrationNumber,
  nextFreeNumber,
  numbersIn,
  unacceptedCollisions,
} from "./check-migration-numbers";

describe("numbersIn", () => {
  it("reads the leading number and ignores everything else in the directory", () => {
    expect(
      numbersIn([
        "129_retire_formula_draft.sql",
        "110_formula_version_process.sql",
        "README.md",
        "DRIFT.md",
        "not_a_migration.sql",
        ".DS_Store",
      ])
    ).toEqual([110, 129]);
  });

  it("collapses a number claimed by two files in one repo", () => {
    expect(numbersIn(["120_a.sql", "120_b.sql"])).toEqual([120]);
  });

  it("has no opinion about leading zeros or four digits", () => {
    expect(migrationNumber("007_early.sql")).toBe(7);
    expect(migrationNumber("1301_later.sql")).toBe(1301);
    expect(migrationNumber("no_number.sql")).toBeNull();
  });
});

describe("unacceptedCollisions", () => {
  // The whole point of the gate. A number used by a different migration in each
  // repo, against one database, that nobody has recorded as history.
  it("reports a new collision", () => {
    expect(unacceptedCollisions([129, 130], [128, 130], [])).toEqual([130]);
  });

  it("stays quiet about collisions already declared as history", () => {
    expect(unacceptedCollisions([124, 125, 126], [124, 125, 126], ACCEPTED_COLLISIONS)).toEqual([]);
  });

  // An accepted collision must not buy silence for a NEW one at a different
  // number — that would turn the list into a way of switching the check off.
  it("still reports a new collision alongside accepted ones", () => {
    expect(unacceptedCollisions([125, 131], [125, 131], ACCEPTED_COLLISIONS)).toEqual([131]);
  });

  it("says nothing when the two repos share no number", () => {
    expect(unacceptedCollisions([127, 128, 129], [120, 121, 122], [])).toEqual([]);
  });
});

describe("nextFreeNumber", () => {
  it("clears the highest number either repo has used", () => {
    expect(nextFreeNumber([129], [126])).toBe(130);
    expect(nextFreeNumber([118], [126])).toBe(127);
  });

  // Beverage has no 119-123 and the CRM does. Handing 119 back out is precisely
  // how two active repos race into the same number in the same week.
  it("does not reuse a gap in one repo that the other has filled", () => {
    const beverage = [118, 124, 125];
    const crm = [119, 120, 121, 122, 123, 124];
    expect(nextFreeNumber(beverage, crm)).toBe(126);
  });

  it("starts at 1 when neither repo has any migrations", () => {
    expect(nextFreeNumber([], [])).toBe(1);
  });
});

describe("the accepted list is a record, not a blanket", () => {
  it("holds exactly the eleven numbers already doubled up on both sides", () => {
    expect([...ACCEPTED_COLLISIONS]).toEqual([
      111, 112, 113, 114, 115, 116, 117, 118, 124, 125, 126,
    ]);
  });
});
