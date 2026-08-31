import { describe, expect, it } from "vitest";
import { COURSE_ASSETS, courseAssetSources } from "./knowledgeCourseAssets";

describe("COURSE_ASSETS registry", () => {
  it("covers every row of downloadable_assets.tsv", () => {
    // 6 assets across lessons 6, 7, 16, 23 and 27 (27 has two).
    expect(COURSE_ASSETS).toHaveLength(6);
    expect(COURSE_ASSETS.filter(a => a.lesson_id === "4761")).toHaveLength(2);
  });

  it("gives every asset a unique, stable key", () => {
    const keys = COURSE_ASSETS.map(a => a.source_key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^AOD-ASSET-\d+-\d+$/);
  });

  it("marks a document as grounded only when it was actually read", () => {
    const usda = COURSE_ASSETS.find(a => a.source_key === "AOD-ASSET-4736-1")!;
    // 26 scanned pages, no text layer — nothing was read.
    expect(usda.summary_grounded).toBe(false);
    expect(usda.governed_summary).toMatch(/NOT been read/);

    const supplier = COURSE_ASSETS.find(a => a.source_key === "AOD-ASSET-5841-1")!;
    // HTTP 403 behind Cloudflare — never collected.
    expect(supplier.retrievable).toBe(false);
    expect(supplier.summary_grounded).toBe(false);
    expect(supplier.governed_summary).toMatch(/NOT been collected/);
  });

  it("carries a real title and author for every document it did read", () => {
    for (const a of COURSE_ASSETS.filter(x => x.summary_grounded)) {
      expect(a.title).toBeTruthy();
      expect(a.creator).toBeTruthy();
    }
  });
});

describe("courseAssetSources", () => {
  const rows = courseAssetSources();

  it("produces exactly one citation row per asset", () => {
    expect(rows).toHaveLength(COURSE_ASSETS.length);
  });

  // The "no chunks" guarantee is STRUCTURAL, not assertable here: this function
  // returns SourcePayload, which has no chunk field, and scripts/ingest-knowledge.ts
  // puts `assets` only into `allSources` — never into `chunksBySource`. Asserting
  // `not.toHaveProperty("chunks")` on the return value would pass for any input
  // and catch nothing. What IS worth pinning is that every row declares a
  // rights posture that forbids holding the text.
  it("declares a summary-only or private rights posture on every row", () => {
    for (const r of rows) {
      expect(["public_summary_only", "authorized_private"]).toContain(r.rights_status);
    }
  });

  it("files outside publications as tier C, summary-only", () => {
    const fema = rows.find(r => r.source_key === "AOD-ASSET-4761-2")!;
    expect(fema.authority_tier).toBe("tier_c_external_practitioner");
    expect(fema.rights_status).toBe("public_summary_only");
  });

  it("files course-hosted material as tier B, authorized private", () => {
    const supplier = rows.find(r => r.source_key === "AOD-ASSET-5841-1")!;
    expect(supplier.authority_tier).toBe("tier_b_authorized_course");
    expect(supplier.rights_status).toBe("authorized_private");
  });

  it("never lands anything as an approved control", () => {
    for (const r of rows) {
      expect(r.operational_status).toBe("reference_only");
      expect(r.citation_required).toBe(true);
    }
  });

  it("records the linking lesson so the citation is traceable", () => {
    const emulsions = rows.find(r => r.source_key === "AOD-ASSET-4746-1")!;
    expect(emulsions.source_metadata).toMatchObject({
      linked_from_lesson_id: "4746",
      linked_from_lesson_number: "16",
      linked_from_lesson_title: "Emulsions",
    });
  });

  it("propagates the grounded flag so an unread document cannot pose as read", () => {
    const usda = rows.find(r => r.source_key === "AOD-ASSET-4736-1")!;
    expect(usda.source_metadata.summary_grounded_in_document).toBe(false);
    const emulsions = rows.find(r => r.source_key === "AOD-ASSET-4746-1")!;
    expect(emulsions.source_metadata.summary_grounded_in_document).toBe(true);
  });

  it("falls back to a non-committal title when the document had none", () => {
    const usda = rows.find(r => r.source_key === "AOD-ASSET-4736-1")!;
    expect(usda.title).toBe("Untitled document linked from lesson 7");
  });
});
