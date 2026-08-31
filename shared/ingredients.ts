/**
 * Ingredient resolution for a recipe draft.
 *
 * ONE resolver for both draft shapes, on purpose. The Notion intake produced
 * two disjoint populations:
 *
 *   syrups    59 of 76 carry a structured `ingredients[]` with quantities.
 *   cocktails 0 of 50 carry it. They carry a free-text line instead, and the
 *             importer said so in `parse_warnings`: "Cocktail source stores
 *             ingredient lists as free text; structured quantity parsing has
 *             not been inferred."
 *
 * Reading the free text is therefore the extension that lets a cocktail reach
 * the same normalize dialog a syrup already reaches. It is NOT a second parser
 * running beside the first — structured rows still win whenever they exist, and
 * both shapes leave here as the same `ParsedIngredient[]`.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * 49 of the 50 cocktails record no quantity anywhere — "Mint, Lime, Rum, Soda"
 * is the whole ingredient list. `formula_components.quantity` and `.unit` are
 * both NOT NULL, so those cocktails cannot become a formula version until a
 * person supplies the measures. This module will not invent them, will not
 * infer a house pour, and will not substitute a similar ingredient. It reads
 * what is written, reports per item what is missing, and stops. The value it
 * adds is that the names no longer have to be typed and the blockage is
 * specific rather than a blanket "none resolved".
 */
import { isKnownUnit, isMeasureWord } from "./units";

export type CatalogEntry = {
  /** The formula_key when this is a formula that could become a sub-component. */
  key: string | null;
  name: string;
  kind: "approved_formula" | "known_ingredient";
};

export type IngredientIssue =
  | { code: "no_quantity_in_source" }
  | { code: "no_unit_in_source" }
  | { code: "quantity_is_zero" }
  | { code: "unit_not_recognised"; unit: string }
  | { code: "quantity_not_exact"; text: string }
  | { code: "ambiguous_catalog_match"; candidates: string[] };

export type ParsedIngredient = {
  name: string;
  /** An exact decimal string, or null when the source records no measure. */
  quantity: string | null;
  unit: string | null;
  role: "ingredient" | "garnish";
  /** The formula_key this links to, only when exactly one catalog entry matched. */
  catalogKey: string | null;
  catalogMatch: "approved_formula" | "known_ingredient" | "ambiguous" | "none";
  issues: IngredientIssue[];
};

export type DraftResolution = {
  source: "structured" | "free_text" | "none";
  language: "en" | "fr" | null;
  items: ParsedIngredient[];
  duplicatesDropped: number;
  /** True when a formula version cannot be created from this as it stands. */
  blocked: boolean;
  blockedReason: string | null;
};

type DraftLike = {
  product_category?: string | null;
  original_recipe_json?: {
    ingredients?: Array<{
      ingredient_name?: string | null;
      quantity_normalized?: string | null;
      unit_name?: string | null;
    }> | null;
    ingredients_source_text_english?: string | null;
    ingredients_source_text_french?: string | null;
  } | null;
};

/**
 * An exact decimal for a quantity written as a decimal, a fraction, or a mixed
 * number. Returns null when the value has no finite decimal form.
 *
 * "3/4 oz" is real in the source and `1/3` is plausible in the next import.
 * Three quarters is exactly 0.75; a third is not exactly anything a decimal can
 * write, and rounding it to 0.333 would put a number in an approved formula
 * that nobody chose. So it refuses, and the operator decides.
 */
export function exactDecimal(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  // Canonical form: "007" is seven, and a formula component should not carry a
  // quantity string that fails a plain equality check against "7".
  if (/^\d+(\.\d+)?$/.test(text)) return trimZeros(text.replace(/^0+(?=\d)/, ""));

  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  const simple = text.match(/^(\d+)\/(\d+)$/);
  if (!mixed && !simple) return null;

  const whole = mixed ? BigInt(mixed[1]) : 0n;
  const numerator = BigInt(mixed ? mixed[2] : simple![1]);
  const denominator = BigInt(mixed ? mixed[3] : simple![2]);
  if (denominator === 0n) return null;

  // A fraction terminates in base 10 only when its reduced denominator has no
  // prime factor other than 2 and 5.
  let d = denominator / gcd(numerator, denominator);
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  if (d !== 1n) return null;

  const total = whole * denominator + numerator;
  // Scale to a power of ten, then place the point by hand — no float involved.
  let scale = 1n;
  let digits = 0;
  let reduced = denominator / gcd(total, denominator);
  while (reduced !== 1n) {
    scale *= 10n;
    digits += 1;
    reduced = denominator / gcd(total * scale, denominator);
  }
  const scaled = (total * scale) / denominator;
  if (digits === 0) return scaled.toString();
  const s = scaled.toString().padStart(digits + 1, "0");
  return trimZeros(`${s.slice(0, -digits)}.${s.slice(-digits)}`);
}

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x || 1n;
}

