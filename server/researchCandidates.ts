/**
 * Validation for the one thing the agent surface is allowed to write.
 *
 * Brix may propose a citation it found while answering a question. It may not
 * approve one: `beverage_decide_research_candidate` requires the owner or
 * approver role and the Hermes subject is an `operator`, so the database
 * refuses. A proposal is a queue entry with Ashley's name on the decision.
 *
 * What is checked here is what cannot be checked later. These rows are built
 * from pages Brix has just read, and a page it read is data, never an
 * instruction — so the URL scheme is constrained rather than trusted, the list
 * is bounded so one question cannot bury the queue, and a missing summary stays
 * missing instead of being filled in from the title.
 */

/** As many as a person will actually read in one sitting. */
export const MAX_CANDIDATES = 8;

/** The RPC truncates to 1000; doing it here too keeps the stored value predictable. */
const MAX_SUMMARY = 1000;

export type ResearchCandidate = {
  title: string;
  source_url: string;
  governed_summary: string;
};

export type ParsedCandidates = {
  candidates: ResearchCandidate[];
  error: string | null;
};

function refuse(error: string): ParsedCandidates {
  return { candidates: [], error };
}

/**
 * http and https only. A `javascript:` or `data:` "citation" is not a citation,
 * and every row in this queue is meant to be something Ashley can click and read
 * for herself before she decides.
 */
function isFetchableUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export function parseResearchCandidates(input: unknown): ParsedCandidates {
  if (!Array.isArray(input)) return refuse("candidates must be an array");
  if (input.length === 0) return refuse("at least one candidate is required");
  if (input.length > MAX_CANDIDATES) {
    return refuse(`at most ${MAX_CANDIDATES} candidates per question`);
  }

  const candidates: ResearchCandidate[] = [];
  for (const row of input) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return refuse("each candidate must be an object");
    }
    const raw = row as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const url = typeof raw.source_url === "string" ? raw.source_url.trim() : "";
    if (!title) return refuse("each candidate needs a title");
    if (!url) return refuse("each candidate needs a source_url");
    if (!isFetchableUrl(url)) {
      return refuse(`source_url must be an http or https address: ${url}`);
    }
    const summary = typeof raw.governed_summary === "string" ? raw.governed_summary.trim() : "";
    candidates.push({
      title,
      source_url: url,
      governed_summary: summary.slice(0, MAX_SUMMARY),
    });
  }
  return { candidates, error: null };
}
