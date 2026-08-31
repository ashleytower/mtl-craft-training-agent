import { describe, expect, it } from "vitest";
import {
  COURSE_SOURCE_KEY,
  courseSource,
  externalSources,
  formatClock,
  lessonChunkPayloads,
  lessonSourceKey,
  lessonSources,
  parseJsonl,
  parseLessonManifest,
  type CourseChunkRecord,
  type ExternalSourceRecord,
  type LessonManifestRow,
} from "./knowledgeCorpus";

const PROVENANCE = { recoveredFrom: "https://manus.im/share/x", recoveredAt: "2026-08-31" };

function chunk(overrides: Partial<CourseChunkRecord> = {}): CourseChunkRecord {
  return {
    record_type: "knowledge_chunk",
    source_provider: "Art of Drink Education",
    source_tier: "B",
    course_title: "Flavour & Beverage Development Course",
    lesson_number: "5",
    lesson_id: "4726",
    lesson_title: "Safety",
    source_url: "https://edu.artofdrink.com/x/4726",
    caption_origin: "native_en_auto_vtt",
    review_status: "pending_review",
    start_seconds: 0.169,
    end_seconds: 63.024,
    text: "One of the key goals of this course is to teach you how to use these safely.",
    chunk_id: "aod-fbd-4726-001",
    ...overrides,
  };
}

const MANIFEST_CSV = [
  "lesson_number,lesson_id,lesson_title,lesson_type,duration_or_marker,url",
  "1,6486,Introduction,video,6 minutes,https://edu.artofdrink.com/x/6486",
  "5,4726,Safety,video,7 minutes,https://edu.artofdrink.com/x/4726",
  '9,6241,"Safety Quiz, part one",quiz,10 questions,https://edu.artofdrink.com/x/6241',
].join("\n");

describe("parseLessonManifest", () => {
  it("reads every column of every row", () => {
    const rows = parseLessonManifest(MANIFEST_CSV);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({
      lesson_number: "5",
      lesson_id: "4726",
      lesson_title: "Safety",
      lesson_type: "video",
      duration_or_marker: "7 minutes",
      url: "https://edu.artofdrink.com/x/4726",
    });
  });

  it("keeps a comma that is inside a quoted title", () => {
    const rows = parseLessonManifest(MANIFEST_CSV);
    expect(rows[2].lesson_title).toBe("Safety Quiz, part one");
    expect(rows[2].lesson_type).toBe("quiz");
  });

  it("refuses a manifest missing a column rather than filling in blanks", () => {
    expect(() => parseLessonManifest("lesson_number,lesson_id\n1,6486")).toThrow(
      /lesson_title/
    );
  });
});

describe("formatClock", () => {
  it("reads back the way someone scrubs a video", () => {
    expect(formatClock(0.169)).toBe("0:00");
    expect(formatClock(63.024)).toBe("1:03");
    expect(formatClock(3804)).toBe("1:03:24");
  });
});

describe("courseSource", () => {
  const manifest = parseLessonManifest(MANIFEST_CSV);

  it("carries the whole manifest, including lessons with no captions", () => {
    const source = courseSource(manifest, [chunk()], PROVENANCE);
    const carried = source.source_metadata.lesson_manifest as LessonManifestRow[];
    expect(carried).toHaveLength(3);
    // The point of storing all 39: the gap is queryable, not prose.
    expect(carried.map(l => l.lesson_id)).toContain("6486");
    expect(source.source_metadata.lessons_with_captions).toBe(1);
    expect(source.source_metadata.lessons_total).toBe(3);
  });

  it("lands pending_review — retrievable is not approved", () => {
    const source = courseSource(manifest, [chunk()], PROVENANCE);
    expect(source.operational_status).toBe("pending_review");
    expect(source.authority_tier).toBe("tier_b_authorized_course");
    expect(source.rights_status).toBe("authorized_private");
    expect(source.citation_required).toBe(true);
  });

  it("records where it was recovered from", () => {
    const source = courseSource(manifest, [chunk()], PROVENANCE);
    expect(source.source_metadata.recovered_from).toBe(PROVENANCE.recoveredFrom);
    expect(source.source_key).toBe(COURSE_SOURCE_KEY);
  });
});

