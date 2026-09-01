import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { extractLessonPage } from "./knowledgeLessonPages";

/**
 * The two halves of the transcription pipeline live in different languages and
 * different files, and they share one list by hand.
 *
 * `collect-lesson-transcripts.sh` biases the Whisper decoder toward a list of
 * course terms. `verify-transcript-terms.py` then checks every occurrence of
 * those terms against the course's own written material and, for a sample,
 * against the unprimed audio.
 *
 * A term present in the first list and missing from the second is biased into
 * the transcripts and never checked — the exact hole the verification exists to
 * close, opened silently by editing one file. There is no import to keep them
 * honest across a shell script and a Python script, so the invariant is a test.
 */
const REPO = resolve(import.meta.dirname, "..");

function biasedTerms(): string[] {
  const sh = readFileSync(resolve(REPO, "scripts/collect-lesson-transcripts.sh"), "utf8");
  const match = sh.match(/PRIME="Flavour and beverage development course\. Terms: ([\s\S]*?)\."/);
  if (!match) throw new Error("PRIME vocabulary not found in collect-lesson-transcripts.sh");
  return match[1].split(",").map(t => t.trim()).filter(Boolean);
}

function verifiedTerms(): string[] {
  const py = readFileSync(resolve(REPO, "scripts/verify-transcript-terms.py"), "utf8");
  const match = py.match(/^TERMS = \[([\s\S]*?)\]/m);
  if (!match) throw new Error("TERMS list not found in verify-transcript-terms.py");
  return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

describe("transcription pipeline vocabulary", () => {
  it("verifies every term it biases the decoder toward", () => {
    const biased = biasedTerms();
    const verified = new Set(verifiedTerms());
    const unchecked = biased.filter(term => !verified.has(term));
    expect(unchecked).toEqual([]);
  });

  it("does not claim to verify a term it never biased", () => {
    // Harmless, but it means the verifier's coverage report counts a term the
    // prompt could not have introduced, overstating what was checked.
    const biased = new Set(biasedTerms());
    expect(verifiedTerms().filter(term => !biased.has(term))).toEqual([]);
  });

  it("actually found a non-trivial vocabulary in both files", () => {
    // Guards the regexes above: if either stopped matching, both lists would be
    // empty and the two tests above would pass vacuously.
    expect(biasedTerms().length).toBeGreaterThan(20);
    expect(verifiedTerms().length).toBeGreaterThan(20);
  });

  it("biases only toward terms attested in the course's own material", () => {
    // The rule for this corpus: bias may nudge spelling toward vocabulary the
    // course itself uses. It may not introduce a word from nowhere. Every term
    // must appear in the Jargon File or in a saved lesson page.
    //
    // Skipped when the corpus files are absent — they are gitignored Tier B
    // material, so CI and a fresh clone legitimately do not have them.
    let pages: string[];
    try {
      const dir = resolve(REPO, "data/knowledge/batch1/authorized_lesson_pages");
      pages = readdirSync(dir)
        .filter(f => f.endsWith(".html"))
        // The real extractor, not a second crude one. Stripping every tag to a
        // space turns `CO<sub>2</sub>` into "CO 2", so a search for CO2 finds
        // nothing and the term looks unattested — which is precisely the
        // corruption extractLessonPage was written to avoid.
        .map(f => {
          const id = f.replace(/^lesson_|\.html$/g, "");
          return extractLessonPage(readFileSync(resolve(dir, f), "utf8"), id)
            .blocks.map(b => b.text)
            .join("\n");
        });
    } catch {
      return;
    }
    expect(pages.length).toBeGreaterThan(0);

    const unattested = biasedTerms().filter(term => {
      const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      return !pages.some(page => pattern.test(page));
    });
    expect(unattested).toEqual([]);
  });
});
