/**
 * Adversarial tests for the one rule that matters most about Brix's knowledge:
 *
 *   Course, Patreon, Kevin Kos and every other source can explain technique.
 *   None of them can supply or change an MTL Craft measurement, approve
 *   anything, touch the CRM, move money, send a message, or release a batch.
 *
 * These are written to FAIL if somebody later wires a writer into the agent
 * surface, not to describe the current design approvingly. Each one names the
 * change that would break it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { citationFor } from "./hermesRoutes";
import type { KnowledgeResult } from "./beverageClient";

const hermesRoutesSource = readFileSync(new URL("./hermesRoutes.ts", import.meta.url), "utf8");
const beverageClientSource = readFileSync(new URL("./beverageClient.ts", import.meta.url), "utf8");

/** Strip comments so prose describing a writer is not mistaken for calling one. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * What `hermesRoutes` is ALLOWED to call on `beverageClient`.
 *
 * A grant constraint, not a deny roster. An earlier version of this test listed
 * the writers to forbid, with a comment claiming the list was "derived from the
 * file" — it was hand-written, so a writer added tomorrow under a new name would
 * have been forbidden by nothing. Anchoring on the shape we accept inverts that:
 * any new `beverage.*` call fails this test until somebody adds it here and
 * argues for it.
 *
 * Every entry was read-only until `recordResearchCandidates`, which is the one
 * deliberate exception and is argued for here rather than quietly added.
 *
 * It writes, and what it writes is a PROPOSAL: the RPC forces
 * `candidate_status: proposed` and `rights_status: public_summary_only` on every
 * row, keeps the run's retention `temporary`, and stores a URL plus at most a
 * 1000-character summary with no source text behind it. None of it is citable by
 * the agent. Turning one into a real source is
 * `beverage_decide_research_candidate`, which requires the owner or approver
 * role — the Hermes subject is an `operator`, so the database refuses the agent
 * its own approval. That refusal is the boundary; this list is the record of
 * having checked it.
 *
 * The risk it does carry: these rows are built from pages Brix has just read, so
 * a page could propose its own summary into Ashley's queue. That is why the
 * queue is bounded, the URL scheme is constrained to http(s), and the summary is
 * never invented when absent — see researchCandidates.ts.
 *
 * Nothing that CREATES, APPROVES, INGESTS or EMBEDS may join this list.
 */
const ALLOWED_BEVERAGE_CALLS = [
  "listApprovedFormulas",
  "listFormulaDrafts",
  "searchKnowledge",
  "knowledgeCoverage",
  "listResearchCandidates",
  "recordResearchCandidates",
];

/** Writers that must never appear. Kept as a second, narrower net. */
const WRITER_EXPORTS = [
  // The agent proposes research; it never dispositions it. This one is listed
  // first because it is the near miss — the sibling of a call that IS allowed.
  "decideResearchCandidate",
  "createFormulaVersion",
  "approveFormulaVersion",
  "ingestKnowledgeSources",
  "ingestKnowledgeChunks",
  "setSourceEmbedding",
  "recordCalculationPlan",
];

const WRITER_RPCS = [
  "beverage_create_formula_version",
  "beverage_approve_formula_version",
  "beverage_ingest_knowledge_sources",
  "beverage_ingest_knowledge_chunks",
  "beverage_set_source_embedding",
  "beverage_record_calculation_plan",
];

