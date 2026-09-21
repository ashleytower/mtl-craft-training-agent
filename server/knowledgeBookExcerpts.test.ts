import { describe, expect, it } from "vitest";
import {
  MAX_EXCERPT_CHARS,
  MAX_TOTAL_CHARS,
  bookChunkPayloads,
  bookSource,
  parseBookExcerpts,
} from "./knowledgeBookExcerpts";

// Every string below is invented. None of it is from any book.
const FRONT = `---
source_key: example-book
title: Example Book
creator: Jane Roe and John Doe
publisher: Example Press
url: https://example.com/book
---
`;

const TWO = `${FRONT}
=== p. 42 | Setting agar ===
Agar sets firm at room temperature.

Use less than you think.

=== pp. 50-51 ===
A second passage with no section heading.
`;

describe("parseBookExcerpts", () => {
  it("reads the front matter and every excerpt with its page reference", () => {
    const { meta, excerpts } = parseBookExcerpts(TWO);
    expect(meta).toMatchObject({
      source_key: "example-book",
      title: "Example Book",
      creator: "Jane Roe and John Doe",
      publisher: "Example Press",
      url: "https://example.com/book",
    });
    expect(excerpts).toHaveLength(2);
    expect(excerpts[0]).toEqual({
      pageReference: "p. 42",
      section: "Setting agar",
      body: "Agar sets firm at room temperature.\n\nUse less than you think.",
    });
    expect(excerpts[1]).toMatchObject({ pageReference: "pp. 50-51", section: null });
  });

  it("ignores HTML comments, so the template can carry its own instructions", () => {
    const withComment = TWO.replace(
      "=== p. 42",
      "<!-- paste below this line -->\n=== p. 42"
    );
    expect(parseBookExcerpts(withComment).excerpts).toHaveLength(2);
  });

  it("an empty template is valid and holds no excerpts", () => {
    expect(parseBookExcerpts(FRONT).excerpts).toEqual([]);
  });

  it("names the front-matter key that is missing", () => {
    expect(() => parseBookExcerpts(TWO.replace("publisher: Example Press\n", ""))).toThrow(
      /publisher/
    );
  });

  it("refuses an excerpt with no page reference, because a citation must be checkable", () => {
    expect(() => parseBookExcerpts(`${FRONT}\n=== | Only a section ===\ntext\n`)).toThrow(
      /page reference/i
    );
  });

  it("refuses an excerpt with no text rather than ingesting an empty passage", () => {
    expect(() => parseBookExcerpts(`${FRONT}\n=== p. 9 ===\n\n=== p. 10 ===\ntext\n`)).toThrow(
      /p\. 9/
    );
  });

  it("refuses loose text before the first header, so nothing is ingested unlabelled", () => {
    expect(() => parseBookExcerpts(`${FRONT}\nstray pasted line\n=== p. 1 ===\ntext\n`)).toThrow(
      /before the first/i
    );
  });

  it("keeps a header that follows a multi-line comment on its own line", () => {
    // A comment spanning lines must not weld the next header onto the previous
    // passage, or page 2's text would be cited as page 1.
    const { excerpts } = parseBookExcerpts(
      `${FRONT}\n=== p. 1 ===\nbody one <!-- a\nb --> === p. 2 ===\nbody two\n`
    );
    expect(excerpts.map(e => [e.pageReference, e.body])).toEqual([
      ["p. 1", "body one"],
      ["p. 2", "body two"],
    ]);
  });

  it("refuses a Markdown underline, which looks like a header with no page", () => {
    expect(() =>
      parseBookExcerpts(`${FRONT}\n=== p. 3 ===\nChapter Three\n=============\nbody text\n`)
    ).toThrow(/page reference/i);
  });

  it("refuses a comment that is never closed instead of filing its text as the book's", () => {
    expect(() =>
      parseBookExcerpts(`${FRONT}\n<!-- paste under the header\n=== p. 1 ===\ntext\n`)
    ).toThrow(/never closed/i);
  });

  it("reads a file saved with Windows line endings the same way", () => {
    expect(parseBookExcerpts(TWO.replace(/\n/g, "\r\n")).excerpts).toEqual(
      parseBookExcerpts(TWO).excerpts
    );
  });

  it("refuses one excerpt longer than the per-excerpt limit", () => {
    const big = "x".repeat(MAX_EXCERPT_CHARS + 1);
    expect(() => parseBookExcerpts(`${FRONT}\n=== p. 1 ===\n${big}\n`)).toThrow(/p\. 1/);
  });

  it("refuses a file that has grown toward the whole book", () => {
    const each = "x".repeat(MAX_EXCERPT_CHARS);
    const count = Math.ceil(MAX_TOTAL_CHARS / MAX_EXCERPT_CHARS) + 1;
    const blocks = Array.from({ length: count }, (_, i) => `=== p. ${i + 1} ===\n${each}\n`);
    expect(() => parseBookExcerpts(`${FRONT}\n${blocks.join("\n")}`)).toThrow(/whole book/i);
  });
});

