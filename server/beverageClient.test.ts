import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The RPC transport is stubbed so these tests assert what we SEND to the
// database and how we surface what it sends back — never the database's own
// rules, which are tested where they live.
const rpc = vi.fn();
vi.mock("./_core/supabaseAuth", () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

import * as beverage from "./beverageClient";
import type { OperatorIdentity } from "./_core/supabaseAuth";

const ASHLEY: OperatorIdentity = {
  subject: "35300621-b866-4cb2-8092-8b772cad435e",
  email: "owner@example.com",
  displayName: "Ashley Tower",
};

const STRANGER: OperatorIdentity = {
  subject: "00000000-0000-0000-0000-000000000000",
  email: "someone@example.com",
  displayName: "Someone Else",
};

const originalOwners = process.env.BEVERAGE_OWNER_SUBJECTS;

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
  delete process.env.BEVERAGE_OWNER_SUBJECTS;
});

afterEach(() => {
  if (originalOwners === undefined) delete process.env.BEVERAGE_OWNER_SUBJECTS;
  else process.env.BEVERAGE_OWNER_SUBJECTS = originalOwners;
});

function sentArgs() {
  return rpc.mock.calls[0][1] as Record<string, unknown>;
}

describe("ownership is never asserted by the caller", () => {
  it("sends p_is_owner false when no allowlist is configured", async () => {
    await beverage.listFormulaDrafts(ASHLEY);
    expect(sentArgs().p_is_owner).toBe(false);
  });

  it("sends p_is_owner false for a subject that is not on the allowlist", async () => {
    process.env.BEVERAGE_OWNER_SUBJECTS = ASHLEY.subject;
    await beverage.listFormulaDrafts(STRANGER);
    expect(sentArgs().p_is_owner).toBe(false);
  });

  it("sends p_is_owner true only for an allowlisted subject", async () => {
    process.env.BEVERAGE_OWNER_SUBJECTS = ASHLEY.subject;
    await beverage.listFormulaDrafts(ASHLEY);
    expect(sentArgs().p_is_owner).toBe(true);
  });

  it("tolerates whitespace and multiple entries in the allowlist", async () => {
    process.env.BEVERAGE_OWNER_SUBJECTS = ` ${STRANGER.subject} , ${ASHLEY.subject} `;
    await beverage.listFormulaDrafts(ASHLEY);
    expect(sentArgs().p_is_owner).toBe(true);
  });

  it("never lets an empty allowlist entry grant ownership", async () => {
    process.env.BEVERAGE_OWNER_SUBJECTS = " , , ";
    await beverage.listFormulaDrafts(ASHLEY);
    expect(sentArgs().p_is_owner).toBe(false);
  });
});

describe("operator identity mapping", () => {
  it("sends the verified subject, never a client-supplied one", async () => {
    await beverage.listFormulaDrafts(ASHLEY);
    expect(sentArgs().p_external_subject).toBe(ASHLEY.subject);
    expect(sentArgs().p_display_name).toBe("Ashley Tower");
  });

  it("falls back to email then subject for a display name", async () => {
    await beverage.listFormulaDrafts({ ...ASHLEY, displayName: null });
    expect(sentArgs().p_display_name).toBe("owner@example.com");

    rpc.mockClear();
    await beverage.listFormulaDrafts({ ...ASHLEY, displayName: null, email: null });
    expect(sentArgs().p_display_name).toBe(ASHLEY.subject);
  });
});

describe("database refusals reach the operator intact", () => {
  it("rethrows the database message verbatim", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Approval rationale is required" },
    });

    await expect(
      beverage.approveFormulaVersion(ASHLEY, {
        formulaVersionId: "11111111-1111-1111-1111-111111111111",
        rationale: "   ",
      })
    ).rejects.toThrow("Approval rationale is required");
  });

  it("passes approval arguments through unchanged", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await beverage.approveFormulaVersion(ASHLEY, {
      formulaVersionId: "11111111-1111-1111-1111-111111111111",
      rationale: "Checked against the Notion source",
    });

    expect(rpc).toHaveBeenCalledWith(
      "beverage_approve_formula_version_for_subject",
      expect.objectContaining({
        p_formula_version_id: "11111111-1111-1111-1111-111111111111",
        p_rationale: "Checked against the Notion source",
      })
    );
  });
});
