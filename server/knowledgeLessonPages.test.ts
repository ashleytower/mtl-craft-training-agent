import { describe, expect, it } from "vitest";
import {
  appendPageChunks,
  extractLessonPage,
  pageChunkPayloads,
  pageLessonSource,
  withPageTextNoted,
} from "./knowledgeLessonPages";
import type { ChunkPayload, LessonManifestRow, SourcePayload } from "./knowledgeCorpus";

const LESSON: LessonManifestRow = {
  lesson_number: "13",
  lesson_id: "6066",
  lesson_title: "Solvents for Flavours",
  lesson_type: "video",
  duration_or_marker: "10 minutes",
  url: "https://edu.artofdrink.com/x/6066",
};

/** The real page shape: a stylesheet link that mentions the same class name
 *  BEFORE the actual video div, then body blocks, then the nav buttons. */
function page(inner: string): string {
  return [
    '<link rel="stylesheet" id="masterstudy-course-player-lesson-video-css" href="/x.css">',
    '<div class="masterstudy-course-player-lesson-video">',
    '<iframe src="https://iframe.mediadelivery.net/embed/1/2"></iframe></div>',
    inner,
    '<div class="masterstudy-nav-button"><span>Next</span></div>',
    "<p>footer noise that must not be ingested</p>",
  ].join("\n");
}

describe("extractLessonPage", () => {
  it("anchors on the video div, not the stylesheet link that shares its name", () => {
    const result = extractLessonPage(page("<p>Real body text.</p>"), "6066");
    expect(result.blocks).toEqual([{ kind: "text", text: "Real body text." }]);
  });

  it("stops at the nav buttons so page furniture is not ingested", () => {
    const result = extractLessonPage(page("<p>Body.</p>"), "6066");
    expect(result.blocks.map(b => b.text)).not.toContain(
      "footer noise that must not be ingested"
    );
  });

  it("keeps headings and paragraphs in document order", () => {
    const html = page("<p>Intro.</p><h3>Alcohol</h3><p>Ethanol works.</p><li>A list item.</li>");
    expect(extractLessonPage(html, "6066").blocks).toEqual([
      { kind: "text", text: "Intro." },
      { kind: "heading", text: "Alcohol" },
      { kind: "text", text: "Ethanol works." },
      { kind: "text", text: "A list item." },
    ]);
  });

  it("decodes entities, and decodes the ampersand last", () => {
    const html = page("<p>Sugar &amp;#8217;s role &#8212; salt &amp; acid &#8220;here&#8221;</p>");
    const [block] = extractLessonPage(html, "6066").blocks;
    // &amp;#8217; must survive as the literal text "&#8217;", not become "’"
    expect(block.text).toContain("&#8217;s role");
    expect(block.text).toContain("— salt & acid");
    expect(block.text).toContain('"here"');
  });

  it("returns no blocks when the page is not a lesson, rather than throwing", () => {
    expect(extractLessonPage("<html><body>login</body></html>", "6066").blocks).toEqual([]);
  });

  // A `<(p|li|h)>(.*?)</\1>` match closes on the FIRST </li>, which is the
  // inner one — so "Sub 1" was welded onto the outer item and the text after
  // the nested list vanished from the corpus without a trace.
  it("flattens a nested list and keeps the text trailing it", () => {
    const html = page(
      "<li>Item A<ul><li>Sub 1</li><li>Sub 2</li></ul>trailing text</li>"
    );
    expect(extractLessonPage(html, "6066").blocks.map(b => b.text)).toEqual([
      "Item A",
      "Sub 1",
      "Sub 2",
      "trailing text",
    ]);
  });

  it("does not leak the unterminated tag the body is sliced inside", () => {
    // The body ends at the nav-button marker, which is mid-tag: `<div class="`.
    for (const block of extractLessonPage(page("<p>Body.</p>"), "6066").blocks) {
      expect(block.text).not.toMatch(/<|div class/);
    }
  });

  // CO<sub>2</sub> became "CO 2 :" — a corrupted chemical formula in text the
  // system treats as verbatim. Inline tags sit inside a word; they must vanish.
  it("does not insert a space where an inline tag sat inside a word", () => {
    const html = page("<p>CO<sub>2</sub>: Carbon dioxide and H<sub>2</sub>O</p>");
    expect(extractLessonPage(html, "6066").blocks[0].text).toBe(
      "CO2: Carbon dioxide and H2O"
    );
  });

  it("does not pad a list wrapped in anchors", () => {
    const html = page("<p><a>New Directions</a> (<a>AU</a>, <a>CA</a>, <a>US</a>) - oils</p>");
    expect(extractLessonPage(html, "6066").blocks[0].text).toBe(
      "New Directions (AU, CA, US) - oils"
    );
  });

  it("still treats <br> as a separator, because it separates lines", () => {
    const html = page("<p>Polysorbate 20 HLB: 16.7<br>Polysorbate 60 HLB: 14.9</p>");
    expect(extractLessonPage(html, "6066").blocks[0].text).toBe(
      "Polysorbate 20 HLB: 16.7 Polysorbate 60 HLB: 14.9"
    );
  });

  it("keeps an opening single quote opening", () => {
    const html = page("<p>&#8216;proof of concept&#8217; and it&#8217;s fine</p>");
    expect(extractLessonPage(html, "6066").blocks[0].text).toBe(
      "‘proof of concept’ and it’s fine"
    );
  });

  it("drops empty and whitespace-only blocks", () => {
    const html = page("<p></p><p>   </p><p>Kept.</p>");
    expect(extractLessonPage(html, "6066").blocks).toHaveLength(1);
  });
});

