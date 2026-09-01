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
import { embedToLiteral } from "./knowledgeEmbedding";
import { isLocalTranscript } from "./knowledgeCorpus";
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

/**
 * The citation, composed here rather than by the agent.
 *
 * A model asked to "cite the lesson and timestamp" will mostly do it and
 * occasionally invent a plausible one, and a fabricated timestamp on a real
 * lesson is worse than no citation at all — it looks checkable and isn't. So
 * the string is built from the stored locator and handed over finished.
 */
export function citationFor(result: beverage.KnowledgeResult): string {
  const locator = result.locator ?? {};
  const url = typeof locator.source_url === "string" ? locator.source_url : null;

  if (result.kind === "chunk") {
    const lessonNumber = locator.lesson_number;
    const lessonTitle = locator.lesson_title;
    const course = locator.course_title ?? "Art of Drink course";
    const lesson =
      lessonNumber && lessonTitle
        ? `lesson ${lessonNumber} "${lessonTitle}"`
        : (lessonTitle ?? result.source_title);

    // A caption chunk has a clock; a page-text chunk does not and must never be
    // given one. Some lessons had no caption track, so their body is prose on a
    // page — cited by section and paragraph, which a reader can actually check.
    const where =
      locator.retrieval_type === "page_text_only"
        ? ` (lesson page, ${locator.page_reference ?? "no paragraph recorded"})`
        : locator.timestamp
          ? ` at ${locator.timestamp}`
          : "";

    // Not every clock comes from the publisher. Seven lessons' narration was
    // transcribed on this machine because their player exposes no caption
    // track, and a Whisper guess must not read as the publisher's own words.
    //
    // This has to happen HERE. The source row's governed summary carries the
    // same disclaimer, but that is written once per lesson at ingest time,
    // whereas this string is the one a reader sees against an actual quote —
    // and by this function's own reasoning, it is built rather than left to the
    // model to infer from a raw `caption_origin` field it may never read.
    const provenance = isLocalTranscript(locator.caption_origin)
      ? " (local transcript, unreviewed machine output)"
      : "";

    return `${course}, ${lesson}${where}${provenance}${url ? ` — ${url}` : ""}`;
  }

  const publisher = result.publisher ? `${result.publisher}, ` : "";
  return `${publisher}"${result.source_title}"${url ? ` — ${url}` : ""}`;
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
   * Search the governed knowledge corpus.
   *
   * This is the only route that answers a technique question, and it answers it
   * with somebody else's words plus a citation — never with a formula. Two
   * result kinds come back and the difference matters:
   *
   *   quotable: true   course material we hold in full. `body` is the actual
   *                    transcript and may be read out, attributed.
   *   quotable: false  a public source we may only cite. `body` is a governed
   *                    summary someone already wrote; there is no fuller text
   *                    behind it to go and find.
   *
   * `search_mode` reports whether the embedding service was reachable. A
   * text-only answer is a real answer, just a narrower one, and saying so beats
   * a silent downgrade that reads as a thin corpus.
   */
  app.get("/api/hermes/knowledge", async (req: Request, res: Response) => {
    const identity = hermesIdentityFromRequest(req);
    if (!identity) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }

    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!query) {
      res.status(400).json({ error: "q is required" });
      return;
    }
    const parsedLimit = Number.parseInt(String(req.query.limit ?? "6"), 10);
    const limit = Number.isNaN(parsedLimit) ? 6 : parsedLimit;

    try {
      // Null when the local embedding service is down; the RPC then ranks by
      // full text alone and says so in `search_mode`.
      const embedding = await embedToLiteral(query);
      const found = await beverage.searchKnowledge(identity, {
        query,
        embedding,
        limit,
      });

      res.json({
        query: found.query,
        search_mode: found.search_mode,
        count: found.count,
        boundary: found.boundary,
        results: found.results.map(result => ({
          citation: citationFor(result),
          quotable: result.kind === "chunk",
          // Every result already carries a finished `citation`, so this is not
          // permission to omit one — it is the source's own declared rights
          // posture, and it was being computed, stored and returned by the RPC
          // only to be dropped here. Forwarded so the field means something.
          citation_required: result.citation_required,
          authority_tier: result.authority_tier,
          // Only a chunk has a review vocabulary (pending_review / reviewed /
          // rejected). For a source the RPC echoes operational_status into this
          // field, which reads as a review state and is not one — so it is not
          // forwarded. `operational_status` below carries the real answer.
          review_status: result.kind === "chunk" ? result.review_status : null,
          operational_status: result.operational_status,
          source_key: result.source_key,
          text: result.body,
          locator: result.locator,
        })),
      });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "knowledge search failed",
      });
    }
  });

  /**
   * What the corpus holds, per source and per course lesson.
   *
   * Returns CONTENT coverage and MANIFEST coverage as separate numbers. All 39
   * manifest rows have always existed; what matters is how many carry material
   * Brix can answer from, and the two must never be conflated in a report.
   *
   * `content_kind` per item is one of `captions`, `page_text`, `register_only`
   * (a quiz — course metadata, not knowledge) or `none` (the real gap). Without
   * this route the agent would have to take a coverage claim on faith from a
   * prompt, and a prompt cannot know when someone collects another lesson.
   */
  app.get("/api/hermes/knowledge/coverage", async (req: Request, res: Response) => {
    const identity = hermesIdentityFromRequest(req);
    if (!identity) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }

    try {
      // Passed through as the database computes it. Content coverage and
      // manifest coverage are separate numbers on purpose: 39 manifest rows
      // have always existed, and the question that matters is how many carry
      // material Brix can actually answer from.
      const coverage = await beverage.knowledgeCoverage(identity);
      res.json(coverage);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "coverage lookup failed",
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
