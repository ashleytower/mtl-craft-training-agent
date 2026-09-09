/**
 * Live QA against the running beverage API — the surface Brix itself calls.
 *
 * Run:
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/brix-live-qa.ts
 *
 * Not a unit test. Unit tests prove the code is internally consistent; this
 * proves the deployed process, the applied migrations and the real corpus agree
 * with each other. Both are needed and neither substitutes for the other.
 *
 * Every assertion names a specific expected value — a source key, an exact
 * quantity, a status code. A check that passes because a list came back empty
 * would prove nothing, so "empty" is only ever accepted where emptiness is the
 * honest answer, and there it is asserted as EXACTLY zero.
 */
import "dotenv/config";

const BASE = process.env.BEVERAGE_API_URL ?? "http://127.0.0.1:3000";
const TOKEN = process.env.HERMES_SERVICE_TOKEN ?? "";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "x-hermes-service-token": TOKEN,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body: body as Record<string, unknown> };
}

type KnowledgeResponse = {
  count: number;
  search_mode: string;
  boundary: string;
  results: Array<{
    citation: string;
    quotable: boolean;
    citation_required: boolean;
    source_key: string;
    text: string;
    authority_tier: string;
    operational_status: string;
    locator: Record<string, unknown> | null;
  }>;
};

/**
 * What each corpus group must actually return. `expect` describes the honest
 * shape for that group, so a course topic answering with only citations, or a
 * third-party topic answering with quotable text, both fail.
 */
const RETRIEVAL_CASES: Array<{
  query: string;
  group: string;
  minResults: number;
  requireQuotable: boolean;
  forbidQuotable: boolean;
  expectSourcePrefix?: string;
  expectSourceKey?: string;
  expectZero?: boolean;
}> = [
  {
    query: "Kevin Kos super juice",
    group: "Kevin Kos",
    minResults: 1,
    requireQuotable: false,
    // Every Kevin Kos row is a governed summary. If one ever comes back
    // quotable, somebody has copied his page into the corpus.
    forbidQuotable: true,
    expectSourcePrefix: "PUB-KK-",
  },
  {
    query: "clear ice directional freezing",
    group: "clear ice",
    minResults: 1,
    requireQuotable: false,
    forbidQuotable: true,
  },
  {
    query: "acids and acidity citric tartaric",
    group: "Art of Drink course — acids",
    minResults: 1,
    requireQuotable: true,
    forbidQuotable: false,
    expectSourceKey: "aod-fbd-lesson-4801",
  },
  {
    query: "extraction extracts solvent",
    group: "Art of Drink course — extraction",
    minResults: 1,
    requireQuotable: true,
    forbidQuotable: false,
  },
  {
    query: "emulsions emulsifier stability",
    group: "Art of Drink course — emulsions",
    minResults: 1,
    requireQuotable: true,
    forbidQuotable: false,
    expectSourceKey: "aod-fbd-lesson-4746",
  },
  {
    query: "preservation shelf stable water activity",
    group: "preservation",
    minResults: 1,
    requireQuotable: false,
    forbidQuotable: false,
  },
  {
    query: "how to develop a beverage flavour course",
    group: "Art of Drink course",
    minResults: 1,
    requireQuotable: true,
    forbidQuotable: false,
  },
  {
    // The honest gap. Asserted as EXACTLY zero rather than "few", because the
    // whole point is that nothing has been collected and nothing invented.
    query: "Art of Drink Patreon exclusive post",
    group: "Art of Drink Patreon",
    minResults: 0,
    requireQuotable: false,
    forbidQuotable: true,
    expectZero: true,
  },
];