describe("lessonSources", () => {
  const manifest = parseLessonManifest(MANIFEST_CSV);

  it("makes one source per lesson that actually has passages", () => {
    const sources = lessonSources(manifest, [
      chunk(),
      chunk({ chunk_id: "aod-fbd-6486-001", lesson_id: "6486", lesson_number: "1", lesson_title: "Introduction" }),
    ]);
    expect(sources.map(s => s.source_key)).toEqual([
      lessonSourceKey("6486"),
      lessonSourceKey("4726"),
    ]);
  });

  it("creates nothing for a lesson that was never collected", () => {
    const sources = lessonSources(manifest, [chunk()]);
    expect(sources).toHaveLength(1);
    expect(sources.map(s => s.source_key)).not.toContain(lessonSourceKey("6241"));
  });

  it("keeps every lesson under review", () => {
    for (const source of lessonSources(manifest, [chunk()])) {
      expect(source.operational_status).toBe("pending_review");
      expect(source.rights_status).toBe("authorized_private");
    }
  });
});

describe("lessonChunkPayloads", () => {
  it("orders by time, not by the order the file happened to be in", () => {
    const payloads = lessonChunkPayloads([
      chunk({ chunk_id: "aod-fbd-4726-002", start_seconds: 63.1, end_seconds: 120 }),
      chunk({ chunk_id: "aod-fbd-4726-001", start_seconds: 0.169, end_seconds: 63.024 }),
    ]);
    const lesson = payloads.get(lessonSourceKey("4726"))!;
    expect(lesson.map(c => c.chunk_key)).toEqual([
      "aod-fbd-4726-001",
      "aod-fbd-4726-002",
    ]);
    expect(lesson.map(c => c.ordinal)).toEqual([1, 2]);
  });

  it("stores a citation locator a person can check", () => {
    const payloads = lessonChunkPayloads([chunk()]);
    const [first] = payloads.get(lessonSourceKey("4726"))!;
    expect(first.locator).toMatchObject({
      lesson_id: "4726",
      lesson_number: "5",
      lesson_title: "Safety",
      source_url: "https://edu.artofdrink.com/x/4726",
      timestamp: "0:00-1:03",
    });
  });

  it("carries the body verbatim", () => {
    const payloads = lessonChunkPayloads([chunk()]);
    const [first] = payloads.get(lessonSourceKey("4726"))!;
    expect(first.body).toBe(chunk().text);
  });
});

describe("externalSources", () => {
  function record(overrides: Partial<ExternalSourceRecord> = {}): ExternalSourceRecord {
    return {
      source_id: "PUB-KK-001",
      title: "Super Juice Calculator",
      publisher: "Kevin Kos",
      source_url: "https://example.test/super-juice",
      source_authority: "external_practitioner",
      operational_status: "reference_only",
      rights_status: "public_page_citation_and_governed_summary_only",
      citation_required: true,
      topics: ["super juice", "acid"],
      governed_summary: "Describes an acid-adjusted citrus substitute.",
      ...overrides,
    };
  }

  it("uses the summary verbatim and holds no body text", () => {
    const [source] = externalSources([record()]);
    expect(source.governed_summary).toBe("Describes an acid-adjusted citrus substitute.");
    expect(source.authority_tier).toBe("tier_c_external_practitioner");
    expect(source.rights_status).toBe("public_summary_only");
  });

  it("keeps the register's original wording so the mapping can be audited", () => {
    const [source] = externalSources([record()]);
    expect(source.source_metadata).toMatchObject({
      manus_source_authority: "external_practitioner",
      manus_rights_status: "public_page_citation_and_governed_summary_only",
      manus_operational_status: "reference_only",
    });
  });

  it("treats a missing rights note as review_required, never as permission", () => {
    const [source] = externalSources([record({ rights_status: null })]);
    expect(source.rights_status).toBe("review_required");
  });

  it("files an inspiration-only source as inspiration, not as reference", () => {
    const [source] = externalSources([
      record({ source_authority: "inspiration_only", operational_status: "not_ingested" }),
    ]);
    expect(source.authority_tier).toBe("tier_d_inspiration");
    expect(source.operational_status).toBe("inspiration_only");
  });

  it("throws on a vocabulary nobody mapped rather than guessing a default", () => {
    expect(() => externalSources([record({ source_authority: "brand_new_tier" })])).toThrow(
      /Unmapped source_authority/
    );
    expect(() => externalSources([record({ rights_status: "some_new_licence" })])).toThrow(
      /Unmapped rights_status/
    );
    expect(() =>
      externalSources([record({ operational_status: "half_ingested" })])
    ).toThrow(/Unmapped operational_status/);
  });

  it("falls back to the video url when there is no page url", () => {
    const [source] = externalSources([
      record({ source_url: undefined, video_url: "https://youtu.be/abc" }),
    ]);
    expect(source.source_url).toBe("https://youtu.be/abc");
  });
});

describe("parseJsonl", () => {
  it("ignores blank lines and trailing newlines", () => {
    expect(parseJsonl<{ a: number }>('{"a":1}\n\n{"a":2}\n')).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
  });
});
