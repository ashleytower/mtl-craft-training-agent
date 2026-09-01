import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { extractLessonPage } from "./knowledgeLessonPages";
import { GLOSSARY_TERMS } from "./knowledgeGlossary";

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

/** The acronyms the Python matches case-sensitively, because their lowercase
 *  form is an ordinary word or fragment. */
function caseSensitiveTerms(): Set<string> {
  const py = readFileSync(resolve(REPO, "scripts/verify-transcript-terms.py"), "utf8");
  const match = py.match(/^CASE_SENSITIVE = \{([\s\S]*?)\}/m);
  if (!match) throw new Error("CASE_SENSITIVE set not found in verify-transcript-terms.py");
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
}

describe("transcription pipeline vocabulary", () => {
  it("verifies every term it biases the decoder toward", () => {
    const biased = biasedTerms();
    const verified = new Set(verifiedTerms());
    const unchecked = biased.filter(term => !verified.has(term));
    expect(unchecked).toEqual([]);
  });

  it("keeps all THREE copies of the vocabulary in step", () => {
    // The list lives in a shell script (what primes Whisper), a Python script
    // (what verifies the result) and a TypeScript module (what the echo
    // detector counts against). Three runtimes, no shared import.
    //
    // Drift is not cosmetic: a term missing from the Python is biased in and
    // never checked, and a term missing from the TypeScript is invisible to
    // isPromptEcho, which counts distinct glossary terms to catch a recitation
    // that resumes mid-list.
    expect([...GLOSSARY_TERMS]).toEqual(biasedTerms());
    expect([...GLOSSARY_TERMS]).toEqual(verifiedTerms());
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

  it("captures the PRIME list to its real end, not to an embedded full stop", () => {
    // `biasedTerms` captures non-greedily up to the first `.` after "Terms:".
    // No term contains a period today, so it reaches the closing quote — but
    // adding one ("U.S.P.", an "e.g." aside) would silently truncate the list.
    // A length floor cannot catch that: 25 of 41 terms still clears it, and the
    // sync tests would then report "in sync" while 16 terms went unchecked.
    //
    // So compare against the raw PRIME line: every quoted term must survive.
    const sh = readFileSync(resolve(REPO, "scripts/collect-lesson-transcripts.sh"), "utf8");
    const line = sh.match(/^PRIME="([\s\S]*?)"$/m);
    expect(line).not.toBeNull();
    const commasInFullLine = (line![1].match(/,/g) ?? []).length;
    // n comma-separated terms produce n-1 commas.
    expect(biasedTerms().length).toBe(commasInFullLine + 1);
  });

  it("biases only toward terms attested in the course's own material", () => {
    // The rule for this corpus: bias may nudge spelling toward vocabulary the
    // course itself uses. It may not introduce a word from nowhere. Every term
    // must appear in the Jargon File or in a saved lesson page.
    //
    // The corpus is gitignored Tier B material, so CI and a fresh clone
    // legitimately do not have it. Earlier this swallowed the absence with a
    // bare `return` inside a try/catch, which meant the test reported PASS
    // while checking nothing — a green CI run implied this invariant held when
    // it had never been evaluated. Now the skip is explicit and visible.
    const dir = resolve(REPO, "data/knowledge/batch1/authorized_lesson_pages");
    if (!existsSync(dir)) {
      console.warn(
        `SKIPPED: ${dir} is absent (gitignored corpus). The "biased terms are ` +
          `attested" invariant was NOT checked in this run.`
      );
      return;
    }
    let pages: string[];
    try {
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
    } catch (error) {
      throw new Error(`corpus present but unreadable: ${String(error)}`);
    }
    expect(pages.length).toBeGreaterThan(0);

    // Matched exactly as verify-transcript-terms.py matches at runtime:
    // case-SENSITIVE for the acronyms whose lowercase form is an ordinary word.
    // Testing every term case-insensitively checked a weaker predicate than the
    // code it is meant to keep honest — "GRAS" would count as attested because
    // some lesson contains the French "gras", while the Python, matching
    // case-sensitively, would find nothing and correctly call it unattested.
    const caseSensitive = caseSensitiveTerms();
    const unattested = biasedTerms().filter(term => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, caseSensitive.has(term) ? "" : "i");
      return !pages.some(page => pattern.test(page));
    });
    expect(unattested).toEqual([]);
  });

  it("scopes attestation to the lesson body, not the whole saved page", () => {
    // A saved page is ~344,000 characters of which ~4,100 are the lesson. The
    // rest includes a curriculum sidebar listing every lesson title in the
    // course, on every page — so searching the raw file finds "Tincture",
    // "HLB" and "Terpenes" everywhere, as navigation labels.
    //
    // The Python must scope with the same two markers the TypeScript extractor
    // uses. If it drifts back to scanning raw HTML, attestation becomes nearly
    // unfalsifiable and this test is what says so.
    const py = readFileSync(resolve(REPO, "scripts/verify-transcript-terms.py"), "utf8");
    const ts = readFileSync(resolve(REPO, "server/knowledgeLessonPages.ts"), "utf8");
    const bodyStart = ts.match(/const BODY_START = ('[^']+'|"[^"]+");/)![1].slice(1, -1);
    const bodyEnd = ts.match(/const BODY_END = ("[^"]+"|'[^']+');/)![1].slice(1, -1);
    expect(py).toContain(bodyStart);
    expect(py).toContain(bodyEnd);
  });
});

describe("audio_verdict (verify-transcript-terms.py)", () => {
  it("passes its own self-test", () => {
    // The classifier that decides confirmed/variant/absent lives in Python and
    // had no test harness at all, which is exactly why it shipped three
    // defects that each produced FALSE CONFIRMATIONS: it fuzzy-matched on the
    // first word of a multi-word term ("process" confirming "process
    // authority"), gave short acronyms a fuzzy pass where edit-ratio is noise
    // ("tea" scoring 0.80 against "TA"), and lowercased its way around
    // CASE_SENSITIVE.
    //
    // Running its self-test from here puts those cases inside the same gate as
    // the TypeScript, so the Python cannot regress unnoticed.
    const script = resolve(REPO, "scripts/verify-transcript-terms.py");
    const out = execFileSync("python3", [script, "--self-test"], { encoding: "utf8" });
    expect(out).toMatch(/self-test: \d+ cases pass/);
  });
});
