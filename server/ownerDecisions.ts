/**
 * The one route where Brix acts with Ashley's authority instead of its own.
 *
 * WHY THIS IS ALLOWED AT ALL
 *
 * Her rule is that nothing gets approved AUTOMATICALLY. Her saying "keep that
 * one" is not automatic; it is her deciding, in the only chat Brix can hear.
 * The gateway's `allowed_chats` holds exactly one id — her DM — so a message
 * reaching Brix came from her. Refusing to act on it does not make the system
 * safer, it makes the agent useless, which was her point.
 *
 * WHY IT IS ITS OWN FILE
 *
 * hermesRoutes.ts is provably read-only apart from queueing a proposal, and
 * knowledgeBoundary.test.ts keeps it that way by naming every call it may make.
 * Putting an escalation in there would have meant loosening that guard for the
 * whole surface. This file is small on purpose: it is the entire blast radius,
 * and ownerDecisions.test.ts asserts it cannot reach a formula.
 *
 * WHAT HER YES CAN AND CANNOT DO
 *
 * It can disposition a research candidate — a citation and a short summary that
 * becomes a `reference_only`, never-quotable source. Such a source can explain
 * technique. It cannot supply or change a measurement.
 *
 * It cannot approve a formula version. Not because Telegram is untrustworthy,
 * but because a formula version is what somebody measures at the bar, and that
 * deserves seeing the whole component list rather than answering "yes" to a
 * sentence. If she wants that too it is a deliberate build with a confirmation
 * step, not an extension of this one.
 */
import type { Express, Request, Response } from "express";
import * as beverage from "./beverageClient";
import { hermesIdentityFromRequest } from "./_core/hermesService";
import { embedToLiteral } from "./knowledgeEmbedding";
import type { OperatorIdentity } from "./_core/supabaseAuth";

/** The database's three dispositions. Nothing else is a disposition. */
const DISPOSITIONS = ["ingest_as_reference", "saved_research_only", "discarded"] as const;
type Disposition = (typeof DISPOSITIONS)[number];

/**
 * Long enough to be a reason. "ok" records that somebody clicked; the point of
 * the rationale is that the audit row says what she actually told it.
 */
const MIN_RATIONALE = 6;

export type ParsedDecision = {
  candidateId: string;
  decision: Disposition;
  rationale: string;
  error: string | null;
};

const bad = (error: string): ParsedDecision => ({
  candidateId: "", decision: "discarded", rationale: "", error,
});

export function parseDecision(input: unknown): ParsedDecision {
  const raw = (input ?? {}) as Record<string, unknown>;
  const candidateId = typeof raw.candidate_id === "string" ? raw.candidate_id.trim() : "";
  if (!candidateId) return bad("candidate_id is required — name the one she decided on");

  const decision = typeof raw.decision === "string" ? raw.decision.trim() : "";
  if (!DISPOSITIONS.includes(decision as Disposition)) {
    return bad(`decision must be one of the dispositions: ${DISPOSITIONS.join(", ")}`);
  }

  const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
  if (rationale.length < MIN_RATIONALE) {
    return bad("rationale is required — record what she actually said");
  }
  return { candidateId, decision: decision as Disposition, rationale, error: null };
}

/**
 * The owner, from the server's own configuration.
 *
 * Never from the request. The subject IS the authorisation, so if it could be
 * read off a body then anything able to reach this route could name itself
 * owner. An unset list means nobody is an owner and this route does nothing —
 * it never falls back to a default.
 */
export function ownerForDecision(env: NodeJS.ProcessEnv = process.env): OperatorIdentity | null {
  const subject = (env.BEVERAGE_OWNER_SUBJECTS ?? "").split(",")[0]?.trim();
  if (!subject) return null;
  return {
    subject,
    email: null,
    displayName: env.BEVERAGE_OWNER_DISPLAY_NAME ?? "MTL Craft owner",
    origin: "browser",
  };
}

export function registerOwnerDecisionRoutes(app: Express): void {
  app.post("/api/hermes/research/decide", async (req: Request, res: Response) => {
    // Still the agent's own token: this proves the request came through Brix,
    // and Brix only ever hears from her chat.
    if (!hermesIdentityFromRequest(req)) {
      res.status(401).json({ error: "hermes service token required" });
      return;
    }
    const owner = ownerForDecision();
    if (!owner) {
      res.status(503).json({ error: "no owner configured; nothing can be decided" });
      return;
    }
    const parsed = parseDecision(req.body);
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const result = await beverage.decideResearchCandidate(owner, {
        candidateId: parsed.candidateId,
        decision: parsed.decision,
        rationale: parsed.rationale,
      });
      // A kept source starts with no embedding, and an unembedded source is one
      // hybrid search ranks badly or not at all — the exact failure that made
      // thirteen Kevin Kos summaries look like they had never been ingested. So
      // it is embedded here rather than waiting for somebody to remember the
      // backfill.
      //
      // The text comes from `knowledgeSourcesPendingEmbedding`, which is the
      // same list the backfill reads, so there is no second copy of the
      // embed-text rule to drift out of sync with the RPC.
      //
      // Non-fatal on purpose: her decision is already recorded, and an
      // unembedded source is still picked up by the backfill later. Reporting it
      // beats failing a decision that succeeded.
      let searchable = false;
      let embedNote = "";
      if (result.source_id) {
        try {
          const sourceKey = `research-${parsed.candidateId.replace(/-/g, "")}`;
          const pending = await beverage.knowledgeSourcesPendingEmbedding(owner);
          const row = pending.find(p => p.source_key === sourceKey);
          if (row) {
            const vector = await embedToLiteral(row.embed_text);
            if (vector) {
              await beverage.setSourceEmbedding(owner, { sourceKey, embedding: vector });
              searchable = true;
            }
          }
        } catch {
          searchable = false;
        }
        if (!searchable) {
          embedNote =
            " Kept, but not embedded — the embedding service was unreachable, so it" +
            " will not rank in search until the backfill runs.";
        }
      }

      res.json({
        ...result,
        searchable,
        note:
          "Recorded against the owner, with the rationale as given. A kept source " +
          "is reference_only and never quotable — it explains technique and supplies " +
          "no measurement." + embedNote,
      });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "could not record the decision",
      });
    }
  });
}