describe("pageChunkPayloads", () => {
  const course = "Flavour & Beverage Development Course";

  it("never invents a timestamp", () => {
    const html = page("<p>Body text about solvents.</p>");
    const [chunk] = pageChunkPayloads(extractLessonPage(html, "6066"), LESSON, course);
    expect(chunk.locator).not.toHaveProperty("timestamp");
    expect(chunk.locator).not.toHaveProperty("start_seconds");
    expect(chunk.locator).not.toHaveProperty("end_seconds");
    expect(chunk.locator.retrieval_type).toBe("page_text_only");
  });

  it("cites by section and paragraph range instead", () => {
    const html = page("<h3>Alcohol</h3><p>One.</p><p>Two.</p>");
    const [chunk] = pageChunkPayloads(extractLessonPage(html, "6066"), LESSON, course);
    expect(chunk.locator).toMatchObject({
      section: "Alcohol",
      paragraph_start: 1,
      paragraph_end: 2,
      page_reference: '"Alcohol", paragraphs 1-2',
    });
  });

  it("says 'paragraph' not 'paragraphs' for a single one", () => {
    const html = page("<h3>Water</h3><p>Only one.</p>");
    const [chunk] = pageChunkPayloads(extractLessonPage(html, "6066"), LESSON, course);
    expect(chunk.locator.page_reference).toBe('"Water", paragraph 1');
  });

  it("never lets a chunk straddle a section heading", () => {
    const html = page("<h3>Alcohol</h3><p>A.</p><h3>Water</h3><p>B.</p>");
    const chunks = pageChunkPayloads(extractLessonPage(html, "6066"), LESSON, course);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].locator.section).toBe("Alcohol");
    expect(chunks[1].locator.section).toBe("Water");
    expect(chunks[0].body).toBe("A.");
    expect(chunks[1].body).toBe("B.");
  });

  it("numbers paragraphs across the whole page, not per section", () => {
    const html = page("<h3>A</h3><p>one</p><h3>B</h3><p>two</p><h3>C</h3><p>three</p>");
    const chunks = pageChunkPayloads(extractLessonPage(html, "6066"), LESSON, course);
    expect(chunks.map(c => c.locator.paragraph_start)).toEqual([1, 2, 3]);
  });

  it("carries a null section for text before any heading", () => {
    const html = page("<p>Preamble.</p><h3>Alcohol</h3><p>After.</p>");
    const chunks = pageChunkPayloads(extractLessonPage(html, "6066"), LESSON, course);
    expect(chunks[0].locator.section).toBeNull();
    expect(chunks[0].locator.page_reference).toBe("paragraph 1");
  });

  it("splits long sections into chunks and numbers ordinals from 1", () => {
    const long = "x".repeat(950);
    const html = page(`<h3>Long</h3><p>${long}</p><p>${long}</p>`);
    const chunks = pageChunkPayloads(extractLessonPage(html, "6066"), LESSON, course);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map(c => c.ordinal)).toEqual(chunks.map((_, i) => i + 1));
  });

  it("uses a chunk key that cannot collide with a caption chunk", () => {
    const html = page("<p>Body.</p>");
    const [chunk] = pageChunkPayloads(extractLessonPage(html, "6066"), LESSON, course);
    // caption chunks are aod-fbd-<id>-001; page chunks are aod-fbd-<id>-p001
    expect(chunk.chunk_key).toBe("aod-fbd-6066-p001");
  });

  it("produces nothing for a page with no body", () => {
    expect(pageChunkPayloads({ lessonId: "6066", blocks: [] }, LESSON, course)).toEqual([]);
  });

  it("leaves the embedding null for the ingest to fill", () => {
    const html = page("<p>Body.</p>");
    const [chunk] = pageChunkPayloads(extractLessonPage(html, "6066"), LESSON, course);
    expect(chunk.embedding).toBeNull();
  });
});

