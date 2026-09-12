/**
 * Bring the syrup formulas in from Notion, complete.
 *
 * Run:
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/import-notion-syrups.ts            # dry run, writes nothing
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/import-notion-syrups.ts --apply    # writes drafts
 *
 * WHY
 *
 * `beverage.formula_drafts` holds 76 syrup rows that came from a Notion export
 * which followed the `Ingredients ↔ Recipes` relation and kept one or two links
 * per syrup instead of all of them. 30 of those rows carry exactly one
 * ingredient. `Simple syrup` is sugar with no water. `Mosaiq Ginger` is
 * preservative and nothing else. They are not incomplete recipes, they are
 * fragments, and approving one would have Brix hand somebody a jalapeño syrup
 * with no preservative in it.
 *
 * Notion has the whole thing. This reads the extraction and writes real drafts.
 *
 * WHAT IT WILL NOT DO
 *
 * It writes drafts and nothing else. It cannot create a formula version and it
 * cannot approve one. It never invents a quantity: where Notion leaves a
 * quantity blank the ingredient is carried through blank and flagged, because a
 * plausible number in a recipe is worse than a visible hole.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as beverage from "../server/beverageClient";
import { resolveDraftIngredients } from "../shared/ingredients";
import type { OperatorIdentity } from "../server/_core/supabaseAuth";

/**
 * Both intake files default INSIDE the repo.
 *
 * They used to default to a session scratchpad under /private/tmp. That
 * directory is deleted when the session ends, so a script that writes to the
 * production database pointed at a path that no longer existed — the import was
 * not reproducible by anyone, including the next run of the same tool. Keep the
 * env overrides for a one-off extraction; keep the default somewhere that can
 * still be there tomorrow.
 */
const INPUT = resolve(
  process.env.NOTION_SYRUPS_JSON ?? resolve(process.cwd(), "db/intake/notion-syrups.json")
);
const REPORT = resolve(process.cwd(), "docs/BRIX_SYRUP_IMPORT_DIFF.md");
const PARSER_VERSION = "notion-syrups/1.1.0";

/**
 * The Directions off each Notion page, keyed by the page's 32-hex id.
 *
 * Ingredients and method live in two different places in Notion: the
 * ingredients are a relation to `[MASTER] Ingredients ↔ Recipes`, the method is
 * prose in the page BODY. The first extraction read the relation and never
 * opened the body, so 45 of 50 cocktails carried a method and 0 of 54 syrups
 * did — Brix could scale a jalapeño syrup and not say how to make it.
 *
 * Kept as a separate file, and separately verified, because it is separately
 * extracted. `en` is null for a page whose Directions heading is empty, which is
 * a real state (Blueberry) and not a failure.
 */
const DIRECTIONS = resolve(
  process.env.NOTION_SYRUP_DIRECTIONS_JSON ??
    resolve(process.cwd(), "db/intake/notion-syrup-directions.json")
);

export type MethodText = { en: string | null; hi: string | null };

/** The 32-hex page id inside a Notion URL, which is the only stable part of it. */
function notionId(url: string): string | null {
  return /([0-9a-f]{32})/.exec(url)?.[1] ?? null;
}

export type MethodLoad = { methods: Map<string, MethodText>; missing: boolean };

/**
 * `missing` exists because the absence of this file used to be a `console.warn`.
 *
 * The ingest UPDATE replaces `original_recipe_json` wholesale, and
 * `method_source_text` lives inside it. So a run with no directions file does
 * not import "ingredients only" — it rewrites all 43 methods in the corpus to
 * nothing, behind one warning line that scrolls past. Absence has to reach the
 * caller as a value, so `--apply` can refuse on it.
 */
export function loadMethods(): MethodLoad {
  const out = new Map<string, MethodText>();
  let raw: string;
  try {
    raw = readFileSync(DIRECTIONS, "utf8");
  } catch {
    return { methods: out, missing: true };
  }
  const parsed = JSON.parse(raw) as {
    pages: Array<{ notion_id: string; directions_en: string | null; directions_hi: string | null }>;
  };
  for (const page of parsed.pages) {
    const en = nullIfBlank(page.directions_en);
    const hi = nullIfBlank(page.directions_hi);
    if (en || hi) out.set(page.notion_id, { en, hi });
  }
  return { methods: out, missing: false };
}

