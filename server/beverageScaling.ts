/**
 * Deterministic formula scaling.
 *
 * Every quantity is carried as an exact rational (BigInt numerator over BigInt
 * denominator), never as a float. A factor like 3700/5250 reduces to 74/105,
 * whose decimal expansion never terminates — binary floating point cannot hold
 * it, and rounding it silently is how a batch sheet ends up wrong. So the exact
 * fraction is always the answer of record, and the decimal rendering is a
 * convenience that is explicitly flagged when it had to be truncated.
 *
 * This module does no I/O, converts no units, substitutes no ingredients,
 * touches no stock, computes no cost, and never releases a batch.
 */

/** Digits kept when a decimal expansion does not terminate. */
const DECIMAL_DIGITS = 28;

/**
 * A quantity as it reaches us. Postgres `numeric` inside jsonb_build_object
 * crosses the wire as a JSON number, so this is not always a string however
 * much we would prefer it were — see parseRational.
 */
export type Quantity = string | number;

export type FormulaComponent = {
  lineNumber: number;
  ingredientName: string;
  /** Decimal as stored in beverage.formula_components.quantity (numeric). */
  quantity: Quantity;
  unit: string;
};

export type NormalizedFormula = {
  formulaVersionId: string;
  name: string;
  intendedYieldValue: Quantity | null;
  intendedYieldUnit: string | null;
  components: FormulaComponent[];
};

export type ScaleRequest =
  | { mode: "multiplier"; multiplier: Quantity }
  | { mode: "targetYield"; targetYieldValue: Quantity }
  | {
      mode: "limitingIngredient";
      ingredientName: string;
      availableQuantity: Quantity;
      unit: string;
    };

export type ScaledComponent = {
  lineNumber: number;
  ingredientName: string;
  unit: string;
  originalQuantity: Quantity;
  scaledQuantity: string;
  scaledQuantityIsExact: boolean;
  /** Only present when the decimal rendering had to be truncated. */
  scaledQuantityExact?: string;
};

export type ScaleResult = {
  formulaVersionId: string;
  name: string;
  status: "not_released";
  factor: { exact: string; decimal: string; decimalIsExact: boolean };
  scaledYield: { value: string; unit: string | null; isExact: boolean } | null;
  components: ScaledComponent[];
};

type Rational = { n: bigint; d: bigint };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}

function reduce({ n, d }: Rational): Rational {
  if (d === 0n) {
    throw new Error("Cannot divide by zero");
  }
  const sign = d < 0n ? -1n : 1n;
  const divisor = gcd(n, d) || 1n;
  return { n: (n / divisor) * sign, d: (d / divisor) * sign };
}

/**
 * Parse a decimal into an exact rational. Accepts a number as well as a string
 * because Postgres numerics arrive as JSON numbers. A number is stringified
 * rather than used arithmetically, so the exact-rational path is identical
 * either way; precision already lost in JSON cannot be recovered here, which is
 * why the API casts numerics to text at the source.
 */
function parseRational(raw: Quantity | null | undefined, label: string): Rational {
  const text = (typeof raw === "number" ? String(raw) : (raw ?? "")).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error(`${label} must be a decimal number, received "${raw ?? ""}"`);
  }
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const sign = text.startsWith("-") ? -1n : 1n;
  const n = sign * BigInt(`${whole}${fraction}`);
  const d = 10n ** BigInt(fraction.length);
  return reduce({ n, d });
}

function multiply(a: Rational, b: Rational): Rational {
  return reduce({ n: a.n * b.n, d: a.d * b.d });
}

function divide(a: Rational, b: Rational): Rational {
  if (b.n === 0n) {
    throw new Error("Cannot divide by zero");
  }
  return reduce({ n: a.n * b.d, d: a.d * b.n });
}

function isPositive({ n, d }: Rational): boolean {
  return n > 0n && d > 0n;
}

function formatExact({ n, d }: Rational): string {
  return d === 1n ? n.toString() : `${n.toString()}/${d.toString()}`;
}

/**
 * Render a rational as a decimal string by long division. Terminates early and
 * reports `isExact: true` when the remainder reaches zero; otherwise truncates
 * at DECIMAL_DIGITS and reports `isExact: false`. It never rounds — a truncated
 * value is always <= the true value, so a scaled batch is never overstated.
 */
