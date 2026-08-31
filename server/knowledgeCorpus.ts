/**
 * Turning the recovered Manus artifacts into governed knowledge rows.
 *
 * Everything here is a pure transform: files in, row payloads out, no network
 * and no database. That is deliberate — the ingest is the one place where a
 * mistake becomes 158 wrong rows in a shared production database, so the part
 * that decides what a row says is testable without touching anything.
 *
 * Two shapes arrive, and they are not interchangeable:
 *
 *   art_of_drink_knowledge_chunks.jsonl   Ashley's own enrolled course. We hold
 *                                         the caption text in full and may quote
 *                                         it back with a lesson and a timestamp.
 *   Public_External_Knowledge_Records.jsonl
 *                                         Other people's public work. There is
 *                                         no body text and there must not be —
 *                                         only a citation and a summary someone
 *                                         already wrote.
 *
 * The second shape is why `knowledge_sources` and `knowledge_chunks` are
 * separate tables rather than one: a source with no chunks is a complete,
 * correct record, not a half-finished import.
 */

/** One line of `art_of_drink_knowledge_chunks.jsonl`, as Manus produced it. */
export type CourseChunkRecord = {
  record_type: string;
  source_provider: string;
  source_tier: string;
  course_title: string;
  lesson_number: string;
  lesson_id: string;
  lesson_title: string;
  source_url: string;
  caption_origin: string;
  review_status: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
  chunk_id: string;
};

/** One row of `art_of_drink_lesson_manifest.csv`. */
export type LessonManifestRow = {
  lesson_number: string;
  lesson_id: string;
  lesson_title: string;
  lesson_type: string;
  duration_or_marker: string;
  url: string;
};

/** One line of `Public_External_Knowledge_Records.jsonl`. */
export type ExternalSourceRecord = {
  source_id: string;
  title: string;
  publisher?: string;
  source_url?: string;
  media_type?: string;
  source_authority?: string;
  operational_status?: string;
  rights_status?: string | null;
  requires_internal_review?: boolean;
  citation_required?: boolean;
  topics?: string[];
  governed_summary?: string;
  video_url?: string;
  published_at?: string;
  captured_at?: string;
  external_formula_capture?: unknown;
  external_calculator_contract?: unknown;
  companion_source_url?: string;
  relationship_to_existing_source?: string;
};

/** A row for `beverage_ingest_knowledge_sources`. */
export type SourcePayload = {
  source_key: string;
  title: string;
  publisher: string | null;
  creator: string | null;
  source_url: string | null;
  authority_tier: string;
  rights_status: string;
  operational_status: string;
  citation_required: boolean;
  governed_summary: string;
  source_metadata: Record<string, unknown>;
};

/**
 * What a source's embedding is built from.
 *
 * Title, summary and topics — all text already stored on the row. A cite-only
 * source has no body to embed and must not acquire one; this is what lets it be
 * found by meaning rather than only by an exact term match, without holding a
 * word more of anyone's work than the governed summary already does.
 *
 * KEEP IN SYNC WITH `beverage_knowledge_sources_pending_embedding` in
 * `db/migrations/113_backfill_source_embeddings.sql`, which assembles the same
 * three fields in SQL for the backfill path. Two implementations exist on
 * purpose — the backfill runs inside Postgres over rows this script never sees,
 * and routing it through Node would be worse — but if they diverge, the column
 * ends up holding vectors from two different spaces and nothing reports it.
 * `knowledgeCorpus.test.ts` pins the exact output format so a change here shows
 * up as a failing test rather than as quietly worse retrieval.
 */
export function sourceEmbeddingText(source: SourcePayload): string {
  const topics = source.source_metadata.topics;
  const topicLine = Array.isArray(topics) ? topics.join(", ") : "";
  return [source.title, source.governed_summary, topicLine]
    .filter(part => part && String(part).trim())
    .join("\n");
}

/** A row for `beverage_ingest_knowledge_chunks`. */
export type ChunkPayload = {
  chunk_key: string;
  ordinal: number;
  body: string;
  locator: Record<string, unknown>;
  embedding: string | null;
};

export const COURSE_SOURCE_KEY = "aod-fbd-course";

/** `aod-fbd-lesson-4726` — one source per lesson, so review can be per lesson. */
export function lessonSourceKey(lessonId: string): string {
  return `aod-fbd-lesson-${lessonId}`;
}

/**
 * A CSV reader that handles quoted fields and nothing else it does not need.
 * The manifest is machine-generated with a fixed six-column header; pulling in
 * a parser dependency to read 39 rows of it would be the larger risk.
 */
