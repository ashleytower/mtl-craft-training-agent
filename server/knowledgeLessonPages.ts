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
  // U+2018 opens, U+2019 closes. Folding both to U+2019 turned ‘like this’
  // into ’like this’ — a corrupted byte in text this system treats as verbatim
  // and quotable. The apostrophe forms below genuinely share the closing glyph.
  [/&#8216;/g, "‘"],
  [/&#8217;|&#0?39;|&apos;/g, "’"],
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

  return { lessonId, blocks: scanBlocks(body) };
}

/**
 * Walk the body emitting one block per paragraph, list item or heading.
 *
 * This was a `<(p|li|h[2-4])>(.*?)</\1>` match, which is wrong for nested
 * lists: the backreference closes on the FIRST `</li>` it meets, which is the
 * inner one. Given
 *
 *   <li>Item A<ul><li>Sub 1</li><li>Sub 2</li></ul>trailing text</li>
 *
 * it produced ["Item A Sub 1", "Sub 2"] — "Sub 1" silently welded onto the
 * outer item, and "trailing text" dropped from the corpus entirely. Neither
 * lesson collected so far uses sub-bullets, so nothing is currently corrupted,
 * but a technical course will use them and losing text without a trace is the
 * one failure this corpus cannot absorb.
 *
 * So: scan the block-level tags in order and attribute the text between them to
 * whichever block is open. Nested lists flatten into sequential items, and text
 * trailing a nested list still lands. `<ul>`/`<ol>` themselves are containers
 * with no text of their own and need no handling beyond being stripped.
 */
function scanBlocks(body: string): PageBlock[] {
  const blocks: PageBlock[] = [];
  const tags = /<(\/?)(p|li|h[2-4])\b[^>]*>/gi;

  let openKind: PageBlock["kind"] | null = null;
  let textStart = 0;

  const flush = (end: number) => {
    const raw = body.slice(textStart, end);
    const text = decodeEntities(
      raw
        // Inline tags sit INSIDE a word and must vanish, not become a space.
        // `CO<sub>2</sub>: Carbon dioxide` became "CO 2 : Carbon dioxide" —
        // a corrupted chemical formula in text this system treats as verbatim
        // and quotable. Anchors did the same to a list: "( AU , CA , US )".
        // `<br>` is deliberately NOT in this set: it separates lines and the
        // space it leaves behind is correct.
        .replace(/<\/?(?:a|sub|sup|strong|b|em|i|span|u|code|small|mark)\b[^>]*>/gi, "")
        .replace(/<[^>]+>/g, " ")
        // The body is sliced at the nav-button marker, which lands INSIDE that
        // tag, so the last fragment is an unterminated `<div class="`. Strip a
        // trailing incomplete tag or it reads as lesson prose.
        .replace(/<[^>]*$/, " ")
    )
      .replace(/\s+/g, " ")
      .trim();
    // Text found outside any open block is still the lesson's prose — it is
    // attributed as text rather than discarded. Only headings are a distinct
    // kind, and a heading is never open at that point.
    if (text) blocks.push({ kind: openKind ?? "text", text });
  };

  for (const match of body.matchAll(tags)) {
    const isClose = match[1] === "/";
    const kind: PageBlock["kind"] = match[2].toLowerCase().startsWith("h")
      ? "heading"
      : "text";

    flush(match.index);
    openKind = isClose ? null : kind;
    textStart = match.index + match[0].length;
  }
  flush(body.length);

  return blocks;
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
 * Put a lesson's page passages after its time-coded ones, under one source.
 *
 * The ingest used to skip a lesson's page entirely once that lesson had
 * captions. That was survivable only while the two sets never overlapped; the
 * moment a page-text lesson gained a transcript it would have silently dropped
 * every page passage already ingested and cited for it.
 *
 * Ordinals are reassigned so they stay unique and dense within the source.
 * Chunk KEYS are deliberately untouched — `-p001` stays `-p001` — because the
 * upsert matches on `(source_id, chunk_key)`. Renumbering keys instead would
 * orphan every previously ingested page row under a key nothing writes again,
 * leaving them searchable, uncounted and impossible to update.
 */
export function appendPageChunks(
  timeCoded: ChunkPayload[],
  page: ChunkPayload[]
): ChunkPayload[] {
  return [
    ...timeCoded,
    ...page.map((chunk, index) => ({ ...chunk, ordinal: timeCoded.length + index + 1 })),
  ];
}

/**
 * Amend a time-coded lesson's source row to declare the page passages it also
 * holds.
 *
 * A lesson that gains a transcript does not stop having a written page. Both
 * are ingested, under one source row, so the row has to say so — otherwise the
 * summary claims "7 time-coded passages" while the source actually answers from
 * 12, and the five it does not mention are the ones cited by paragraph rather
 * than by clock.
 *
 * `pageLessonSource` still builds the row for a lesson that has ONLY page text.
 * This is the both-kinds case, and it starts from the time-coded row because
 * that row already carries the correct `caption_origin` provenance.
 */
export function withPageTextNoted(
  source: SourcePayload,
  pageChunkCount: number
): SourcePayload {
  if (pageChunkCount === 0) return source;
  return {
    ...source,
    governed_summary:
      `${source.governed_summary} Also holds ${pageChunkCount} passage` +
      `${pageChunkCount === 1 ? "" : "s"} of the lesson's written page, cited by ` +
      `section and paragraph rather than by timestamp.`,
    source_metadata: {
      ...source.source_metadata,
      page_text_chunks: pageChunkCount,
      // Both locator shapes occur under this source, so a consumer that assumes
      // every chunk has a clock is wrong. Saying it here means it can be
      // checked without scanning the chunks.
      retrieval_types: ["time_coded", "page_text_only"],
    },
  };
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