async function retrievalChecks() {
  console.log("\nretrieval — one corpus group at a time");
  for (const testCase of RETRIEVAL_CASES) {
    const { status, body } = await api(
      `/api/hermes/knowledge?q=${encodeURIComponent(testCase.query)}&limit=6`
    );
    if (status !== 200) {
      check(`${testCase.group}: responds`, false, `HTTP ${status}`);
      continue;
    }
    const found = body as unknown as KnowledgeResponse;

    if (testCase.expectZero) {
      // Not "the query returns nothing" — a full-text search for words like
      // "Art", "Drink" and "post" will always match course material, and
      // asserting an empty response would just be asserting that the search is
      // bad at its job. The real claim is narrower and stronger: NO result is
      // attributed to a Patreon source, because no Patreon source exists.
      const patreon = found.results.filter(
        r =>
          r.source_key.startsWith("AOD-PATREON-") ||
          /patreon/i.test(r.citation) ||
          /patreon/i.test(String((r.locator ?? {}).source_url ?? ""))
      );
      check(
        `${testCase.group}: no result is attributed to a Patreon source`,
        patreon.length === 0,
        patreon.map(r => r.source_key).join(",")
      );
      check(
        `${testCase.group}: whatever does match is still cited and unapproved`,
        found.results.every(
          r =>
            r.citation.trim().length > 0 &&
            ["pending_review", "reference_only", "inspiration_only"].includes(
              r.operational_status
            )
        )
      );
      continue;
    }

    check(
      `${testCase.group}: returns at least ${testCase.minResults}`,
      found.count >= testCase.minResults,
      `count=${found.count}`
    );

    check(
      `${testCase.group}: every result carries a citation`,
      found.results.length > 0 && found.results.every(r => r.citation.trim().length > 0),
      found.results.filter(r => !r.citation.trim()).map(r => r.source_key).join(",")
    );

    check(
      `${testCase.group}: nothing is approved`,
      found.results.every(r =>
        ["pending_review", "reference_only", "inspiration_only"].includes(r.operational_status)
      ),
      found.results.map(r => `${r.source_key}=${r.operational_status}`).join(",")
    );

    if (testCase.requireQuotable) {
      check(
        `${testCase.group}: holds quotable course text`,
        found.results.some(r => r.quotable && r.text.trim().length > 0)
      );
    }
    if (testCase.expectSourcePrefix) {
      // A hybrid search ranks the whole corpus, so a query about Kevin Kos also
      // legitimately matches course lessons on the same words ("juice",
      // "super"). Requiring every result to be his would be asserting that
      // retrieval is worse than it is. What must hold is that his material is
      // FOUND, and that HIS rows are never quotable — course rows alongside them
      // being quotable is correct.
      const fromGroup = found.results.filter(r =>
        r.source_key.startsWith(testCase.expectSourcePrefix!)
      );
      check(
        `${testCase.group}: its own sources are found (${testCase.expectSourcePrefix}*)`,
        fromGroup.length > 0,
        found.results.map(r => r.source_key).join(",")
      );
      check(
        `${testCase.group}: none of its own rows is quotable`,
        fromGroup.every(r => !r.quotable),
        fromGroup.filter(r => r.quotable).map(r => r.source_key).join(",")
      );
      check(
        `${testCase.group}: its citations name the publisher and a url`,
        fromGroup.every(r => r.citation.includes("http")),
        fromGroup.map(r => r.citation).join(" | ")
      );
    } else if (testCase.forbidQuotable) {
      // No prefix to scope by, so the claim applies to any third-party
      // (tier_c/tier_d) row in the response.
      const thirdParty = found.results.filter(r => /tier_[cd]_/.test(r.authority_tier));
      check(
        `${testCase.group}: exposes no quotable third-party text`,
        thirdParty.every(r => !r.quotable),
        thirdParty.filter(r => r.quotable).map(r => r.source_key).join(",")
      );
    }
    if (testCase.expectSourceKey) {
      check(
        `${testCase.group}: includes ${testCase.expectSourceKey}`,
        found.results.some(r => r.source_key === testCase.expectSourceKey),
        found.results.map(r => r.source_key).join(",")
      );
    }

    check(
      `${testCase.group}: states the formula boundary`,
      typeof found.boundary === "string" &&
        /never|remain the sole authority/i.test(found.boundary)
    );
  }
}

async function citationStabilityChecks() {
  console.log("\ncitations — stable and never fabricated");
  const first = (await api("/api/hermes/knowledge?q=emulsions&limit=6"))
    .body as unknown as KnowledgeResponse;
  const second = (await api("/api/hermes/knowledge?q=emulsions&limit=6"))
    .body as unknown as KnowledgeResponse;

  check(
    "the same query returns the same citations",
    JSON.stringify(first.results.map(r => [r.source_key, r.citation])) ===
      JSON.stringify(second.results.map(r => [r.source_key, r.citation])),
    "citations changed between two identical calls"
  );

  const pageResults = first.results.filter(
    r => r.locator && r.locator.retrieval_type === "page_text_only"
  );
  check(
    "no page passage is given a clock it does not have",
    pageResults.every(r => !/\bat \d+:\d+/.test(r.citation) && !("timestamp" in (r.locator ?? {}))),
    pageResults.map(r => r.citation).join(" | ")
  );

  const timed = first.results.filter(
    r => r.locator && r.locator.retrieval_type !== "page_text_only" && r.quotable
  );
  check(
    "every time-coded passage cites a real clock",
    timed.every(r => /\bat \d+:\d+/.test(r.citation)),
    timed.map(r => r.citation).join(" | ")
  );

  // Local transcripts must never read as the publisher's own caption track.
  const all = (await api("/api/hermes/knowledge?q=terpenes+limonene&limit=6"))
    .body as unknown as KnowledgeResponse;
  const localOnes = all.results.filter(
    r => r.locator && typeof r.locator.caption_origin === "string" &&
      (r.locator.caption_origin as string).startsWith("local_whisper")
  );
  check(
    "local transcripts are disclosed in the citation",
    localOnes.length === 0 ||
      localOnes.every(r => r.citation.includes("local transcript, unreviewed machine output")),
    localOnes.map(r => r.citation).join(" | ")
  );
  if (localOnes.length > 0) {
    console.log(`        (${localOnes.length} local-transcript passage(s) checked)`);
  }
}

