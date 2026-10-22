/**
 * Recipe tests. Ashley, 2026-10-22: "spicy mango jelly recipe October 20 then I
 * can say I made another one October 30 if I changed anything" ... "saved next
 * to the old one in case I don't like the change I made and I wanna go back to
 * the old one and then when I say OK this is a confirmed recipe."
 *
 *   test     the lines she made that day, saved and approved as
 *            "<family> - test <YYYY-MM-DD>" next to everything else, and logged
 *            as a test with the date and what changed. The date is never defaulted.
 *   taste    her words about a test, stored verbatim.
 *   tests    a family's tests in date order, with lines, tastings, and which one
 *            matches the confirmed recipe.
 *   confirm  copies one test's exact lines to the family name ("<family>").
 *            Migration 127 retires the previous confirmed version; every test
 *            stays, so going back is confirming an older test.
 *
 * Writes are made as the owner (server env), like `save`. Brix needs the service
 * token to reach any of this.
 */
import type { Express, Request, Response } from "express";
import * as beverage from "./beverageClient";
import { hermesIdentityFromRequest } from "./_core/hermesService";
import { ownerForDecision } from "./ownerDecisions";
import { parseSpec, saveApproved, type RecipeSpec } from "./recipeProposals";

type Owner = NonNullable<ReturnType<typeof ownerForDecision>>;

type ApprovedRow = {
  id: string;
  formula_key: string;
  name: string;
  product_category: string | null;
  process_json?: { raw?: string | null; steps?: Array<{ text?: string }> } | null;
  components: Array<{ ingredient_name: string; quantity: number | string; unit: string; component_role?: string }>;
};

/** A real calendar date written YYYY-MM-DD, or null. "2026-02-30" is not one. */
export function madeOnDate(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text ? text : null;
}

export const testName = (family: string, madeOn: string) => `${family.trim()} - test ${madeOn}`;

const BAD_DATE = "made_on must be the date she made it, YYYY-MM-DD. Never guess it.";
const lineText = (c: ApprovedRow["components"][number]) => `${c.ingredient_name} ${String(c.quantity)} ${c.unit}`;
const sameLines = (a: ApprovedRow, b: ApprovedRow) =>
  JSON.stringify(a.components.map(lineText)) === JSON.stringify(b.components.map(lineText));

function methodOf(row: ApprovedRow): string | null {
  const raw = row.process_json?.raw?.trim();
  if (raw) return raw;
  const steps = (row.process_json?.steps ?? []).map(s => (s.text ?? "").trim()).filter(Boolean);
  return steps.length ? steps.join("\n") : null;
}

const failure = (err: unknown, fallback: string) => ({ error: err instanceof Error ? err.message : fallback });

