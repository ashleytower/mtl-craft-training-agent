/**
 * The one place the agent surface acts with the owner's authority.
 *
 * Brix reaches exactly one Telegram chat — `allowed_chats: '8076125560'`, the
 * gateway config — so a "yes" that reaches it came from Ashley. That is the
 * authentication. What this file guards is the SCOPE of what her yes can do.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownerForDecision, parseDecision } from "./ownerDecisions";

const source = readFileSync(new URL("./ownerDecisions.ts", import.meta.url), "utf8");
function code(s: string) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("ownerForDecision", () => {
  it("takes the owner from the server's env, never from the caller", () => {
    const id = ownerForDecision({ BEVERAGE_OWNER_SUBJECTS: "real-owner,second" } as NodeJS.ProcessEnv);
    expect(id?.subject).toBe("real-owner");
  });

  it("refuses to act when no owner is configured, rather than defaulting to one", () => {
    expect(ownerForDecision({} as NodeJS.ProcessEnv)).toBeNull();
    expect(ownerForDecision({ BEVERAGE_OWNER_SUBJECTS: "   " } as NodeJS.ProcessEnv)).toBeNull();
  });

  // The subject is the whole authorisation. If it could be read off the request
  // body then anything that can reach this route could name itself owner.
  it("reads no subject from any request-shaped input", () => {
    expect(code(source)).not.toMatch(/req\.body[^\n]*subject/i);
    expect(code(source)).not.toMatch(/subject\s*:\s*[^\n]*req\./i);
  });
});

describe("parseDecision", () => {
  it("accepts the three dispositions the database allows", () => {
    for (const d of ["ingest_as_reference", "saved_research_only", "discarded"]) {
      expect(parseDecision({ candidate_id: "c1", decision: d, rationale: "Ashley said keep it" }).error)
        .toBeNull();
    }
  });

  it("refuses a disposition the database does not have", () => {
    expect(parseDecision({ candidate_id: "c1", decision: "approve_formula", rationale: "xxxxxxxxxx" }).error)
      .toMatch(/disposition/i);
  });

  // One candidate, named. "Approve them all" is how a single yes becomes six
  // decisions she did not read.
  it("takes exactly one candidate id and has no bulk form", () => {
    expect(parseDecision({ decision: "discarded", rationale: "xxxxxxxxxx" }).error).toMatch(/candidate/i);
    expect(code(source)).not.toMatch(/candidate_ids|\ball\b\s*:\s*true/);
  });

  // The rationale is the audit trail. A blank one, or a bare "ok", records that
  // somebody clicked rather than what she actually said.
  it("requires a rationale with something in it", () => {
    expect(parseDecision({ candidate_id: "c1", decision: "discarded", rationale: "" }).error)
      .toMatch(/rationale/i);
    expect(parseDecision({ candidate_id: "c1", decision: "discarded", rationale: "ok" }).error)
      .toMatch(/rationale/i);
  });

  it("cannot reach a formula version from here at all", () => {
    const body = code(source);
    expect(body).not.toMatch(/formula/i);
    expect(body).not.toMatch(/createFormulaVersion|approveFormulaVersion/);
  });
});
