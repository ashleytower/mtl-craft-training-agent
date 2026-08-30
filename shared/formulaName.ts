/**
 * The Notion intake prefixes syrups with a venue or programme name ("Mosaiq",
 * "Kosher") and suffixes them with a batch qualifier ("(first run)"). Neither is
 * part of the syrup's name.
 *
 * The lists are explicit rather than a general "strip anything in brackets",
 * because some brackets are meaningful: "Orgeat (bought almond milk)" is a real
 * variant, not noise, and losing that distinction would merge two formulas.
 */
const NAME_PREFIX_NOISE = ["mosaiq", "kosher"];

const NAME_SUFFIX_NOISE = [
  "first run total batch",
  "first run whole batch",
  "first run",
  "whole batch",
  "total batch",
  "big batch",
];

export function cleanFormulaName(raw: string): string {
  let name = raw.trim();

  // Leading emoji carried over by the intake. Deliberately narrow: a broad
  // "strip anything non-alphanumeric" also eats a legitimate opening bracket.
  name = name.replace(/^[\s\p{Extended_Pictographic}]+/u, "").trim();

  for (const prefix of NAME_PREFIX_NOISE) {
    const re = new RegExp(`^${prefix}\\s+`, "i");
    if (re.test(name)) name = name.replace(re, "").trim();
  }

  for (const suffix of NAME_SUFFIX_NOISE) {
    const re = new RegExp(`\\s*\\(\\s*${suffix}\\s*\\)\\s*$`, "i");
    if (re.test(name)) name = name.replace(re, "").trim();
  }

  // Never return an empty name — a bad strip is worse than leaving it alone.
  return name || raw.trim();
}
