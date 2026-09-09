/**
 * Generate the source inventory from the database, never by hand.
 *
 * Run:
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/knowledge-inventory.ts
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/knowledge-inventory.ts --check
 *
 * `--check` regenerates and exits non-zero if `docs/BRIX_SOURCE_INVENTORY.md`
 * has drifted from what the data now says. That is the whole point of a
 * generated inventory: a hand-maintained one goes stale the first time anybody
 * ingests anything, and a stale inventory is worse than none because it is
 * still read as current.
 *
 * It reads the SAME `beverage_knowledge_coverage` RPC that Brix's own
 * `coverage` tool reads, so the document and the agent can never disagree.
 * Nothing here queries a table directly and nothing here writes.
 */
// Loaded here rather than left to the caller's shell: this script is run by a
// person and by CI, and a missing SUPABASE_URL should not look like an empty
// corpus. `scripts/ingest-knowledge.ts` predates this and expects the shell to
// export them; both work, and loading is the safer default for a reporting tool.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as beverage from "../server/beverageClient";
import type { KnowledgeCoverage } from "../server/beverageClient";
import type { OperatorIdentity } from "../server/_core/supabaseAuth";

const OUTPUT = resolve(process.cwd(), "docs/BRIX_SOURCE_INVENTORY.md");

/**
 * The groups Ashley asked the inventory to separate. Derived from the row —
 * `source_key` prefix first, then publisher — never from a hand-kept list of
 * source keys, which would silently mis-file anything ingested later.
 */
type Group =
  | "Art of Drink — course"
  | "Art of Drink — linked documents"
  | "Art of Drink — Patreon"
  | "Art of Drink — public blog"
  | "Kevin Kos"
  | "FDA"
  | "Other references"
  | "Internal registers";

type Source = KnowledgeCoverage["sources"][number];

export function groupOf(source: Pick<Source, "source_key" | "publisher">): Group {
  const key = source.source_key;
  const publisher = (source.publisher ?? "").toLowerCase();

  if (key === "aod-fbd-course" || key.startsWith("aod-fbd-lesson-")) {
    return "Art of Drink — course";
  }
  if (key.startsWith("AOD-PATREON-") || publisher.includes("patreon")) {
    return "Art of Drink — Patreon";
  }
  if (key.startsWith("AOD-ASSET-")) return "Art of Drink — linked documents";
  if (key.startsWith("PUB-AOD-")) return "Art of Drink — public blog";
  if (publisher.includes("kevin kos")) return "Kevin Kos";
  if (publisher.includes("food and drug administration")) return "FDA";
  if (key.startsWith("notion-")) return "Internal registers";
  return "Other references";
}

const GROUP_ORDER: Group[] = [
  "Art of Drink — course",
  "Art of Drink — Patreon",
  "Art of Drink — linked documents",
  "Art of Drink — public blog",
  "Kevin Kos",
  "FDA",
  "Other references",
  "Internal registers",
];

/**
 * What we hold, in the vocabulary the brief asked for. Derived from `holding`
 * plus, for a course lesson, the `content_kind` the coverage RPC already
 * computes — so a lesson's row says whether its words are the publisher's
 * captions, this machine's transcript, or its written page.
 */
export function collectionState(source: Source, contentKind: string | null): string {
  if (source.holding === "passages") {
    switch (contentKind) {
      case "captions":
        return "collected — time-coded";
      case "page_text":
        return "collected — page text";
      case "mixed":
        return "collected — time-coded + page text";
      default:
        return "collected";
    }
  }
  if (contentKind === "register_only") return "register only — quiz, no knowledge to hold";
  if (source.holding === "citation_only") return "citation only — summary, no text held";
  return "registered — no summary yet";
}

/** How the material is held, in the brief's vocabulary. */
export function contentForm(
  source: Source,
  contentKind: string | null,
  localTranscriptLessons: Set<string>
): string {
  const lessonId = source.source_key.replace("aod-fbd-lesson-", "");
  if (source.holding === "passages") {
    const parts: string[] = [];
    if (contentKind === "captions" || contentKind === "mixed") {
      parts.push(
        localTranscriptLessons.has(lessonId) ? "local transcript (unreviewed)" : "publisher captions"
      );
    }
    if (contentKind === "page_text" || contentKind === "mixed") parts.push("page text");
    return parts.join(" + ") || "passages";
  }
  if (source.source_key.startsWith("AOD-ASSET-")) return "attachment — governed summary";
  if (source.holding === "citation_only") return "governed summary";
  return "metadata only";
}

function ownerIdentity(): OperatorIdentity {
  const subject = (process.env.BEVERAGE_OWNER_SUBJECTS ?? "").split(",")[0]?.trim();
  if (!subject) {
    throw new Error("BEVERAGE_OWNER_SUBJECTS is required to read coverage");
  }
  return {
    subject,
    email: null,
    displayName: process.env.BEVERAGE_OWNER_DISPLAY_NAME ?? "MTL Craft owner",
    origin: "browser",
  };
}

function escapeCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderInventory(coverage: KnowledgeCoverage): string {
  const lessonByKey = new Map(
    coverage.course.lessons.map(l => [`aod-fbd-lesson-${l.lesson_id}`, l])
  );
  // Which lessons hold text this machine produced rather than the publisher's
  // own captions. The RPC gives the corpus-wide count; the per-lesson answer
  // comes from the lesson having time-coded chunks whose source is a local
  // transcript, which is recorded on the source row's metadata at ingest.
  const localTranscriptLessons = new Set(
    coverage.course.lessons
      .filter(l => l.content_kind === "mixed" || l.content_kind === "captions")
      .filter(l => LOCAL_TRANSCRIPT_LESSON_IDS.has(l.lesson_id))
      .map(l => l.lesson_id)
  );

  const byGroup = new Map<Group, Source[]>();
  for (const source of coverage.sources) {
    const group = groupOf(source);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(source);
  }

  // Two independent counts of the same thing: the per-source sum and the
  // corpus-wide total. They agree today (513 = 513). They are both printed and
  // reconciled rather than one being quietly preferred, because a disagreement
  // between the two halves of this response is the exact failure migration 116
  // was written to fix, and it would otherwise be invisible here.
  const summedChunks = coverage.sources.reduce((n, s) => n + s.chunks, 0);
  const totalChunks = coverage.chunks.total;
  const totalCitable = coverage.sources.reduce((n, s) => n + s.citable, 0);
  const reconciled = summedChunks === totalChunks;
  const withPassages = coverage.sources.filter(s => s.holding === "passages").length;
  const citationOnly = coverage.sources.filter(s => s.holding === "citation_only").length;
  const registered = coverage.sources.filter(s => s.holding === "registered").length;

  const lines: string[] = [];
  lines.push("# Brix — source inventory");
  lines.push("");
  lines.push(
    "**Generated by `scripts/knowledge-inventory.ts` from the live " +
      "`beverage_knowledge_coverage` RPC. Do not edit by hand** — run the script. " +
      "`--check` fails if this file has drifted from the data."
  );
  lines.push("");
  lines.push(
    "This is the same RPC Brix's own `coverage` tool reads, so this document and " +
      "the agent cannot disagree."
  );
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| sources | **${coverage.sources.length}** |`);
  lines.push(`| — holding passages we may quote | ${withPassages} |`);
  lines.push(`| — citation only (summary, no text held) | ${citationOnly} |`);
  lines.push(`| — registered, no summary yet | ${registered} |`);
  lines.push(`| passages | **${totalChunks}** |`);
  if (!reconciled) {
    lines.push(
      `| **passages do not reconcile** | per-source sum ${summedChunks} vs corpus total ` +
        `${totalChunks} — investigate before trusting anything below |`
    );
  }
  lines.push(
    `| — citable (a reference a reader can check) | ${totalCitable} of ${summedChunks} |`
  );
  lines.push(`| — embedded | ${coverage.chunks.embedded} of ${coverage.chunks.total} |`);
  lines.push(`| — time-coded | ${coverage.chunks.caption} |`);
  lines.push(`| — of those, local transcript (unreviewed) | ${coverage.chunks.local_transcript} |`);
  lines.push(`| — page text | ${coverage.chunks.page_text} |`);
  lines.push(`| course items with content | ${coverage.course.items_with_content} of ${coverage.course.items_total} |`);
  lines.push(`| course items register-only (quizzes) | ${coverage.course.items_register_only} |`);
  lines.push(`| course items not collected | ${coverage.course.items_not_collected} |`);
  lines.push(`| orphaned passages (no manifest row) | ${coverage.chunks.orphaned} |`);
  lines.push("");
  lines.push(
    "**No source is approved.** Every row below is `pending_review`, " +
      "`reference_only` or `inspiration_only`. Retrievability is not approval, and " +
      "promoting a source is a human decision no route in this repository can make."
  );
  lines.push("");
  lines.push("## What `citation only` means");
  lines.push("");
  lines.push(
    "A source with 0 passages and a governed summary is **held correctly**, not " +
      "missing. These are third-party pages and videos we may cite and summarise " +
      "but may not copy. Brix can quote none of them; it returns their summary with " +
      "a citation and `quotable: false`. Treating them as a collection gap would " +
      "invite someone to close it by copying somebody else's page."
  );
  lines.push("");

  for (const group of GROUP_ORDER) {
    const sources = byGroup.get(group);
    if (!sources || sources.length === 0) continue;
    const groupChunks = sources.reduce((n, s) => n + s.chunks, 0);
    lines.push(`## ${group}`);
    lines.push("");
    lines.push(
      `${sources.length} source${sources.length === 1 ? "" : "s"}, ${groupChunks} passage${
        groupChunks === 1 ? "" : "s"
      }.`
    );
    lines.push("");
    lines.push(
      "| source | creator / publisher | rights | state | passages | citable | form | locator |"
    );
    lines.push("|---|---|---|---|---:|---:|---|---|");
    for (const source of sources.sort((a, b) => a.source_key.localeCompare(b.source_key))) {
      const lesson = lessonByKey.get(source.source_key);
      const kind = lesson?.content_kind ?? null;
      const attribution = [source.creator, source.publisher].filter(Boolean).join(" / ");
      lines.push(
        [
          "",
          escapeCell(source.title),
          escapeCell(attribution),
          escapeCell(`${source.authority_tier.replace(/^tier_[a-d]_/, "")} · ${source.rights_status}`),
          escapeCell(collectionState(source, kind)),
          String(source.chunks),
          source.chunks === 0 ? "—" : `${source.citable}/${source.chunks}`,
          escapeCell(contentForm(source, kind, localTranscriptLessons)),
          escapeCell(source.source_url),
          "",
        ].join(" | ").trim()
      );
    }
    lines.push("");
  }

  lines.push("## Declared gaps");
  lines.push("");
  lines.push(
    "Registered honestly rather than papered over. A gap recorded here is not " +
      "coverage; it is the absence of coverage, named."
  );
  lines.push("");
  for (const gap of DECLARED_GAPS) {
    lines.push(`- **${gap.what}** — ${gap.why}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Lessons whose time-coded text this machine produced with Whisper rather than
 * the publisher captioning. Recorded here because the coverage RPC reports the
 * corpus-wide count but not which lessons; the seven are fixed and documented
 * in `docs/BRIX_KNOWLEDGE.md`, and a test pins this set against the database.
 */
export const LOCAL_TRANSCRIPT_LESSON_IDS = new Set([
  "4776",
  "4906",
  "5256",
  "5446",
  "5551",
  "6066",
  "6381",
]);

/** Gaps that are real and are not going to be closed by trying harder. */
export const DECLARED_GAPS = [
  {
    what: "Art of Drink Patreon — nothing collected",
    why:
      "No Patreon source exists in the corpus and a retrieval for it returns zero " +
      "results. The course narration refers to a Patreon, and edu.artofdrink.com " +
      "serves the Patron Plugin Pro / patreon-connect assets, so the material is " +
      "real and Ashley's account is entitled to it. Collecting it needs an " +
      "interactive sign-in that only Ashley can complete; nothing here bypasses it.",
  },
  {
    what: "Supplier.pdf (AOD-ASSET-5841-1) — registered, not ingested",
    why: "The course host returns HTTP 403 to a server-side fetch. Registered so the gap is visible.",
  },
  {
    what: "USDA publication (AOD-ASSET-4736-1) — registered, not summarised",
    why:
      "A 26-page scan with no text layer. Its summary is marked as not grounded in " +
      "the document rather than being written from the title.",
  },
  {
    what: "Seven lesson videos have no publisher caption track",
    why:
      "Their Bunny library (177015) exposes no .vtt of any kind. Their narration is " +
      "held as a local Whisper transcript and every citation from one says so.",
  },
  {
    what: "Third-party practitioner sources hold no quotable text",
    why:
      "Kevin Kos, Morgenthaler, the clear-ice articles, the FDA guidance and the " +
      "linked Perfumer & Flavorist and FEMA documents are cite-only by rights, not " +
      "by omission. This is a deliberate posture, not a backlog.",
  },
];

async function main() {
  const check = process.argv.includes("--check");
  const coverage = await beverage.knowledgeCoverage(ownerIdentity());
  const rendered = renderInventory(coverage);

  if (check) {
    let existing = "";
    try {
      existing = readFileSync(OUTPUT, "utf8");
    } catch {
      console.error(`${OUTPUT} does not exist. Run without --check to generate it.`);
      process.exit(1);
    }
    if (existing !== rendered) {
      console.error(
        "docs/BRIX_SOURCE_INVENTORY.md is out of date with the database.\n" +
          "Run: PATH=/usr/local/bin:$PATH npx tsx scripts/knowledge-inventory.ts"
      );
      process.exit(1);
    }
    console.log("docs/BRIX_SOURCE_INVENTORY.md matches the database.");
    return;
  }

  writeFileSync(OUTPUT, rendered, "utf8");
  console.log(
    `Wrote ${OUTPUT} — ${coverage.sources.length} sources, ` +
      `${coverage.chunks.total} passages.`
  );
}

// Only run when invoked directly, so the pure functions above stay testable.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