function toDecimal({ n, d }: Rational): { text: string; isExact: boolean } {
  const negative = n < 0n;
  let numerator = negative ? -n : n;
  const whole = numerator / d;
  let remainder = numerator % d;
  if (remainder === 0n) {
    return { text: `${negative ? "-" : ""}${whole.toString()}`, isExact: true };
  }

  let digits = "";
  for (let i = 0; i < DECIMAL_DIGITS && remainder !== 0n; i += 1) {
    remainder *= 10n;
    digits += (remainder / d).toString();
    remainder %= d;
  }
  return {
    text: `${negative ? "-" : ""}${whole.toString()}.${digits}`,
    isExact: remainder === 0n,
  };
}

/**
 * Spellings of the same unit. This normalises LABELS only — it never converts a
 * magnitude, so "grams" and "gr" agree while "kg" and "gr" still do not.
 *
 * `oz` is deliberately absent: it is ambiguous between weight and fluid volume,
 * and quietly treating 16 oz of sugar as interchangeable with 16 fl oz of
 * anything is precisely the mistake this module exists to prevent.
 */
const UNIT_SPELLINGS: Record<string, string> = {
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
function canonicalUnit(unit: string): string {
  const key = unit.trim().toLowerCase();
  return UNIT_SPELLINGS[key] ?? key;
}

function findComponent(
  formula: NormalizedFormula,
  ingredientName: string
): FormulaComponent {
  const wanted = ingredientName.trim().toLowerCase();
  const match = formula.components.find(
    c => c.ingredientName.trim().toLowerCase() === wanted
  );
  if (!match) {
    throw new Error(`"${ingredientName}" is not a component of ${formula.name}`);
  }
  return match;
}

function resolveFactor(formula: NormalizedFormula, request: ScaleRequest): Rational {
  if (request.mode === "multiplier") {
    const factor = parseRational(request.multiplier, "Multiplier");
    if (!isPositive(factor)) {
      throw new Error("Multiplier must be positive");
    }
    return factor;
  }

  if (request.mode === "targetYield") {
    if (formula.intendedYieldValue === null) {
      throw new Error(
        `${formula.name} has no planned yield, so it cannot be scaled to a target yield`
      );
    }
    const planned = parseRational(formula.intendedYieldValue, "Planned yield");
    const target = parseRational(request.targetYieldValue, "Target yield");
    if (!isPositive(planned) || !isPositive(target)) {
      throw new Error("Planned yield and target yield must both be positive");
    }
    return divide(target, planned);
  }

  const component = findComponent(formula, request.ingredientName);
  if (canonicalUnit(component.unit) !== canonicalUnit(request.unit)) {
    throw new Error(
      `Available ${component.ingredientName} is in "${request.unit}" but the formula ` +
        `specifies "${component.unit}". This scaler does not convert units — ` +
        `restate the available quantity in "${component.unit}".`
    );
  }
  const required = parseRational(component.quantity, `${component.ingredientName} quantity`);
  const available = parseRational(request.availableQuantity, "Available quantity");
  if (!isPositive(required) || !isPositive(available)) {
    throw new Error("Required and available quantities must both be positive");
  }
  return divide(available, required);
}

export function scaleFormula(
  formula: NormalizedFormula,
  request: ScaleRequest
): ScaleResult {
  if (formula.components.length === 0) {
    throw new Error(
      `${formula.name} has no normalized component rows, so there is nothing to scale`
    );
  }

  const factor = resolveFactor(formula, request);
  if (!isPositive(factor)) {
    throw new Error("Scaling factor must be positive");
  }
  const factorDecimal = toDecimal(factor);

  const components = formula.components.map(component => {
    const quantity = parseRational(
      component.quantity,
      `${component.ingredientName} quantity`
    );
    const scaled = multiply(quantity, factor);
    const decimal = toDecimal(scaled);
    const row: ScaledComponent = {
      lineNumber: component.lineNumber,
      ingredientName: component.ingredientName,
      unit: component.unit,
      originalQuantity: component.quantity,
      scaledQuantity: decimal.text,
      scaledQuantityIsExact: decimal.isExact,
    };
    if (!decimal.isExact) {
      row.scaledQuantityExact = formatExact(scaled);
    }
    return row;
  });

  let scaledYield: ScaleResult["scaledYield"] = null;
  if (formula.intendedYieldValue !== null) {
    const planned = parseRational(formula.intendedYieldValue, "Planned yield");
    const decimal = toDecimal(multiply(planned, factor));
    scaledYield = {
      value: decimal.text,
      unit: formula.intendedYieldUnit,
      isExact: decimal.isExact,
    };
  }

  return {
    formulaVersionId: formula.formulaVersionId,
    name: formula.name,
    // A scaled sheet is a calculation, never a release decision.
    status: "not_released",
    factor: {
      exact: formatExact(factor),
      decimal: factorDecimal.text,
      decimalIsExact: factorDecimal.isExact,
    },
    scaledYield,
    components,
  } as const;
}
