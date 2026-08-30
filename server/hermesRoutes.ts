/**
 * Plain REST surface for the Hermes agent.
 *
 * tRPC's batching and superjson encoding are awkward to call from a skill
 * script, so the agent gets a small, explicit JSON API instead. It is
 * deliberately read-and-calculate only: there is no route here that creates or
 * approves a formula version, so the agent cannot perform a governed write even
 * if it is instructed to. Those live behind `humanProcedure` in the tRPC router.
 */
import type { Express, Request, Response } from "express";
import { hermesIdentityFromRequest } from "./_core/hermesService";
import * as beverage from "./beverageClient";
import { scaleFormula, type NormalizedFormula } from "./beverageScaling";
import { methodForAgent, type StoredMethod } from "@shared/method";

type ApprovedFormula = {
  id: string;
  formula_key: string;
  version_number: number;
  name: string;
  product_category: string | null;
  intended_yield_value: string | null;
  intended_yield_unit: string | null;
  process_json: StoredMethod;
  components: Array<{
    line_number: number;
    ingredient_name: string;
    quantity: string;
    unit: string;
  }>;
};

/**
 * A number someone can actually measure. The exact value stays alongside it —
 * "185/9 gr" is correct but nobody weighs that, and an agent asked to choose
 * between the two will sometimes choose the useless one. So the API decides.
 */
function measurable(value: string, isExact: boolean): string {
  const dot = value.indexOf(".");
  if (dot === -1) return value;
  const short = value.slice(0, dot + 3).replace(/\.?0+$/, "");
  return isExact && short === value ? value : `${short}`;
}

function toNormalized(formula: ApprovedFormula): NormalizedFormula {
  return {
    formulaVersionId: formula.id,
    name: formula.name,
    intendedYieldValue: formula.intended_yield_value,
    intendedYieldUnit: formula.intended_yield_unit,
    components: (formula.components ?? []).map(c => ({
      lineNumber: c.line_number,
      ingredientName: c.ingredient_name,
      quantity: c.quantity,
      unit: c.unit,
    })),
  };
}

export function registerHermesRoutes(app: Express) {
  /** Approved formulas the agent may talk about and scale. */
  app.get("/api/hermes/formulas", async (req: Request, res: Response) => {
    const identity = hermesIdentityFromRequest(req);
    if (!identity) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }

    try {
      const formulas = (await beverage.listApprovedFormulas(
        identity
      )) as ApprovedFormula[];
      res.json({
        count: formulas.length,
        formulas: formulas.map(f => ({
          id: f.id,
          name: f.name,
          version: f.version_number,
          // Carried so a syrup/cocktail question is answerable from this one
          // call, rather than by asking the operator to narrow it.
          product_category: f.product_category,
          yield: f.intended_yield_value,
          yield_unit: f.intended_yield_unit,
          // Always present, even when empty, so "how do I make it" is
          // answerable from the same call that answers "what is in it".
          method: methodForAgent(f.process_json),
          components: f.components,
        })),
      });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "lookup failed",
      });
    }
  });

  /**
   * What EXISTS but is not yet approved. Names and categories only —
   * deliberately no quantities, because an unapproved draft must never be the
   * source of a number someone measures. This exists so the agent can say
   * "there is a draft awaiting approval" instead of "there isn't one", which
   * is misleading when the recipe plainly exists.
   */
  app.get("/api/hermes/drafts", async (req: Request, res: Response) => {
    const identity = hermesIdentityFromRequest(req);
    if (!identity) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }

    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    try {
      const drafts = (await beverage.listFormulaDrafts(identity)) as Array<{
        id: string;
        name: string;
        product_category: string;
        draft_status: string;
        original_recipe_json: { ingredients?: unknown[] } | null;
        method_source_text: string | null;
      }>;
      const rows = drafts
        .filter(d => !search || d.name.toLowerCase().includes(search))
        .map(d => ({
          name: d.name,
          product_category: d.product_category,
          draft_status: d.draft_status,
          has_ingredients: (d.original_recipe_json?.ingredients ?? []).length > 0,
          // Whether one exists, not what it says. An unapproved method is no
          // safer to follow than an unapproved quantity.
          has_method: Boolean(d.method_source_text),
          approved: false,
        }));
      res.json({ count: rows.length, search: search || null, drafts: rows });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "lookup failed",
      });
    }
  });

  /**
   * Scale an approved formula. Accepts the formula by id or by name so the
   * agent can act on what someone said out loud. Never releases a batch.
   */
  app.post("/api/hermes/scale", async (req: Request, res: Response) => {
    const identity = hermesIdentityFromRequest(req);
    if (!identity) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }

    const { formula, request: scaleRequest } = req.body ?? {};
    if (typeof formula !== "string" || !formula.trim()) {
      res.status(400).json({ error: "formula (id or name) is required" });
      return;
    }
    if (!scaleRequest || typeof scaleRequest !== "object") {
      res.status(400).json({ error: "request is required" });
      return;
    }

    let approved: ApprovedFormula[];
    try {
      approved = (await beverage.listApprovedFormulas(identity)) as ApprovedFormula[];
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "lookup failed",
      });
      return;
    }

    const wanted = formula.trim().toLowerCase();
    const matches = approved.filter(
      f => f.id === formula.trim() || f.name.trim().toLowerCase() === wanted
    );

    if (matches.length === 0) {
      res.status(404).json({
        error: `No approved formula matches "${formula}".`,
        approved_names: approved.map(f => f.name),
      });
      return;
    }
    if (matches.length > 1) {
      // Never guess between two approved formulas with the same name.
      res.status(409).json({
        error: `"${formula}" matches ${matches.length} approved formulas. Use the id.`,
        candidates: matches.map(f => ({
          id: f.id,
          name: f.name,
          version: f.version_number,
        })),
      });
      return;
    }

    try {
      const result = scaleFormula(toNormalized(matches[0]), scaleRequest);
      res.json({
        ...result,
        // Scaling is when someone is about to make the thing, so the method
        // belongs in this response rather than behind another call.
        method: methodForAgent(matches[0].process_json),
        factor: {
          ...result.factor,
          measurable: measurable(result.factor.decimal, result.factor.decimalIsExact),
        },
        components: result.components.map(c => ({
          ...c,
          // What to say out loud, alongside the exact value already present.
          measurable: measurable(c.scaledQuantity, c.scaledQuantityIsExact),
        })),
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "scaling refused",
      });
    }
  });
}