export function parseLessonManifest(csv: string): LessonManifestRow[] {
  const lines = csv.replace(/\r\n/g, "\n").trim().split("\n");
  const header = splitCsvLine(lines[0]);
  const required = [
    "lesson_number",
    "lesson_id",
    "lesson_title",
    "lesson_type",
    "duration_or_marker",
    "url",
  ];
  for (const column of required) {
    if (!header.includes(column)) {
      throw new Error(`lesson manifest is missing the "${column}" column`);
    }
  }
  return lines.slice(1).filter(Boolean).map((line, index) => {
    const cells = splitCsvLine(line);
    // Same discipline as `externalSources` below: refuse rather than guess. An
    // unquoted comma inside a lesson title yields one cell too many, and
    // zipping that against the header shifts every field after the break —
    // `lesson_type` silently becomes " part one" and the url is dropped. That
    // misfiling would reach the database looking entirely plausible.
    if (cells.length !== header.length) {
      throw new Error(
        `lesson manifest row ${index + 2} has ${cells.length} cells, expected ` +
          `${header.length}. A comma inside a field must be quoted. Row: ${line}`
      );
    }
    const row: Record<string, string> = {};
    header.forEach((name, position) => {
      row[name] = cells[position] ?? "";
    });
    return row as unknown as LessonManifestRow;
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
}

export function parseJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as T);
}

/**
 * The course itself, as one source row carrying the whole 39-item manifest.
 *
 * It holds no chunks — it is the register, not the material. Keeping the full
 * manifest here is what makes "which lessons can you actually answer from?" a
 * database question instead of a sentence in a document that goes stale the
 * next time captions are collected.
 */
export function courseSource(
  manifest: LessonManifestRow[],
  chunks: CourseChunkRecord[],
  provenance: { recoveredFrom: string; recoveredAt: string }
): SourcePayload {
  const lessonsWithCaptions = new Set(chunks.map(c => c.lesson_id));
  const videoCount = manifest.filter(l => l.lesson_type === "video").length;

  return {
    source_key: COURSE_SOURCE_KEY,
    title: "Art of Drink — Flavour & Beverage Development Course",
    publisher: "Art of Drink Education",
    creator: "Darcy O'Neil",
    source_url:
      "https://edu.artofdrink.com/courses-archive-elementor/flavor-beverage-development/",
    authority_tier: "tier_b_authorized_course",
    // Ashley is enrolled; the captions came from her own authorised browser
    // session. Private to this organisation, never redistributed.
    rights_status: "authorized_private",
    operational_status: "pending_review",
    citation_required: true,
    governed_summary:
      `Enrolled course, ${manifest.length} curriculum items (${videoCount} video). ` +
      `Time-coded captions collected for ${lessonsWithCaptions.size} lessons, ` +
      `yielding ${chunks.length} citable passages. Tier B training reference: ` +
      `it explains technique and never supplies an approved measure.`,
    source_metadata: {
      lms_course_id: 3206,
      lesson_manifest: manifest,
      lessons_total: manifest.length,
      lessons_with_captions: lessonsWithCaptions.size,
      chunk_count: chunks.length,
      recovered_from: provenance.recoveredFrom,
      recovered_at: provenance.recoveredAt,
    },
  };
}

/** One source per lesson that actually has captured passages. */
export function lessonSources(
  manifest: LessonManifestRow[],
  chunks: CourseChunkRecord[]
): SourcePayload[] {
  const byLesson = groupChunksByLesson(chunks);
  const manifestById = new Map(manifest.map(row => [row.lesson_id, row]));

  return [...byLesson.entries()]
    .sort((a, b) => lessonNumber(a[1][0]) - lessonNumber(b[1][0]))
    .map(([lessonId, lessonChunks]) => {
      const row = manifestById.get(lessonId);
      const first = lessonChunks[0];
      const spanSeconds = Math.max(...lessonChunks.map(c => c.end_seconds));
      return {
        source_key: lessonSourceKey(lessonId),
        title: `${first.lesson_title} — Flavour & Beverage Development`,
        publisher: "Art of Drink Education",
        creator: "Darcy O'Neil",
        source_url: first.source_url,
        authority_tier: "tier_b_authorized_course",
        rights_status: "authorized_private",
        operational_status: "pending_review",
        citation_required: true,
        governed_summary:
          `Lesson ${first.lesson_number} of the Flavour & Beverage Development ` +
          `course. ${lessonChunks.length} time-coded passages covering ` +
          `${formatClock(spanSeconds)} of ${row?.duration_or_marker ?? "video"}.`,
        source_metadata: {
          course_source_key: COURSE_SOURCE_KEY,
          course_title: first.course_title,
          lesson_id: lessonId,
          lesson_number: first.lesson_number,
          lesson_type: row?.lesson_type ?? "video",
          duration_or_marker: row?.duration_or_marker ?? null,
          caption_origin: first.caption_origin,
        },
      };
    });
}

/**
 * Chunk payloads keyed by the lesson source they belong to.
 *
 * `ordinal` is assigned by time order rather than taken from the chunk id, so
 * a re-run that collects the same lesson with different chunking still reads in
 * the order someone would watch it.
 */
