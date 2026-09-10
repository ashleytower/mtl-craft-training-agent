import { describe, expect, it } from "vitest";
import { parseRevision, resolveRevision } from "./buildRevision";

const SHA = "4303a75a8e1749af0417cb9469ef5d4213215ba0";

describe("parseRevision", () => {
  it("accepts a full 40-character sha", () => {
    expect(parseRevision(SHA)).toBe(SHA);
  });

  it("tolerates the trailing newline a stamp file carries", () => {
    expect(parseRevision(`${SHA}\n`)).toBe(SHA);
  });

  // The point of the module. A short sha reads as a real answer in a health
  // payload but cannot be compared against a merge commit, so it is refused
  // rather than passed through.
  it("refuses an abbreviated sha", () => {
    expect(parseRevision("4303a75")).toBeNull();
  });

  it("refuses a decorated or dirty describe string", () => {
    expect(parseRevision(`${SHA}-dirty`)).toBeNull();
    expect(parseRevision("v1.2.3")).toBeNull();
  });

  it("refuses an uppercase sha rather than silently normalising it", () => {
    expect(parseRevision(SHA.toUpperCase())).toBeNull();
  });

  it("refuses empty, whitespace and non-strings", () => {
    expect(parseRevision("")).toBeNull();
    expect(parseRevision("   ")).toBeNull();
    expect(parseRevision(null)).toBeNull();
    expect(parseRevision(undefined)).toBeNull();
  });
});

describe("resolveRevision", () => {
  it("prefers the environment, and says so", () => {
    const got = resolveRevision({ BEVERAGE_BUILD_REVISION: SHA } as NodeJS.ProcessEnv, () => null);
    expect(got).toEqual({ revision: SHA, source: "env" });
  });

  it("falls back to the build stamp, and says so", () => {
    const got = resolveRevision({} as NodeJS.ProcessEnv, () => SHA);
    expect(got).toEqual({ revision: SHA, source: "build_stamp" });
  });

  it("reports unavailable rather than inventing a revision", () => {
    const got = resolveRevision({} as NodeJS.ProcessEnv, () => null);
    expect(got).toEqual({ revision: null, source: "unavailable" });
  });

  // A malformed env value must not shadow a good stamp: the process really is
  // running the stamped bundle, and reporting `unavailable` there would make a
  // correct deployment look unverifiable.
  it("ignores a malformed env value and still finds the stamp", () => {
    const got = resolveRevision(
      { BEVERAGE_BUILD_REVISION: "not-a-sha" } as NodeJS.ProcessEnv,
      () => SHA
    );
    expect(got).toEqual({ revision: SHA, source: "build_stamp" });
  });

  it("never reports a source of env or build_stamp without a revision", () => {
    for (const stamp of [null, SHA]) {
      for (const env of ["", "bad", SHA]) {
        const got = resolveRevision(
          { BEVERAGE_BUILD_REVISION: env } as NodeJS.ProcessEnv,
          () => stamp
        );
        if (got.source === "unavailable") expect(got.revision).toBeNull();
        else expect(got.revision).toBe(SHA);
      }
    }
  });
});