export function registerRecipeTestRoutes(app: Express): void {
  // Common front: service token, owner, and a family name.
  const front = (req: Request, res: Response): { owner: Owner; family: string } | null => {
    if (!hermesIdentityFromRequest(req)) {
      res.status(401).json({ error: "hermes service token required" });
      return null;
    }
    const owner = ownerForDecision();
    if (!owner) {
      res.status(503).json({ error: "no owner configured; nothing can be saved" });
      return null;
    }
    const family = typeof req.body?.family === "string" ? req.body.family.trim() : "";
    if (!family) {
      res.status(400).json({ error: "family (the recipe this test belongs to) is required" });
      return null;
    }
    return { owner, family };
  };

  // The one test made on that date, or a reply naming the dates that exist.
  async function findTest(owner: Owner, family: string, rawDate: unknown, res: Response) {
    const madeOn = madeOnDate(rawDate);
    if (!madeOn) {
      res.status(400).json({ error: BAD_DATE });
      return null;
    }
    const tests = await beverage.listRecipeTests(owner, family);
    const hits = tests.filter(t => t.made_on === madeOn);
    if (hits.length !== 1) {
      res.status(hits.length ? 409 : 404).json({
        error: hits.length
          ? `"${family}" has ${hits.length} tests on ${madeOn}.`
          : `"${family}" has no test made on ${madeOn}.`,
        test_dates: tests.map(t => t.made_on),
      });
      return null;
    }
    return hits[0];
  }

  app.post("/api/hermes/recipe/test", async (req: Request, res: Response) => {
    const f = front(req, res);
    if (!f) return;
    const madeOn = madeOnDate(req.body?.made_on);
    if (!madeOn) {
      res.status(400).json({ error: BAD_DATE });
      return;
    }
    const change =
      typeof req.body?.change === "string" && req.body.change.trim() ? req.body.change.trim() : "first test";
    const { spec, error } = parseSpec({ ...req.body, name: testName(f.family, madeOn) });
    if (error || !spec) {
      res.status(400).json({ error });
      return;
    }
    const saved = await saveApproved(f.owner, spec, {
      replace: false,
      rationale: `Ashley's test of ${f.family}, made ${madeOn}. Saved next to the others (her rule 2026-10-22).`,
    });
    if (saved.status !== 200) {
      res.status(saved.status).json(saved.body);
      return;
    }
    try {
      const opened = await beverage.openRecipeTest(f.owner, {
        family: f.family, change, madeOn, formulaVersionId: String(saved.body.version_id),
      });
      res.json({ ...saved.body, family: f.family, made_on: madeOn, change, test_id: opened.test_id });
    } catch (err) {
      res.status(502).json({
        error: `the recipe was saved as "${spec.name}" but the test could not be logged: ` +
          (err instanceof Error ? err.message : "unknown error"),
      });
    }
  });

  app.post("/api/hermes/recipe/taste", async (req: Request, res: Response) => {
    const f = front(req, res);
    if (!f) return;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
    if (!notes.trim()) {
      res.status(400).json({ error: "notes (what she said about how it tasted) are required" });
      return;
    }
    try {
      const test = await findTest(f.owner, f.family, req.body?.made_on, res);
      if (!test) return;
      // Verbatim: her words, not a summary of them.
      const out = await beverage.recordRecipeTasting(f.owner, { testId: test.test_id, notes });
      res.json({ recorded: true, family: test.family, made_on: test.made_on, notes, ...out });
    } catch (err) {
      res.status(502).json(failure(err, "could not record the tasting"));
    }
  });

  app.post("/api/hermes/recipe/tests", async (req: Request, res: Response) => {
    const f = front(req, res);
    if (!f) return;
    try {
      const [tests, approved] = await Promise.all([
        beverage.listRecipeTests(f.owner, f.family),
        beverage.listApprovedFormulas(f.owner) as Promise<ApprovedRow[]>,
      ]);
      const confirmed =
        approved.find(a => a.name.trim().toLowerCase() === f.family.toLowerCase()) ?? null;
      res.json({
        family: f.family,
        confirmed: confirmed ? { name: confirmed.name, lines: confirmed.components.map(lineText) } : null,
        tests: tests.map(t => {
          const row = approved.find(a => a.id === t.formula_version_id) ?? null;
          return {
            made_on: t.made_on,
            change: t.change,
            name: row?.name ?? null,
            lines: row ? row.components.map(lineText) : [],
            tastings: t.tastings,
            is_confirmed: Boolean(row && confirmed && sameLines(row, confirmed)),
          };
        }),
      });
    } catch (err) {
      res.status(502).json(failure(err, "could not read the tests"));
    }
  });

  app.post("/api/hermes/recipe/confirm", async (req: Request, res: Response) => {
    const f = front(req, res);
    if (!f) return;
    try {
      const test = await findTest(f.owner, f.family, req.body?.made_on, res);
      if (!test) return;
      const approved = (await beverage.listApprovedFormulas(f.owner)) as ApprovedRow[];
      const row = approved.find(a => a.id === test.formula_version_id);
      if (!row) {
        res.status(409).json({ error: `the ${test.made_on} test's recipe is no longer saved, so it cannot be confirmed` });
        return;
      }
      const spec: RecipeSpec = {
        name: f.family,
        // Same default as `save` when a row has no category.
        product_category: (row.product_category ?? "syrup_or_related_product") as RecipeSpec["product_category"],
        items: row.components.map(c => ({
          ingredient_name: c.ingredient_name,
          quantity: String(c.quantity),
          unit: c.unit as RecipeSpec["items"][number]["unit"],
          role: c.component_role === "garnish" ? "garnish" : "ingredient",
        })),
        method: methodOf(row),
      };
      const out = await saveApproved(f.owner, spec, {
        replace: true,
        rationale: `Ashley confirmed her ${test.made_on} test as ${f.family} (her rule 2026-10-22).`,
      });
      res.status(out.status).json(out.status === 200 ? { ...out.body, confirmed_from: test.made_on } : out.body);
    } catch (err) {
      res.status(502).json(failure(err, "could not confirm the test"));
    }
  });
}
