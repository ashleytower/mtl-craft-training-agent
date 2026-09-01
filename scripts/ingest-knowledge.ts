/**
 * Load the recovered Manus corpus into the governed beverage schema.
 *
 * Run:
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/ingest-knowledge.ts [--dry-run]
 *
 * Idempotent. Sources upsert by `source_key`, chunks by `(source_key,
 * chunk_key)`, and neither path overwrites a human decision: `rights_status`,
 * `operational_status` and `review_status` are left alone on conflict, so
 * re-running after someone approves a source does not walk that approval back.
 *
 * Input files are NOT in git. They are third-party course material held under
 * `authorized_private` rights, and a private repository is still the wrong
 * place for a verbatim copy of somebody's paid course. `docs/BRIX_KNOWLEDGE.md`
 * records where they came from and how to recover them again; the database is
 * the store of record.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  COURSE_SOURCE_KEY,
  courseSource,
  externalSources,
  lessonChunkPayloads,
  lessonSourceKey,
  lessonSources,
  parseJsonl,
  parseLessonManifest,
  sourceEmbeddingText,
  type ChunkPayload,
  type CourseChunkRecord,
  type ExternalSourceRecord,
  type LessonManifestRow,
  type SourcePayload,
} from "../server/knowledgeCorpus";
import {
  appendPageChunks,
  extractLessonPage,
  pageChunkPayloads,
  pageLessonSource,
  withPageTextNoted,
} from "../server/knowledgeLessonPages";
import {
  isPromptEcho,
  parseVtt,
  transcriptChunkRecords,
  transcriptSpanSeconds,
} from "../server/knowledgeTranscripts";
import { courseAssetSources } from "../server/knowledgeCourseAssets";
import { embedToLiteral, embeddingConfig } from "../server/knowledgeEmbedding";
import * as beverage from "../server/beverageClient";
import type { OperatorIdentity } from "../server/_core/supabaseAuth";

const CORPUS_DIR = process.env.BEVERAGE_CORPUS_DIR ?? "data/knowledge";
const MANUS_SHARE = "https://manus.im/share/5BNfPHDbcgJbvdHmeTZo9E";

/**
 * Names the exact decoder behind every locally transcribed passage.
 *
 * It is stored on each chunk's locator and read back by `captionOriginNote`,
 * so a citation can say which model produced the words. Changing model means
 * changing this string — two models' output must not share one origin label.
 */
const TRANSCRIPT_ORIGIN = "local_whisper_small_en";