/** Case- and accent-insensitive, but never fuzzy: two different words stay different. */
function normalise(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const QUANTITY_LED =
  /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*([A-Za-z]+)?\s+(.+)$/;

function matchCatalog(
  name: string,
  catalog: CatalogEntry[]
): Pick<ParsedIngredient, "catalogKey" | "catalogMatch"> & { issues: IngredientIssue[] } {
  const wanted = normalise(name);
  const hits = catalog.filter(entry => normalise(entry.name) === wanted);
  if (hits.length === 0) return { catalogKey: null, catalogMatch: "none", issues: [] };

  const distinct = new Set(hits.map(h => h.key ?? h.name));
  if (distinct.size > 1) {
    return {
      catalogKey: null,
      catalogMatch: "ambiguous",
      issues: [
        {
          code: "ambiguous_catalog_match",
          candidates: hits.map(h => h.key ?? h.name),
        },
      ],
    };
  }
  return { catalogKey: hits[0].key, catalogMatch: hits[0].kind, issues: [] };
}

function buildItem(
  name: string,
  quantityText: string | null,
  unit: string | null,
  role: ParsedIngredient["role"],
  catalog: CatalogEntry[]
): ParsedIngredient {
  const issues: IngredientIssue[] = [];
  let quantity: string | null = null;

  if (quantityText) {
    quantity = exactDecimal(quantityText);
    if (quantity === null) {
      // The source DID record something; it just has no exact decimal form.
      // Saying "no quantity in the source" here would send someone to check a
      // source that plainly shows "1/3".
      issues.push({ code: "quantity_not_exact", text: quantityText });
    } else if (/^0(\.0+)?$/.test(quantity)) {
      // Real in the corpus: one syrup carries a 0 gr row beside a 550 gr row.
      // Zero of an ingredient is not a measurement, it is a leftover.
      issues.push({ code: "quantity_is_zero" });
    }
  } else if (role === "ingredient") {
    // A garnish has no measure by nature. Reporting it as missing one would
    // bury the rows that genuinely need a person to supply it.
    issues.push({ code: "no_quantity_in_source" });
  }

  if (role === "ingredient" && quantityText && !unit) {
    // Has a number, no unit — "2 Fresh limes". A different problem from a
    // missing quantity and a different thing for the operator to do.
    issues.push({ code: "no_unit_in_source" });
  }

  if (unit && !isKnownUnit(unit)) {
    issues.push({ code: "unit_not_recognised", unit });
  }

  const catalogInfo = matchCatalog(name, catalog);
  return {
    name,
    quantity,
    unit,
    role,
    catalogKey: catalogInfo.catalogKey,
    catalogMatch: catalogInfo.catalogMatch,
    issues: [...issues, ...catalogInfo.issues],
  };
}

/**
 * Turn a "3 Egg whites" / "1 oz dry gin" match into an item.
 *
 * The word after the number is the unit ONLY when it actually names a measure.
 * Taking any word would resolve "6 Mint leaves" to the ingredient "leaves" with
 * the unit "Mint" — a row that still looks plausible in the dialog while having
 * lost what the ingredient is.
 */
function fromQuantityLed(
  match: RegExpMatchArray,
  catalog: CatalogEntry[]
): ParsedIngredient {
  const [, quantityText, word, rest] = match;
  const isUnit = Boolean(word) && isMeasureWord(word);
  const name = (isUnit ? rest : [word, rest].filter(Boolean).join(" ")).trim();
  return buildItem(name, quantityText, isUnit ? word : null, "ingredient", catalog);
}

function parseFreeText(text: string, catalog: CatalogEntry[]): ParsedIngredient[] {
  const items: ParsedIngredient[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s•\-*]+/, "").trim();
    if (!line) continue;

    // "Garnish: orange slice, green grape" — everything after the label is
    // garnish, and the commas inside it separate garnishes rather than
    // ingredients. Taken before the split so the label is not lost.
    // The colon is optional because the intake is inconsistent, but the word
    // must stand alone — "Garnishing syrup" is an ingredient, not a label.
    const garnish = line.match(/^garnish\s*(?::\s*|\s+)(.+)$/i);
    if (garnish) {
      for (const part of garnish[1].split(",")) {
        // A repeated label ("Garnish: lime, Garnish: mint") is a label, not
        // part of the garnish's name.
        const name = part.replace(/^\s*garnish\s*:\s*/i, "").trim();
        if (name) items.push(buildItem(name, null, null, "garnish", catalog));
      }
      continue;
    }

    // Split on commas FIRST, then look for a quantity on each piece. The other
    // order looks equivalent and is not: "1 oz gin, 2 oz rum, 1/2 oz lime"
    // matches the quantity pattern as a whole, which would yield one ingredient
    // named "gin, 2 oz rum, 1/2 oz lime" measured at 1 oz — three ingredients
    // silently collapsed into one, carrying the first one's quantity.
    for (const part of line.split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const led = piece.match(QUANTITY_LED);
      items.push(
        led
          ? fromQuantityLed(led, catalog)
          : buildItem(piece, null, null, "ingredient", catalog)
      );
    }
  }

  return items;
}

