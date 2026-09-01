import { describe, expect, it } from "vitest";
import {
  parseVtt,
  transcriptChunkRecords,
  transcriptSpanSeconds,
} from "./knowledgeTranscripts";
import type { LessonManifestRow } from "./knowledgeCorpus";

const LESSON: LessonManifestRow = {
  lesson_number: "26",
  lesson_id: "4776",
  lesson_title: "Tincture",
  lesson_type: "video",
  duration_or_marker: "3 minutes",
  url: "https://edu.artofdrink.com/courses-archive-elementor/flavor-beverage-development/4776",
};

const OPTIONS = {
  courseTitle: "Flavour & Beverage Development Course",
  captionOrigin: "local_whisper_small_en",
};

describe("parseVtt", () => {
  it("reads the cues Whisper actually emits", () => {
    const cues = parseVtt(
      [
        "WEBVTT",
        "",
        "00:00.000 --> 00:08.340",
        "Though not commonly used much anymore tinctures still have their place",
        "",
        "00:08.340 --> 00:10.340",
        "so gentian which has a",
        "",
      ].join("\n")
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({
      startSeconds: 0,
      endSeconds: 8.34,
      text: "Though not commonly used much anymore tinctures still have their place",
    });
    expect(cues[1].startSeconds).toBe(8.34);
  });

  it("reads the hour form and the minute form in one file", () => {
    // Whisper switches to HH:MM:SS partway through a long file. Reading
    // "01:05.000" as an hour, or "01:00:05.000" as a minute, moves a citation
    // by an hour — and the citation still looks perfectly plausible.
    const cues = parseVtt(
      ["WEBVTT", "", "59:58.000 --> 01:00:02.000", "crossing the hour", ""].join("\n")
    );
    expect(cues[0].startSeconds).toBe(3598);
    expect(cues[0].endSeconds).toBe(3602);
  });

  it("drops cue settings that trail the end time", () => {
    const cues = parseVtt(
      ["WEBVTT", "", "00:01.000 --> 00:02.500 align:start position:0%", "text", ""].join("\n")
    );
    expect(cues[0].endSeconds).toBe(2.5);
  });

  it("strips markup and folds a multi-line cue into one passage", () => {
    const cues = parseVtt(
      ["WEBVTT", "", "00:00.000 --> 00:03.000", "<i>first line</i>", "second line", ""].join("\n")
    );
    expect(cues[0].text).toBe("first line second line");
  });

  it("skips an empty cue rather than storing a silent passage", () => {
    const cues = parseVtt(
      ["WEBVTT", "", "00:00.000 --> 00:03.000", "", "00:03.000 --> 00:05.000", "real", ""].join("\n")
    );
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("real");
  });

  it("refuses a cue whose clock runs backwards", () => {
    // A corrupt clock produces a citation that looks checkable and is not.
    expect(() =>
      parseVtt(["WEBVTT", "", "00:10.000 --> 00:04.000", "backwards", ""].join("\n"))
    ).toThrow(/corrupt clock/);
  });

  it("returns nothing for a file with no cues", () => {
    expect(parseVtt("WEBVTT\n\n")).toEqual([]);
  });
});

describe("transcriptChunkRecords", () => {
  const cues = Array.from({ length: 25 }, (_, i) => ({
    startSeconds: i * 5,
    endSeconds: i * 5 + 5,
    text: `line ${i + 1}`,
  }));

  it("groups 12 cues per chunk, matching the existing caption corpus", () => {
    const records = transcriptChunkRecords(cues, LESSON, OPTIONS);
    expect(records).toHaveLength(3);
    expect(records[0].text.match(/\bline \d+/g)).toHaveLength(12);
    expect(records[0].text).toBe(
      Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join(" ")
    );
    // The 13th cue starts the next chunk, and the remainder is not padded.
    expect(records[1].text.startsWith("line 13")).toBe(true);
    expect(records[2].text).toBe("line 25");
  });

  it("carries the real cue clocks through untouched", () => {
    const records = transcriptChunkRecords(cues, LESSON, OPTIONS);
    // First chunk spans cue 1's start to cue 12's end: 0 to 60.
    expect(records[0].start_seconds).toBe(0);
    expect(records[0].end_seconds).toBe(60);
    // Second starts where the 13th cue starts, not where the first chunk ended
    // plus something tidy.
    expect(records[1].start_seconds).toBe(60);
    expect(records[2].start_seconds).toBe(120);
    expect(records[2].end_seconds).toBe(125);
  });

  it("keys transcripts in their own namespace", () => {
    // Vendor captions are -001 and page passages are -p001. A transcript must
    // collide with neither, or one silently overwrites the other on ingest.
    const records = transcriptChunkRecords(cues, LESSON, OPTIONS);
    expect(records.map(r => r.chunk_id)).toEqual([
      "aod-fbd-4776-t001",
      "aod-fbd-4776-t002",
      "aod-fbd-4776-t003",
    ]);
  });

  it("names the decoder on every record so it cannot pose as a publisher caption", () => {
    for (const record of transcriptChunkRecords(cues, LESSON, OPTIONS)) {
      expect(record.caption_origin).toBe("local_whisper_small_en");
      expect(record.review_status).toBe("pending_review");
    }
  });

  it("produces nothing from no cues", () => {
    expect(transcriptChunkRecords([], LESSON, OPTIONS)).toEqual([]);
  });
});

describe("transcriptSpanSeconds", () => {
  it("reports the last moment any cue covers", () => {
    expect(
      transcriptSpanSeconds([
        { startSeconds: 0, endSeconds: 10, text: "a" },
        { startSeconds: 10, endSeconds: 25.5, text: "b" },
      ])
    ).toBe(25.5);
  });

  it("returns 0 for an empty transcript, not -Infinity", () => {
    // Math.max() of nothing is -Infinity, which sails through any
    // `span <= mediaDuration` check and defeats the guard entirely.
    expect(transcriptSpanSeconds([])).toBe(0);
  });
});
