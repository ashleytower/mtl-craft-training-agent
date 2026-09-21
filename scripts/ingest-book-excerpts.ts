/**
 * Load the passages the owner pasted from a book the business bought.
 *
 * Run:
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/ingest-book-excerpts.ts [file] [--dry-run]
 *
 * `file` defaults to ~/Desktop/Solid Wiggles/excerpts.md. Read the header of
 * server/knowledgeBookExcerpts.ts for the file format and for why the size limits
 * exist. Idempotent: the source upserts by `source_key` and each passage by its
 * positional key, and neither overwrites `rights_status`, `operational_status` or
 * `review_status`, exactly as scripts/ingest-knowledge.ts.
 *
 * The excerpt file is NOT in git. It holds text from a book the business does not
 * own the copyright to.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  bookChunkPayloads,
  bookSource,
  parseBookExcerpts,
} from "../server/knowledgeBookExcerpts";
import { sourceEmbeddingText } from "../server/knowledgeCorpus";
import { embedToLiteral, embeddingConfig } from "../server/knowledgeEmbedding";
import * as beverage from "../server/beverageClient";
import type { OperatorIdentity } from "../server/_core/supabaseAuth";

const DEFAULT_FILE = join(homedir(), "Desktop", "Solid Wiggles", "excerpts.md");

/**
 * Same rule as scripts/ingest-knowledge.ts, restated because that file runs its
 * `main()` on import. Writing reference material is an operator action, so it is
 * filed as the owner, from a browser origin, never as the agent.
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
    origin: "browser",
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const file = process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? DEFAULT_FILE;

  const { meta, excerpts } = parseBookExcerpts(readFileSync(file, "utf8"));
  const characters = excerpts.reduce((sum, e) => sum + e.body.length, 0);
  console.log(`${meta.title}: ${excerpts.length} passages, ${characters} characters (${file})`);

  if (excerpts.length === 0) {
    console.log("Nothing to ingest: the file holds no passages yet.");
    return;
  }

  const source = bookSource(meta, excerpts.length);
  const chunks = bookChunkPayloads(meta, excerpts);

  if (dryRun) {
    console.log(JSON.stringify({ source, firstLocator: chunks[0].locator }, null, 2));
    console.log("--dry-run: nothing written");
    return;
  }

  const identity = ownerIdentity();
  const config = embeddingConfig();

  const sourceResult = await beverage.ingestKnowledgeSources(identity, [
    { ...source, embedding: await embedToLiteral(sourceEmbeddingText(source), config) },
  ]);
  console.log(`source: ${sourceResult.inserted} inserted, ${sourceResult.updated} updated`);

  const withEmbeddings = [];
  for (const chunk of chunks) {
    withEmbeddings.push({ ...chunk, embedding: await embedToLiteral(chunk.body, config) });
  }
  const result = await beverage.ingestKnowledgeChunks(identity, {
    sourceKey: source.source_key,
    chunks: withEmbeddings,
  });
  console.log(`${source.source_key}: ${result.chunks} passages, ${result.embedded} embedded`);
  if (result.embedded < result.chunks) {
    console.log(
      `  ${result.chunks - result.embedded} passages have no embedding. They are still found by ` +
        `full text. Re-run once ${config.baseUrl} is reachable to fill them in.`
    );
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
