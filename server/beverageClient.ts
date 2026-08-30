/**
 * Thin client over the governed beverage RPCs.
 *
 * Every rule that matters — approval rationale, owner/approver membership, the
 * "at least one normalized component" refusal, the audit trail — lives in
 * Postgres, in SECURITY DEFINER functions that only `service_role` may execute.
 * This module deliberately re-implements none of it. It marshals arguments,
 * calls the function, and surfaces the database's refusal verbatim so an
 * operator sees the real reason rather than a paraphrase.
 */
import { getSupabaseAdmin } from "./_core/supabaseAuth";
import type { OperatorIdentity } from "./_core/supabaseAuth";

/** Arguments every governed RPC takes, derived from the verified operator. */
type OperatorArgs = {
  p_external_subject: string;
  p_display_name: string;
  p_is_owner: boolean;
};

/**
 * `p_is_owner` is trusted by the database, so it is the application's job to
 * decide it rather than let a caller assert it. Until a real entitlement source
 * exists, ownership is granted only to subjects listed in BEVERAGE_OWNER_SUBJECTS.
 * An empty list means nobody is an owner — it never defaults to true.
 */
function isOwner(identity: OperatorIdentity): boolean {
  const allowed = (process.env.BEVERAGE_OWNER_SUBJECTS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return allowed.includes(identity.subject);
}

function operatorArgs(identity: OperatorIdentity): OperatorArgs {
  return {
    p_external_subject: identity.subject,
    p_display_name: identity.displayName ?? identity.email ?? identity.subject,
    p_is_owner: isOwner(identity),
  };
}

async function callRpc<T>(
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(name, args);
  if (error) {
    // The database's message is the useful one ("Approval rationale is
    // required", "Only draft formula versions may be approved", ...).
    throw new Error(error.message);
  }
  return data as T;
}

export type BeverageContext = {
  organization_id: string;
  organization_name: string;
  principal_id: string;
  role: string;
};

export type FormulaDraft = {
  id: string;
  name: string;
  product_category: string;
  draft_status: string;
  intended_yield_value: string | null;
  intended_yield_unit: string | null;
  /** Freeform method text from the intake. Cocktails carry it; syrups never do. */
  method_source_text: string | null;
  original_recipe_json: unknown;
};

export type FormulaComponentInput = {
  line_number: number;
  ingredient_name: string;
  ingredient_key?: string;
  quantity: string;
  unit: string;
  component_role?: string;
  optional?: boolean;
  source_locator?: string;
  notes?: string;
};

export function ensureContext(identity: OperatorIdentity) {
  return callRpc<BeverageContext>("beverage_ensure_context", operatorArgs(identity));
}

export function dashboard(identity: OperatorIdentity) {
  return callRpc<unknown>("beverage_dashboard", operatorArgs(identity));
}

export function listFormulaDrafts(identity: OperatorIdentity) {
  return callRpc<FormulaDraft[]>("beverage_list_formula_drafts", operatorArgs(identity));
}

export function listApprovedFormulas(identity: OperatorIdentity) {
  return callRpc<unknown[]>("beverage_list_approved_formulas", operatorArgs(identity));
}

export function listPendingFormulaVersions(identity: OperatorIdentity) {
  return callRpc<unknown[]>(
    "beverage_list_pending_formula_versions",
    operatorArgs(identity)
  );
}

/**
 * A preparation step as the operator confirmed it. `section` is the heading it
 * sits under ("TO BATCH"), or null when the method has no headings.
 */
export type ProcessStepInput = {
  section?: string | null;
  text: string;
};

export function createFormulaVersion(
  identity: OperatorIdentity,
  input: {
    formulaDraftId: string;
    formulaKey: string;
    name: string;
    yieldValue?: string;
    yieldUnit?: string;
    components: FormulaComponentInput[];
    processSteps?: ProcessStepInput[];
  }
) {
  return callRpc<{
    id: string;
    lifecycle_status: string;
    version_number: number;
    method_source: "operator" | "notion_draft" | "none";
  }>("beverage_create_formula_version", {
    ...operatorArgs(identity),
    p_formula_draft_id: input.formulaDraftId,
    p_formula_key: input.formulaKey,
    p_name: input.name,
    p_yield_value: input.yieldValue ?? null,
    p_yield_unit: input.yieldUnit ?? null,
    p_components: input.components,
    // Omitted rather than empty: the database reads "no steps supplied" as
    // "carry the intake text through unreviewed", which is not the same as
    // "the operator cleared the method".
    p_process_steps: input.processSteps?.length ? input.processSteps : null,
  });
}

export function approveFormulaVersion(
  identity: OperatorIdentity,
  input: { formulaVersionId: string; rationale: string }
) {
  return callRpc<unknown>("beverage_approve_formula_version_for_subject", {
    ...operatorArgs(identity),
    p_formula_version_id: input.formulaVersionId,
    p_rationale: input.rationale,
  });
}

export function recordCalculationPlan(
  identity: OperatorIdentity,
  input: {
    formulaVersionId: string;
    planType: string;
    inputPayload: unknown;
    outputPayload: unknown;
  }
) {
  return callRpc<unknown>("beverage_record_calculation_plan", {
    ...operatorArgs(identity),
    p_formula_version_id: input.formulaVersionId,
    p_plan_type: input.planType,
    p_input_payload: input.inputPayload,
    p_output_payload: input.outputPayload,
  });
}