describe("pageLessonSource", () => {
  const course = "Flavour & Beverage Development Course";
  const built = pageLessonSource({ lessonId: "6066", blocks: [] }, LESSON, course, 7);

  it("matches the tier and rights of a captioned lesson — same course, same enrolment", () => {
    expect(built.authority_tier).toBe("tier_b_authorized_course");
    expect(built.rights_status).toBe("authorized_private");
    expect(built.operational_status).toBe("pending_review");
    expect(built.source_key).toBe("aod-fbd-lesson-6066");
  });

  it("says in words that it is page text and not a transcript", () => {
    expect(built.governed_summary).toMatch(/no caption track/);
    expect(built.governed_summary).toMatch(/not a transcript/);
    expect(built.source_metadata.retrieval_type).toBe("page_text_only");
  });

  it("does not claim a caption origin", () => {
    expect(built.source_metadata).not.toHaveProperty("caption_origin");
  });
});

describe("withPageTextNoted", () => {
  const timeCoded: SourcePayload = {
    source_key: "aod-fbd-lesson-6066",
    title: "Solvents for Flavours — Flavour & Beverage Development",
    publisher: "Art of Drink Education",
    creator: "Darcy O'Neil",
    source_url: "https://edu.artofdrink.com/x/6066",
    authority_tier: "tier_b_authorized_course",
    rights_status: "authorized_private",
    operational_status: "pending_review",
    citation_required: true,
    governed_summary: "Lesson 13 of the course. 7 time-coded passages covering 10:21 of 10 minutes.",
    source_metadata: { lesson_id: "6066", caption_origin: "local_whisper_small_en" },
  };

  it("declares the page passages the row also answers from", () => {
    const merged = withPageTextNoted(timeCoded, 7);
    expect(merged.governed_summary).toMatch(/Also holds 7 passages of the lesson's written page/);
    expect(merged.governed_summary).toMatch(/section and paragraph rather than by timestamp/);
    expect(merged.source_metadata.page_text_chunks).toBe(7);
    expect(merged.source_metadata.retrieval_types).toEqual(["time_coded", "page_text_only"]);
  });

  it("says passage, not passages, for one", () => {
    expect(withPageTextNoted(timeCoded, 1).governed_summary).toMatch(/Also holds 1 passage of/);
  });

  it("leaves a row with no page text exactly as it was", () => {
    expect(withPageTextNoted(timeCoded, 0)).toBe(timeCoded);
  });

  it("keeps the provenance the time-coded row already carried", () => {
    // The merged row must not lose caption_origin: it is the only thing
    // distinguishing a machine transcript from the publisher's own captions.
    const merged = withPageTextNoted(timeCoded, 7);
    expect(merged.source_metadata.caption_origin).toBe("local_whisper_small_en");
    expect(merged.operational_status).toBe("pending_review");
    expect(merged.rights_status).toBe("authorized_private");
  });
});

describe("appendPageChunks", () => {
  const timeCoded: ChunkPayload[] = [1, 2, 3].map(n => ({
    chunk_key: `aod-fbd-6066-t00${n}`,
    ordinal: n,
    body: `transcript ${n}`,
    locator: { lesson_id: "6066", timestamp: "0:00-1:00" },
    embedding: null,
  }));
  const pageText: ChunkPayload[] = [1, 2].map(n => ({
    chunk_key: `aod-fbd-6066-p00${n}`,
    ordinal: n,
    body: `page ${n}`,
    locator: { lesson_id: "6066", retrieval_type: "page_text_only" },
    embedding: null,
  }));

  it("keeps the page passages instead of dropping them for the transcript", () => {
    // This is the regression the whole merge exists for: the ingest previously
    // skipped a lesson's page the moment it had time-coded text.
    const merged = appendPageChunks(timeCoded, pageText);
    expect(merged).toHaveLength(5);
    expect(merged.map(c => c.chunk_key)).toContain("aod-fbd-6066-p001");
    expect(merged.map(c => c.chunk_key)).toContain("aod-fbd-6066-p002");
  });

  it("renumbers page ordinals to follow the time-coded ones", () => {
    const merged = appendPageChunks(timeCoded, pageText);
    expect(merged.map(c => c.ordinal)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never rewrites a chunk key", () => {
    // Keys are the upsert's identity. Renumbering them would orphan every page
    // row already in the database under a key nothing writes again.
    const merged = appendPageChunks(timeCoded, pageText);
    expect(merged.slice(3).map(c => c.chunk_key)).toEqual([
      "aod-fbd-6066-p001",
      "aod-fbd-6066-p002",
    ]);
  });

  it("leaves the page locator's absent timestamp absent", () => {
    // A page passage has no clock. Merging it beside timestamped passages must
    // not tempt anything into giving it one.
    const merged = appendPageChunks(timeCoded, pageText);
    expect(merged[3].locator).not.toHaveProperty("timestamp");
    expect(merged[3].locator.retrieval_type).toBe("page_text_only");
  });

  it("numbers from 1 when the lesson has only page text", () => {
    expect(appendPageChunks([], pageText).map(c => c.ordinal)).toEqual([1, 2]);
  });

  it("returns the time-coded chunks untouched when there is no page text", () => {
    expect(appendPageChunks(timeCoded, [])).toEqual(timeCoded);
  });
});
