/**
 * Turn the cocktail drafts into approved, scalable formulas.
 *
 * Run:
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/version-cocktails.ts
 *       reads nothing but the database, writes the plan, changes NOTHING
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/version-cocktails.ts --apply --rationale "..."
 *       creates and approves exactly the plan that was last written
 *
 * WHY IT IS TWO STEPS
 *
 * 38 drinks is too many to approve one at a time and far too many to approve
 * blind. So the plan step writes every spec out in full, and the apply step
 * refuses unless the live data still hashes to the plan she read. Her yes
 * attaches to a LIST, and the fingerprint is what makes that mechanical rather
 * than a promise.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * The CRM, only. `resolveDraftIngredients` prefers a matching CRM recipe over
 * anything in the draft, which is Ashley's rule — the CRM is authoritative for
 * house recipe quantities. A draft that does not match a CRM recipe is left
 * alone rather than versioned from its own free text, because that text is the
 * Notion intake and has no quantities in it at all.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as beverage from "../server/beverageClient";
import { resolveDraftIngredients } from "../shared/ingredients";
import type { OperatorIdentity } from "../server/_core/supabaseAuth";

const PLAN = resolve(process.cwd(), "docs/BRIX_COCKTAIL_VERSION_PLAN.md");
const FINGERPRINT_LINE = "<!-- plan-fingerprint: ";

export type ResolvedItem = {
  name: string;
  quantity: string | null;
  unit: string | null;
  role: "ingredient" | "garnish";
};

export type ResolvedDraft = {
  draftId: string;
  name: string;
  items: ResolvedItem[];
};

export type ComponentInput = {
  line_number: number;
  ingredient_name: string;
  quantity: string;
  unit: string;
  component_role: string;
};

/**
 * The components for one drink, in the order the resolver produced them.
 *
 * A garnish stays a garnish (migration 128). Storing a grape skewer as an
 * `ingredient` would make the measured lines and the presentation lines
 * indistinguishable, which is what Ashley was pointing at when she said the
 * Jungle Bird's Tajín line was in the wrong place.
 */
export function componentsFor(draft: ResolvedDraft): ComponentInput[] {
  if (draft.items.length === 0) {
    throw new Error(`${draft.name}: no components to version`);
  }
  return draft.items.map((item, index) => {
    if (!item.quantity) {
      throw new Error(`${draft.name}: "${item.name}" has no quantity; it cannot be scaled`);
    }
    if (!item.unit) {
      throw new Error(`${draft.name}: "${item.name}" has no unit; it cannot be scaled`);
    }
    return {
      line_number: index + 1,
      ingredient_name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      component_role: item.role === "garnish" ? "garnish" : "ingredient",
    };
  });
}

/**
 * A hash of exactly what she is being asked to approve.
 *
 * Sorted by drink so the order the database happened to return rows in does not
 * invalidate a plan, and covering every name, quantity, unit and role so that
 * anything she would have noticed changing does invalidate it.
 */
