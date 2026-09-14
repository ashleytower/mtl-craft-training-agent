/**
 * Turn named syrup drafts into approved, scalable formulas.
 *
 * Run:
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/version-syrups.ts --only "A,B,C"
 *       reads the database, writes the plan, changes NOTHING
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/version-syrups.ts --only "A,B,C" --apply --rationale "..."
 *       creates and approves exactly the plan that was last written
 *
 * SAME TWO STEPS AS THE COCKTAILS, AND THE SAME REASON
 *
 * The plan writes every spec out in full and the apply refuses unless the live
 * data still hashes to it. The fingerprint, `componentsFor` and `duplicateKeys`
 * are imported from `version-cocktails` rather than rewritten, because two
 * copies of an approval rule is how the two copies drift.
 *
 * WHERE THE NUMBERS COME FROM, AND WHY THAT DIFFERS
 *
 * The DRAFT, not the CRM. `version-cocktails` refuses anything without a CRM
 * recipe, because the CRM is authoritative for a house cocktail. No syrup has a
 * CRM recipe — a syrup's quantities live in Notion and nowhere else — so this
 * resolves from the draft itself. That is the whole reason this is a second
 * script and not a flag on the first one: they disagree about what counts as a
 * trustworthy source, and collapsing them would lose that.
 *
 * `--apply` REQUIRES `--only`
 *
 * There are 52 syrup drafts and approving one is a decision about what somebody
 * measures at the bar. A script that could approve all of them because an
 * argument was forgotten is a mass write waiting for a bad afternoon.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as beverage from "../server/beverageClient";
import { resolveDraftIngredients } from "../shared/ingredients";
import {
  componentsFor,
  duplicateKeys,
  planFingerprint,
  type ResolvedDraft,
} from "./version-cocktails";
import type { OperatorIdentity } from "../server/_core/supabaseAuth";

const PLAN = resolve(process.cwd(), "docs/BRIX_SYRUP_VERSION_PLAN.md");
const FINGERPRINT_LINE = "<!-- plan-fingerprint: ";

/** `Saline Solution` -> `saline-solution`, the same shape the cocktails use. */
export function formulaKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

async function resolveAll(identity: OperatorIdentity, only: Set<string>) {
  const [drafts, approved] = await Promise.all([
    beverage.listFormulaDrafts(identity),
    beverage.listApprovedFormulas(identity) as Promise<Array<{ formula_key: string }>>,
  ]);
  const approvedKeys = new Set(approved.map(a => a.formula_key));

  const ready: ResolvedDraft[] = [];
  const skipped: Array<{ name: string; why: string }> = [];
  for (const d of drafts) {
    if (d.product_category !== "syrup_or_related_product") continue;
    if (only.size > 0 && !only.has(d.name.toLowerCase())) continue;

    const r = resolveDraftIngredients(d as never, []);
    if (r.blocked) {
      skipped.push({ name: d.name, why: r.blockedReason ?? "blocked" });
      continue;
    }
    if (r.items.length === 0) {
      skipped.push({ name: d.name, why: "no ingredients; nothing to scale" });
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

  // A name she asked for that matched nothing is a typo or a retired row, and
  // silently approving the other five would hide it.
  const found = new Set(ready.map(r => r.name.toLowerCase()));
  const missing = [...only].filter(n => !found.has(n) && !skipped.some(s => s.name.toLowerCase() === n));
  return { ready, skipped, missing };
}

function renderPlan(ready: ResolvedDraft[], skipped: Array<{ name: string; why: string }>): string {
  const l: string[] = [];
  l.push("# Brix — syrups ready to version", "");
  l.push("Every quantity below comes from the syrup's own Notion draft. No syrup has a");
  l.push("CRM recipe, so the draft is the only source there is.", "");
  l.push("| | |", "|---|---|");
  l.push(`| ready to approve | **${ready.length}** |`);
  l.push(`| skipped | ${skipped.length} |`, "");
  l.push("Approving these creates one formula version each and approves it, so Brix can");
  l.push("scale them. The apply refuses if anything below has changed since this file", "was written.", "");
  for (const d of ready) {
    l.push(`### ${d.name}`, "");
    for (const i of d.items) l.push(`- ${i.name} — ${i.quantity} ${i.unit}`);
    l.push("");
  }
  if (skipped.length > 0) {
    l.push("## Not included", "");
    for (const s of skipped) l.push(`- **${s.name}** — ${s.why}`);
    l.push("");
  }
  l.push(`${FINGERPRINT_LINE}${planFingerprint(ready)} -->`);
  return l.join("\n");
}

function fingerprintInPlan(): string | null {
  try {
    return readFileSync(PLAN, "utf8").match(/<!-- plan-fingerprint: ([0-9a-f]+) -->/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const onlyRaw = argValue("--only");
  const only = new Set(
    (onlyRaw ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
  );

  if (apply && only.size === 0) {
    console.error(
      "--apply requires --only \"Name, Name\". Approving every syrup because an " +
        "argument was forgotten is not something this script will do."
    );
    process.exit(1);
  }

  const identity = ownerIdentity();
  const { ready, skipped, missing } = await resolveAll(identity, only);

  if (missing.length > 0) {
    console.error(`no syrup draft named: ${missing.join(", ")}`);
    process.exit(1);
  }

  const fingerprint = planFingerprint(ready);
  if (!apply) {
    writeFileSync(PLAN, renderPlan(ready, skipped), "utf8");
    console.log(`${ready.length} ready, ${skipped.length} skipped`);
    console.log(`plan: ${PLAN}`);
    console.log(`fingerprint: ${fingerprint}`);
    console.log("\nNothing written to the database. Re-run with --apply to approve.");
    return;
  }

  const rationale = argValue("--rationale");
  if (!rationale || rationale.trim().length < 6) {
    console.error('--rationale "what she said" is required, and "ok" is not a rationale.');
    process.exit(1);
  }
  const planned = fingerprintInPlan();
  if (planned !== fingerprint) {
    console.error(
      `the plan on disk is ${planned ?? "missing"} but the live data hashes to ` +
        `${fingerprint}. Re-run without --apply, read what changed, then apply.`
    );
    process.exit(1);
  }
  const clashes = duplicateKeys(ready);
  if (clashes.length > 0) {
    for (const c of clashes) {
      console.error(`Two drafts share the formula key "${c.key}": ${c.names.join(", ")}.`);
    }
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

  // Read back through the same list Brix reads. A version that exists and does
  // not come back here is a formula nobody can scale.
  const live = (await beverage.listApprovedFormulas(identity)) as Array<{
    name: string; components: unknown[];
  }>;
  const byName = new Map(live.map(f => [f.name, f.components?.length ?? 0]));
  const unscalable = ready.filter(d => !byName.get(d.name));
  console.log(`read back: ${ready.length - unscalable.length} of ${ready.length} are scalable`);
  for (const d of unscalable) console.error(`  NOT SCALABLE ${d.name}`);
  if (unscalable.length > 0 || failures.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
