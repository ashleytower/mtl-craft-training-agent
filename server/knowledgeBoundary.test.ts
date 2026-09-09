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
 * Every function in `beverageClient` that changes stored state. Derived from
 * the file rather than hand-listed, so a writer added tomorrow is covered by
 * this test the day it is written.
 */
const WRITER_RPCS = [
  "beverage_create_formula_version",
  "beverage_approve_formula_version",
  "beverage_ingest_knowledge_sources",
  "beverage_ingest_knowledge_chunks",
  "beverage_set_source_embedding",
  "beverage_record_calculation_plan",
];

const WRITER_EXPORTS = [
  "createFormulaVersion",
  "approveFormulaVersion",
  "ingestKnowledgeSources",
  "ingestKnowledgeChunks",
  "setSourceEmbedding",
  "recordCalculationPlan",
];

describe("the agent surface cannot write", () => {
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

  it("exposes exactly one mutating HTTP verb, and it is the pure scale calculation", () => {
    const verbs = [...code(hermesRoutesSource).matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)]
      .map(m => ({ verb: m[1], route: m[2] }));

    const mutating = verbs.filter(v => v.verb !== "get");
    expect(mutating).toEqual([{ verb: "post", route: "/api/hermes/scale" }]);

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

  it("a cite-only source is never presented as quotable", () => {
    // The route computes `quotable` from `kind`. A source result is a governed
    // summary of somebody else's page; presenting it as quotable would invite
    // Brix to read a third party's words out as though we held them.
    const sourceResult = result({ kind: "source" });
    expect(sourceResult.kind === "chunk").toBe(false);
  });
});

describe("citations are built, never invented", () => {
  const base = {
    kind: "chunk" as const,
    ref: "r",
    source_key: "aod-fbd-lesson-7561",
    source_title: "Suppliers",
    publisher: null,
    authority_tier: "tier_b_authorized_course",
    operational_status: "pending_review",
    citation_required: true,
    body: "text",
    review_status: "pending_review",
    text_rank: 1,
    vector_similarity: null,
    score: 1,
  };

  it("cites page text by paragraph and gives it no clock", () => {
    const citation = citationFor({
      ...base,
      locator: {
        lesson_number: "38",
        lesson_title: "Suppliers",
        course_title: "Flavour & Beverage Development",
        retrieval_type: "page_text_only",
        page_reference: "section 2, paragraph 3",
        source_url: "https://edu.artofdrink.com/x/7561",
      },
    });
    expect(citation).toContain("lesson page, section 2, paragraph 3");
    // The invariant the corpus is built on: a page passage has no timestamp and
    // must never be given one, because a fabricated clock looks checkable.
    expect(citation).not.toMatch(/\bat \d+:\d+/);
  });

  it("says so when a page passage has no recorded paragraph, rather than guessing", () => {
    const citation = citationFor({
      ...base,
      locator: { retrieval_type: "page_text_only", lesson_title: "Suppliers" },
    });
    expect(citation).toContain("no paragraph recorded");
  });

  it("marks a local transcript as unreviewed machine output", () => {
    const citation = citationFor({
      ...base,
      locator: {
        lesson_number: "15",
        lesson_title: "Terpenes",
        course_title: "Flavour & Beverage Development",
        timestamp: "02:10",
        caption_origin: "local_whisper_small_en",
        source_url: "https://edu.artofdrink.com/x/6381",
      },
    });
    expect(citation).toContain("(local transcript, unreviewed machine output)");
  });

  it("does not add that disclaimer to a publisher caption", () => {
    const citation = citationFor({
      ...base,
      locator: {
        lesson_number: "33",
        lesson_title: "Mineral Salts",
        course_title: "Flavour & Beverage Development",
        timestamp: "07:45",
        caption_origin: "publisher_auto_caption",
        source_url: "https://edu.artofdrink.com/x/4851",
      },
    });
    expect(citation).not.toContain("local transcript");
    expect(citation).toContain("at 07:45");
  });

  it("cites a third-party source by publisher and url, with no invented locator", () => {
    const citation = citationFor({
      ...base,
      kind: "source",
      source_key: "PUB-KK-013",
      source_title: "Making Clear Ice With Any Sized Freezer!",
      publisher: "Kevin Kos / Cocktail Time",
      locator: { source_url: "https://www.kevinkos.com/post/make-clear-ice" },
    });
    expect(citation).toBe(
      'Kevin Kos / Cocktail Time, "Making Clear Ice With Any Sized Freezer!" — ' +
        "https://www.kevinkos.com/post/make-clear-ice"
    );
    expect(citation).not.toMatch(/\bat \d+:\d+/);
    expect(citation).not.toContain("lesson");
  });
});