describe("the agent surface cannot write", () => {
  it("calls nothing on beverageClient outside the read-only allowlist", () => {
    // The guard that does not go stale: every `beverage.<name>` reference in
    // the agent surface must be one we have explicitly allowed.
    // Matched at the CALL site — `beverage.name(` — not on any reference to the
    // namespace. `beverage.KnowledgeResult` is a type annotation, and a type
    // cannot write to anything; requiring the open paren keeps this guard about
    // behaviour rather than about imports.
    const called = new Set(
      [...code(hermesRoutesSource).matchAll(/\bbeverage\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(
        m => m[1]
      )
    );
    const unexpected = [...called].filter(name => !ALLOWED_BEVERAGE_CALLS.includes(name));
    expect(unexpected).toEqual([]);
    // And the allowlist must not have rotted into naming things that are gone.
    for (const name of ALLOWED_BEVERAGE_CALLS) {
      expect(beverageClientSource).toMatch(new RegExp(`export function ${name}\\b`));
    }
  });

  it("names every writer this test is guarding, and they all still exist", () => {
    // If a writer is renamed or removed, this fails and the list above has to
    // be corrected — otherwise the tests below would silently guard nothing.
    for (const name of WRITER_EXPORTS) {
      expect(beverageClientSource).toMatch(new RegExp(`export function ${name}\\b`));
    }
  });

  it("hermesRoutes imports no writer from beverageClient", () => {
    const body = code(hermesRoutesSource);
    for (const name of WRITER_EXPORTS) {
      expect(body).not.toMatch(new RegExp(`\\bbeverage\\.${name}\\b`));
    }
  });

  it("hermesRoutes calls no write RPC by name", () => {
    const body = code(hermesRoutesSource);
    for (const rpc of WRITER_RPCS) {
      expect(body).not.toContain(rpc);
    }
  });

  it("exposes exactly two mutating HTTP verbs, and neither can approve anything", () => {
    const verbs = [...code(hermesRoutesSource).matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)]
      .map(m => ({ verb: m[1], route: m[2] }));

    // /scale computes and stores nothing. /research queues a proposal the owner
    // must decide on. Any THIRD mutating route has to be argued for here.
    const mutating = verbs.filter(v => v.verb !== "get");
    expect(mutating).toEqual([
      { verb: "post", route: "/api/hermes/research" },
      { verb: "post", route: "/api/hermes/scale" },
    ]);

    // POST here means "compute from a body too big for a query string", not
    // "change something". If /scale ever starts recording, this file is where
    // that decision has to be argued.
    expect(code(hermesRoutesSource)).not.toMatch(/\brecord\s*:\s*true\b/);
  });

  it("has no route that could approve a formula or a source", () => {
    const body = code(hermesRoutesSource);
    // "approved" is the read-only adjective this file is full of and legitimately
    // uses — `listApprovedFormulas`, `ApprovedFormula`, `approved_names`. The
    // VERB is what must never appear. The lookahead is `(?!d)` and not `(?!d\b)`
    // on purpose: `ApprovedFormula` has no word boundary after the "d", so the
    // stricter form flagged the type name and would have had to be weakened or
    // deleted — which is how a real guard turns into a disabled one.
    expect(body).not.toMatch(/\bapprove(?!d)/i);
    // Nor may it assign any of the three human-decision columns.
    expect(body).not.toMatch(/operational_status\s*[:=]\s*["']/);
    expect(body).not.toMatch(/review_status\s*[:=]\s*["']/);
    expect(body).not.toMatch(/rights_status\s*[:=]\s*["']/);
  });

  it("reaches no CRM writer, no payment, no messaging and no batch release", () => {
    const body = code(hermesRoutesSource);
    // The CRM is readable through the resolver; nothing here may write to it,
    // and none of these other systems may be reachable at all.
    for (const forbidden of [
      /\bfrom\("recipes"\)[\s.]*\.(insert|update|upsert|delete)/,
      /\.insert\(/,
      /\.update\(/,
      /\.upsert\(/,
      /\.delete\(/,
      /stripe/i,
      /resend/i,
      /twilio/i,
      /sendEmail/i,
      /production_batches/i,
      /release_batch/i,
    ]) {
      expect(body).not.toMatch(forbidden);
    }
  });
});

describe("knowledge results cannot carry a measurement", () => {
  function result(over: Partial<KnowledgeResult> = {}): KnowledgeResult {
    return {
      kind: "chunk",
      ref: "r1",
      source_key: "aod-fbd-lesson-4801",
      source_title: "Acids & Acidity",
      publisher: "Art of Drink Education",
      authority_tier: "tier_b_authorized_course",
      operational_status: "pending_review",
      citation_required: true,
      body: "Citric acid is roughly twice as sour as tartaric at the same weight.",
      locator: {
        lesson_number: "32",
        lesson_title: "Acids & Acidity",
        course_title: "Flavour & Beverage Development",
        timestamp: "04:12",
        source_url: "https://edu.artofdrink.com/x/4801",
      },
      review_status: "pending_review",
      text_rank: 1,
      vector_similarity: 0.8,
      score: 1.8,
      ...over,
    };
  }

  it("the result type has no quantity, unit, or formula field", () => {
    // Structural: a knowledge result that could carry a measurement is one
    // refactor away from a knowledge result that supplies one.
    const shape = Object.keys(result()).sort();
    expect(shape).toEqual([
      "authority_tier",
      "body",
      "citation_required",
      "kind",
      "locator",
      "operational_status",
      "publisher",
      "ref",
      "review_status",
      "score",
      "source_key",
      "source_title",
      "text_rank",
      "vector_similarity",
    ]);
    for (const forbidden of ["quantity", "unit", "components", "formula_version_id", "yield"]) {
      expect(shape).not.toContain(forbidden);
    }
  });

  it("the route derives quotable from kind, so a source can never be quotable", () => {
    // This used to build `result({kind:"source"})` and assert that its `kind`
    // was not "chunk" — which is asserting the fixture, not the rule. Deleting
    // the real line in hermesRoutes.ts left it passing. It now checks the rule.
    expect(code(hermesRoutesSource)).toMatch(/quotable:\s*result\.kind\s*===\s*"chunk"/);
    // And nothing may hand `quotable` a literal or a different predicate.
    const assignments = [
      ...code(hermesRoutesSource).matchAll(/quotable:\s*([^,\n]+)/g),
    ].map(m => m[1].trim());
    expect(assignments).toEqual(['result.kind === "chunk"']);
  });
});
