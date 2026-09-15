/**
 * A measured yield is read back before it is saved.
 *
 * Every cost later derived from a batch divides by this number, so a misheard
 * "eighteen four" becomes a wrong bottle cost on every bottle forever. Same
 * shape as `specFingerprint` in ./recipeProposals: the agent previews, Ashley
 * says the token back, and the server recomputes the hash from the claim it is
 * asked to store. If a digit moved in between, the hashes differ and it refuses.
 */
import { createHash } from "node:crypto";

export type YieldClaim = {
  productionBatchId: string;
  value: string;
  unit: string;
};

/** Volume or mass. A syrup is sometimes weighed, per the hot-fill method. */
export const YIELD_UNITS = ["L", "ml", "kg", "gr"] as const;

/**
 * A plain decimal, in digits, and nothing else. `numeric` columns accept
 * `'NaN'`, `'Infinity'` and scientific notation without complaint — Postgres
 * parses all three, so a value this pattern would reject can still commit and
 * poison every later sum. No leading `-`, so it doubles as the "positive"
 * check for anything that must never be negative. Batch capture in
 * hermesRoutes.ts reuses this rather than keeping a second copy that could
 * drift from it.
 */
export const NUMERIC_PATTERN = /^\d+(\.\d+)?$/;

export function yieldFingerprint(claim: YieldClaim): string {
  const canonical = [claim.productionBatchId, claim.value.trim(), claim.unit];
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 12);
}

/** What she says out loud. Six characters: unambiguous, readable off a phone. */
export function yieldToken(claim: YieldClaim): string {
  return yieldFingerprint(claim).slice(0, 6);
}

export function parseYieldClaim(
  body: unknown
): { claim: YieldClaim | null; error?: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const productionBatchId =
    typeof b.production_batch_id === "string" ? b.production_batch_id.trim() : "";
  if (!productionBatchId) {
    return { claim: null, error: "production_batch_id is required" };
  }

  const value = typeof b.value === "string" ? b.value.trim() : "";
  if (!NUMERIC_PATTERN.test(value)) {
    return {
      claim: null,
      error: `value must be a number, in digits, not "${String(b.value)}"`,
    };
  }
  if (Number(value) <= 0) {
    return { claim: null, error: "value must be greater than zero" };
  }

  const unit = typeof b.unit === "string" ? b.unit.trim() : "";
  if (!(YIELD_UNITS as readonly string[]).includes(unit)) {
    return { claim: null, error: `unit must be one of ${YIELD_UNITS.join(", ")}` };
  }

  return { claim: { productionBatchId, value, unit } };
}
