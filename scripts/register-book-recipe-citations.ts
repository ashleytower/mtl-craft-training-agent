/**
 * Register a citation-only source for a book recipe that has already been
 * dictated into an approved Brix formula, so `solid-wiggles` can say which
 * book and formula a recipe came from without holding any of the book's text.
 *
 * Run:
 *   PATH=/usr/local/bin:$PATH npx tsx scripts/register-book-recipe-citations.ts [--dry-run]
 *
 * Writes only `beverage.knowledge_sources`, never a chunk — see the header of
 * `recipeCitationSource` in server/knowledgeBookExcerpts.ts for why. Idempotent,
 * same identity rule as scripts/ingest-book-excerpts.ts: writes as the owner.
 *
 * RECIPES is the record of what has been registered. Add a formula here only
 * after it is confirmed and approved (`scripts/ingest-book-excerpts.ts`-style
 * dictation), and write `description` as a plain restatement of its ingredient
 * list — never a sentence from the book.
 */
import { recipeCitationSource, type BookMeta, type RecipeCitation } from "../server/knowledgeBookExcerpts";
import { sourceEmbeddingText } from "../server/knowledgeCorpus";
import { embedToLiteral, embeddingConfig } from "../server/knowledgeEmbedding";
import * as beverage from "../server/beverageClient";
import type { OperatorIdentity } from "../server/_core/supabaseAuth";

const BOOK: BookMeta = {
  source_key: "solid-wiggles",
  title: "Solid Wiggles: Recipes and Techniques for Phenomenal Jelly Shots and Cakes",
  creator: "Jena Derman and Jack Schramm",
  publisher: "Ten Speed Press",
  year: "2026",
  isbn: "978-0593838150",
  url: "https://www.amazon.ca/dp/B0FSCNVCG2",
  note: null,
};

const RECIPES: RecipeCitation[] = [
  {
    source_key: "solid-wiggles-recipe-amaretto-carciofo-sour",
    recipeTitle: "Amaretto + Carciofo Sour",
    description:
      "A jelly-shot recipe combining orange juice, water, Faccia Brutto Carciofo, amaretto, lemon " +
      "juice, sugar, citric acid and silver sheet gelatin.",
    formulaKey: "amaretto-carciofo-sour",
  },
  {
    source_key: "solid-wiggles-recipe-arnold-palmer",
    recipeTitle: "Arnold Palmer (Non-Alc)",
    description:
      "A jelly-shot recipe combining lemon juice, unsweetened black tea, water, sugar and silver " +
      "sheet gelatin, with a noted variant that swaps in vodka.",
    formulaKey: "arnold-palmer-non-alc",
  },
  {
    source_key: "solid-wiggles-recipe-cherry-lime-rickey",
    recipeTitle: "Cherry Lime Rickey (Non-Alc)",
    description:
      "A jelly-shot recipe combining lime juice, water, tart cherry juice, sugar and silver sheet " +
      "gelatin.",
    formulaKey: "cherry-lime-rickey-non-alc",
  },
  {
    source_key: "solid-wiggles-recipe-gin-tonic",
    recipeTitle: "Gin + Tonic",
    description:
      "A jelly-shot recipe combining tonic water, lime juice, gin, sugar and silver sheet gelatin.",
    formulaKey: "gin-tonic",
  },
];

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
  const sources = RECIPES.map(recipe => recipeCitationSource(BOOK, recipe));

  console.log(`${sources.length} recipe citations, 0 chunks (citation-only by design)`);
  if (dryRun) {
    console.log(JSON.stringify(sources[0], null, 2));
    console.log("--dry-run: nothing written");
    return;
  }

  const identity = ownerIdentity();
  const config = embeddingConfig();
  const withEmbeddings = [];
  for (const source of sources) {
    withEmbeddings.push({
      ...source,
      embedding: await embedToLiteral(sourceEmbeddingText(source), config),
    });
  }
  const result = await beverage.ingestKnowledgeSources(identity, withEmbeddings);
  console.log(`sources: ${result.inserted} inserted, ${result.updated} updated`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
