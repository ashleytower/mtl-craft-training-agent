/**
 * Unit labels, in one place.
 *
 * This table used to live inside beverageScaling.ts. It moved here when the
 * cocktail ingredient resolver needed the same answer to "is this a unit we
 * understand?" — a second copy would have been a second source of truth, and
 * the two would have drifted the first time a spelling was added to one.
 *
 * These normalise SPELLING only, never dimension: `gram` and `g` are the same
 * label as `gr`, but `kg` is a different unit and stays different. `oz` is
 * deliberately absent — it is ambiguous between weight and fluid volume, and
 * guessing which one a bartender meant is exactly the kind of silent decision
 * this system refuses to make. An unknown label compares as itself, so nothing
 * is lost; it simply cannot be converted.
 */
export const UNIT_SPELLINGS: Record<string, string> = {
  g: "gr", gr: "gr", gram: "gr", grams: "gr", gramme: "gr", grammes: "gr",
  kg: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", milliliter: "ml", millilitre: "ml", milliliters: "ml", millilitres: "ml",
  l: "l", lt: "l", liter: "l", litre: "l", liters: "l", litres: "l",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  cup: "cup", cups: "cup",
  unit: "unit", units: "unit", each: "unit", ea: "unit",
  piece: "unit", pieces: "unit", pc: "unit", pcs: "unit",
};

/** Canonical label for comparison. Unknown units compare as themselves. */
export function canonicalUnit(unit: string): string {
  const key = unit.trim().toLowerCase();
  return UNIT_SPELLINGS[key] ?? key;
}

/**
 * Whether the label is one the system can reason about. `false` does not mean
 * the ingredient is wrong — it means nobody can scale it safely, so it has to
 * be shown to a person rather than quietly accepted.
 */
export function isKnownUnit(unit: string): boolean {
  return Object.hasOwn(UNIT_SPELLINGS, unit.trim().toLowerCase());
}

/**
 * Words that are a measure, including ones this system deliberately will not
 * convert. `oz` and `dash` are real units a bartender writes; they are simply
 * not convertible here — `oz` because it is ambiguous between weight and fluid
 * volume, `dash` because it has no defined size.
 *
 * This exists to tell a unit from a describing word. "1 oz dry gin" has a unit;
 * "6 Mint leaves" does not, and reading "Mint" as the unit would leave the
 * ingredient named "leaves". Anything not in this set stays part of the name.
 */
const EXTRA_MEASURE_WORDS = new Set([
  "oz", "ounce", "ounces",
  "dash", "dashes",
  "drop", "drops",
  "splash", "splashes",
  "pinch", "pinches",
  "barspoon", "barspoons",
  "part", "parts",
]);

/** Whether the word names a measure at all, convertible or not. */
export function isMeasureWord(word: string): boolean {
  const key = word.trim().toLowerCase();
  return Object.hasOwn(UNIT_SPELLINGS, key) || EXTRA_MEASURE_WORDS.has(key);
}
