/**
 * Dictate a recipe to Brix, read it back, confirm it, and it is approved.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT AN EXTENSION OF ownerDecisions
 *
 * That file says, in its own header, that approving a formula version "deserves
 * seeing the whole component list rather than answering yes to a sentence. If
 * she wants that too it is a deliberate build with a confirmation step, not an
 * extension of this one." This is that build. Ashley asked for it on 2026-09-14
 * and supplied the safety property herself: "can it ask me, are you sure you
 * want this recipe, or can I just say confirm".
 *
 * WHY THERE IS NO PENDING-PROPOSAL TABLE
 *
 * The obvious design stores the proposal, hands back a token, and looks it up on
 * confirm. That is a second source of truth with an expiry, a cleanup job, and a
 * window where the stored spec and the spec she was read differ. The corpus
 * already carries one open bug of exactly that shape (an in-memory approval
 * store).
 *
 * So nothing is stored. `preview` validates and returns the canonical spec plus
 * its fingerprint; `confirm` sends that same spec back and the server RECOMPUTES
 * the fingerprint from it. If a single quantity changed in between, the hash
 * does not match and the write is refused. Her yes is bound to the bytes she was
 * read, not to a row that might have moved underneath it.
 *
 * WHY THE TOKEN IS THE FINGERPRINT
 *
 * "confirm" on its own lands on whatever is pending. Two recipes in a row and
 * the wrong one gets approved. The token she says out loud IS the first six
 * characters of the content hash, so the word and the content cannot come apart.
 *
 * WHAT IT STILL REFUSES
 *
 * A formula key that is already approved. Migration 127 makes approval supersede
 * every other approved version under the same key, so creating one from chat
 * would silently retire the recipe the bar is using. That is the Spicy Margarita
 * failure with a shorter fuse, and it is refused rather than resolved here.
 */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import * as beverage from "./beverageClient";
import { hermesIdentityFromRequest } from "./_core/hermesService";
import { resolveDraftIngredients } from "../shared/ingredients";
import { ownerForDecision } from "./ownerDecisions";

/** gr, ml, unit. The house units, and the only ones the scaler can reason about. */
const HOUSE_UNITS = ["gr", "ml", "unit"] as const;
const CATEGORIES = ["syrup_or_related_product", "cocktail"] as const;
const MAX_ITEMS = 40;

export type SpecItem = {
  ingredient_name: string;
  quantity: string;
  unit: (typeof HOUSE_UNITS)[number];
  role: "ingredient" | "garnish";
};

export type RecipeSpec = {
  name: string;
  product_category: (typeof CATEGORIES)[number];
  items: SpecItem[];
  method: string | null;
};

export type ParsedSpec = { spec: RecipeSpec | null; error: string | null };

/** `Saline Solution` -> `saline-solution`, the shape every other formula key uses. */
export function formulaKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * The hash her confirmation is bound to.
 *
 * Canonical on purpose: the item order is preserved because line order is part
 * of a recipe, but every field is normalised so that whitespace or casing drift
 * in the agent's echo does not read as a different recipe.
 */
