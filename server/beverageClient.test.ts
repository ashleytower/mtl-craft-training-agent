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

describe("batch capture", () => {
  it("sends the operator args and the batch fields openProductionBatch was given", async () => {
    rpc.mockResolvedValue({ data: { id: "batch-1" }, error: null });
    process.env.BEVERAGE_OWNER_SUBJECTS = ASHLEY.subject;

    await beverage.openProductionBatch(ASHLEY, {
      formulaVersionId: "fa96080f-00d9-461d-91c4-295962f94489",
      batchLabel: "Hibiscus 2026-09-15",
      madeOn: "2026-09-15",
      notes: null,
    });

    expect(rpc.mock.calls[0][0]).toBe("beverage_open_production_batch");
    expect(sentArgs()).toMatchObject({
      p_external_subject: ASHLEY.subject,
      p_is_owner: true,
      p_formula_version_id: "fa96080f-00d9-461d-91c4-295962f94489",
      p_batch_label: "Hibiscus 2026-09-15",
      p_made_on: "2026-09-15",
      p_notes: null,
    });
  });

  it("keeps money and quantities as strings so numeric precision survives", async () => {
    rpc.mockResolvedValue({ data: { id: "input-1" }, error: null });

    await beverage.recordBatchInput(ASHLEY, {
      productionBatchId: "batch-1",
      itemName: "Strawberries",
      quantityPurchased: "2.5",
      unit: "kg",
      amountPaid: "37.50",
      currencyCode: "CAD",
      supplier: "Jean-Talon",
      invoiceReference: "INV-9912",
      purchasedOn: "2026-09-14",
      externalSource: "google_sheets_inventory",
      externalRecordKey: "Ingredients!A42",
    });

    const args = sentArgs();
    expect(typeof args.p_amount_paid).toBe("string");
    expect(args).toMatchObject({
      p_production_batch_id: "batch-1",
      p_item_name: "Strawberries",
      p_quantity_purchased: "2.5",
      p_unit: "kg",
      p_amount_paid: "37.50",
      p_currency_code: "CAD",
      p_supplier: "Jean-Talon",
      p_invoice_reference: "INV-9912",
      p_purchased_on: "2026-09-14",
      p_external_source: "google_sheets_inventory",
      p_external_record_key: "Ingredients!A42",
    });
  });

  it("records a measured yield against its batch", async () => {
    rpc.mockResolvedValue({ data: { id: "batch-1" }, error: null });

    await beverage.recordMeasuredYield(ASHLEY, {
      productionBatchId: "batch-1",
      measuredYieldValue: "18.4",
      measuredYieldUnit: "L",
    });

    expect(rpc.mock.calls[0][0]).toBe("beverage_record_measured_yield");
    expect(sentArgs()).toMatchObject({
      p_production_batch_id: "batch-1",
      p_measured_yield_value: "18.4",
      p_measured_yield_unit: "L",
    });
  });

  it("never asserts ownership for a subject not on the allowlist", async () => {
    rpc.mockResolvedValue({ data: { id: "batch-1" }, error: null });
    await beverage.openProductionBatch(STRANGER, {
      formulaVersionId: "v1", batchLabel: "x", madeOn: "2026-09-15", notes: null,
    });
    expect(sentArgs().p_is_owner).toBe(false);
  });

  it("surfaces the database refusal verbatim", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Batch label is required" } });
    await expect(
      beverage.openProductionBatch(ASHLEY, {
        formulaVersionId: "v1", batchLabel: "", madeOn: "2026-09-15", notes: null,
      })
    ).rejects.toThrow("Batch label is required");
  });

  it("records a batch cost delta with all fields", async () => {
    rpc.mockResolvedValue({ data: { id: "delta-1" }, error: null });

    await beverage.recordBatchCostDelta(ASHLEY, {
      productionBatchId: "batch-1",
      costBaselineId: "baseline-1",
      label: "Supplier price adjustment",
      deltaAmount: "-15.50",
      rationale: "Volume discount applied",
    });

    expect(rpc.mock.calls[0][0]).toBe("beverage_record_batch_cost_delta");
    expect(sentArgs()).toMatchObject({
      p_production_batch_id: "batch-1",
      p_cost_baseline_id: "baseline-1",
      p_label: "Supplier price adjustment",
      p_delta_amount: "-15.50",
      p_rationale: "Volume discount applied",
    });
    expect(typeof sentArgs().p_delta_amount).toBe("string");
  });
});