function parseStructured(
  rows: NonNullable<NonNullable<DraftLike["original_recipe_json"]>["ingredients"]>,
  catalog: CatalogEntry[]
): ParsedIngredient[] {
  return rows
    .filter(row => (row.ingredient_name ?? "").trim().length > 0)
    .map(row => {
      const quantity = (row.quantity_normalized ?? "").trim();
      const unit = (row.unit_name ?? "").trim();
      return buildItem(
        (row.ingredient_name ?? "").trim(),
        quantity || null,
        unit || null,
        "ingredient",
        catalog
      );
    });
}

/**
 * Drop an ingredient the source listed twice. Exact repeats only — "Lime" and
 * "Lime juice" are two different things and both survive.
 */
function dedupe(items: ParsedIngredient[]): { items: ParsedIngredient[]; dropped: number } {
  const seen = new Set<string>();
  const kept: ParsedIngredient[] = [];
  for (const item of items) {
    const fingerprint = `${item.role}:${normalise(item.name)}:${item.quantity ?? ""}:${item.unit ?? ""}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    kept.push(item);
  }
  return { items: kept, dropped: items.length - kept.length };
}

export function resolveDraftIngredients(
  draft: DraftLike,
  catalog: CatalogEntry[] = []
): DraftResolution {
  const json = draft.original_recipe_json ?? null;
  const structured = json?.ingredients ?? null;

  let items: ParsedIngredient[] = [];
  let source: DraftResolution["source"] = "none";
  let language: DraftResolution["language"] = null;

  if (structured && structured.length > 0) {
    items = parseStructured(structured, catalog);
    source = items.length > 0 ? "structured" : "none";
  } else {
    const english = (json?.ingredients_source_text_english ?? "").trim();
    const french = (json?.ingredients_source_text_french ?? "").trim();
    // English wins when both exist. Never merge the two — the same drink would
    // arrive twice under two spellings.
    const text = english || french;
    if (text) {
      items = parseFreeText(text, catalog);
      if (items.length > 0) {
        source = "free_text";
        language = english ? "en" : "fr";
      }
    }
  }

  const deduped = dedupe(items);
  const measurable = deduped.items.filter(i => i.role === "ingredient");

  const has = (item: ParsedIngredient, code: IngredientIssue["code"]) =>
    item.issues.some(issue => issue.code === code);

  const noQuantity = measurable.filter(i => has(i, "no_quantity_in_source"));
  const noUnit = measurable.filter(i => has(i, "no_unit_in_source"));
  const notExact = measurable.filter(i => has(i, "quantity_not_exact"));
  const zero = measurable.filter(i => has(i, "quantity_is_zero"));
  const blocking = measurable.filter(
    i =>
      has(i, "no_quantity_in_source") ||
      has(i, "no_unit_in_source") ||
      has(i, "quantity_not_exact") ||
      has(i, "quantity_is_zero")
  );

  let blocked = false;
  let blockedReason: string | null = null;

  if (source === "none") {
    blocked = true;
    blockedReason = "This draft records no ingredient list, so there is nothing to version yet.";
  } else if (blocking.length > 0) {
    blocked = true;
    // Lead with how many INGREDIENTS are stuck, then say why. The reasons are
    // attributes of that set and one ingredient can carry two of them, so
    // counting them separately made two bad rows read as four. When there is
    // only one reason its count is already the leading number, so it is dropped
    // rather than repeated.
    const reasons: Array<{ n: number; phrase: string }> = [];
    if (noQuantity.length > 0) {
      reasons.push({ n: noQuantity.length, phrase: "no quantity in the source" });
    }
    if (noUnit.length > 0) {
      reasons.push({ n: noUnit.length, phrase: "a quantity but no unit" });
    }
    if (notExact.length > 0) {
      reasons.push({ n: notExact.length, phrase: "a quantity that has no exact decimal form" });
    }
    if (zero.length > 0) {
      reasons.push({ n: zero.length, phrase: "a quantity of zero" });
    }

    const lead = `${blocking.length} of ${measurable.length} ingredients cannot be used yet`;
    const fix = blocking.length === 1 ? "Fix it" : "Fix each";
    if (reasons.length === 1) {
      const subject = blocking.length === 1 ? "It has" : "They have";
      blockedReason = `${lead}. ${subject} ${reasons[0].phrase}. ${fix} before creating a version.`;
    } else {
      const listed = reasons.map(r => `${r.n} with ${r.phrase}`).join("; ");
      blockedReason =
        `${lead} — ${listed}, and these can overlap on one ingredient. ` +
        `${fix} before creating a version.`;
    }
  }

  return {
    source,
    language,
    items: deduped.items,
    duplicatesDropped: deduped.dropped,
    blocked,
    blockedReason,
  };
}