export function specFingerprint(spec: RecipeSpec): string {
  const canonical = {
    name: spec.name.trim().toLowerCase(),
    category: spec.product_category,
    items: spec.items.map(i => [
      i.ingredient_name.trim().toLowerCase(), i.quantity.trim(), i.unit, i.role,
    ]),
    method: (spec.method ?? "").trim(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 12);
}

/** What she says out loud. Six characters is enough to be unambiguous and short
 *  enough to read off a phone. */
export function confirmToken(spec: RecipeSpec): string {
  return specFingerprint(spec).slice(0, 6);
}

const bad = (error: string): ParsedSpec => ({ spec: null, error });

export function parseSpec(input: unknown): ParsedSpec {
  const raw = (input ?? {}) as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return bad("the recipe needs a name");
  if (name.length > 120) return bad("that name is too long to be a recipe name");

  const category = typeof raw.product_category === "string" ? raw.product_category.trim() : "";
  if (!CATEGORIES.includes(category as never)) {
    return bad(`product_category must be one of ${CATEGORIES.join(", ")}`);
  }

  const rawItems = Array.isArray(raw.items) ? raw.items : null;
  if (!rawItems || rawItems.length === 0) return bad("the recipe needs at least one ingredient");
  if (rawItems.length > MAX_ITEMS) return bad(`at most ${MAX_ITEMS} ingredients per recipe`);

  const items: SpecItem[] = [];
  for (const entry of rawItems) {
    const it = (entry ?? {}) as Record<string, unknown>;
    const iname = typeof it.ingredient_name === "string" ? it.ingredient_name.trim() : "";
    if (!iname) return bad("every ingredient needs a name");

    // A quantity is what somebody measures. It is required, it must be a number,
    // and it must be positive — a zero line is the shape that made a Notion row
    // unversionable rather than a real ingredient.
    const qtyRaw = it.quantity;
    const qty = typeof qtyRaw === "number" ? String(qtyRaw) : String(qtyRaw ?? "").trim();
    if (!qty) return bad(`"${iname}" has no quantity`);
    if (!/^\d+(\.\d+)?$/.test(qty)) return bad(`"${iname}" has a quantity that is not a number: ${qty}`);
    if (Number(qty) <= 0) return bad(`"${iname}" has a quantity of ${qty}`);

    const unit = typeof it.unit === "string" ? it.unit.trim().toLowerCase() : "";
    if (!HOUSE_UNITS.includes(unit as never)) {
      return bad(`"${iname}" has unit "${unit || "(none)"}", which is not one of ${HOUSE_UNITS.join(", ")}`);
    }

    const role = it.role === "garnish" ? "garnish" : "ingredient";
    items.push({ ingredient_name: iname, quantity: qty, unit: unit as SpecItem["unit"], role });
  }

  const method = typeof raw.method === "string" && raw.method.trim() ? raw.method.trim() : null;
  return { spec: { name, product_category: category as RecipeSpec["product_category"], items, method }, error: null };
}

/** The whole component list, in words, because that is the point of the step. */
export function renderReadback(spec: RecipeSpec): string {
  const lines = [`${spec.name} (${spec.product_category.replace(/_/g, " ")})`, ""];
  for (const i of spec.items) {
    lines.push(`  ${i.ingredient_name} — ${i.quantity} ${i.unit}${i.role === "garnish" ? " (garnish)" : ""}`);
  }
  lines.push("", spec.method ? `Method:\n${spec.method}` : "No method given.");
  lines.push("", `Reply: confirm ${confirmToken(spec)}`);
  return lines.join("\n");
}

/** The draft shape the ingest RPC and `resolveDraftIngredients` both expect.
 *  The key names here are the ones the READER uses; writing {name, quantity,
 *  unit} instead is what once left 56 syrups stored and unreadable. */
export function draftFor(spec: RecipeSpec, fingerprint: string) {
  const recipe = {
    source: "brix_dictated",
    notion_url: null,
    dictated_fingerprint: fingerprint,
    ingredients: spec.items.map(i => ({
      ingredient_name: i.ingredient_name,
      quantity_raw: i.quantity,
      quantity_normalized: i.quantity,
      unit_name: i.unit,
    })),
    method_source_text: spec.method,
    method_source_text_hi: null,
  };
  const sourceIdentity = `brix-dictated:${formulaKey(spec.name)}`;
  return {
    original_source_hash: createHash("sha256").update(sourceIdentity).digest("hex"),
    external_recipe_id: sourceIdentity,
    name: spec.name,
    product_category: spec.product_category,
    original_recipe_json: {
      ...recipe,
      content_sha256: createHash("sha256").update(JSON.stringify(recipe)).digest("hex"),
    },
    intended_yield_value: null,
    intended_yield_unit: null,
    warnings: [],
  };
}

export function registerRecipeProposalRoutes(app: Express): void {
  app.post("/api/hermes/recipe/preview", async (req: Request, res: Response) => {
    if (!hermesIdentityFromRequest(req)) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }
    const { spec, error } = parseSpec(req.body);
    if (error || !spec) {
      res.status(400).json({ error });
      return;
    }
    const fingerprint = specFingerprint(spec);
    res.json({
      spec,
      fingerprint,
      confirm_token: confirmToken(spec),
      readback: renderReadback(spec),
      note:
        "Nothing was written. Read this back in full, then send the same spec to " +
        "/api/hermes/recipe/confirm with this fingerprint.",
    });
  });

  app.post("/api/hermes/recipe/confirm", async (req: Request, res: Response) => {
    if (!hermesIdentityFromRequest(req)) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }
    // Read from the server's env, never from the request. A body-supplied
    // subject would let anything reaching this route name itself owner.
    const owner = ownerForDecision();
    if (!owner) {
      res.status(503).json({ error: "no owner configured; nothing can be confirmed" });
      return;
    }

    const { spec, error } = parseSpec((req.body ?? {}).spec);
    if (error || !spec) {
      res.status(400).json({ error });
      return;
    }
    const claimed = typeof req.body?.fingerprint === "string" ? req.body.fingerprint.trim() : "";
    if (!claimed) {
      res.status(400).json({ error: "fingerprint is required; preview it first" });
      return;
    }
    const actual = specFingerprint(spec);
    if (claimed !== actual && claimed !== actual.slice(0, 6)) {
      res.status(409).json({
        error:
          `this spec hashes to ${actual}, not ${claimed}. Something changed between ` +
          `the read-back and the confirmation. Preview it again and read it out.`,
      });
      return;
    }

    const key = formulaKey(spec.name);
    try {
      const approved = (await beverage.listApprovedFormulas(owner)) as Array<{
        formula_key: string; name: string;
      }>;
      if (approved.some(a => a.formula_key === key)) {
        res.status(409).json({
          error:
            `"${spec.name}" already has an approved formula. Approving another under ` +
            `the same key would supersede the one the bar is using, so this refuses. ` +
            `Rename it, or retire the existing version on purpose first.`,
        });
        return;
      }

      // A cocktail's quantities live in the CRM and the CRM is authoritative.
      // Dictating one that already exists there would create a second answer.
      if (spec.product_category === "cocktail") {
        const crm = (await beverage.listCrmRecipes()) as Array<{ name: string }>;
        if (crm.some(r => r.name.trim().toLowerCase() === spec.name.trim().toLowerCase())) {
          res.status(409).json({
            error:
              `"${spec.name}" is a CRM recipe, and the CRM is authoritative for house ` +
              `cocktail quantities. Change it there, not here.`,
          });
          return;
        }
      }

      await beverage.ingestFormulaDrafts(owner, {
        run: {
          intake_kind: "other",
          source_label: "Brix, dictated by the owner",
          original_reference: `brix-dictated:${key}`,
          parser_version: "brix-dictated/1.0.0",
          warnings: [],
        },
        drafts: [draftFor(spec, actual)],
      });

      // Find the draft we just wrote, through the same list Brix reads.
      const drafts = (await beverage.listFormulaDrafts(owner)) as Array<{
        id: string; name: string; original_recipe_json: { dictated_fingerprint?: string } | null;
      }>;
      const draft = drafts.find(
        d => d.original_recipe_json?.dictated_fingerprint === actual && d.name === spec.name
      );
      if (!draft) {
        res.status(502).json({ error: "the draft was written but could not be read back" });
        return;
      }

      // The reader's verdict, not the writer's. A stored recipe nothing can open
      // is the failure this corpus has already had once.
      const resolved = resolveDraftIngredients(draft as never, []);
      if (resolved.blocked || resolved.items.length === 0) {
        res.status(502).json({
          error: `the draft was written but does not resolve: ${resolved.blockedReason ?? "no items"}`,
        });
        return;
      }

      const version = await beverage.createFormulaVersion(owner, {
        formulaDraftId: draft.id,
        formulaKey: key,
        name: spec.name,
        components: spec.items.map((i, index) => ({
          line_number: index + 1,
          ingredient_name: i.ingredient_name,
          quantity: i.quantity,
          unit: i.unit,
          component_role: i.role,
        })),
      });
      await beverage.approveFormulaVersion(owner, {
        formulaVersionId: version.id,
        rationale: `Ashley dictated this to Brix and confirmed ${confirmToken(spec)}.`,
      });

      const live = (await beverage.listApprovedFormulas(owner)) as Array<{
        formula_key: string; components: unknown[];
      }>;
      const scalable = (live.find(f => f.formula_key === key)?.components ?? []).length > 0;

      res.json({
        approved: true,
        formula_key: key,
        name: spec.name,
        version_id: version.id,
        version_number: version.version_number,
        scalable,
        note: scalable
          ? "Approved and scalable. Ask for it by name with a multiplier."
          : "Approved, but it did not come back scalable — do not rely on it until that is looked at.",
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "could not record the recipe",
      });
    }
  });
}
