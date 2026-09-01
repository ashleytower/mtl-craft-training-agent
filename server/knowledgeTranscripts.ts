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
import { ECHO_TERM_THRESHOLD, GLOSSARY_TERMS } from "./knowledgeGlossary";

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
    const header = lines[i].trim();
    const start = lines[i].slice(0, arrow).trim().split(/\s+/)[0];
    const end = lines[i].slice(arrow + 3).trim().split(/\s+/)[0];

    // The clocks are validated before the body is read, so an error names the
    // header line that is actually wrong rather than whatever index the body
    // scan finished on.
    const startSeconds = clockToSeconds(start);
    const endSeconds = clockToSeconds(end);
    // A malformed clock is evidence of a corrupt file, so it is refused rather
    // than skipped. Dropping the cue quietly would lose narration from the
    // middle of a lesson with nothing to show for it, and the enclosing chunk's
    // start/end would then span text the chunk no longer contains.
    if (startSeconds === null || endSeconds === null) {
      throw new Error(
        `Unreadable transcript clock in "${header}". Refusing to build a ` +
          `citation from a file this damaged.`
      );
    }
    // A cue that ends before it starts is a corrupt clock, and a corrupt clock
    // in this corpus produces a citation that looks checkable and isn't. Refuse
    // the file rather than store one.
    if (endSeconds < startSeconds) {
      throw new Error(
        `Transcript cue ends before it starts (${header}). Refusing to ` +
          `build a citation from a corrupt clock.`
      );
    }
    // Cues must run forward through the file. Whisper can loop or hallucinate
    // on silence and emit a segment that jumps backwards; each such cue is
    // internally consistent, so the per-cue check above passes, and the
    // media-duration guard is a max over all cues and passes too. The damage
    // shows up only at chunk level, where `start_seconds` comes from the first
    // cue and `end_seconds` from the last: out of order, that range no longer
    // bounds the text it is attached to.
    const previous = cues[cues.length - 1];
    if (previous && startSeconds < previous.startSeconds) {
      throw new Error(
        `Transcript cue "${header}" starts before the cue before it ` +
          `(${previous.startSeconds}s). Cues must run forward, or a ` +
          `chunk's time range will not bound its own text.`
      );
    }

    const body: string[] = [];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "") {
      body.push(lines[i].replace(/<[^>]+>/g, "").trim());
      i += 1;
    }

    const text = body.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;

    cues.push({ startSeconds, endSeconds, text });
  }

  return cues;
}

function clockToSeconds(clock: string): number | null {
  const parts = clock.replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  // Every component must actually be a number. `Number("")` is 0, not NaN, so
  // a NaN check alone lets "::05.000" through as 5 seconds — a clock invented
  // out of a damaged one, which is precisely what must not happen here.
  if (parts.some(part => !/^\d+(\.\d+)?$/.test(part.trim()))) return null;
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
 * Does this cue look like the decoder reciting its own `--initial_prompt`?
 *
 * Transcription primes Whisper with a comma-separated glossary of course terms.
 * Whisper is known to emit its conditioning text as though it were speech when
 * it meets silence, and the result is catastrophic here rather than merely
 * untidy: the glossary lands in the corpus as a passage with a real timestamp,
 * indistinguishable from narration, and gets quoted back verbatim as something
 * the instructor said. It would also sail through every term check, because the
 * words in it are by construction the exact words the checker treats as
 * attested course vocabulary.
 *
 * The test is deliberately narrow — the prompt's own preamble plus a long
 * comma run. A flavour course really does say things like "lemon, lime, orange,
 * grapefruit and yuzu", and a looser rule would throw that away. Callers REFUSE
 * on a hit rather than dropping the cue, so a false positive costs a human
 * glance and a false negative is what must not happen.
 */
export function isPromptEcho(text: string): boolean {
  const low = text.toLowerCase();
  const commas = low.match(/,/g)?.length ?? 0;

  // The prompt's own preamble, recited from the top.
  if (low.includes("terms:") && commas >= 5) return true;

  // A recitation that resumes mid-list has no preamble to find. Whisper loops
  // on its conditioning text, and nothing says a loop restarts at the
  // beginning — "gentian, wormwood, percolation, macerated, tincture, solvent,
  // emulsion, HLB" is the same fabrication wearing no identifying mark, and the
  // preamble test alone would pass it straight into the corpus.
  //
  // So: a comma run carrying many DISTINCT glossary terms. Counting glossary
  // terms rather than commas is what separates this from real speech — a
  // flavour course does say "lemon, lime, orange, grapefruit and yuzu", and
  // none of those is course jargon.
  if (commas >= ECHO_TERM_THRESHOLD - 1) {
    const distinct = new Set(
      GLOSSARY_TERMS.filter(term =>
        new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
      ).map(term => term.toLowerCase())
    );
    if (distinct.size >= ECHO_TERM_THRESHOLD) return true;
  }

  return false;
}

/**
 * Whisper's decode window. The final one is padded with silence, so a correct
 * transcript's last timestamp can sit up to this far past the end of the audio.
 */
export const WHISPER_WINDOW_SECONDS = 30;

/**
 * How much of a lesson's audio a transcript must cover to count as whole.
 *
 * Deliberately generous: a lesson may end on a long silent outro, and rejecting
 * a good transcript is worse than accepting a slightly short one. It is here to
 * catch transcription that died partway — the seven collected lessons all cover
 * 99%+ of their audio, so anything near half is broken, not merely quiet.
 */
export const MINIMUM_COVERAGE = 0.5;

/**
 * Check a transcript against the recording it claims to describe.
 *
 * Two opposite failures, both of which produce citations nobody can check:
 *
 * OVERSHOOT — timestamps running past the end of the audio. Some overshoot is
 * correct: Whisper decodes in 30-second windows and pads the last one with
 * silence, so lesson 10's final cue ends at 1414.3s against 1406.6s of media.
 * An earlier one-second tolerance rejected that good transcript. One window is
 * the principled ceiling because the overshoot can only come from that padded
 * window; beyond it the transcript describes audio the file does not contain,
 * which is what a mismatched pairing or a runaway clock looks like — and those
 * are wrong by minutes, not seconds.
 *
 * TRUNCATION — transcription died partway. Nothing is fabricated, but every
 * later citation for the lesson is simply missing, and saying nothing is how a
 * half-read lesson gets counted as fully covered.
 */
export function assertTranscriptCoversMedia(
  cues: TranscriptCue[],
  mediaSeconds: number,
  lessonId: string
): void {
  const span = transcriptSpanSeconds(cues);

  if (span > mediaSeconds + WHISPER_WINDOW_SECONDS) {
    throw new Error(
      `Transcript for lesson ${lessonId} runs to ${span.toFixed(1)}s but its media is ` +
        `${mediaSeconds.toFixed(1)}s — past the one-window tolerance. The transcript ` +
        `does not match the recording; its timestamps are not citable.`
    );
  }

  if (span < mediaSeconds * MINIMUM_COVERAGE) {
    throw new Error(
      `Transcript for lesson ${lessonId} covers only ${span.toFixed(1)}s of ` +
        `${mediaSeconds.toFixed(1)}s of audio ` +
        `(${((span / mediaSeconds) * 100).toFixed(0)}%). It looks truncated — re-run ` +
        `the transcription for this lesson rather than ingesting a partial one.`
    );
  }
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