async function formulaBoundaryChecks() {
  console.log("\nformula boundary — knowledge explains, it never measures");

  const formulas = await api("/api/hermes/formulas");
  const approved = (formulas.body.formulas ?? []) as Array<Record<string, unknown>>;
  check("lists the approved formulas", formulas.status === 200 && approved.length === 1,
    `count=${approved.length}`);
  check(
    "the one approved formula is Jalapeno v1",
    approved[0]?.name === "Jalapeno" && approved[0]?.version === 1,
    JSON.stringify(approved.map(f => [f.name, f.version]))
  );

  // Drafts must be nameable and never measurable.
  const drafts = await api("/api/hermes/drafts?q=orgeat");
  const draftsJson = JSON.stringify(drafts.body);
  check("drafts route answers", drafts.status === 200);
  check(
    "drafts expose no quantity, unit or component",
    !/"quantity"|"unit"|"components"|"quantity_normalized"/.test(draftsJson),
    draftsJson.slice(0, 200)
  );
  check(
    "drafts still name the draft, so it can be discussed",
    /orgeat/i.test(draftsJson),
    draftsJson.slice(0, 200)
  );

  // Exact rational scaling. Jalapeno v1: 30 gr citric acid, 5400 gr jalapenos,
  // 30 gr preservative, 18000 ml water. Doubling must be exact, not rounded.
  const scaled = await api("/api/hermes/scale", {
    method: "POST",
    body: JSON.stringify({
      formula: "Jalapeno",
      request: { mode: "multiplier", multiplier: 2 },
    }),
  });
  const components = (scaled.body.components ?? []) as Array<Record<string, unknown>>;
  const byName = new Map(components.map(c => [String(c.ingredientName ?? c.ingredient_name), c]));
  const expected: Array<[string, string, string]> = [
    ["Citric acid", "60", "gr"],
    ["Jalapenos", "10800", "gr"],
    ["Preservative", "60", "gr"],
    ["Water", "36000", "ml"],
  ];
  check("scale route answers", scaled.status === 200, `HTTP ${scaled.status}`);
  for (const [name, quantity, unit] of expected) {
    const component = byName.get(name);
    const got = String(component?.scaledQuantity ?? component?.quantity ?? "");
    check(
      `Jalapeno x2 — ${name} is exactly ${quantity} ${unit}`,
      got === quantity && String(component?.unit) === unit,
      `got ${got} ${component?.unit}`
    );
  }

  // Refusing is the correct answer for anything unapproved.
  const unapproved = await api("/api/hermes/scale", {
    method: "POST",
    body: JSON.stringify({
      formula: "Orgeat",
      request: { mode: "multiplier", multiplier: 2 },
    }),
  });
  check(
    "refuses to scale an unapproved formula",
    unapproved.status === 404,
    `HTTP ${unapproved.status}`
  );
  check(
    "and says which formulas it can actually scale",
    Array.isArray(unapproved.body.approved_names) &&
      (unapproved.body.approved_names as string[]).includes("Jalapeno"),
    JSON.stringify(unapproved.body.approved_names)
  );

  // Try to approve something through the agent surface, then prove nothing was
  // approved.
  //
  // The status code is NOT the evidence here and asserting on it was wrong: in
  // production the SPA catch-all serves index.html for any unmatched path, so a
  // POST to a route that does not exist returns 200 with HTML. A test reading
  // that as "approval succeeded" is wrong, and one reading a 404 as the
  // guarantee is testing the router's fallback rather than the boundary.
  //
  // The real property is that the approved set is unchanged, whatever any
  // endpoint answered.
  const approvedBefore = JSON.stringify(
    approved.map(f => [f.id, f.name, f.version]).sort()
  );
  for (const path of [
    "/api/hermes/approve",
    "/api/hermes/formulas/approve",
    "/api/hermes/knowledge/approve",
  ]) {
    const attempt = await api(path, {
      method: "POST",
      body: JSON.stringify({ id: approved[0]?.id, rationale: "live QA attempt" }),
    });
    const returnedJson = typeof attempt.body === "object" && attempt.body !== null;
    check(
      `${path} does not answer as a working approval endpoint`,
      !(returnedJson && ("approved" in attempt.body || attempt.body.ok === true)),
      `HTTP ${attempt.status} ${JSON.stringify(attempt.body).slice(0, 120)}`
    );
  }

  const afterAttempts = await api("/api/hermes/formulas");
  const approvedAfter = JSON.stringify(
    ((afterAttempts.body.formulas ?? []) as Array<Record<string, unknown>>)
      .map(f => [f.id, f.name, f.version])
      .sort()
  );
  check(
    "the approved set is byte-identical after every approval attempt",
    approvedBefore === approvedAfter,
    `before=${approvedBefore} after=${approvedAfter}`
  );

  // And the three drafts awaiting a human decision are still awaiting it.
  const stillPending = await api("/api/hermes/drafts?q=orgeat");
  check(
    "an unapproved draft is still unapproved and still unmeasurable",
    stillPending.status === 200 &&
      !/"quantity"|"components"/.test(JSON.stringify(stillPending.body))
  );
}