function nullIfBlank(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

type NotionIngredient = { name: string; qty: string | null; unit: string | null };
type NotionSyrup = {
  notion_url: string;
  name: string;
  archived?: boolean;
  mosaiq?: boolean;
  yield_value?: number | string | null;
  yield_unit?: string | null;
  labour_hours?: number | null;
  selling_price?: number | null;
  ingredients: NotionIngredient[];
};

/**
 * "20,000" is twenty thousand, not twenty. Notion stores the quantity as a
 * TITLE, so it is free text and carries whatever separators were typed. The
 * comma is a thousands separator here, confirmed against water quantities that
 * appear as both "18,000" and 18000 for the same recipe.
 *
 * Anything that is not cleanly a number comes back null rather than guessed at.
 */
export function parseQuantity(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().replace(/,/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * The canonical name for a syrup, after Ashley's instruction to collapse the
 * Mosaiq batch rows: "they were big batch forms, so you can consolidate
 * everything into one syrup ... Everything can be collapsed into one name."
 *
 * `Mosaiq Jalapeno (first run whole batch)` and `Mosaiq Jalapeno (first run)`
 * and `Jalapeno` are one syrup recorded three times at different batch sizes.
 * Brix scales exactly, so the batch-size variants are redundant by construction.
 */
export function canonicalName(raw: string): string {
  let name = raw.trim();
  name = name.replace(/^[^\p{L}\d]+/u, "").trim();          // strip leading emoji
  name = name.replace(/^Mosaiq\s+/i, "");                    // drop the client prefix
  name = name.replace(/\s*\((?:first run)?[^)]*\)\s*$/i, ""); // drop "(first run whole batch)"
  return name.trim();
}

/** Group key: case-insensitive, punctuation-insensitive canonical name. */
function groupKey(name: string): string {
  return canonicalName(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * One mass unit, one volume unit, and counts.
 *
 * The corpus is 123 lines in `gr` and 68 in `ml`, with three stragglers in `L`.
 * `L` and `kg` are the same measurement as `ml` and `gr` at a different scale,
 * so folding them in is exact arithmetic that loses nothing.
 *
 * `ml` to `gr` is NOT in here and must not be. It is exact only for water; for
 * a juice or a purée it depends on the liquid, and the corpus has both. Ashley
 * weighs water (the Green Grape recipe says 800 g of it), so a liquid recorded
 * in grams is her normal practice rather than an error.
 *
 * `unit` is a count — "15 nutmeg" — and converting a count to a mass would
 * invent a weight nobody measured.
 */
const UNIT_SCALE: Record<string, { to: string; factor: number }> = {
  L: { to: "ml", factor: 1000 },
  l: { to: "ml", factor: 1000 },
  kg: { to: "gr", factor: 1000 },
};

/** The units a formula is allowed to reach approval in. */
const HOUSE_UNITS = new Set(["gr", "ml", "unit"]);

export function normalizeMeasure(
  quantity: number | null,
  unit: string | null
): { quantity: number | null; unit: string | null } {
  const raw = (unit ?? "").trim();
  if (raw === "") return { quantity, unit: null };
  const scale = UNIT_SCALE[raw];
  // A quantity that could not be read stays unreadable. Multiplying null by a
  // thousand must not be how a blank becomes a number.
  if (!scale) return { quantity, unit: raw };
  return {
    quantity: quantity === null ? null : quantity * scale.factor,
    unit: scale.to,
  };
}

function ingredientsOf(s: NotionSyrup) {
  return (s.ingredients ?? []).map(i => {
    const measure = normalizeMeasure(parseQuantity(i.qty), i.unit ?? null);
    return {
      name: (i.name ?? "").trim(),
      quantity: measure.quantity,
      // The untouched Notion string. After a conversion the stored quantity and
      // the raw one legitimately differ ("1" L becomes 1000 ml), and this is
      // what makes that checkable rather than mysterious.
      quantity_raw: i.qty ?? null,
      unit: measure.unit,
    };
  });
}

/**
 * The shape an ingredient is STORED in, which is not the shape the code above
 * works in.
 *
 * `resolveDraftIngredients`, the console and the versioning path all read
 * `ingredient_name` / `quantity_normalized` / `unit_name` out of
 * `original_recipe_json.ingredients` (shared/ingredients.ts, `DraftLike`). The
 * first version of this importer stored `name` / `quantity` / `unit` instead.
 * Every unit test passed, all 56 formulas landed, and not one could be opened,
 * because nothing on the reading side could see a single ingredient.
 *
 * `quantity_normalized` is a STRING on that contract, not a number: the reader
 * runs it through `exactDecimal`, which refuses a quantity with no finite
 * decimal form rather than rounding it. Keep it a string.
 *
 * KEEP IN SYNC with `DraftLike` in shared/ingredients.ts.
 */
function storedIngredientsOf(s: NotionSyrup) {
  return ingredientsOf(s).map(i => ({
    ingredient_name: i.name,
    quantity_normalized: i.quantity === null ? null : String(i.quantity),
    unit_name: i.unit,
    // The untouched Notion string, kept beside the parsed value so a quantity
    // can always be checked against what was actually typed.
    quantity_raw: i.quantity_raw,
  }));
}

/**
 * Completeness, used only to choose between rows describing the same syrup.
 * An ingredient counts when it has a name, a parsable quantity and a unit.
 */
function completeness(s: NotionSyrup): number {
  return ingredientsOf(s).filter(
    // `UNKNOWN (deleted ingredient page, ...)` is a hole, not an ingredient.
    // Counting it as complete made the Espresso merge keep the row whose fifth
    // line was a deleted page and discard the row that still said "Espresso".
    i => i.name && !/^UNKNOWN/i.test(i.name) && i.quantity !== null && i.unit
  ).length;
}

export type MergedSyrup = {
  canonical: string;
  chosen: NotionSyrup;
  mergedFrom: string[];
  /**
   * The URLs of every Notion page in this group, chosen one included.
   * `mergedFrom` holds names, which read well in a report but cannot be looked
   * up; the method check needs to ask "does a page I merged away have
   * directions?", and that is a question about pages, not names.
   */
  mergedFromUrls: string[];
  warnings: string[];
};

/**
 * Collapse the variants, keeping the richest row rather than the base row.
 *
 * This matters more than it sounds. `Espresso Syrup` has ZERO ingredients in
 * Notion while `Mosaiq Espresso Syrup (first run whole batch)` has a real list.
 * Collapsing blindly onto the base name would have thrown the only surviving
 * copy of that recipe away. So the canonical NAME comes from the group and the
 * CONTENT comes from whichever row actually holds the recipe.
 */
export function mergeVariants(syrups: NotionSyrup[]): MergedSyrup[] {
  const groups = new Map<string, NotionSyrup[]>();
  for (const s of syrups) {
    const key = groupKey(s.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const out: MergedSyrup[] = [];
  for (const rows of groups.values()) {
    // Array.prototype.sort is stable, so a tie on completeness would resolve to
    // whatever order Notion happened to return the pages in — and the winner
    // decides `original_source_hash`. A re-extraction in a different order would
    // then INSERT a second draft for the same syrup and strand the first.
    // The URL is the tie-break because it is the one thing about a Notion page
    // that never changes.
    const ranked = [...rows].sort(
      (a, b) => completeness(b) - completeness(a) || a.notion_url.localeCompare(b.notion_url)
    );
    const chosen = ranked[0];
    const warnings: string[] = [];

    if (rows.length > 1) {
      const losers = ranked.slice(1);
      warnings.push(
        `Collapsed ${rows.length} Notion rows into one formula. Kept "${chosen.name}" ` +
          `(${completeness(chosen)} complete ingredients); merged away ` +
          losers.map(l => `"${l.name}" (${completeness(l)})`).join(", ") +
          `. Batch-size variants are redundant because scaling is exact.`
      );
      const richestLoser = completeness(losers[0] ?? chosen);
      if (richestLoser === completeness(chosen) && completeness(chosen) > 0) {
        warnings.push(
          `Two merged rows were equally complete — confirm the kept one is right.`
        );
      }
    }
    out.push({
      canonical: canonicalName(chosen.name) || chosen.name.trim(),
      chosen,
      // Sorted for the same reason: `merged_from` is inside the content hash, so
      // arrival order must not move it.
      mergedFrom: rows.map(r => r.name).sort((a, b) => a.localeCompare(b)),
      mergedFromUrls: rows.map(r => r.notion_url).sort((a, b) => a.localeCompare(b)),
      warnings,
    });
  }
  return out.sort((a, b) => a.canonical.localeCompare(b.canonical));
}

/**
 * A warning that actually stops this formula being approved, as opposed to
 * context. Every row carries context — what got merged, what Notion claimed
 * about the yield — and if all of that counted as a problem then 56 of 56
 * formulas would be "flagged" and the flag would mean nothing.
 *
 * Blocking means: a human has to supply something before this can be made.
 */
export function isBlocking(warning: string): boolean {
  return (
    warning.startsWith("NO INGREDIENTS") ||
    warning.includes("has no usable quantity") ||
    warning.includes("has a quantity but no unit") ||
    warning.includes("has a quantity of 0") ||
    warning.includes("same method, word for word") ||
    warning.includes("which is not one of gr, ml or unit") ||
    warning.includes("deleted Notion page") ||
    warning.includes("equally complete")
  );
}

/**
 * A row that records a bought product rather than something made here.
 *
 * `Lemon Juice` is one line — "Lemon Juice 1000 ml" — under its own name. It
 * exists so a case of bought juice has a cost, not because anybody makes it.
 * Ashley, 2026-09-10: "no method at all if it's bought." Without this they sit
 * in the missing-method count forever and make the number meaningless.
 *
 * Read off the recipe, not a list of names, so the next bought juice added to
 * Notion is handled without touching this file. One ingredient plus sugar is a
 * real syrup and still owes a method.
 */
export function isBoughtProduct(m: MergedSyrup): boolean {
  const ings = ingredientsOf(m.chosen);
  if (ings.length !== 1) return false;
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(ings[0].name) === norm(m.canonical);
}

/** Everything wrong with a recipe that a human has to look at. */
export function auditWarnings(m: MergedSyrup): string[] {
  const w = [...m.warnings];
  const ings = ingredientsOf(m.chosen);

  if (ings.length === 0) {
    w.push("NO INGREDIENTS in Notion — cannot be approved until a recipe is supplied.");
  }
  for (const i of ings) {
    if (!i.name || /^UNKNOWN/i.test(i.name)) {
      w.push(`Ingredient points at a deleted Notion page: ${i.name}`);
    } else if (i.quantity === null) {
      w.push(`"${i.name}" has no usable quantity in Notion (raw: ${JSON.stringify(i.quantity_raw)}).`);
    } else if (i.quantity === 0) {
      // "0" parses as a perfectly good number, so nothing upstream catches it.
      // Blood Orange Cordial genuinely carries a 0 gr line beside a 550 gr one.
      w.push(`"${i.name}" has a quantity of 0 in Notion, which is not a measurement.`);
    } else if (!i.unit) {
      w.push(`"${i.name}" has a quantity but no unit in Notion.`);
    } else if (!HOUSE_UNITS.has(i.unit)) {
      // gr, ml and unit are the whole vocabulary after L and kg are folded in.
      // Anything else is a unit nobody has agreed on, and scaling it exactly
      // would only make a confident wrong answer.
      w.push(
        `"${i.name}" is measured in "${i.unit}", which is not one of gr, ml or unit. ` +
          `Not converted — say what it should be.`
      );
    }
  }
  // Notion's yield is deliberately not imported, so it is recorded here only as
  // context for whoever sets the real one later.
  const yieldValue = parseQuantity(m.chosen.yield_value as string | null);
  if (yieldValue === null) {
    w.push("No yield in Notion. Set one in Supabase after a real batch.");
  } else {
    w.push(
      `Notion claims a yield of ${yieldValue} ${m.chosen.yield_unit ?? "?"}. ` +
        `NOT imported — Notion specs are unreliable. Set the real one after a batch.`
    );
    // The yields in Notion are demonstrably unreliable: the jalapeño row claims
    // 6 L for a batch containing 18 L of water. Imported, but never trusted.
  }
  return w;
}

function ownerIdentity(): OperatorIdentity {
  const subject = (process.env.BEVERAGE_OWNER_SUBJECTS ?? "").split(",")[0]?.trim();
  if (!subject) throw new Error("BEVERAGE_OWNER_SUBJECTS is required");
  return {
    subject,
    email: null,
    displayName: process.env.BEVERAGE_OWNER_DISPLAY_NAME ?? "MTL Craft owner",
    origin: "browser",
  };
}

/**
 * The method texts that more than one formula claims.
 *
 * Notion's Directions are prose in the page body, and prose gets copy-pasted.
 * `Orgeat Toasted`, `Spiced Cran ( big Batch )` and `Spiced Crantr` all carry
 * Salted Grapefruit's directions verbatim, down to "Peal Grapefruit with as
 * little perth as possable"; `Lemon Super Juice`, `Lemonade`, `Lime Super
 * Juice` and `Plaintain` share one method between the four of them. Attaching
 * those would have Brix tell somebody making orgeat to peel a grapefruit.
 *
 * Two Notion pages that are the SAME syrup at different batch sizes share a
 * method legitimately, and the merge has already collapsed those onto one
 * canonical name before this runs — so identical text under ONE canonical name
 * is fine, and identical text under TWO is a copy-paste.
 *
 * Which formula the method really belongs to is not knowable from here, so it
 * is attached to none of them and every claimant is flagged. Once Ashley fixes
 * the source page, or deletes the duplicate row, a re-run attaches it cleanly.
 */
export function contestedMethods(
  merged: MergedSyrup[],
  methods: Map<string, MethodText>
): Set<string> {
  const claimants = new Map<string, Set<string>>();
  for (const m of merged) {
    const id = notionId(m.chosen.notion_url);
    const en = id ? methods.get(id)?.en : null;
    if (!en) continue;
    if (!claimants.has(en)) claimants.set(en, new Set());
    claimants.get(en)!.add(m.canonical.toLowerCase());
  }
  const contested = new Set<string>();
  for (const [text, names] of claimants) if (names.size > 1) contested.add(text);
  return contested;
}

export function buildDraft(
  m: MergedSyrup,
  methods: Map<string, MethodText> = new Map(),
  contested: Set<string> = new Set()
) {
  const ingredients = storedIngredientsOf(m.chosen);

  // The method comes off the page the merge KEPT. A page that was merged away
  // describes the same syrup at a different batch size, so its directions are
  // probably the same — but "probably" is not good enough to attach a procedure
  // nobody chose to a formula somebody will make. When only a merged-away page
  // has one, say so and take nothing.
  const chosenId = notionId(m.chosen.notion_url);
  let chosen = chosenId ? methods.get(chosenId) : undefined;
  const methodWarnings: string[] = [];

  if (chosen?.en && contested.has(chosen.en)) {
    methodWarnings.push(
      `Another formula's Notion page carries the same method, word for word, so ` +
        `this one's directions are a copy-paste and there is no way to tell which ` +
        `formula they describe. NOT imported — fix the Directions in Notion.`
    );
    chosen = undefined;
  }

  if (!chosen?.en && isBoughtProduct(m)) {
    methodWarnings.push(
      `This is a bought product, not something made here — one ingredient under ` +
        `its own name. No method is expected.`
    );
  } else if (!chosen?.en) {
    const siblings = m.mergedFrom.length > 1;
    const siblingHasMethod = siblings && m.mergedFromUrls.some(u => {
      const id = notionId(u);
      return id && id !== chosenId && methods.get(id)?.en;
    });
    if (siblingHasMethod) {
      methodWarnings.push(
        `No method on the Notion page this kept, but one of the pages it merged away has ` +
          `directions. Not copied across — confirm which method is right.`
      );
    }
  }

  const recipe = {
    source: "notion",
    notion_url: m.chosen.notion_url,
    merged_from: m.mergedFrom,
    ingredients,
    // KEEP THIS KEY. `beverage_create_formula_version` reads
    // `original_recipe_json->>'method_source_text'` and nothing else; renaming it
    // means the method is stored and never reaches a formula version.
    method_source_text: chosen?.en ?? null,
    // Ashley needs the line in English, Hindi and French for her staff. 13 of the
    // Notion pages already carry a Hindi translation she wrote; it is kept beside
    // the English, never merged into it.
    method_source_text_hi: chosen?.hi ?? null,
    labour_hours: m.chosen.labour_hours ?? null,
    selling_price: m.chosen.selling_price ?? null,
  };
  // The yield is part of the content, not metadata beside it. Leaving it out
  // meant a corrected yield in Notion hashed identically to the wrong one, so a
  // re-run reported "unchanged" and silently discarded the fix. Caught by
  // `hashes the SOURCE identity, not the content`.
  // The hash covers exactly what is stored, and `warnings` is stored on the
  // draft row. Leaving it out meant a fix to `auditWarnings` could never reach a
  // row that already existed: the recipe hashed identically, the ingest RPC
  // correctly reported "unchanged", and the stale warnings stayed forever. Same
  // shape as the yield bug. If it is written to the row, it belongs in here.
  const warnings = [...auditWarnings(m), ...methodWarnings];
  const content = JSON.stringify({ name: m.canonical, ...recipe, warnings });
  const contentHash = createHash("sha256").update(content).digest("hex");

  return {
    // Hash of the SOURCE IDENTITY, not the content — see migration 125's header.
    original_source_hash: createHash("sha256").update(m.chosen.notion_url).digest("hex"),
    external_recipe_id: m.chosen.notion_url,
    name: m.canonical,
    product_category: "syrup_or_related_product",
    original_recipe_json: { ...recipe, content_sha256: contentHash },
    // Yields are NOT imported. Ashley, 2026-09-10: "anything that is a spec in
    // there, anything in Notion that's not just the recipe is wrong. We have not
    // done it yet." Notion's yields are aspirational — the jalapeño row claimed
    // 6 L for a batch holding 18 L of water, Salted Grapefruit claimed 1 L for
    // 25 L of liquid. Only the ingredient list is trustworthy. Yields get set in
    // Supabase as real batches are made, and Supabase becomes the source of truth.
    intended_yield_value: null,
    intended_yield_unit: null,
    warnings,
  };
}

function renderReport(
  drafts: ReturnType<typeof buildDraft>[],
  nameOnly: ReturnType<typeof buildDraft>[] = []
): string {
  const blocking = (d: { warnings: string[] }) => d.warnings.filter(isBlocking);
  const clean = drafts.filter(d => blocking(d).length === 0);
  const flagged = drafts.filter(d => blocking(d).length > 0);

  const lines: string[] = [];
  lines.push("# Brix — Notion syrup import, diff");
  lines.push("");
  lines.push("**Generated by `scripts/import-notion-syrups.ts`. Dry run writes nothing.**");
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| formulas after collapsing variants | **${drafts.length}** |`);
  lines.push(`| ready to approve as-is | **${clean.length}** |`);
  lines.push(`| blocked, need something from you | **${flagged.length}** |`);
  lines.push(`| in Notion with no recipe, NOT written | ${nameOnly.length} |`);
  lines.push(`| carry a method from Notion | **${drafts.filter(d => d.original_recipe_json.method_source_text).length}** |`);
  lines.push(`| carry a Hindi method | ${drafts.filter(d => d.original_recipe_json.method_source_text_hi).length} |`);
  lines.push(`| yields imported | 0 — every Notion spec is unreliable, set them after a real batch |`);
  lines.push("");
  lines.push("Nothing here is approved. Every row lands as `needs_review`.");
  lines.push("");

  if (nameOnly.length > 0) {
    lines.push("## In Notion, but with no recipe behind the name");
    lines.push("");
    lines.push(
      "These pages exist in Notion and hold no ingredients at all, so they are " +
        "**not written**. A draft with an empty ingredient list can never be " +
        "versioned, and writing one only pads the approval queue."
    );
    lines.push("");
    for (const d of nameOnly) lines.push(`- ${d.name} — ${d.external_recipe_id}`);
    lines.push("");
  }

  lines.push("## Methods, as Notion has them");
  lines.push("");
  lines.push(
    "Verbatim, including the typos. Read each one against its ingredients above: " +
      "the two are recorded in different places in Notion (the ingredients are a " +
      "relation, the method is prose in the page body) and nothing keeps them in " +
      "agreement. The Jalapeno method says to add habanero and no Jalapeno " +
      "ingredient list records any."
  );
  lines.push("");
  for (const d of drafts) {
    const method = d.original_recipe_json.method_source_text as string | null;
    if (!method) continue;
    const hi = d.original_recipe_json.method_source_text_hi as string | null;
    lines.push(`### ${d.name}${hi ? " (also in Hindi)" : ""}`);
    lines.push("");
    lines.push("```");
    lines.push(method);
    lines.push("```");
    lines.push("");
  }

  const noMethod = drafts.filter(d => !d.original_recipe_json.method_source_text);
  if (noMethod.length > 0) {
    lines.push("### No method in Notion");
    lines.push("");
    lines.push(
      "The `▶Directions` heading on these pages is empty. Brix can scale them and " +
        "cannot say how to make them."
    );
    lines.push("");
    lines.push(noMethod.map(d => d.name).join(", "));
    lines.push("");
  }

  lines.push("## Formulas");
  lines.push("");
  lines.push("| syrup | ingredients | yield | flags |");
  lines.push("|---|---|---|---|");
  for (const d of drafts) {
    const ings = (d.original_recipe_json.ingredients ?? []) as Array<{
      ingredient_name: string;
      quantity_normalized: string | null;
      unit_name: string | null;
    }>;
    const recipe =
      ings
        .map(i => `${i.ingredient_name} ${i.quantity_normalized ?? "?"}${i.unit_name ?? ""}`)
        .join(" + ") || "—";
    const y =
      d.intended_yield_value === null
        ? "—"
        : `${d.intended_yield_value} ${d.intended_yield_unit ?? ""}`.trim();
    lines.push(
      `| ${d.name} | ${recipe} | ${y} | ${blocking(d).length === 0 ? "ready" : `${blocking(d).length} blocking`} |`
    );
  }
  lines.push("");

  if (flagged.length > 0) {
    lines.push("## What needs you");
    lines.push("");
    for (const d of flagged) {
      lines.push(`**${d.name}**`);
      for (const w of blocking(d)) lines.push(`- ${w}`);
      lines.push("");
    }
    lines.push("## Context on every formula");
    lines.push("");
    lines.push("Merge notes and rejected Notion yields. Nothing here blocks approval.");
    lines.push("");
    for (const d of drafts) {
      const notes = d.warnings.filter(w => !isBlocking(w));
      if (notes.length === 0) continue;
      lines.push(`**${d.name}**`);
      for (const w of notes) lines.push(`- ${w}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const raw = JSON.parse(readFileSync(INPUT, "utf8")) as NotionSyrup[];
  const active = raw.filter(s => !s.archived);
  const { methods, missing: methodsMissing } = loadMethods();
  if (methodsMissing) {
    const message = `no directions file at ${DIRECTIONS}`;
    if (apply) {
      console.error(
        `${message}\n` +
          "REFUSING TO WRITE. The ingest replaces original_recipe_json wholesale, " +
          "so applying without the methods would clear method_source_text on every " +
          "syrup it touches. Regenerate the file, or set NOTION_SYRUP_DIRECTIONS_JSON."
      );
      process.exitCode = 1;
      return;
    }
    console.warn(`${message} — dry run continues, methods will read as absent`);
  }
  const merged = mergeVariants(active);
  const contested = contestedMethods(merged, methods);
  const all = merged.map(m => buildDraft(m, methods, contested));

  // A Notion page with no ingredient list at all is not a recipe — it is the
  // blank template, or a name someone reserved. Writing it produces a draft that
  // can never be versioned (the resolver blocks on an empty list) but that Brix
  // still counts as "awaiting approval", so it pads the queue with rows nobody
  // can act on. They stay in the report, under their own heading, so the fact
  // that Notion holds a name with no recipe behind it is not lost.
  const drafts = all.filter(
    d => ((d.original_recipe_json.ingredients ?? []) as unknown[]).length > 0
  );
  const nameOnly = all.filter(d => !drafts.includes(d));

  writeFileSync(REPORT, renderReport(drafts, nameOnly), "utf8");
  console.log(
    `${active.length} active Notion syrups -> ${drafts.length} formulas after collapsing variants`
  );
  if (nameOnly.length > 0) {
    console.log(
      `not written (no ingredients in Notion): ${nameOnly.map(d => d.name).join(", ")}`
    );
  }
  console.log(`report: ${REPORT}`);

  if (!apply) {
    console.log("\nDRY RUN. Nothing written. Re-run with --apply to write drafts.");
    return;
  }

  const result = await beverage.ingestFormulaDrafts(ownerIdentity(), {
    run: {
      intake_kind: "notion_export",
      source_label: "Notion [MASTER] All Syrups",
      original_reference: "https://app.notion.com/p/9f7a914997454e53a9225491d3c3b44d",
      parser_version: PARSER_VERSION,
      warnings: [],
    },
    drafts,
  });
  console.log("\nwritten:", JSON.stringify(result, null, 2));

  await reportStrays(drafts);
  await verifyReadable(drafts);
}

/**
 * Read back what was just written, through the reader that actually consumes it.
 *
 * This exists because of a bug that every other check missed. The importer wrote
 * ingredients as {name, quantity, unit}; `resolveDraftIngredients`, the console
 * and the versioning path all read {ingredient_name, quantity_normalized,
 * unit_name}. 36 unit tests passed. The RPC reported 56 rows written. The
 * database genuinely held 56 syrups. And not one of them could be opened,
 * because nothing on the reading side could see a single ingredient.
 *
 * Nothing that inspects only this script's own output can catch that. The check
 * has to fetch the stored row and run the real reader over it, which is what
 * this does — and it exits non-zero, because an import that lands unreadable
 * recipes has not succeeded, whatever the write count says.
 */
async function verifyReadable(written: ReturnType<typeof buildDraft>[]) {
  const expected = new Set(written.map(d => d.external_recipe_id));
  const stored = (await beverage.listFormulaDrafts(ownerIdentity())).filter(d => {
    const url = (d.original_recipe_json as { notion_url?: string } | null)?.notion_url;
    return url !== undefined && expected.has(url);
  });

  const unreadable = stored.filter(
    d => resolveDraftIngredients(d as never, []).items.length === 0
  );

  console.log(
    `\nread back ${stored.length} of ${written.length} written; ` +
      `${stored.length - unreadable.length} resolve to a recipe.`
  );
  if (stored.length !== written.length || unreadable.length > 0) {
    console.error(
      `\nFAILED: ${unreadable.length} stored draft(s) hold ingredients that nothing ` +
        `can read, and ${written.length - stored.length} were not found at all. ` +
        `The rows exist; the recipes are invisible.`
    );
    for (const d of unreadable.slice(0, 10)) console.error(`  - ${d.name}`);
    process.exitCode = 1;
  }
}

/**
 * Say which syrup drafts are in the database but no longer in Notion.
 *
 * This import is keyed on the Notion page URL, so a draft only ever updates in
 * place while that page keeps winning its merge. The moment a merge resolves to
 * a DIFFERENT page — because the recipe changed, or because the merge rule was
 * corrected — the new page inserts a new draft and the old one is simply left
 * behind, still `needs_review`, still offered to Brix for approval. Correcting
 * the deleted-page bug did exactly that to Espresso Syrup: the stale row had
 * `UNKNOWN (deleted ingredient page...)` where the real espresso should be.
 *
 * It reports and does not act. Superseding on absence would mean a partial
 * extraction — Notion timing out halfway, an export written to the wrong path —
 * quietly rejecting every recipe it failed to return. A list Ashley reads is
 * worth more than an automatic write that can be catastrophically wrong.
 */
async function reportStrays(written: ReturnType<typeof buildDraft>[]) {
  const known = new Set(written.map(d => d.external_recipe_id));
  const existing = await beverage.listFormulaDrafts(ownerIdentity());
  const strays = existing.filter(d => {
    if (d.product_category !== "syrup_or_related_product") return false;
    const url = (d.original_recipe_json as { notion_url?: string } | null)?.notion_url;
    return !url || !known.has(url);
  });

  if (strays.length === 0) {
    console.log("\nno stray drafts: every syrup in the database is one this run wrote.");
    return;
  }
  console.log(
    `\nSTRAY DRAFTS (${strays.length}). In the database, not in this extraction. ` +
      `Brix still offers these for approval. Nothing was changed — decide each one:`
  );
  for (const d of strays) console.log(`  - ${d.name} [${d.draft_status}] ${d.id}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
