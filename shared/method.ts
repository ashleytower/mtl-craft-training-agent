/**
 * Preparation method, parsed out of the freeform text the Notion intake carried.
 *
 * This is a PREFILL, never a source of truth. The operator sees the parsed steps
 * in the normalize dialog and edits them before the version is created, and the
 * steps they confirm are what gets stored. Parsing at read time instead would
 * mean a change to this file silently rewrites the procedure attached to an
 * already-approved formula, which is exactly the kind of thing an approval is
 * supposed to prevent.
 *
 * Only cocktails carry method text — the Notion syrup collection is an inventory
 * and costing table (yield, bags, bottles, labour hours, selling price) with no
 * procedure in it at all. For a syrup this returns nothing and the operator
 * types the method in. That is the intended path, not a failure.
 */

export type MethodStep = {
  /** The heading this step sits under ("TO BATCH"), or null when there is none. */
  section: string | null;
  text: string;
};

/**
 * A heading labels the steps beneath it: "TO BATCH", "TO SERVE".
 *
 * The hard case is a one-word instruction — "GARNISH." is upper case and alone
 * on its line, but it is a step. The period is what separates them: headings in
 * this corpus never end in one. A heading also has to be followed by something,
 * which is checked by the caller.
 */
function isSectionHeading(line: string): boolean {
  if (line.length > 40) return false;
  if (/[.:;!?]$/.test(line)) return false;
  return /^[A-Z][A-Z\s&/-]*$/.test(line);
}

const NUMBERED = /^\s*\d+\s*[.)]\s*/;

/**
 * Some sources run the whole method together on one line:
 *   "RIM half the glass. ADD all ingredients. SHAKE for 15 seconds."
 *
 * A sentence boundary starts a new step. Two variants, because the corpus has
 * both:
 *
 *   - ". " then any capital. Covers the methods written in sentence case
 *     ("... hard shake. Strain into a coupe glass."), which have no upper-case
 *     verbs to key on. The required whitespace is what keeps "1.5 oz" intact.
 *   - "." then an upper-case word, no space at all — "STRAIN into glass.GARNISH"
 *     is real and appears twice. Requiring two or more capitals here keeps the
 *     rule off abbreviations, since without the space there is nothing else to
 *     tell them apart.
 *
 * Neither fires on "For mocktails : Replace ... with water." — a colon is not a
 * sentence boundary. A run with no punctuation at all ("and stir ADD more ice")
 * is deliberately left whole: splitting it would be a guess, and this is a
 * prefill the operator corrects.
 */
function splitVerbLedRun(line: string): string[] {
  return line
    .split(/(?<=[.!?])(?:\s+(?=[A-Z])|(?=[A-Z]{2,}\b))/)
    .map(part => part.trim())
    .filter(Boolean);
}

export function parseMethodDraft(raw: string | null | undefined): MethodStep[] {
  if (!raw || !raw.trim()) return [];

  const steps: MethodStep[] = [];
  let section: string | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const numbered = NUMBERED.test(line);
    if (!numbered && isSectionHeading(line)) {
      section = line;
      continue;
    }

    // A numbered step keeps its text verbatim; the numbering is ours to redo,
    // because steps get renumbered whenever the operator reorders them.
    if (numbered) {
      const text = line.replace(NUMBERED, "").trim();
      if (text) steps.push({ section, text });
      continue;
    }

    for (const text of splitVerbLedRun(line)) {
      steps.push({ section, text });
    }
  }

  return steps;
}

/**
 * Render steps back to numbered lines for display and for the agent to read
 * aloud. Numbering restarts under each heading, which is how a bartender reads
 * "TO BATCH 1, 2, 3 / TO SERVE 1, 2, 3".
 */
export function methodToLines(steps: MethodStep[]): string[] {
  const lines: string[] = [];
  let section: string | null = null;
  let n = 0;

  for (const step of steps) {
    if (step.section !== section) {
      section = step.section;
      n = 0;
      if (section) lines.push(section);
    }
    n += 1;
    lines.push(`${n}. ${step.text}`);
  }

  return lines;
}

/** `process_json` as the database stores it. See migration 110 for the contract. */
export type StoredMethod = {
  source?: "operator" | "notion_draft" | null;
  steps?: MethodStep[] | null;
  raw?: string | null;
} | null | undefined;

export type AgentMethod = {
  recorded: boolean;
  /** True only when a person confirmed these steps at normalize time. */
  reviewed: boolean;
  source: "operator" | "notion_draft" | null;
  steps: string[];
  /** A sentence the agent can say verbatim, or null when the steps speak for themselves. */
  note: string | null;
};

const NOT_RECORDED =
  "No preparation method has been recorded for this formula.";
const NOT_REVIEWED =
  "This is the original text from the recipe intake and has not been reviewed or approved.";

/**
 * Turn stored method into something an agent can read out without deciding
 * anything. The agent must never fill a gap from general cocktail knowledge and
 * present it as house practice, so the empty case returns a finished sentence
 * rather than an empty list it might feel obliged to improve on.
 *
 * The untouched value is `{}`, not null — process_json is NOT NULL with default
 * '{}'::jsonb — so an empty object has to read as "nothing recorded" here too.
 */
export function methodForAgent(stored: StoredMethod): AgentMethod {
  const steps = Array.isArray(stored?.steps) ? stored.steps : [];
  const raw = stored?.raw?.trim() ? stored.raw : null;

  if (steps.length > 0) {
    return {
      recorded: true,
      reviewed: stored?.source === "operator",
      source: stored?.source ?? null,
      steps: methodToLines(steps),
      note: stored?.source === "operator" ? null : NOT_REVIEWED,
    };
  }

  if (raw) {
    // Nobody confirmed these, so they are parsed for readability only and the
    // note says so. Parsing here is safe precisely because it is unreviewed
    // text — there is no approved procedure to alter.
    return {
      recorded: true,
      reviewed: false,
      source: stored?.source ?? "notion_draft",
      steps: methodToLines(parseMethodDraft(raw)),
      note: NOT_REVIEWED,
    };
  }

  return {
    recorded: false,
    reviewed: false,
    source: null,
    steps: [],
    note: NOT_RECORDED,
  };
}