async function coverageChecks() {
  console.log("\ncoverage — reports the corpus honestly");
  const { status, body } = await api("/api/hermes/knowledge/coverage");
  check("coverage route answers", status === 200, `HTTP ${status}`);

  const sources = (body.sources ?? []) as Array<Record<string, unknown>>;
  const chunks = (body.chunks ?? {}) as Record<string, number>;
  const course = (body.course ?? {}) as Record<string, number>;

  const withPassages = sources.filter(s => s.holding === "passages").length;
  const citationOnly = sources.filter(s => s.holding === "citation_only").length;

  check("reports every source", sources.length === 71, `got ${sources.length}`);
  check(
    "separates held passages from citation-only sources",
    withPassages === 35 && citationOnly === 36,
    `passages=${withPassages} citation_only=${citationOnly}`
  );
  check("passage total is 513", chunks.total === 513, `got ${chunks.total}`);
  check("nothing is unembedded", chunks.embedded === chunks.total,
    `${chunks.embedded}/${chunks.total}`);
  check("no orphaned passages", chunks.orphaned === 0, `got ${chunks.orphaned}`);
  check(
    "the per-source sum reconciles with the corpus total",
    sources.reduce((n, s) => n + Number(s.chunks), 0) === chunks.total
  );
  check(
    "every passage is citable",
    sources.reduce((n, s) => n + Number(s.citable), 0) === chunks.total,
    `citable=${sources.reduce((n, s) => n + Number(s.citable), 0)} of ${chunks.total}`
  );
  check(
    "course content coverage is 35 of 39 with 4 register-only and 0 uncollected",
    course.items_with_content === 35 &&
      course.items_total === 39 &&
      course.items_register_only === 4 &&
      course.items_not_collected === 0,
    JSON.stringify(course.items_with_content) +
      "/" + course.items_total + " reg=" + course.items_register_only +
      " uncollected=" + course.items_not_collected
  );
  check(
    "no source is approved",
    sources.every(s =>
      ["pending_review", "reference_only", "inspiration_only"].includes(String(s.operational_status))
    )
  );
  check(
    "every source requires a citation",
    sources.every(s => s.citation_required === true)
  );
  check(
    "local transcripts are counted separately from publisher captions",
    chunks.local_transcript === 50,
    `got ${chunks.local_transcript}`
  );

  // No source appears twice. The database enforces this with
  // `knowledge_sources_organization_id_source_key_key` and
  // `knowledge_chunks_source_id_chunk_key_key`, so a duplicate here would mean
  // either the constraint was dropped or coverage is double-counting a join —
  // the second is a real risk, since `source_rows` joins `source_counts`.
  const keys = sources.map(s => String(s.source_key));
  check(
    "no source is reported twice",
    new Set(keys).size === keys.length,
    keys.filter((k, i) => keys.indexOf(k) !== i).join(",")
  );
}

async function healthChecks() {
  console.log("\nhealth and loaded revision");
  const response = await fetch(`${BASE}/api/hermes/health`);
  const body = (await response.json()) as Record<string, unknown>;
  check("health answers without a token", response.status === 200);
  check("status is ok", body.status === "ok");
  check("the Hermes boundary is enabled", body.hermes_service === "enabled");
  check(
    "the loaded revision is a build stamp, not a guess",
    body.revision_source === "build_stamp" && /^[0-9a-f]{40}$/.test(String(body.revision)),
    `revision=${body.revision} source=${body.revision_source}`
  );
  console.log(`        loaded revision: ${body.revision}`);
}

async function main() {
  if (!TOKEN) {
    console.error("HERMES_SERVICE_TOKEN is required (loaded from .env).");
    process.exit(2);
  }
  console.log(`Brix live QA against ${BASE}`);

  await healthChecks();
  await retrievalChecks();
  await citationStabilityChecks();
  await formulaBoundaryChecks();
  await coverageChecks();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("\nfailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
