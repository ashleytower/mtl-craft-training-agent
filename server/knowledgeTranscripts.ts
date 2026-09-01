/**
 * Locally transcribed lesson audio, turned into the same shape a caption is.
 *
 * Seven lessons carry video whose Bunny library (177015) exposes no caption
 * track at all — not an empty one, none: the embed document contains no `.vtt`
 * reference of any kind, where library 4056's embeds do. Their narration was
 * therefore unreachable, and `knowledgeLessonPages.ts` held the written page
 * body instead, cited by section and paragraph because a page has no clock.
 *
 * This module covers the other half: audio pulled from the enrolled session and
 * transcribed on this machine produces real cues with real clocks, so those
 * lessons can finally be quoted with a timestamp someone can scrub to.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO
 *
 * It does not replace the page text. A transcript and a written page are
 * different material — the page often states what the video only gestures at —
 * so a lesson ends up holding both, and `ingest-knowledge.ts` merges rather than
 * chooses. Dropping the page chunks to make room would delete verified,
 * already-cited passages.
 *
 * It does not launder a machine transcript into a publisher's caption. The
 * `caption_origin` on every record it emits names the model that produced it,
 * so a reader can tell a vendor caption from a local guess, and
 * `transcript_confidence` records that these are unreviewed machine output.
 * A local transcript is evidence of what was said, not a certified quote.
 */
import type { CourseChunkRecord, LessonManifestRow } from "./knowledgeCorpus";

/** One `00:00.000 --> 00:08.340` cue, already stripped of markup. */
export type TranscriptCue = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

/**
 * Cues per chunk.
 *
 * 12 is not a tuning choice — it is the grouping
 * `data/knowledge/batch1/vtt_to_knowledge_records.py` used for the 336 caption
 * chunks already in the corpus. Matching it keeps transcript passages the same
 * rough size as caption passages, so retrieval ranks the two against each other
 * on length-comparable footing instead of favouring whichever module produced
 * the longer body.
 */
const CUES_PER_CHUNK = 12;

/**
 * Parse a WebVTT file into cues.
 *
 * Accepts both `MM:SS.mmm` and `HH:MM:SS.mmm`, because Whisper switches to the
 * hour form partway through a long file — lesson 10 is 23 minutes and stays in
 * the short form, but nothing guarantees the next collected lesson will.
 * Mixing the two inside one file is normal and must not shift a timestamp by an
 * hour.
 */
export function parseVtt(vtt: string): TranscriptCue[] {
  const lines = vtt.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  const cues: TranscriptCue[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const arrow = lines[i].indexOf("-->");
    if (arrow === -1) continue;

    // Cue settings (`align:start position:0%`) trail the end time on the same
    // line. Splitting on whitespace and taking the first token drops them.
    const start = lines[i].slice(0, arrow).trim().split(/\s+/)[0];
    const end = lines[i].slice(arrow + 3).trim().split(/\s+/)[0];

    const body: string[] = [];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "") {
      body.push(lines[i].replace(/<[^>]+>/g, "").trim());
      i += 1;
    }

    const text = body.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const startSeconds = clockToSeconds(start);
    const endSeconds = clockToSeconds(end);
    if (startSeconds === null || endSeconds === null) continue;
    // A cue that ends before it starts is a corrupt clock, and a corrupt clock
    // in this corpus produces a citation that looks checkable and isn't. Refuse
    // the file rather than store one.
    if (endSeconds < startSeconds) {
      throw new Error(
        `Transcript cue ends before it starts (${start} --> ${end}). Refusing to ` +
          `build a citation from a corrupt clock.`
      );
    }
    cues.push({ startSeconds, endSeconds, text });
  }

  return cues;
}

function clockToSeconds(clock: string): number | null {
  const parts = clock.replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map(Number);
  if (numbers.some(Number.isNaN)) return null;
  return parts.length === 2
    ? numbers[0] * 60 + numbers[1]
    : numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

/**
 * Group cues into citable chunk records.
 *
 * `start_seconds` and `end_seconds` are the first cue's start and the last
 * cue's end, carried through unchanged bar a 3-decimal round — the same
 * rounding the existing caption records use. No timestamp is computed,
 * interpolated or nudged to look tidy; the clock a citation shows is the clock
 * the decoder emitted for that audio.
 */
export function transcriptChunkRecords(
  cues: TranscriptCue[],
  lesson: LessonManifestRow,
  options: { courseTitle: string; captionOrigin: string }
): CourseChunkRecord[] {
  const records: CourseChunkRecord[] = [];

  for (let offset = 0; offset < cues.length; offset += CUES_PER_CHUNK) {
    const group = cues.slice(offset, offset + CUES_PER_CHUNK);
    const index = offset / CUES_PER_CHUNK + 1;
    records.push({
      record_type: "knowledge_chunk",
      source_provider: "Art of Drink Education",
      source_tier: "B",
      course_title: options.courseTitle,
      lesson_number: lesson.lesson_number,
      lesson_id: lesson.lesson_id,
      lesson_title: lesson.lesson_title,
      source_url: lesson.url,
      caption_origin: options.captionOrigin,
      review_status: "pending_review",
      start_seconds: round3(group[0].startSeconds),
      end_seconds: round3(group[group.length - 1].endSeconds),
      text: group.map(cue => cue.text).join(" "),
      // A namespace of its own. Vendor captions are `aod-fbd-4726-001` and page
      // passages are `aod-fbd-4726-p001`; a local transcript is `-t001` so one
      // lesson can hold all three without a key collision, and so the origin of
      // a chunk is legible from its key alone in a log or an error.
      chunk_id: `aod-fbd-${lesson.lesson_id}-t${String(index).padStart(3, "0")}`,
    });
  }

  return records;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The last moment any cue covers, for checking a transcript against its media.
 *
 * Returns 0 for an empty transcript rather than `-Infinity`, which is what
 * `Math.max()` of nothing gives and which would sail through a
 * `<= duration` check.
 */
export function transcriptSpanSeconds(cues: TranscriptCue[]): number {
  return cues.reduce((max, cue) => (cue.endSeconds > max ? cue.endSeconds : max), 0);
}
