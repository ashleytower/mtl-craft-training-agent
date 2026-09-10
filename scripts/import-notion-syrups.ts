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
import type { OperatorIdentity } from "../server/_core/supabaseAuth";

const INPUT = resolve(
  process.env.NOTION_SYRUPS_JSON ??
    "/private/tmp/claude-501/-Users-ashleytower/d3589e76-37ea-4d4c-9226-6b02d60483f2/scratchpad/notion-syrups.json"
);
const REPORT = resolve(process.cwd(), "docs/BRIX_SYRUP_IMPORT_DIFF.md");
const PARSER_VERSION = "notion-syrups/1.0.0";

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

function ingredientsOf(s: NotionSyrup) {
  return (s.ingredients ?? []).map(i => ({
    name: (i.name ?? "").trim(),
    quantity: parseQuantity(i.qty),
    quantity_raw: i.qty ?? null,
    unit: i.unit ?? null,
  }));
}

/**
 * Completeness, used only to choose between rows describing the same syrup.
 * An ingredient counts when it has a name, a parsable quantity and a unit.
 */
function completeness(s: NotionSyrup): number {
  return ingredientsOf(s).filter(i => i.name && i.quantity !== null && i.unit).length;
}

export type MergedSyrup = {
  canonical: string;
  chosen: NotionSyrup;
  mergedFrom: string[];
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
    const ranked = [...rows].sort((a, b) => completeness(b) - completeness(a));
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
      mergedFrom: rows.map(r => r.name),
      warnings,
    });
  }
  return out.sort((a, b) => a.canonical.localeCompare(b.canonical));
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
    } else if (!i.unit) {
      w.push(`"${i.name}" has a quantity but no unit in Notion.`);
    }
  }
  const yieldValue = parseQuantity(m.chosen.yield_value as string | null);
  if (yieldValue === null) {
    w.push("No yield recorded — target-yield scaling will refuse until one is set.");
  } else {
    // The yields in Notion are demonstrably unreliable: the jalapeño row claims
    // 6 L for a batch containing 18 L of water. Imported, but never trusted.
    const totalMass = ingredientsOf(m.chosen).reduce((n, i) => n + (i.quantity ?? 0), 0);
    if (totalMass > 0 && yieldValue * 1000 < totalMass / 4) {
      w.push(
        `Yield of ${yieldValue} ${m.chosen.yield_unit ?? "?"} looks too small for ` +
          `${totalMass} units of ingredients — verify before enabling target-yield scaling.`
      );
    }
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

export function buildDraft(m: MergedSyrup) {
  const ingredients = ingredientsOf(m.chosen);
  const recipe = {
    source: "notion",
    notion_url: m.chosen.notion_url,
    merged_from: m.mergedFrom,
    ingredients,
    labour_hours: m.chosen.labour_hours ?? null,
    selling_price: m.chosen.selling_price ?? null,
    // Notion's own yields are unreliable, so the value is carried but explicitly
    // marked unverified. `brix-status`-style honesty: hold the number, refuse to
    // present it as trustworthy.
    yield_verified: false,
  };
  // The yield is part of the content, not metadata beside it. Leaving it out
  // meant a corrected yield in Notion hashed identically to the wrong one, so a
  // re-run reported "unchanged" and silently discarded the fix. Caught by
  // `hashes the SOURCE identity, not the content`.
  const content = JSON.stringify({
    name: m.canonical,
    ...recipe,
    intended_yield_value: parseQuantity(m.chosen.yield_value as string | null),
    intended_yield_unit: m.chosen.yield_unit ?? null,
  });
  const contentHash = createHash("sha256").update(content).digest("hex");

  return {
    // Hash of the SOURCE IDENTITY, not the content — see migration 125's header.
    original_source_hash: createHash("sha256").update(m.chosen.notion_url).digest("hex"),
    external_recipe_id: m.chosen.notion_url,
    name: m.canonical,
    product_category: "syrup_or_related_product",
    original_recipe_json: { ...recipe, content_sha256: contentHash },
    intended_yield_value: parseQuantity(m.chosen.yield_value as string | null),
    intended_yield_unit: m.chosen.yield_unit ?? null,
    warnings: auditWarnings(m),
  };
}

function renderReport(drafts: ReturnType<typeof buildDraft>[]): string {
  const clean = drafts.filter(d => d.warnings.length === 0);
  const flagged = drafts.filter(d => d.warnings.length > 0);
  const empty = drafts.filter(d =>
    (d.original_recipe_json.ingredients ?? []).length === 0
  );

  const lines: string[] = [];
  lines.push("# Brix — Notion syrup import, diff");
  lines.push("");
  lines.push("**Generated by `scripts/import-notion-syrups.ts`. Dry run writes nothing.**");
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| formulas after collapsing variants | **${drafts.length}** |`);
  lines.push(`| clean, no warnings | ${clean.length} |`);
  lines.push(`| needs a human look | ${flagged.length} |`);
  lines.push(`| no ingredients at all | ${empty.length} |`);
  lines.push(
    `| carry a yield | ${drafts.filter(d => d.intended_yield_value !== null).length} |`
  );
  lines.push("");
  lines.push("Nothing here is approved. Every row lands as `needs_review`.");
  lines.push("");

  lines.push("## Formulas");
  lines.push("");
  lines.push("| syrup | ingredients | yield | flags |");
  lines.push("|---|---|---|---|");
  for (const d of drafts) {
    const ings = (d.original_recipe_json.ingredients ?? []) as Array<{
      name: string;
      quantity: number | null;
      unit: string | null;
    }>;
    const recipe =
      ings.map(i => `${i.name} ${i.quantity ?? "?"}${i.unit ?? ""}`).join(" + ") || "—";
    const y =
      d.intended_yield_value === null
        ? "—"
        : `${d.intended_yield_value} ${d.intended_yield_unit ?? ""}`.trim();
    lines.push(
      `| ${d.name} | ${recipe} | ${y} | ${d.warnings.length === 0 ? "" : d.warnings.length} |`
    );
  }
  lines.push("");

  if (flagged.length > 0) {
    lines.push("## What needs you");
    lines.push("");
    for (const d of flagged) {
      lines.push(`**${d.name}**`);
      for (const w of d.warnings) lines.push(`- ${w}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const raw = JSON.parse(readFileSync(INPUT, "utf8")) as NotionSyrup[];
  const active = raw.filter(s => !s.archived);
  const merged = mergeVariants(active);
  const drafts = merged.map(buildDraft);

  writeFileSync(REPORT, renderReport(drafts), "utf8");
  console.log(
    `${active.length} active Notion syrups -> ${drafts.length} formulas after collapsing variants`
  );
  console.log(`report: ${REPORT}`);

  if (!apply) {
    console.log("\nDRY RUN. Nothing written. Re-run with --apply to write drafts.");
    return;
  }

  const result = await beverage.ingestFormulaDrafts(ownerIdentity(), {
    run: {
      intake_kind: "notion_syrup_master",
      source_label: "Notion [MASTER] All Syrups",
      original_reference: "https://app.notion.com/p/9f7a914997454e53a9225491d3c3b44d",
      parser_version: PARSER_VERSION,
      warnings: [],
    },
    drafts,
  });
  console.log("\nwritten:", JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
