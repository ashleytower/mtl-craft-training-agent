/**
 * How much of one of her syrups replaces the sugar in a jelly recipe.
 *
 * Ashley 2026-10-22: "this is your syrup recipe ... try this amount". Her rule for
 * this one calculation (2026-10-23): 1 ml of WATER counts as 1 g. Nothing else is
 * converted: a syrup with any other ml line (juice, puree) is refused, by name.
 *
 * The syrup's sugar share is Sugar g / every line's weight, as written. The fruit's
 * own sugar and anything strained out are not counted, so the answer is a starting
 * point for a test, and says so. Exact rationals throughout, like scaling. The
 * jelly's water is shown, never changed: how much liquid to take out is her call.
 *
 * Pure: no I/O, writes nothing.
 */

import {
  divide,
  formatExact,
  measurable,
  parseRational,
  subtract,
  sum,
  toDecimal,
  type FormulaComponent,
  type NormalizedFormula,
  type Rational,
} from "./beverageScaling";
import { canonicalUnit } from "@shared/units";

type Amount = { exact: string; measurable: string; truncated: boolean };
type Line = { ingredient_name: string; quantity: string; unit: string };

export type SugarSwap = {
  jelly: string;
  syrup: string;
  sugar_line: string;
  jelly_sugar_g: string;
  syrup_sugar_share: { exact: string; decimal: string };
  /** How much syrup carries the same sugar. */
  syrup_g: Amount;
  /** What the syrup adds besides its sugar: its water and fruit. */
  added_besides_sugar_g: Amount;
  /** Her water line in the same layer as the swapped sugar, as it is. */
  jelly_water_lines: Line[];
  /** The jelly with that one sugar line swapped for the syrup. Ready for `test`. */
  lines: Line[];
  assumption: string;
};

const ASSUMPTION =
  "Counts 1 ml of water as 1 g. Does not count the fruit's own sugar, or anything " +
  "strained out or cooked off, so treat it as a starting amount to test.";

/** "Sugar" or "Sugar (<layer>)". Never "Sugar syrup", "Sugar, invert", "Brown sugar". */
const SUGAR_LINE = /^sugar(\s*\([^()]*\))?$/i;
const WATER_LINE = /^water(\s*\([^()]*\))?$/i;
const named = (c: FormulaComponent, name: string) => c.ingredientName.trim().toLowerCase() === name;
const isGrams = (c: FormulaComponent) => canonicalUnit(c.unit) === "gr";
const show = (c: FormulaComponent) => `${c.ingredientName} ${c.quantity} ${c.unit}`;

function amount(r: Rational): Amount {
  const d = toDecimal(r);
  const said = measurable(d.text, d.isExact);
  return { exact: formatExact(r), measurable: said, truncated: !(d.isExact && said === d.text) };
}

function asLine(c: FormulaComponent): Line {
  return { ingredient_name: c.ingredientName, quantity: String(c.quantity), unit: c.unit };
}

function syrupShare(syrup: NormalizedFormula): Rational {
  const sugar = syrup.components.filter(c => named(c, "sugar"));
  if (sugar.length !== 1) {
    throw new Error(
      sugar.length === 0
        ? `${syrup.name} has no Sugar line.`
        : `${syrup.name} has ${sugar.length} Sugar lines; cannot tell which one.`
    );
  }
  const waterMl = (c: FormulaComponent) => named(c, "water") && canonicalUnit(c.unit) === "ml";
  const unweighable = syrup.components.filter(c => !isGrams(c) && !waterMl(c));
  if (unweighable.length > 0) {
    throw new Error(
      `${syrup.name} has lines Brix cannot weigh: ${unweighable.map(show).join("; ")}. ` +
        "Only water counts 1 ml as 1 g."
    );
  }
  const total = sum(syrup.components.map(c => parseRational(c.quantity, c.ingredientName)));
  const sugarG = parseRational(sugar[0].quantity, "Sugar");
  if (sugarG.n <= 0n) throw new Error(`${syrup.name} has no sugar to give.`);
  return divide(sugarG, total);
}

function pickSugarLine(jelly: NormalizedFormula, wanted?: string): FormulaComponent {
  const sugars = jelly.components.filter(c => SUGAR_LINE.test(c.ingredientName.trim()));
  if (wanted !== undefined) {
    const hit = sugars.find(c => named(c, wanted.trim().toLowerCase()));
    if (!hit) {
      throw new Error(
        `"${wanted}" is not a Sugar line of ${jelly.name}. Its Sugar lines: ` +
          (sugars.map(c => c.ingredientName).join("; ") || "none")
      );
    }
    return hit;
  }
  if (sugars.length === 0) throw new Error(`${jelly.name} has no Sugar line to replace.`);
  if (sugars.length > 1) {
    throw new Error(
      `${jelly.name} has ${sugars.length} Sugar lines: ` +
        `${sugars.map(c => c.ingredientName).join("; ")}. Say which one.`
    );
  }
  return sugars[0];
}

export function swapSugar(
  jelly: NormalizedFormula,
  syrup: NormalizedFormula,
  sugarLine?: string
): SugarSwap {
  const line = pickSugarLine(jelly, sugarLine);
  if (!isGrams(line)) {
    throw new Error(`${show(line)} is not in grams; Brix does not convert it.`);
  }
  const share = syrupShare(syrup);
  const jellySugar = parseRational(line.quantity, line.ingredientName);
  const syrupG = divide(jellySugar, share);
  // " (lime-vodka layer)" or "". Keeps the layer on the syrup line and finds that
  // layer's water, so a layered recipe still reads as its layers.
  const layer = line.ingredientName.trim().slice("sugar".length);
  const sameLayerWater = (c: FormulaComponent) =>
    WATER_LINE.test(c.ingredientName.trim()) &&
    c.ingredientName.trim().slice("water".length).toLowerCase() === layer.toLowerCase();

  return {
    jelly: jelly.name,
    syrup: syrup.name,
    sugar_line: line.ingredientName,
    jelly_sugar_g: String(line.quantity),
    syrup_sugar_share: { exact: formatExact(share), decimal: toDecimal(share).text },
    syrup_g: amount(syrupG),
    added_besides_sugar_g: amount(subtract(syrupG, jellySugar)),
    jelly_water_lines: jelly.components.filter(sameLayerWater).map(asLine),
    lines: jelly.components.map(c =>
      c === line
        ? { ingredient_name: syrup.name + layer, quantity: amount(syrupG).measurable, unit: "gr" }
        : asLine(c)
    ),
    assumption: ASSUMPTION,
  };
}
