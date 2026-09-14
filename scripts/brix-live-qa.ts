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
  minResults?: number;
  requireQuotable?: boolean;
  forbidQuotable?: boolean;
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
    // No minResults/requireQuotable here: `expectZero` returns before either is
    // read, and leaving them set implied a threshold that was never applied.
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

    const minResults = testCase.minResults ?? 1;
    check(
      `${testCase.group}: returns at least ${minResults}`,
      found.count >= minResults,
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
  // The count was pinned to 1, from when Jalapeno was the only approved formula.
  // That is the same mistake the comment below warns about one line further on:
  // a pinned number turns every legitimate approval into a red check, and teaches
  // whoever hits it to bump the number rather than read it. Ashley approved 92
  // more on 2026-09-14 and this went red for doing exactly what she asked.
  //
  // What must be true regardless of how many she approves: the route answers,
  // there is at least one, and every one of them carries components — an approved
  // formula with no lines is one nobody can scale, which is the failure this
  // corpus has already had.
  const componentless = approved.filter(
    f => !Array.isArray(f.components) || (f.components as unknown[]).length === 0
  );
  check(
    "lists the approved formulas, and every one of them has components",
    formulas.status === 200 && approved.length > 0 && componentless.length === 0,
    `count=${approved.length}, componentless=${JSON.stringify(componentless.map(f => f.name))}`
  );
  // Pinning the version number meant every legitimate approval broke this check
  // and taught whoever hit it to bump the number. What actually matters is that
  // one name resolves to exactly one approved recipe, and that the recipe is
  // whole — v1 was approved with four components and no sugar for eleven days.
  const approvedByName = new Map<string, number>();
  for (const f of approved) {
    approvedByName.set(String(f.name), (approvedByName.get(String(f.name)) ?? 0) + 1);
  }
  const ambiguous = [...approvedByName.entries()].filter(([, n]) => n > 1);
  check(
    "no name resolves to two approved formulas, so scaling never has to guess",
    ambiguous.length === 0,
    JSON.stringify(ambiguous)
  );

  const jalapeno = approved.find(f => f.name === "Jalapeno");
  const jalapenoLines = (jalapeno?.components ?? []) as Array<{ ingredient_name: string }>;
  const jalapenoNames = jalapenoLines.map(c => c.ingredient_name.toLowerCase());
  check(
    "the approved Jalapeno is the whole recipe, sugar included",
    ["sugar", "jalapenos", "water", "preservative", "citric acid"].every(n =>
      jalapenoNames.some(actual => actual === n)
    ),
    JSON.stringify(jalapenoNames)
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
  // This used to name "Orgeat" as the example of something unapproved. Ashley
  // approved Orgeat on 2026-09-14 along with 48 other syrups, so the check went
  // red while the behaviour it guards was perfectly intact — the fixture had
  // simply stopped being an example of its own case.
  //
  // A sentinel cannot stop being unapproved. The property is about the refusal,
  // not about which recipe happens to be waiting today.
  const unapproved = await api("/api/hermes/scale", {
    method: "POST",
    body: JSON.stringify({
      formula: "zzz-no-such-formula-zzz",
      request: { mode: "multiplier", multiplier: 2 },
    }),
  });
  check(
    "refuses to scale a formula that is not approved",
    unapproved.status === 404,
    `HTTP ${unapproved.status}`
  );
  check(
    "and says which formulas it can actually scale",
    Array.isArray(unapproved.body.approved_names) &&
      (unapproved.body.approved_names as string[]).includes("Jalapeno"),
    JSON.stringify(unapproved.body.approved_names).slice(0, 120)
  );

  // A retired draft is the case that actually bites: Brix knew this name
  // yesterday, and must not scale it today. Retiring is a state, not a delete,
  // so nothing stops the row being found — only the approval does.
  const retired = await api("/api/hermes/scale", {
    method: "POST",
    body: JSON.stringify({
      formula: "Comosus",
      request: { mode: "multiplier", multiplier: 2 },
    }),
  });
  check(
    "refuses to scale a retired draft it used to list",
    retired.status === 404,
    `HTTP ${retired.status}`
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
  console.log("\ncoverage — invariants, not a census");
  const { status, body } = await api("/api/hermes/knowledge/coverage");
  check("coverage route answers", status === 200, `HTTP ${status}`);

  const sources = (body.sources ?? []) as Array<Record<string, unknown>>;
  const chunks = (body.chunks ?? {}) as Record<string, number>;
  const course = (body.course ?? {}) as Record<string, number>;

  // Deliberately NOT asserting 71 sources / 513 passages / 35+36 / 50 local.
  // Those were a snapshot of one day's data. Pinning them here would mean the
  // next legitimate ingest — the Art of Drink Patreon material, once Ashley
  // signs in — fails QA for growing the corpus, which is the opposite of a
  // gate. The exact census belongs in the generated inventory, where
  // `knowledge-inventory --check` already fails on any drift and prints a diff.
  // What must hold at ANY corpus size is below.
  const summed = sources.reduce((n, s) => n + Number(s.chunks), 0);
  const citable = sources.reduce((n, s) => n + Number(s.citable), 0);
  const withPassages = sources.filter(s => s.holding === "passages").length;
  const citationOnly = sources.filter(s => s.holding === "citation_only").length;
  const keys = sources.map(s => String(s.source_key));

  check("the corpus is not empty", chunks.total > 0 && sources.length > 0,
    `${sources.length} sources, ${chunks.total} passages`);
  check("nothing is unembedded", chunks.embedded === chunks.total,
    `${chunks.embedded}/${chunks.total}`);
  check("no orphaned passages", chunks.orphaned === 0, `got ${chunks.orphaned}`);
  check("no course item is uncollected", course.items_not_collected === 0,
    `got ${course.items_not_collected}`);
  check("the per-source sum reconciles with the corpus total", summed === chunks.total,
    `${summed} vs ${chunks.total}`);
  check("every passage can produce a citation", citable === chunks.total,
    `citable ${citable} of ${chunks.total}`);
  check("no source is reported twice", new Set(keys).size === keys.length,
    keys.filter((k, i) => keys.indexOf(k) !== i).join(","));
  check(
    "no source is approved",
    sources.every(s =>
      ["pending_review", "reference_only", "inspiration_only"].includes(String(s.operational_status))
    ),
    sources.filter(s => String(s.operational_status) === "approved").map(s => s.source_key).join(",")
  );
  check("every source requires a citation", sources.every(s => s.citation_required === true));

  // The rights split must EXIST, at whatever size. Both halves being non-empty
  // is the invariant; their exact sizes are not.
  check("the corpus holds quotable material", withPassages > 0, `${withPassages}`);
  check(
    "and holds citation-only sources, the rights posture being intact",
    citationOnly > 0,
    `${citationOnly}`
  );
  check(
    "every citation-only source can still say something",
    sources
      .filter(s => s.holding === "citation_only")
      .every(s => s.has_governed_summary === true && Number(s.chunks) === 0)
  );
  console.log(
    `        census (reported, not asserted): ${sources.length} sources ` +
      `(${withPassages} with passages, ${citationOnly} citation-only), ` +
      `${chunks.total} passages, ${chunks.local_transcript} local-transcript, ` +
      `course content ${course.items_with_content}/${course.items_total}`
  );
}

/**
 * Records which build was tested. It does NOT gate on the revision:
 * `scripts/brix-status.sh --expect-revision <sha>` owns that check and is
 * stricter, because it also requires the revision to come from a build stamp
 * rather than a guess. Two scripts asserting the same thing to different
 * standards is how the weaker one ends up being the one people run.
 */
async function recordBuildUnderTest() {
  const response = await fetch(`${BASE}/api/hermes/health`);
  const body = (await response.json()) as Record<string, unknown>;
  check("the API answers and its agent boundary is on", body.hermes_service === "enabled",
    `hermes_service=${body.hermes_service}`);
  console.log(
    `        build under test: ${body.revision} (source: ${body.revision_source})`
  );
}

async function main() {
  if (!TOKEN) {
    console.error("HERMES_SERVICE_TOKEN is required (loaded from .env).");
    process.exit(2);
  }
  console.log(`Brix live QA against ${BASE}`);

  await recordBuildUnderTest();
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
