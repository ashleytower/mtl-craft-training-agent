import { describe, expect, it } from "vitest";
import { citationFor } from "./hermesRoutes";
import type { KnowledgeResult } from "./beverageClient";

function result(overrides: Partial<KnowledgeResult> = {}): KnowledgeResult {
  return {
    kind: "chunk",
    ref: "aod-fbd-4726-001",
    source_key: "aod-fbd-lesson-4726",
    source_title: "Safety — Flavour & Beverage Development",
    publisher: "Art of Drink Education",
    authority_tier: "tier_b_authorized_course",
    operational_status: "pending_review",
    citation_required: true,
    body: "some passage",
    locator: {},
    review_status: "pending_review",
    text_rank: 0.5,
    vector_similarity: 0.8,
    score: 0.7,
    ...overrides,
  };
}

const LESSON = {
  course_title: "Flavour & Beverage Development Course",
  lesson_number: "5",
  lesson_title: "Safety",
  source_url: "https://edu.artofdrink.com/x/4726",
};

describe("citationFor", () => {
  it("cites a publisher caption with its timestamp and nothing extra", () => {
    const cite = citationFor(
      result({
        locator: { ...LESSON, timestamp: "0:00-1:03", caption_origin: "native_en_auto_vtt" },
      })
    );
    expect(cite).toBe(
      'Flavour & Beverage Development Course, lesson 5 "Safety" at 0:00-1:03 ' +
        "— https://edu.artofdrink.com/x/4726"
    );
    expect(cite).not.toMatch(/transcript/);
  });

  it("marks a local transcript as unreviewed machine output", () => {
    // THE POINT. Both this and the case above have a clock. Only one is the
    // publisher's own words, and a reader seeing a quote must be able to tell
    // which — the source row's summary is written once per lesson and is not
    // in front of them here.
    const cite = citationFor(
      result({
        ref: "aod-fbd-4776-t001",
        locator: { ...LESSON, timestamp: "0:08-0:10", caption_origin: "local_whisper_small_en" },
      })
    );
    expect(cite).toMatch(/\(local transcript, unreviewed machine output\)/);
    expect(cite).toMatch(/at 0:08-0:10/);
  });

  it("does not confuse a caption and a transcript that are otherwise identical", () => {
    const locator = { ...LESSON, timestamp: "1:00-2:00" };
    const caption = citationFor(result({ locator: { ...locator, caption_origin: "native_en_auto_vtt" } }));
    const transcript = citationFor(result({ locator: { ...locator, caption_origin: "local_whisper_small_en" } }));
    expect(caption).not.toBe(transcript);
  });

  it("cites a page passage by section and paragraph, never a clock", () => {
    const cite = citationFor(
      result({
        ref: "aod-fbd-4726-p001",
        locator: {
          ...LESSON,
          retrieval_type: "page_text_only",
          page_reference: '"Safe Handling", paragraphs 1-2',
        },
      })
    );
    expect(cite).toMatch(/\(lesson page, "Safe Handling", paragraphs 1-2\)/);
    expect(cite).not.toMatch(/\bat \d/);
  });

  it("says so when a page passage has no paragraph recorded", () => {
    const cite = citationFor(
      result({ locator: { ...LESSON, retrieval_type: "page_text_only" } })
    );
    expect(cite).toMatch(/no paragraph recorded/);
  });

  it("survives a locator missing everything", () => {
    // Locators are JSON; a field can be absent or the wrong type.
    expect(() => citationFor(result({ locator: {} }))).not.toThrow();
    expect(() => citationFor(result({ locator: { caption_origin: 42 } }))).not.toThrow();
    expect(citationFor(result({ locator: { caption_origin: 42 } }))).not.toMatch(/transcript/);
  });

  it("cites a source-level hit by publisher and title", () => {
    const cite = citationFor(
      result({
        kind: "source",
        source_title: "How to make clear ice",
        publisher: "Kevin Kos",
        locator: { source_url: "https://example.com/ice" },
      })
    );
    expect(cite).toBe('Kevin Kos, "How to make clear ice" — https://example.com/ice');
  });
});
