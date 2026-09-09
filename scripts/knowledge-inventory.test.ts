import { describe, expect, it } from "vitest";
import {
  DECLARED_GAPS,
  collectionState,
  contentForm,
  groupOf,
  renderInventory,
} from "./knowledge-inventory";
import type { KnowledgeCoverage } from "../server/beverageClient";

type Source = KnowledgeCoverage["sources"][number];

function source(over: Partial<Source> = {}): Source {
  return {
    source_key: "PUB-XX-001",
    title: "A source",
    authority_tier: "tier_c_external_practitioner",
    operational_status: "reference_only",
    summary_embedded: true,
    chunks: 0,
    embedded: 0,
    citable: 0,
    creator: null,
    publisher: null,
    source_url: "https://example.invalid/a",
    rights_status: "public_summary_only",
    citation_required: true,
    has_governed_summary: true,
    holding: "citation_only",
    ...over,
  };
}

describe("groupOf", () => {
  it("files course lessons and the course root together", () => {
    expect(groupOf({ source_key: "aod-fbd-course", publisher: null })).toBe("Art of Drink — course");
    expect(groupOf({ source_key: "aod-fbd-lesson-4801", publisher: null })).toBe(
      "Art of Drink — course"
    );
  });

  it("separates linked documents from the course itself", () => {
    expect(groupOf({ source_key: "AOD-ASSET-4746-1", publisher: "Perfumer & Flavorist" })).toBe(
      "Art of Drink — linked documents"
    );
  });

  it("files Kevin Kos by publisher, whatever the key", () => {
    expect(groupOf({ source_key: "PUB-KK-013", publisher: "Kevin Kos / Cocktail Time" })).toBe(
      "Kevin Kos"
    );
    // Publisher decides, so a future Kevin Kos item under a different key
    // still lands in his section rather than in "Other references".
    expect(groupOf({ source_key: "PUB-ZZ-999", publisher: "Kevin Kos" })).toBe("Kevin Kos");
  });

  it("recognises Patreon by key prefix or publisher", () => {
    expect(groupOf({ source_key: "AOD-PATREON-001", publisher: null })).toBe(
      "Art of Drink — Patreon"
    );
    expect(groupOf({ source_key: "PUB-QQ-1", publisher: "Art of Drink Patreon" })).toBe(
      "Art of Drink — Patreon"
    );
  });

  // Patreon must win over the AOD blog prefix: a Patreon post is paid material
  // under different rights, and filing it as a public blog page would misstate
  // what we are allowed to do with it.
  it("prefers Patreon over the public-blog prefix when the publisher says Patreon", () => {
    expect(groupOf({ source_key: "PUB-AOD-009", publisher: "Art of Drink Patreon" })).toBe(
      "Art of Drink — Patreon"
    );
  });

  it("files the FDA and the internal registers", () => {
    expect(
      groupOf({ source_key: "PUB-FS-001", publisher: "U.S. Food and Drug Administration" })
    ).toBe("FDA");
    expect(groupOf({ source_key: "notion-syrups-hq-master", publisher: null })).toBe(
      "Internal registers"
    );
  });

  it("falls back to Other references rather than guessing", () => {
    expect(groupOf({ source_key: "PUB-JM-002", publisher: "Jeffrey Morgenthaler" })).toBe(
      "Other references"
    );
  });
});

describe("collectionState", () => {
  it("names how a collected lesson was collected", () => {
    const held = source({ chunks: 9, citable: 9, holding: "passages" });
    expect(collectionState(held, "captions")).toBe("collected — time-coded");
    expect(collectionState(held, "page_text")).toBe("collected — page text");
    expect(collectionState(held, "mixed")).toBe("collected — time-coded + page text");
  });

  // The distinction the whole inventory exists to make.
  it("calls a cite-only source held, not missing", () => {
    expect(collectionState(source({ holding: "citation_only" }), null)).toBe(
      "citation only — summary, no text held"
    );
  });

  it("calls a quiz register-only rather than a gap", () => {
    expect(collectionState(source({ holding: "registered" }), "register_only")).toContain(
      "register only"
    );
  });

  it("reports a source with neither text nor summary as an open registration", () => {
    expect(collectionState(source({ holding: "registered", has_governed_summary: false }), null)).toBe(
      "registered — no summary yet"
    );
  });
});