describe("bookSource", () => {
  const { meta, excerpts } = parseBookExcerpts(TWO);
  const source = bookSource(meta, excerpts.length);

  it("files a purchased book as private authorised material awaiting review", () => {
    expect(source).toMatchObject({
      source_key: "example-book",
      title: "Example Book",
      publisher: "Example Press",
      creator: "Jane Roe and John Doe",
      source_url: "https://example.com/book",
      authority_tier: "tier_b_authorized_course",
      rights_status: "authorized_private",
      operational_status: "pending_review",
      citation_required: true,
    });
  });

  it("says in its own summary that the full text is not held", () => {
    expect(source.governed_summary).toMatch(/2 passages/);
    expect(source.governed_summary).toMatch(/full text is not held/i);
  });

  it("carries the file's own note, so a summary is never passed off as the book's words", () => {
    const withNote = parseBookExcerpts(
      TWO.replace(
        "url: https://example.com/book",
        "url: https://example.com/book\nnote: A summary, not the authors' words."
      )
    );
    expect(withNote.meta.note).toBe("A summary, not the authors' words.");
    const s = bookSource(withNote.meta, withNote.excerpts.length);
    expect(s.governed_summary).toMatch(/A summary, not the authors' words\./);
    expect(s.source_metadata.note).toBe("A summary, not the authors' words.");
    // and a file with no note adds nothing
    expect(source.governed_summary).not.toMatch(/summary, not/);
  });
});

describe("bookChunkPayloads", () => {
  const { meta, excerpts } = parseBookExcerpts(TWO);
  const chunks = bookChunkPayloads(meta, excerpts);

  it("gives every passage a stable, unique key and a dense ordinal", () => {
    expect(chunks.map(c => c.chunk_key)).toEqual(["example-book-e001", "example-book-e002"]);
    expect(chunks.map(c => c.ordinal)).toEqual([1, 2]);
  });

  it("keeps the pasted text exactly", () => {
    expect(chunks[0].body).toBe("Agar sets firm at room temperature.\n\nUse less than you think.");
  });

  it("writes a locator that migration 124's `citable` rule counts", () => {
    // page_text_only + a non-empty page_reference + a non-empty source_url.
    // Change this only together with db/migrations/124 and `citationFor`.
    for (const chunk of chunks) {
      expect(chunk.locator.retrieval_type).toBe("page_text_only");
      expect(String(chunk.locator.page_reference)).not.toBe("");
      expect(String(chunk.locator.source_url)).not.toBe("");
      expect(chunk.locator.medium).toBe("book_excerpt");
    }
  });

  it("carries no lesson_id, so course coverage never counts a book as a lesson", () => {
    for (const chunk of chunks) expect(chunk.locator).not.toHaveProperty("lesson_id");
  });
});