export function planFingerprint(drafts: ResolvedDraft[]): string {
  const canonical = [...drafts]
    .sort((a, b) => a.draftId.localeCompare(b.draftId))
    .map(d => ({
      id: d.draftId,
      name: d.name,
      items: d.items.map(i => [i.name, i.quantity, i.unit, i.role]),
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

/** `Summer in Italy` -> `summer-in-italy`, the same shape the CRM uses for its ids. */
function formulaKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Drinks whose names collapse to one formula key.
 *
 * Two drafts are both called "Spicy Margarita". Approving both made the second
 * supersede the first — migration 127 behaving correctly on input that should
 * never have reached it. Their specs were identical so nothing wrong was
 * served, but the run said "approved 38 of 38" when there were 37 distinct
 * drinks, and the read-back agreed because it matched on name.
 *
 * A duplicate is a question for Ashley, not something to resolve by letting one
 * quietly win.
 */
export function duplicateKeys(drafts: ResolvedDraft[]): Array<{ key: string; names: string[] }> {
  const byKey = new Map<string, string[]>();
  for (const d of drafts) {
    const key = formulaKey(d.name);
    byKey.set(key, [...(byKey.get(key) ?? []), d.name]);
  }
  return [...byKey.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([key, names]) => ({ key, names }));
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

async function resolveAll(identity: OperatorIdentity) {
  const [drafts, crm, approved] = await Promise.all([
    beverage.listFormulaDrafts(identity),
    beverage.listCrmRecipes(),
    beverage.listApprovedFormulas(identity) as Promise<Array<{ formula_key: string }>>,
  ]);
  const approvedKeys = new Set(approved.map(a => a.formula_key));

  const ready: ResolvedDraft[] = [];
  const skipped: Array<{ name: string; why: string }> = [];
  for (const d of drafts) {
    if (d.product_category !== "cocktail") continue;
    const r = resolveDraftIngredients(d as never, [], crm);
    if (r.source !== "crm_recipe") {
      skipped.push({ name: d.name, why: "no CRM recipe of this name; nothing supplies quantities" });
      continue;
    }
    if (r.blocked) {
      skipped.push({ name: d.name, why: r.blockedReason ?? "blocked" });
      continue;
    }
    if (approvedKeys.has(formulaKey(d.name))) {
      skipped.push({ name: d.name, why: "already has an approved formula" });
      continue;
    }
    ready.push({
      draftId: d.id,
      name: d.name,
      items: r.items.map(i => ({
        name: i.name, quantity: i.quantity, unit: i.unit, role: i.role,
      })),
    });
  }
  ready.sort((a, b) => a.name.localeCompare(b.name));
  return { ready, skipped };
}

function renderPlan(ready: ResolvedDraft[], skipped: Array<{ name: string; why: string }>): string {
  const lines: string[] = [];
  lines.push("# Brix — cocktails ready to version");
  lines.push("");
  lines.push(
    "Every quantity below comes from the CRM recipe of the same name. Nothing here " +
      "was read off a Notion draft and nothing was inferred."
  );
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| ready to approve | **${ready.length}** |`);
  lines.push(`| skipped | ${skipped.length} |`);
  lines.push("");
  lines.push("Approving these creates one formula version each and approves it, so Brix");
  lines.push("can scale them. Run:");
  lines.push("");
  lines.push("```");
  lines.push('npx tsx scripts/version-cocktails.ts --apply --rationale "<what you said>"');
  lines.push("```");
  lines.push("");
  lines.push("The apply refuses if anything below has changed since this file was written.");
  lines.push("");

  for (const d of ready) {
    lines.push(`### ${d.name}`);
    lines.push("");
    for (const i of d.items) {
      const tag = i.role === "garnish" ? "  _(garnish)_" : "";
      lines.push(`- ${i.quantity} ${i.unit} — ${i.name}${tag}`);
    }
    lines.push("");
  }

  const clashes = duplicateKeys(ready);
  if (clashes.length > 0) {
    lines.push("## Duplicate names — apply will refuse until these are resolved");
    lines.push("");
    for (const c of clashes) {
      lines.push(`- **${c.key}** — ${c.names.join(", ")}`);
    }
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push("## Not included");
    lines.push("");
    for (const s of skipped) lines.push(`- **${s.name}** — ${s.why}`);
    lines.push("");
  }
  lines.push(`${FINGERPRINT_LINE}${planFingerprint(ready)} -->`);
  return lines.join("\n");
}

function fingerprintInPlan(): string | null {
  try {
    const text = readFileSync(PLAN, "utf8");
    const match = text.match(/<!-- plan-fingerprint: ([0-9a-f]+) -->/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rationaleIndex = process.argv.indexOf("--rationale");
  const rationale = rationaleIndex >= 0 ? (process.argv[rationaleIndex + 1] ?? "").trim() : "";

  const identity = ownerIdentity();
  const { ready, skipped } = await resolveAll(identity);
  const fingerprint = planFingerprint(ready);

  if (!apply) {
    writeFileSync(PLAN, renderPlan(ready, skipped), "utf8");
    console.log(`${ready.length} cocktails ready to version, ${skipped.length} skipped`);
    console.log(`plan: ${PLAN}`);
    console.log(`fingerprint: ${fingerprint}`);
    console.log("\nNothing was written to the database. Read the plan, then re-run with");
    console.log('--apply --rationale "<what you said>".');
    return;
  }

  if (rationale.length < 6) {
    console.error('--apply needs --rationale "<what you said>"; it becomes the approval record.');
    process.exit(2);
  }
  const planned = fingerprintInPlan();
  if (!planned) {
    console.error(`No plan at ${PLAN}. Run without --apply first.`);
    process.exit(2);
  }
  if (planned !== fingerprint) {
    console.error(
      `The plan is stale. It was written for ${planned} and the data now hashes to ` +
        `${fingerprint}. Re-run without --apply, read what changed, then apply.`
    );
    process.exit(1);
  }

  const clashes = duplicateKeys(ready);
  if (clashes.length > 0) {
    for (const c of clashes) {
      console.error(`Two drafts share the formula key "${c.key}": ${c.names.join(", ")}.`);
    }
    console.error(
      "Approving both would make one supersede the other. Resolve the duplicate " +
        "draft first — this is a question about the corpus, not something to pick a winner for."
    );
    process.exit(1);
  }

  let created = 0;
  const failures: string[] = [];
  for (const draft of ready) {
    try {
      const version = await beverage.createFormulaVersion(identity, {
        formulaDraftId: draft.draftId,
        formulaKey: formulaKey(draft.name),
        name: draft.name,
        components: componentsFor(draft),
      });
      await beverage.approveFormulaVersion(identity, {
        formulaVersionId: version.id,
        rationale,
      });
      created += 1;
    } catch (error) {
      failures.push(`${draft.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`approved ${created} of ${ready.length}`);
  for (const f of failures) console.error(`  FAILED ${f}`);

  // Read back through the same list Brix reads. A version that exists but does
  // not come back here is a formula nobody can scale, which is the failure this
  // corpus has already had once.
  const live = (await beverage.listApprovedFormulas(identity)) as Array<{
    name: string;
    components: unknown[];
  }>;
  const byName = new Map(live.map(f => [f.name, f.components?.length ?? 0]));
  const unscalable = ready.filter(d => !byName.get(d.name));
  const distinct = new Set(ready.map(d => formulaKey(d.name))).size;
  console.log(
    `read back: ${distinct - unscalable.length} of ${distinct} distinct formulas are scalable`
  );
  if (unscalable.length > 0 || failures.length > 0) {
    for (const d of unscalable) console.error(`  NOT SCALABLE ${d.name}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
