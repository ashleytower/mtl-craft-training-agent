/**
 * The shared migration number line.
 *
 * `mtl-craft-training-agent` (this repo, `db/migrations/`) and
 * `mtl-craft-cocktails-ai` (the CRM, `supabase_migrations/`) write into ONE
 * Supabase project. The number in a migration filename is how a human refers to
 * it — "126 revoked the anon grant" — and nothing has ever enforced that the two
 * repos do not reach for the same one.
 *
 * They already have, eleven times. 111 through 118 doubled up in late August, and
 * 124, 125 and 126 doubled up again on 2026-09-11. Nothing ever failed, because
 * `supabase_migrations.schema_migrations` keys on a timestamp and carries the
 * file number only inside `name`. The cost is not an error, it is that "115"
 * names a staff-assignment command in one repo and a coverage function in the
 * other, against one database.
 *
 * None of the eleven can be renumbered: both sides are applied and recorded, and
 * renaming a file after the fact would make the repo lie about what ran. So they
 * are declared below as accepted history, and this refuses any collision that is
 * NOT one of them. A gate that fails on what already happened would just be
 * switched off, which is how this went unnoticed for three weeks.
 *
 * Usage:
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/check-migration-numbers.ts
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/check-migration-numbers.ts --next
 *
 * Reads the CRM from its ORIGIN ref over the GitHub API, never from a local
 * clone: a stale checkout is exactly how you convince yourself a number is free.
 */
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CRM_REPO = "ashleytower/mtl-craft-cocktails-ai";
const CRM_DIR = "supabase_migrations";
const CRM_REF = "main";

/**
 * Collisions that predate this check: a number claimed by a different migration
 * in each repo, with both already applied to the live database.
 *
 * Never add to this list to make the check pass. Add to it only to record
 * something that has already shipped on both sides and therefore cannot be
 * undone — and say what the two migrations are, so the entry is a record rather
 * than a silenced alarm.
 *
 *   111  beverage_knowledge_retrieval        / amendment_admits_empty_client_note
 *   112  knowledge_source_embeddings         / ab_guest_count_amendment
 *   113  backfill_source_embeddings          / atomic_portal_checkout_command
 *   114  search_excludes_bookkeeping_sources / atomic_invoice_command
 *   115  coverage_content_vs_manifest        / staff_assignment_and_browser_outbound_commands
 *   116  coverage_reconciles_with_chunk_totals / portal_checkout_readiness_probe
 *   117  coverage_single_statement           / portal_checkout_unique_violation_backstop
 *   118  coverage_counts_mixed_lessons       / browser_outbound_typed_duplicate_refusal
 *   124  coverage_source_provenance          / atomic_menu_event_revision_binding
 *   125  ingest_formula_drafts               / commercial_amendment_event_date_type
 *   126  revoke_anon_formula_version_grant   / commercial_amendment_event_date_text
 *   127  approval_supersedes_prior_version   / proposal_identity_and_acceptance_authority
 *   128  component_role_garnish              / legacy_unaccepted_ab_option_semantics
 *   129  retire_formula_draft                / portal_checkout_accepted_option_payment_authority
 *
 * (beverage / CRM)
 *
 * 127, 128 and 129 were added on 2026-09-14, three days after the first eleven,
 * which is the part worth noticing: this is not a historical mess that was
 * cleaned up, it is an ongoing one. Both repos are active and neither asks the
 * other what number it just took.
 *
 * Applied-ness, checked rather than assumed. Beverage 127 and 128 are live in pg
 * (`approve_formula_version` supersedes; the role check accepts `garnish`) though
 * absent from the ledger, and 129 is recorded. CRM 127 and 129 are recorded.
 * CRM 128 is a one-time DO block that repairs quote rows and creates no database
 * object, so there is no schema trace to check it by — but it sits on origin/main
 * between two applied migrations, and the number is claimed by a file in each
 * repo either way. That last part is what this list records: not whether both
 * ran, but that neither filename can now be renumbered without misrepresenting
 * what shipped.
 *
 * Also worth knowing: the CRM has started disambiguating on its side, and its
 * 129 is recorded as `..._crm129`. That is a workaround for this collision, not
 * a fix for it.
 */
export const ACCEPTED_COLLISIONS: readonly number[] = [
  111, 112, 113, 114, 115, 116, 117, 118, 124, 125, 126, 127, 128, 129,
];

export function migrationNumber(filename: string): number | null {
  const m = /^(\d{3,})_/.exec(filename);
  return m ? Number(m[1]) : null;
}

export function numbersIn(filenames: readonly string[]): number[] {
  const out = new Set<number>();
  for (const f of filenames) {
    if (!f.endsWith(".sql")) continue;
    const n = migrationNumber(f);
    if (n !== null) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Numbers claimed on both sides that nobody has accepted. */
export function unacceptedCollisions(
  ours: readonly number[],
  theirs: readonly number[],
  accepted: readonly number[] = ACCEPTED_COLLISIONS
): number[] {
  const other = new Set(theirs);
  const ok = new Set(accepted);
  return ours.filter(n => other.has(n) && !ok.has(n)).sort((a, b) => a - b);
}

/**
 * The next number free on BOTH sides.
 *
 * One above the highest number either repo has used, not one above the highest
 * gap: reusing a gap is how two repos race into the same number the moment they
 * are both active in the same week.
 */
export function nextFreeNumber(ours: readonly number[], theirs: readonly number[]): number {
  return Math.max(0, ...ours, ...theirs) + 1;
}

function ourNumbers(): number[] {
  return numbersIn(readdirSync(resolve(process.cwd(), "db/migrations")));
}

function crmNumbers(): number[] {
  // `gh` is authenticated as ashleytower and the CRM is private, so this is the
  // one call that sees the real origin state without a local clone.
  const raw = execFileSync(
    "gh",
    ["api", `repos/${CRM_REPO}/contents/${CRM_DIR}?ref=${CRM_REF}`, "--jq", ".[].name"],
    { encoding: "utf8" }
  );
  return numbersIn(raw.split("\n").map(s => s.trim()).filter(Boolean));
}

function main() {
  const ours = ourNumbers();
  let theirs: number[];
  try {
    theirs = crmNumbers();
  } catch (error) {
    // Refuse rather than pass. "I could not check" is not "it is fine" — that
    // substitution is what let three collisions through in the first place.
    console.error(
      `could not read ${CRM_REPO}/${CRM_DIR} at ${CRM_REF}: ` +
        (error instanceof Error ? error.message : String(error))
    );
    process.exitCode = 1;
    return;
  }

  const next = nextFreeNumber(ours, theirs);
  if (process.argv.includes("--next")) {
    console.log(next);
    return;
  }

  console.log(`beverage db/migrations:      ${ours.length} files, highest ${Math.max(...ours)}`);
  console.log(`CRM ${CRM_DIR} (${CRM_REF}): ${theirs.length} files, highest ${Math.max(...theirs)}`);
  console.log(`accepted collisions:         ${ACCEPTED_COLLISIONS.join(", ")}`);

  const bad = unacceptedCollisions(ours, theirs);
  if (bad.length > 0) {
    console.error(
      `\nCOLLISION: ${bad.join(", ")} ${bad.length === 1 ? "is" : "are"} claimed by a migration ` +
        `in both repos.\nOne database, one number line. Renumber the unapplied side to ${next} ` +
        `or higher, or\nif both are already applied, add the number to ACCEPTED_COLLISIONS with ` +
        `a note saying why.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nNo unaccepted collision. The next free number on both sides is ${next}.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  main();
}
