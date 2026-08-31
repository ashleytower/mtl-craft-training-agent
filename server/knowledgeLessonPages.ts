/**
 * Lessons whose player exposed no caption track.
 *
 * Two of the 39 course items — 13 "Solvents for Flavours" and 22
 * "Documentation" — are ordinary video lessons whose Bunny player never
 * exposed an English auto-caption track. Manus saved their authorised lesson
 * pages anyway and left a note that they must not be represented as time-coded
 * transcripts. That note is the whole design of this file.
 *
 * A caption chunk can say "at 2:15". A page chunk cannot, because there is no
 * clock — the text is prose on a page. Inventing a plausible timestamp for it
 * would produce a citation that looks checkable and isn't, which is the exact
 * failure the citation contract exists to prevent. So page chunks carry a
 * different locator: the section heading they sit under and the paragraph range
 * they cover. Both are things a person can actually go and verify on the page.
 *
 * The video's own narration is still uncaptured. This is the lesson's written
 * body, not a substitute transcript, and `retrieval_type: "page_text_only"`
 * says so on every chunk.
 */
import type { ChunkPayload, LessonManifestRow, SourcePayload } from "./knowledgeCorpus";
import { COURSE_SOURCE_KEY, lessonSourceKey } from "./knowledgeCorpus";

/** A heading or a paragraph, in the order it appears on the page. */
export type PageBlock = {
  kind: "heading" | "text";
  text: string;
};

export type LessonPage = {
  lessonId: string;
  blocks: PageBlock[];
};

/**
 * The lesson body sits between the video embed and the next/previous nav
 * buttons. Anchoring on those two markers rather than on a content class is
 * deliberate: MasterStudy reuses its content classes in `<link>` tags for
 * stylesheets, so the first textual match for the class name is a CSS URL, not
 * the lesson.
 */
const BODY_START = '<div class="masterstudy-course-player-lesson-video">';
const BODY_END = "masterstudy-nav-button";

const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/g, " "],
  [/&#8216;|&#8217;|&#0?39;|&apos;/g, "’"],
  [/&#8220;|&#8221;|&quot;/g, '"'],
  [/&#8211;/g, "–"],
  [/&#8212;/g, "—"],
  [/&#8230;/g, "…"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  // Ampersand last, so a decoded "&" cannot be re-read as the start of an
  // entity by a later rule.
  [/&amp;/g, "&"],
];

function decodeEntities(text: string): string {
  return ENTITIES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

/**
 * Pull the ordered heading/paragraph blocks out of a saved lesson page.
 *
 * Returns an empty block list rather than throwing when the markers are absent:
 * a page that does not look like a lesson is a page with no lesson text, and
 * the ingest reports that plainly instead of failing the whole run.
 */
export function extractLessonPage(html: string, lessonId: string): LessonPage {
  const start = html.indexOf(BODY_START);
  if (start === -1) return { lessonId, blocks: [] };
  const end = html.indexOf(BODY_END, start);
  const body = html.slice(start, end === -1 ? undefined : end);

  const blocks: PageBlock[] = [];
  for (const match of body.matchAll(/<(p|li|h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase();
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    blocks.push({ kind: tag.startsWith("h") ? "heading" : "text", text });
  }
  return { lessonId, blocks };
}

/**
 * Roughly the size of a caption chunk (the 158 course chunks average ~955
 * characters), so retrieval ranks page text and transcript against each other
 * on comparable footing rather than favouring whichever happens to be longer.
 */
const TARGET_CHUNK_CHARS = 900;

/**
 * Group blocks into chunks that never straddle a section heading.
 *
 * A heading starts a new chunk. Paragraphs accumulate until the next heading or
 * until the chunk is long enough. Paragraph numbers count text blocks only and
 * run across the whole page, so "paragraphs 4-6" means the 4th to 6th
 * paragraph of the lesson, which is what someone scanning the page will count.
 */
export function pageChunkPayloads(
  page: LessonPage,
  lesson: LessonManifestRow,
  courseTitle: string
): ChunkPayload[] {
  const chunks: ChunkPayload[] = [];
  let section: string | null = null;
  let buffer: string[] = [];
  let firstParagraph = 0;
  let paragraphNumber = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const ordinal = chunks.length + 1;
    const lastParagraph = paragraphNumber;
    chunks.push({
      chunk_key: `aod-fbd-${page.lessonId}-p${String(ordinal).padStart(3, "0")}`,
      ordinal,
      body: buffer.join("\n\n"),
      locator: {
        course_title: courseTitle,
        lesson_id: page.lessonId,
        lesson_number: lesson.lesson_number,
        lesson_title: lesson.lesson_title,
        source_url: lesson.url,
        // The honest substitute for a timestamp. No `timestamp`,
        // `start_seconds` or `end_seconds` key exists on a page chunk — a
        // consumer that wants a clock will find nothing rather than a guess.
        retrieval_type: "page_text_only",
        section,
        paragraph_start: firstParagraph,
        paragraph_end: lastParagraph,
        page_reference:
          (section ? `"${section}", ` : "") +
          (firstParagraph === lastParagraph
            ? `paragraph ${firstParagraph}`
            : `paragraphs ${firstParagraph}-${lastParagraph}`),
      },
      embedding: null,
    });
    buffer = [];
  };

  for (const block of page.blocks) {
    if (block.kind === "heading") {
      flush();
      section = block.text;
      continue;
    }
    paragraphNumber += 1;
    if (buffer.length === 0) firstParagraph = paragraphNumber;
    buffer.push(block.text);
    if (buffer.join("\n\n").length >= TARGET_CHUNK_CHARS) flush();
  }
  flush();

  return chunks;
}

/**
 * The source row for a page-text lesson.
 *
 * Same shape, tier and rights as a captioned lesson — it is the same course and
 * the same enrolment. Only the summary and `retrieval_type` differ, and they
 * differ so that nobody reading the row mistakes it for a transcript.
 */
export function pageLessonSource(
  page: LessonPage,
  lesson: LessonManifestRow,
  courseTitle: string,
  chunkCount: number
): SourcePayload {
  return {
    source_key: lessonSourceKey(page.lessonId),
    title: `${lesson.lesson_title} — Flavour & Beverage Development`,
    publisher: "Art of Drink Education",
    creator: "Darcy O'Neil",
    source_url: lesson.url,
    authority_tier: "tier_b_authorized_course",
    rights_status: "authorized_private",
    operational_status: "pending_review",
    citation_required: true,
    governed_summary:
      `Lesson ${lesson.lesson_number} of the Flavour & Beverage Development ` +
      `course. The player exposed no caption track, so this is the lesson's ` +
      `written page text in ${chunkCount} passages, cited by section and ` +
      `paragraph. It is not a transcript of the ${lesson.duration_or_marker} video.`,
    source_metadata: {
      course_source_key: COURSE_SOURCE_KEY,
      course_title: courseTitle,
      lesson_id: page.lessonId,
      lesson_number: lesson.lesson_number,
      lesson_type: lesson.lesson_type,
      duration_or_marker: lesson.duration_or_marker,
      // Deliberately not `caption_origin`: there is no caption here.
      retrieval_type: "page_text_only",
    },
  };
}
