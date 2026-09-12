import { describe, expect, it } from "vitest";
import { parseResearchCandidates, MAX_CANDIDATES } from "./researchCandidates";

const ok = { title: "Super Juice Calculator", source_url: "https://www.kevinkos.com/x" };

describe("parseResearchCandidates", () => {
  it("accepts a title and an https url", () => {
    const parsed = parseResearchCandidates([ok]);
    expect(parsed.error).toBeNull();
    expect(parsed.candidates).toEqual([
      { title: "Super Juice Calculator", source_url: "https://www.kevinkos.com/x", governed_summary: "" },
    ]);
  });

  it("refuses a candidate with no title or no url", () => {
    expect(parseResearchCandidates([{ source_url: "https://x.com" }]).error).toMatch(/title/i);
    expect(parseResearchCandidates([{ title: "x" }]).error).toMatch(/url/i);
    expect(parseResearchCandidates([{ title: "   ", source_url: "https://x.com" }]).error).toMatch(/title/i);
  });

  // Brix builds these from pages it just read. A page it read is not a
  // trustworthy instruction source, so the scheme is restricted here rather
  // than trusted to be sane: a javascript: or data: "citation" is not a
  // citation, and Ashley is meant to be able to click every one of these.
  it("accepts only http and https", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "file:///etc/passwd",
      "ftp://example.com/x",
      "not a url at all",
    ]) {
      expect(parseResearchCandidates([{ title: "x", source_url: bad }]).error).toMatch(/http/i);
    }
    expect(parseResearchCandidates([{ title: "x", source_url: "http://example.com" }]).error).toBeNull();
  });

  it("refuses anything that is not a non-empty array", () => {
    expect(parseResearchCandidates([]).error).toMatch(/at least one/i);
    expect(parseResearchCandidates("nope").error).toMatch(/array/i);
    expect(parseResearchCandidates(null).error).toMatch(/array/i);
    expect(parseResearchCandidates([{ title: "x", source_url: "https://x.com" }, "junk"]).error)
      .toMatch(/object/i);
  });

  // A bounded queue is a reviewable queue. Without a cap one question could
  // bury the approval list under a hundred rows nobody reads.
  it("refuses more candidates than a person will review", () => {
    const many = Array.from({ length: MAX_CANDIDATES + 1 }, () => ok);
    expect(parseResearchCandidates(many).error).toMatch(new RegExp(String(MAX_CANDIDATES)));
    expect(parseResearchCandidates(many.slice(0, MAX_CANDIDATES)).error).toBeNull();
  });

  it("keeps the summary but trims it, and never invents one", () => {
    const long = "x".repeat(2000);
    const parsed = parseResearchCandidates([{ ...ok, governed_summary: long }]);
    expect(parsed.candidates[0].governed_summary.length).toBe(1000);
    // No summary supplied stays empty rather than being filled in from the title.
    expect(parseResearchCandidates([ok]).candidates[0].governed_summary).toBe("");
  });

  it("strips surrounding whitespace so a padded title is not a different title", () => {
    const parsed = parseResearchCandidates([{ title: "  Clear Ice  ", source_url: " https://x.com/a " }]);
    expect(parsed.candidates[0]).toMatchObject({ title: "Clear Ice", source_url: "https://x.com/a" });
  });
});