function readCorpusFile(name: string): string {
  const path = resolve(process.cwd(), CORPUS_DIR, name);
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${path}. The corpus files are not committed — see docs/BRIX_KNOWLEDGE.md ` +
        `for where they come from.`
    );
  }
  return readFileSync(path, "utf8");
}

/** Optional corpus file: absent is a normal state, not a failure. */
function readCorpusFileIfPresent(name: string): string | null {
  const path = resolve(process.cwd(), CORPUS_DIR, name);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/**
 * Locally transcribed lessons, read from `local_transcripts/`.
 *
 * Each `lesson_<id>.vtt` is Whisper output for that lesson's audio, and each
 * sits beside a `lesson_<id>.duration` holding the media length ffprobe
 * measured. The duration file is not bookkeeping: it is the check that a
 * transcript belongs to the recording it claims. A VTT whose last cue runs past
 * the end of its media is either transcribing different audio or carrying a
 * decoder timestamp that ran away, and either way its clocks cannot be cited.
 *
 * A lesson with no VTT is normal — most lessons have a real caption track, and
 * five have no video at all.
 */
function loadLocalTranscripts(
  manifest: LessonManifestRow[],
  courseTitle: string
): CourseChunkRecord[] {
  const records: CourseChunkRecord[] = [];

  for (const lesson of manifest) {
    const vtt = readCorpusFileIfPresent(`local_transcripts/lesson_${lesson.lesson_id}.vtt`);
    if (!vtt) continue;

    const cues = parseVtt(vtt);
    if (cues.length === 0) {
      console.log(
        `  lesson ${lesson.lesson_number} (${lesson.lesson_id}): transcript present ` +
          `but empty — skipped rather than ingested as a silent lesson`
      );
      continue;
    }

    const durationFile = readCorpusFileIfPresent(
      `local_transcripts/lesson_${lesson.lesson_id}.duration`
    );
    if (!durationFile) {
      throw new Error(
        `Transcript for lesson ${lesson.lesson_id} has no measured media duration ` +
          `beside it. Refusing to ingest timestamps that were never checked ` +
          `against their recording.`
      );
    }
    const mediaSeconds = Number.parseFloat(durationFile.trim());
    if (!Number.isFinite(mediaSeconds) || mediaSeconds <= 0) {
      throw new Error(
        `Unreadable media duration "${durationFile.trim()}" for lesson ${lesson.lesson_id}.`
      );
    }

    // The decoder reciting its own glossary is not narration. Left alone it
    // would enter the corpus as a timestamped, quotable passage and then pass
    // every term check, because the words in it ARE the checker's vocabulary.
    // Refused rather than dropped: a cue this file cannot vouch for is a human
    // decision, not something to silently delete from a lesson.
    const echo = cues.find(cue => isPromptEcho(cue.text));
    if (echo) {
      throw new Error(
        `Lesson ${lesson.lesson_id} transcript contains what looks like the decoder ` +
          `reciting its own initial_prompt at ${echo.startSeconds}s: ` +
          `"${echo.text.slice(0, 120)}". Refusing to ingest it as narration. ` +
          `Check the audio at that timestamp, then delete the cue or the file.`
      );
    }

    const span = transcriptSpanSeconds(cues);
    // One second of slack: a cue may legitimately end on the final frame, and
    // ffprobe's container duration and the decoder's last timestamp are
    // measured slightly differently. Anything beyond that is a real mismatch.
    if (span > mediaSeconds + 1) {
      throw new Error(
        `Transcript for lesson ${lesson.lesson_id} runs to ${span.toFixed(1)}s but its ` +
          `media is ${mediaSeconds.toFixed(1)}s. The transcript does not match the ` +
          `recording; its timestamps are not citable.`
      );
    }

    records.push(
      ...transcriptChunkRecords(cues, lesson, {
        courseTitle,
        captionOrigin: TRANSCRIPT_ORIGIN,
      })
    );
  }

  return records;
}

/**
 * The ingest runs as the owner, not as Brix.
 *
 * Brix's own principal is deliberately not an owner, and writing reference
 * material is an operator action with an audit trail. Using the agent's
 * identity here would file every row as though the agent had decided to add it.
 */
function ownerIdentity(): OperatorIdentity {
  const subject = (process.env.BEVERAGE_OWNER_SUBJECTS ?? "").split(",")[0]?.trim();
  if (!subject) {
    throw new Error(
      "BEVERAGE_OWNER_SUBJECTS is empty. The ingest writes as the owner; it will not " +
        "invent a subject."
    );
  }
  return {
    subject,
    email: null,
    displayName: process.env.BEVERAGE_OWNER_DISPLAY_NAME ?? "MTL Craft owner",
    // "browser" is the origin a signed-in human carries. This script is run by
    // hand by that human; marking it "hermes" would file the ingest as the
    // agent's own doing, which is the opposite of true.
    origin: "browser",
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const captions = parseJsonl<CourseChunkRecord>(
    readCorpusFile("art_of_drink_knowledge_chunks.jsonl")
  );
  const manifest = parseLessonManifest(readCorpusFile("art_of_drink_lesson_manifest.csv"));
  const external = parseJsonl<ExternalSourceRecord>(
    readCorpusFile("Public_External_Knowledge_Records.jsonl")
  );

  const courseTitle = captions[0]?.course_title ?? "Flavour & Beverage Development Course";

  // Lessons whose player exposed no caption track but whose audio was
  // transcribed locally. These records have the same shape as a caption record
  // and travel the same path from here on — the difference lives in
  // `caption_origin`, which every citation carries.
  const transcripts = loadLocalTranscripts(manifest, courseTitle);
  const chunks = [...captions, ...transcripts];

  const course = courseSource(manifest, chunks, {
    recoveredFrom: MANUS_SHARE,
    recoveredAt: "2026-08-31",
  });
  const externals = externalSources(external);
  const chunksBySource = lessonChunkPayloads(chunks);

  // Every lesson's written page, whether or not it also has time-coded text.
  //
  // This used to `continue` past any lesson that had captions, treating the
  // page as a fallback for missing captions rather than as material in its own
  // right. Two consequences followed from dropping that guard, and both are
  // wanted:
  //
  //   1. A lesson that gains a transcript keeps its page passages. Without
  //      this, the seven newly transcribed lessons would have silently lost
  //      every page citation already ingested for them.
  //   2. The twelve lessons that always had captions gain the pages that were
  //      collected for them and never ingested — 83 passages, including the
  //      8.8k-character Food Grade Ingredients page. Ashley chose to include
  //      these (2026-09-01) rather than leave collected, authorised material
  //      sitting unused on disk.
  //
  // A page passage is still cited by section and paragraph, never by a
  // timestamp it does not have.
  const timeCoded = new Set(chunks.map(c => c.lesson_id));
  const pageChunksBySource = new Map<string, ChunkPayload[]>();
  const pageOnlyLessons: SourcePayload[] = [];

  for (const lesson of manifest) {
    const html = readCorpusFileIfPresent(
      `batch1/authorized_lesson_pages/lesson_${lesson.lesson_id}.html`
    );
    if (!html) continue;

    const page = extractLessonPage(html, lesson.lesson_id);
    const pageChunks = pageChunkPayloads(page, lesson, courseTitle);
    if (pageChunks.length === 0) {
      console.log(
        `  lesson ${lesson.lesson_number} (${lesson.lesson_id}): page saved but no ` +
          `readable body — skipped rather than ingested empty`
      );
      continue;
    }
    pageChunksBySource.set(lessonSourceKey(lesson.lesson_id), pageChunks);
    if (!timeCoded.has(lesson.lesson_id)) {
      pageOnlyLessons.push(pageLessonSource(page, lesson, courseTitle, pageChunks.length));
    }
  }

  // Page passages follow the time-coded ones within a source, renumbered so
  // ordinals stay unique and dense. Chunk keys are untouched — `-p001` stays
  // `-p001` — so a re-run updates the existing row in place instead of
  // orphaning it under a new key.
  for (const [sourceKey, pageChunks] of pageChunksBySource) {
    chunksBySource.set(
      sourceKey,
      appendPageChunks(chunksBySource.get(sourceKey) ?? [], pageChunks)
    );
  }

  // One row per lesson. A lesson holding both kinds declares both; building a
  // second row from `pageLessonSource` would collide on `source_key` and the
  // last writer would win, hiding whichever description lost.
  const lessons = lessonSources(manifest, chunks).map(source =>
    withPageTextNoted(source, pageChunksBySource.get(source.source_key)?.length ?? 0)
  );
  const pageLessons = pageOnlyLessons;

  console.log(
    `corpus: ${manifest.length} manifest rows, ${captions.length} caption chunks + ` +
      `${transcripts.length} local-transcript chunks across ${timeCoded.size} lessons, ` +
      `${pageChunksBySource.size} lessons with page text ` +
      `(${pageLessons.length} page-only), ${externals.length} external sources, ` +
      `${courseAssetSources().length} linked course assets`
  );

  if (dryRun) {
    console.log(JSON.stringify({ course, lessons: lessons.slice(0, 2), external: externals.slice(0, 2) }, null, 2));
    console.log("--dry-run: nothing written");
    return;
  }

  const identity = ownerIdentity();

  // Embeddings are per row and the model is local, so these are plain
  // sequential loops rather than a batched pipeline: 200 calls to a process on
  // localhost is seconds, and a failure is easier to attribute one at a time.
  const config = embeddingConfig();

  // Sources get an embedding too. Without one they were reachable only by an
  // exact AND of every term in the question, so "how do I make clear ice at
  // home" found none of the three clear-ice sources while "clear ice" found all
  // three. See db/migrations/112.
  // Documents the lessons LINK but the course does not host as lessons —
  // citations only, no chunks, because holding their text is what the rights
  // posture forbids. See server/knowledgeCourseAssets.ts.
  const assets = courseAssetSources();

  const allSources = [course, ...lessons, ...pageLessons, ...externals, ...assets];
  const sourcesWithEmbeddings = [];
  for (const source of allSources) {
    sourcesWithEmbeddings.push({
      ...source,
      embedding: await embedToLiteral(sourceEmbeddingText(source), config),
    });
  }

  const sourceResult = await beverage.ingestKnowledgeSources(
    identity,
    sourcesWithEmbeddings
  );
  console.log(
    `sources: ${sourceResult.inserted} inserted, ${sourceResult.updated} updated, ` +
      `${sourcesWithEmbeddings.filter(s => s.embedding).length} embedded`
  );

  let embedded = 0;
  let unembedded = 0;

  for (const [sourceKey, payloads] of chunksBySource) {
    const withEmbeddings = [];
    for (const payload of payloads) {
      const embedding = await embedToLiteral(payload.body, config);
      if (embedding) embedded += 1;
      else unembedded += 1;
      withEmbeddings.push({ ...payload, embedding });
    }
    const result = await beverage.ingestKnowledgeChunks(identity, {
      sourceKey,
      chunks: withEmbeddings,
    });
    console.log(
      `  ${sourceKey}: ${result.chunks} chunks, ${result.embedded} embedded`
    );
  }

  console.log(`chunks embedded: ${embedded}, without embedding: ${unembedded}`);
  if (unembedded > 0) {
    console.log(
      `  ${unembedded} chunks have no embedding — they are still retrievable by ` +
        `full text. Re-run once ${config.baseUrl} is reachable to fill them in.`
    );
  }

  // Any source with a summary and no embedding, whoever created it. Catches the
  // five rows that predate this work — including the two FDA references a
  // preservation question should reach — and anything added by hand later.
  const pending = await beverage.knowledgeSourcesPendingEmbedding(identity);
  let backfilled = 0;
  for (const source of pending) {
    const embedding = await embedToLiteral(source.embed_text, config);
    if (!embedding) continue;
    await beverage.setSourceEmbedding(identity, {
      sourceKey: source.source_key,
      embedding,
    });
    backfilled += 1;
  }
  if (pending.length > 0) {
    console.log(
      `backfilled ${backfilled} of ${pending.length} pre-existing source embeddings`
    );
  }

  // CONTENT coverage and MANIFEST coverage, reported separately. All 39
  // manifest rows have always existed; the number that matters is how many
  // carry material Brix can answer from.
  const coverage = await beverage.knowledgeCoverage(identity);
  const cov = coverage.course;
  const chunkCounts = coverage.chunks;
  console.log(
    `coverage: ${cov.items_with_content}/${cov.items_total} course items have CONTENT ` +
      `(${cov.items_with_captions} captions, ${cov.items_page_text_only} page-text)`
  );
  console.log(
    `          ${cov.items_register_only} register-only (quizzes, no knowledge to hold), ` +
      `${cov.items_not_collected} NOT COLLECTED`
  );
  console.log(
    `chunks:   ${chunkCounts.total} total (${chunkCounts.caption} caption, ` +
      `${chunkCounts.page_text} page-text), ${chunkCounts.embedded} embedded`
  );
  console.log(`course source key: ${COURSE_SOURCE_KEY}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