describe("contentForm", () => {
  const lesson = (over: Record<string, unknown> = {}) =>
    ({
      content_kind: "captions",
      time_coded_chunks: 10,
      local_transcript_chunks: 0,
      ...over,
    }) as Parameters<typeof contentForm>[1];

  it("distinguishes the publisher's captions from this machine's transcript", () => {
    const held = source({ source_key: "aod-fbd-lesson-4851", chunks: 43, holding: "passages" });
    expect(contentForm(held, lesson())).toBe("publisher captions");
    expect(
      contentForm(held, lesson({ content_kind: "mixed", local_transcript_chunks: 10 }))
    ).toBe("local transcript (unreviewed) + page text");
  });

  // The provenance now comes from the lesson's own counts, so a lesson
  // transcribed tomorrow is labelled correctly with no code change. A hand-kept
  // list of lesson ids used to decide this and would have called an eighth
  // transcribed lesson "publisher captions" — the one error this must not make.
  it("labels a newly transcribed lesson without any list being updated", () => {
    const brandNew = source({ source_key: "aod-fbd-lesson-9999", chunks: 4, holding: "passages" });
    expect(
      contentForm(brandNew, lesson({ time_coded_chunks: 4, local_transcript_chunks: 4 }))
    ).toBe("local transcript (unreviewed)");
  });

  it("does not collapse a lesson holding both kinds of clock into one label", () => {
    const held = source({ source_key: "aod-fbd-lesson-4851", chunks: 10, holding: "passages" });
    expect(
      contentForm(held, lesson({ time_coded_chunks: 10, local_transcript_chunks: 4 }))
    ).toBe("publisher captions + local transcript (unreviewed)");
  });

  it("marks a linked document as an attachment summary", () => {
    expect(contentForm(source({ source_key: "AOD-ASSET-4736-1" }), null)).toBe(
      "attachment — governed summary"
    );
  });

  it("never claims a cite-only source holds text", () => {
    for (const kind of [null, "captions", "mixed", "page_text"]) {
      expect(
        contentForm(source({ holding: "citation_only" }), kind ? lesson({ content_kind: kind }) : null)
      ).toBe("governed summary");
    }
  });
});

describe("renderInventory", () => {
  const coverage: KnowledgeCoverage = {
    sources: [
      source({
        source_key: "aod-fbd-lesson-4801",
        title: "Acids & Acidity",
        creator: "Darcy O'Neil",
        publisher: "Art of Drink Education",
        authority_tier: "tier_b_authorized_course",
        rights_status: "authorized_private",
        operational_status: "pending_review",
        chunks: 18,
        embedded: 18,
        citable: 18,
        holding: "passages",
      }),
      source({
        source_key: "PUB-KK-013",
        title: "Making Clear Ice With Any Sized Freezer!",
        publisher: "Kevin Kos / Cocktail Time",
      }),
    ],
    course: {
      items_total: 39,
      items_with_content: 35,
      items_with_captions: 30,
      items_page_text_only: 5,
      items_with_page_text: 24,
      items_mixed: 19,
      items_register_only: 4,
      items_not_collected: 0,
      lessons: [
        {
          lesson_number: "32",
          lesson_id: "4801",
          lesson_title: "Acids & Acidity",
          lesson_type: "video",
          duration_or_marker: "15 minutes",
          chunks: 18,
          time_coded_chunks: 12,
          local_transcript_chunks: 0,
          page_chunks: 6,
          content_kind: "mixed",
          ingested: true,
        },
      ],
    },
    chunks: {
      total: 513,
      embedded: 513,
      caption: 386,
      page_text: 127,
      local_transcript: 50,
    },
  } as unknown as KnowledgeCoverage;

  const rendered = renderInventory(coverage);

  it("states the citation-only split in the totals", () => {
    expect(rendered).toContain("| — holding passages we may quote | 1 |");
    expect(rendered).toContain("| — citation only (summary, no text held) | 1 |");
  });

  it("says plainly that nothing is approved", () => {
    expect(rendered).toContain("**No source is approved.**");
  });

  // The inventory must never read as though a rights posture were a backlog.
  it("explains that citation-only is correct rather than a gap", () => {
    expect(rendered).toContain("held correctly**, not missing");
  });

  it("puts Kevin Kos in his own section and shows no quotable passages", () => {
    expect(rendered).toContain("## Kevin Kos");
    const kkLine = rendered.split("\n").find(l => l.includes("Making Clear Ice"));
    expect(kkLine).toBeDefined();
    expect(kkLine).toContain("citation only — summary, no text held");
    expect(kkLine).toContain("governed summary");
  });

  it("registers the Patreon gap honestly instead of implying coverage", () => {
    expect(rendered).toContain("## Declared gaps");
    expect(rendered).toContain("Art of Drink Patreon — nothing collected");
    // No Patreon section, because there is no Patreon material. The gap is
    // stated once, in the place gaps belong.
    expect(rendered).not.toContain("## Art of Drink — Patreon");
  });

  it("carries every declared gap into the document", () => {
    for (const gap of DECLARED_GAPS) expect(rendered).toContain(gap.what);
  });

  it("shows citable as a ratio so a shortfall would be visible", () => {
    expect(rendered).toContain("| — citable (a reference a reader can check) | 18 of 18 |");
    expect(rendered).toContain("18/18");
  });

  // The fixture deliberately disagrees with itself: its two sources hold 18
  // passages while its corpus total says 513. Real coverage reconciles, so this
  // is the only way to prove the reconciliation line is reachable — a check
  // that could never fire would not be a check.
  it("flags a per-source sum that disagrees with the corpus total", () => {
    expect(rendered).toContain("**passages do not reconcile**");
    expect(rendered).toContain("per-source sum 18 vs corpus total 513");
  });

  it("stays silent about reconciliation when the two counts agree", () => {
    const agreeing = {
      ...coverage,
      chunks: { ...coverage.chunks, total: 18 },
    } as unknown as KnowledgeCoverage;
    expect(renderInventory(agreeing)).not.toContain("do not reconcile");
  });

  it("is deterministic — the same coverage renders identically", () => {
    expect(renderInventory(coverage)).toBe(rendered);
  });
});
