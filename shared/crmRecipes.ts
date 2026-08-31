/**
 * Cocktail recipes as the CRM records them.
 *
 * The CRM is the source of truth for a cocktail's ingredients, quantities and
 * units. `public.recipes` lives in the same Supabase project as the beverage
 * schema and already grants SELECT to `service_role`, which the beverage client
 * already holds — so this reads through the integration that exists rather than
 * adding a pipeline of its own.
 *
 * This module does the mapping only. It performs no I/O, matches nothing
 * fuzzily, reconciles nothing against any other source, and never writes back:
 * a CRM recipe is read as given or not used at all.
 */
import { isKnownUnit } from "./units";
import type { IngredientIssue, ParsedIngredient } from "./ingredients";

export type CrmIngredient = {
  name: string;
  /** alcohol | garnish | glass | juice | others | soda | syrup — lower case. */
  type?: string | null;
  /** Arrives from jsonb as a JSON number. */
  quantityPerDrink?: number | string | null;
  unit?: string | null;
  frenchName?: string | null;
  containerSize?: number | null;
};

export type CrmRecipe = {
  id: string;
  name: string;
  englishDescription?: string | null;
  method?: string | null;
  ingredients: CrmIngredient[];
};

/**
 * Glassware is not an ingredient. It carries a quantity and a unit like
 * everything else, so without this it would become a formula component and a
 * batch sheet would tell somebody to measure out one Low Ball.
 */
const NOT_AN_INGREDIENT = new Set(["glass"]);

/**
 * Words that describe presentation rather than a measure. A measured row whose
 * unit is one of these disagrees with its own type.
 */
const PRESENTATION_UNITS = new Set(["glass", "garnish"]);

/** Case- and accent-insensitive, never fuzzy. Mirrors the resolver's rule. */
function normalise(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * A JSON number to an exact decimal string. `1.5` must reach the scaler as
 * "1.5", never as a float it has to re-parse, and never rounded on the way.
 */
function quantityText(raw: CrmIngredient["quantityPerDrink"]): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return String(raw);
  }
  const text = raw.trim();
  return text === "" ? null : text;
}

export function crmRecipeToIngredients(recipe: CrmRecipe): ParsedIngredient[] {
  const rows = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

  return rows
    .filter(row => (row.name ?? "").trim().length > 0)
    .filter(row => !NOT_AN_INGREDIENT.has((row.type ?? "").trim().toLowerCase()))
    .map(row => {
      const role: ParsedIngredient["role"] =
        (row.type ?? "").trim().toLowerCase() === "garnish" ? "garnish" : "ingredient";
      const unit = (row.unit ?? "").trim() || null;
      const text = quantityText(row.quantityPerDrink);
      const issues: IngredientIssue[] = [];

      let quantity: string | null = null;
      if (text === null) {
        if (role === "ingredient") issues.push({ code: "no_quantity_in_source" });
      } else if (/^0(\.0+)?$/.test(text)) {
        quantity = text;
        issues.push({ code: "quantity_is_zero" });
      } else {
        quantity = text;
      }

      if (role === "ingredient" && quantity !== null && !unit) {
        issues.push({ code: "no_unit_in_source" });
      }
      // Only a measured row's unit matters. A garnish counted in "garnish" is
      // not a unit problem, and saying so would put noise in the list an
      // operator reads to find the real ones.
      if (role === "ingredient" && unit && !isKnownUnit(unit)) {
        issues.push({ code: "unit_not_recognised", unit });
      }

      // A measured row whose unit describes presentation disagrees with itself.
      // Which field is right is a question for a person — the CRM types one such
      // ingredient as a juice while typing it a garnish in 38 other rows — so
      // the row is kept as typed and the disagreement is reported, not resolved.
      if (role === "ingredient" && unit && PRESENTATION_UNITS.has(unit.toLowerCase())) {
        issues.push({
          code: "type_unit_mismatch",
          type: (row.type ?? "").trim().toLowerCase(),
          unit,
        });
      }

      return {
        name: (row.name ?? "").trim(),
        quantity,
        unit,
        role,
        // The link is to the CRM recipe as a whole, recorded on the resolution
        // rather than per row, so there is nothing to assert here.
        catalogKey: null,
        catalogMatch: "none" as const,
        issues,
      };
    });
}

/**
 * The CRM recipe for a draft, or null.
 *
 * Exact name match only. A near match ("Daiquiri" for "Tropikal Daiquiri")
 * would attach one drink's measures to a different drink, and two recipes
 * sharing a name is a question for a person rather than a tie to break here.
 */
export function findCrmRecipe(
  draftName: string,
  recipes: CrmRecipe[]
): CrmRecipe | null {
  const wanted = normalise(draftName);
  if (!wanted) return null;
  const hits = recipes.filter(r => normalise(r.name) === wanted);
  return hits.length === 1 ? hits[0] : null;
}