export function lessonChunkPayloads(
  chunks: CourseChunkRecord[]
): Map<string, ChunkPayload[]> {
  const out = new Map<string, ChunkPayload[]>();
  for (const [lessonId, lessonChunks] of groupChunksByLesson(chunks)) {
    const ordered = [...lessonChunks].sort((a, b) => a.start_seconds - b.start_seconds);
    out.set(
      lessonSourceKey(lessonId),
      ordered.map((chunk, index) => ({
        chunk_key: chunk.chunk_id,
        ordinal: index + 1,
        body: chunk.text,
        locator: {
          course_title: chunk.course_title,
          lesson_id: chunk.lesson_id,
          lesson_number: chunk.lesson_number,
          lesson_title: chunk.lesson_title,
          source_url: chunk.source_url,
          start_seconds: chunk.start_seconds,
          end_seconds: chunk.end_seconds,
          timestamp: `${formatClock(chunk.start_seconds)}-${formatClock(chunk.end_seconds)}`,
          caption_origin: chunk.caption_origin,
        },
        embedding: null,
      }))
    );
  }
  return out;
}

function groupChunksByLesson(
  chunks: CourseChunkRecord[]
): Map<string, CourseChunkRecord[]> {
  const byLesson = new Map<string, CourseChunkRecord[]>();
  for (const chunk of chunks) {
    const list = byLesson.get(chunk.lesson_id);
    if (list) list.push(chunk);
    else byLesson.set(chunk.lesson_id, [chunk]);
  }
  return byLesson;
}

function lessonNumber(chunk: CourseChunkRecord): number {
  const parsed = Number.parseInt(chunk.lesson_number, 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/** `0:00`, `1:03:24` — what a person reads back while scrubbing a video. */
export function formatClock(totalSeconds: number): string {
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The Manus vocabulary is richer than the column's CHECK constraint, so the
 * mapping is explicit and total, and the original string is kept in metadata.
 * A value nobody anticipated throws rather than falling through to a default —
 * silently filing an unknown rights status as "public summary only" is exactly
 * the mistake this schema exists to prevent.
 */
const AUTHORITY_TIER_BY_SOURCE_AUTHORITY: Record<string, string> = {
  external_practitioner: "tier_c_external_practitioner",
  historical_reference: "tier_c_external_practitioner",
  inspiration_only: "tier_d_inspiration",
};

const RIGHTS_STATUS_BY_MANUS_RIGHTS: Record<string, string> = {
  public_page_citation_and_governed_summary_only: "public_summary_only",
  public_video_citation_and_governed_summary_only: "public_summary_only",
  public_tool_operated_in_place_no_code_or_ui_copying: "public_tool_operated_in_place",
};

const OPERATIONAL_STATUS_BY_MANUS_STATUS: Record<string, string> = {
  reference_only: "reference_only",
  reference_only_and_external_tool_directory: "reference_only",
  external_calculator_reference: "reference_only",
  not_ingested: "inspiration_only",
};

export function externalSources(records: ExternalSourceRecord[]): SourcePayload[] {
  return records.map(record => {
    const tier = AUTHORITY_TIER_BY_SOURCE_AUTHORITY[record.source_authority ?? ""];
    if (!tier) {
      throw new Error(
        `Unmapped source_authority "${record.source_authority}" on ${record.source_id}`
      );
    }
    const status = OPERATIONAL_STATUS_BY_MANUS_STATUS[record.operational_status ?? ""];
    if (!status) {
      throw new Error(
        `Unmapped operational_status "${record.operational_status}" on ${record.source_id}`
      );
    }
    // An absent rights note is not permission. `review_required` is the
    // column's own default and the only honest answer when nobody said.
    const rights = record.rights_status
      ? RIGHTS_STATUS_BY_MANUS_RIGHTS[record.rights_status]
      : "review_required";
    if (!rights) {
      throw new Error(
        `Unmapped rights_status "${record.rights_status}" on ${record.source_id}`
      );
    }

    return {
      source_key: record.source_id,
      title: record.title,
      publisher: record.publisher ?? null,
      creator: null,
      source_url: record.source_url ?? record.video_url ?? null,
      authority_tier: tier,
      rights_status: rights,
      operational_status: status,
      citation_required: record.citation_required ?? true,
      // Manus already wrote a governed summary for each of these. It is the
      // only body text we are entitled to hold, so it is used verbatim rather
      // than re-summarised — a paraphrase of a rights-limited summary is a
      // second derivative nobody reviewed.
      governed_summary: record.governed_summary ?? "",
      source_metadata: {
        media_type: record.media_type ?? null,
        topics: record.topics ?? [],
        video_url: record.video_url ?? null,
        published_at: record.published_at ?? null,
        captured_at: record.captured_at ?? null,
        companion_source_url: record.companion_source_url ?? null,
        relationship_to_existing_source: record.relationship_to_existing_source ?? null,
        requires_internal_review: record.requires_internal_review ?? true,
        external_calculator_contract: record.external_calculator_contract ?? null,
        external_formula_capture: record.external_formula_capture ?? null,
        // The words the register actually used, kept so the mapping above can
        // be audited without going back to the Manus share.
        manus_source_authority: record.source_authority ?? null,
        manus_operational_status: record.operational_status ?? null,
        manus_rights_status: record.rights_status ?? null,
      },
    };
  });
}
