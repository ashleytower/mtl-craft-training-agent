import { describe, expect, it } from "vitest";
import { parseYieldClaim, yieldFingerprint, yieldToken } from "./batchYield";

const CLAIM = { productionBatchId: "batch-1", value: "18.4", unit: "L" };

describe("parseYieldClaim", () => {
  it("accepts a positive decimal in a known unit", () => {
    const { claim, error } = parseYieldClaim({
      production_batch_id: "batch-1", value: "18.4", unit: "L",
    });
    expect(error).toBeUndefined();
    expect(claim).toEqual(CLAIM);
  });

  it("refuses a zero yield rather than storing a divide-by-zero", () => {
    const { claim, error } = parseYieldClaim({
      production_batch_id: "batch-1", value: "0", unit: "L",
    });
    expect(claim).toBeNull();
    expect(error).toMatch(/greater than zero/i);
  });

  it("refuses a negative yield", () => {
    expect(parseYieldClaim({
      production_batch_id: "batch-1", value: "-2", unit: "L",
    }).error).toMatch(/number/i);
  });

  it("refuses a non-numeric value instead of coercing it", () => {
    expect(parseYieldClaim({
      production_batch_id: "batch-1", value: "about 18", unit: "L",
    }).error).toMatch(/number/i);
  });

  it("refuses an unknown unit and names the ones it takes", () => {
    const { error } = parseYieldClaim({
      production_batch_id: "batch-1", value: "18", unit: "buckets",
    });
    expect(error).toMatch(/L, ml, kg, gr/);
  });

  it("requires the batch id", () => {
    expect(parseYieldClaim({ value: "18", unit: "L" }).error)
      .toMatch(/production_batch_id/);
  });
});

describe("yield read-back token", () => {
  it("is stable for the same claim", () => {
    expect(yieldToken(CLAIM)).toBe(yieldToken({ ...CLAIM }));
  });

  it("changes when the value changes, so a misheard number cannot confirm", () => {
    expect(yieldToken(CLAIM)).not.toBe(yieldToken({ ...CLAIM, value: "18.5" }));
  });

  it("changes when the unit changes", () => {
    expect(yieldToken(CLAIM)).not.toBe(yieldToken({ ...CLAIM, unit: "kg" }));
  });

  it("is six characters, short enough to read off a phone", () => {
    expect(yieldToken(CLAIM)).toHaveLength(6);
    expect(yieldFingerprint(CLAIM)).toHaveLength(12);
  });
});
