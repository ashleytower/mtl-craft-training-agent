/**
 * Passages the owner chose from a book the business bought, pasted by hand.
 *
 * WHAT THIS IS NOT
 *
 * It is not a way to load a book. A purchased ebook is DRM-locked and nothing
 * here reads one; the input is a plain text file the owner pastes selected
 * passages into. The two limits below make that boundary a property of the code
 * rather than a promise: one passage is capped, and so is the whole file, so a
 * file that has grown toward the book is refused instead of ingested.
 *
 * FILE FORMAT
 *
 *   ---
 *   source_key: solid-wiggles
 *   title: ...
 *   creator: ...
 *   publisher: ...
 *   url: https://...
 *   note: optional, see below
 *   ---
 *   === p. 42 | optional section heading ===
 *   pasted text
 *
 * The page reference is required. A passage nobody can look up in the book is
 * not a citation, so it is refused rather than filed.
 *
 * `note` is appended to the source's governed summary. Use it when a file holds
 * a summary somebody compiled from the book rather than the book's own words, so
 * the source says so in the one place Brix reads before it answers. A summary and
 * verbatim passages belong in separate files, because they are separate sources.
 *
 * WHY THE LOCATOR SAYS `page_text_only`
 *
 * `citationFor` (hermesRoutes.ts) and the `citable` counter in
 * db/migrations/124_coverage_source_provenance.sql both key off the locator, and
 * 124 counts a passage as citable only if it has a source_url and, for
 * `page_text_only`, a page_reference. Any other retrieval_type is judged by the
 * time-coded rule and reported uncitable, which fails `brix-live-qa`. So a book
 * passage borrows the page-text shape, and `medium: "book_excerpt"` is what
 * `citationFor` reads to word the citation as a book instead of a lesson page.
 * Change one of these only together with the other two.
 *
 * WHY THERE IS NO `lesson_id`
 *
 * Course coverage counts chunks that carry one. A book passage without it is
 * invisible to the course numbers, which is right: a book is not a lesson.
 *
 * KEYS ARE POSITIONAL. Append new passages at the end; reordering or deleting
 * one shifts the keys of everything after it, and a re-run then rewrites those
 * rows in place while leaving the old last row behind.
 */
import type { ChunkPayload, SourcePayload } from "./knowledgeCorpus";

/** One pasted passage. A recipe or a technique note, not a chapter. */
export const MAX_EXCERPT_CHARS = 4000;

/** The whole file. About what a person would choose to keep, not what a book holds. */
export const MAX_TOTAL_CHARS = 50_000;

export type BookMeta = {
  source_key: string;
  title: string;
  creator: string;
  publisher: string;
  url: string;
  isbn: string | null;
  year: string | null;
  note: string | null;
};

export type BookExcerpt = {
  pageReference: string;
  section: string | null;
  body: string;
};

const REQUIRED_KEYS = ["source_key", "title", "creator", "publisher", "url"] as const;
const HEADER = /^===\s*(.*?)\s*===\s*$/;

export function parseBookExcerpts(text: string): { meta: BookMeta; excerpts: BookExcerpt[] } {
  // Comments let the template carry its own instructions without ingesting them.
  const lines = text.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if (lines[i]?.trim() !== "---") {
    throw new Error('The file must start with a "---" front-matter block.');
  }
  i += 1;

  const front: Record<string, string> = {};
  for (; i < lines.length && lines[i].trim() !== "---"; i += 1) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(lines[i]);
    if (match) front[match[1]] = match[2].trim();
  }
  if (i >= lines.length) throw new Error('The front-matter block is not closed with "---".');
  i += 1;

  for (const key of REQUIRED_KEYS) {
    if (!front[key]) throw new Error(`The front matter is missing "${key}".`);
  }
  const meta: BookMeta = {
    source_key: front.source_key,
    title: front.title,
    creator: front.creator,
    publisher: front.publisher,
    url: front.url,
    isbn: front.isbn || null,
    year: front.year || null,
    note: front.note || null,
  };

  const excerpts: BookExcerpt[] = [];
  let current: { pageReference: string; section: string | null; lines: string[] } | null = null;

  const close = () => {
    if (!current) return;
    const body = current.lines.join("\n").trim();
    if (!body) throw new Error(`The excerpt at ${current.pageReference} has no text.`);
    if (body.length > MAX_EXCERPT_CHARS) {
      throw new Error(
        `The excerpt at ${current.pageReference} is ${body.length} characters; the limit is ` +
          `${MAX_EXCERPT_CHARS}. Shorten it or keep only the part you need.`
      );
    }
    excerpts.push({ pageReference: current.pageReference, section: current.section, body });
  };

  for (; i < lines.length; i += 1) {
    const header = HEADER.exec(lines[i]);
    if (header) {
      close();
      const [pageReference, ...rest] = header[1].split("|");
      const section = rest.join("|").trim() || null;
      if (!pageReference.trim()) {
        throw new Error(
          `Excerpt ${excerpts.length + 1}${section ? ` ("${section}")` : ""} has no page ` +
            `reference. A passage must be findable in the book.`
        );
      }
      current = { pageReference: pageReference.trim(), section, lines: [] };
    } else if (current) {
      current.lines.push(lines[i]);
    } else if (lines[i].trim()) {
      throw new Error(
        `Text found before the first "=== page ===" header: "${lines[i].trim().slice(0, 60)}". ` +
          `Every passage needs a page reference above it.`
      );
    }
  }
  close();

  const total = excerpts.reduce((sum, e) => sum + e.body.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    throw new Error(
      `The excerpts total ${total} characters; the limit is ${MAX_TOTAL_CHARS}. This file is for ` +
        `the passages you chose, not the whole book.`
    );
  }
  return { meta, excerpts };
}

export function bookSource(meta: BookMeta, excerptCount: number): SourcePayload {
  return {
    source_key: meta.source_key,
    title: meta.title,
    publisher: meta.publisher,
    creator: meta.creator,
    source_url: meta.url,
    // The closest existing tier: paid material the business is entitled to use,
    // private to it. The database CHECK admits only these four; a new tier would
    // be a migration on the shared number line for no gain in behaviour.
    authority_tier: "tier_b_authorized_course",
    rights_status: "authorized_private",
    operational_status: "pending_review",
    citation_required: true,
    governed_summary:
      `Purchased book material. The owner supplied ${excerptCount} passages from the copy ` +
      `the business bought; the book's full text is not held.` +
      (meta.note ? ` ${meta.note}` : "") +
      ` Tier B training reference: it explains technique and never supplies an approved measure.`,
    source_metadata: {
      medium: "book_excerpts",
      excerpts_total: excerptCount,
      isbn: meta.isbn,
      year: meta.year,
      note: meta.note,
      selected_by: "owner",
    },
  };
}

export function bookChunkPayloads(meta: BookMeta, excerpts: BookExcerpt[]): ChunkPayload[] {
  return excerpts.map((excerpt, index) => ({
    chunk_key: `${meta.source_key}-e${String(index + 1).padStart(3, "0")}`,
    ordinal: index + 1,
    body: excerpt.body,
    locator: {
      retrieval_type: "page_text_only",
      page_reference: excerpt.pageReference,
      ...(excerpt.section ? { section: excerpt.section } : {}),
      source_url: meta.url,
      medium: "book_excerpt",
      creator: meta.creator,
      selected_by: "owner",
    },
    embedding: null,
  }));
}
