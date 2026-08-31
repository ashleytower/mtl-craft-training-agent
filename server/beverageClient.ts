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
import type { CrmRecipe } from "@shared/ingredients";

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

/**
 * Cocktail recipes as the CRM records them.
 *
 * The CRM is the source of truth for a cocktail's ingredients, quantities and
 * units. `public.recipes` sits in this same Supabase project and already grants
 * SELECT to `service_role`, which this client already holds — so this is a read
 * through the integration that exists, not a new pipeline. It is read-only by
 * construction: there is no writer here, and a beverage draft must never edit a
 * CRM recipe.
 *
 * Rows whose `data` is not a recipe object are skipped rather than guessed at.
 */
export async function listCrmRecipes(): Promise<CrmRecipe[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("recipes")
    .select("id, name, data")
    .order("name");

  if (error) throw new Error(error.message);

  return (data ?? []).flatMap(row => {
    const payload = (row as { data?: unknown }).data;
    if (!payload || typeof payload !== "object") return [];
    const recipe = payload as Partial<CrmRecipe>;
    if (!Array.isArray(recipe.ingredients)) return [];
    return [
      {
        // The row's own id and name win over anything inside the blob, so a
        // malformed payload cannot rename or re-point a recipe.
        id: String((row as { id: unknown }).id),
        name: String((row as { name: unknown }).name ?? recipe.name ?? ""),
        method: recipe.method ?? null,
        ingredients: recipe.ingredients,
      },
    ];
  });
}

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

/**
 * A retrieved passage or a cited source, exactly as the search RPC returns it.
 *
 * `kind` decides what may be said out loud. A `chunk` is course material we
 * hold in full and may quote with its lesson and timestamp; a `source` is
 * somebody else's public work where `body` is a governed summary and the only
 * honest move is to cite it. Nothing here is a formula and nothing here is
 * approved — `boundary` on the response says so on every call.
 */
export type KnowledgeResult = {
  kind: "chunk" | "source";
  ref: string;
  source_key: string;
  source_title: string;
  publisher: string | null;
  authority_tier: string;
  operational_status: string;
  citation_required: boolean;
  body: string;
  locator: Record<string, unknown>;
  review_status: string;
  text_rank: number;
  vector_similarity: number | null;
  score: number;
};

export type KnowledgeSearch = {
  query: string;
  /** `hybrid` when an embedding reached the database, `text_only` when not. */
  search_mode: "hybrid" | "text_only";
  count: number;
  results: KnowledgeResult[];
  boundary: string;
};

/**
 * Search the governed corpus. Read-only, and structurally unable to be
 * anything else: the RPC touches no formula table.
 *
 * `embedding` is a pgvector literal or null. Null is a normal state, not an
 * error — see `knowledgeEmbedding.ts`.
 */
export function searchKnowledge(
  identity: OperatorIdentity,
  input: { query: string; embedding: string | null; limit?: number }
) {
  return callRpc<KnowledgeSearch>("beverage_search_knowledge", {
    ...operatorArgs(identity),
    p_query: input.query,
    p_embedding: input.embedding,
    p_limit: input.limit ?? 6,
  });
}

export type KnowledgeCoverage = {
  sources: Array<{
    source_key: string;
    title: string;
    authority_tier: string;
    operational_status: string;
    chunks: number;
    embedded: number;
  }>;
  course_lessons: Array<{
    lesson_number: string;
    lesson_id: string;
    lesson_title: string;
    lesson_type: string;
    ingested: boolean;
  }>;
};

/**
 * What the corpus actually contains, per source and per course lesson.
 *
 * This exists so "which lessons can you answer from?" is answered from the
 * database rather than from a document that goes stale the next time captions
 * are collected. 12 of the course's 39 items have captions today; the honest
 * answer to a question about the other 27 is that they were never collected,
 * and that answer has to come from data to stay true.
 */
export function knowledgeCoverage(identity: OperatorIdentity) {
  return callRpc<KnowledgeCoverage>(
    "beverage_knowledge_coverage",
    operatorArgs(identity)
  );
}

export function ingestKnowledgeSources(
  identity: OperatorIdentity,
  sources: unknown[]
) {
  return callRpc<{ inserted: number; updated: number }>(
    "beverage_ingest_knowledge_sources",
    { ...operatorArgs(identity), p_sources: sources }
  );
}

/**
 * Sources that carry a summary but no embedding, with the exact text to embed.
 *
 * The text comes from the database rather than being assembled here on purpose:
 * two callers composing "title, summary, topics" slightly differently would put
 * two incompatible vector spaces in one column and nothing would notice.
 */
export function knowledgeSourcesPendingEmbedding(identity: OperatorIdentity) {
  return callRpc<Array<{ source_key: string; embed_text: string }>>(
    "beverage_knowledge_sources_pending_embedding",
    operatorArgs(identity)
  );
}

/** Write one source's embedding. Changes nothing else about the row. */
export function setSourceEmbedding(
  identity: OperatorIdentity,
  input: { sourceKey: string; embedding: string }
) {
  return callRpc<{ source_key: string; embedded: boolean }>(
    "beverage_set_source_embedding",
    {
      ...operatorArgs(identity),
      p_source_key: input.sourceKey,
      p_embedding: input.embedding,
    }
  );
}

export function ingestKnowledgeChunks(
  identity: OperatorIdentity,
  input: { sourceKey: string; chunks: unknown[] }
) {
  return callRpc<{ source_key: string; chunks: number; embedded: number }>(
    "beverage_ingest_knowledge_chunks",
    {
      ...operatorArgs(identity),
      p_source_key: input.sourceKey,
      p_chunks: input.chunks,
    }
  );
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
