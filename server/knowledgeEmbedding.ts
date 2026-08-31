/**
 * Embeddings, from the model that is already on this machine.
 *
 * `public.memory` in this same database has run hybrid search on
 * `vector(768)` for months, and `nomic-embed-text` — 768 dimensions — is
 * already pulled into the local Ollama. So this adds no API key, no vendor and
 * no per-call cost: it reuses the pattern and the model that were both already
 * here. The CRM's memory CONTENT stays where it is; only the mechanism is
 * shared.
 *
 * Every function here returns null rather than throwing when the service is
 * down. That is the important design decision: full-text search over the
 * corpus works with no embedding at all, so a stopped Ollama must degrade
 * retrieval, never break it. What it must not do is degrade silently — the
 * caller reports which mode actually ran.
 */

/** Ollama's default local port. Overridable for a different host. */
const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "nomic-embed-text";

export const EMBEDDING_DIMENSIONS = 768;

export type EmbeddingConfig = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

export function embeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig {
  return {
    baseUrl: (env.BEVERAGE_EMBEDDING_URL ?? DEFAULT_URL).replace(/\/$/, ""),
    model: env.BEVERAGE_EMBEDDING_MODEL ?? DEFAULT_MODEL,
    timeoutMs: Number.parseInt(env.BEVERAGE_EMBEDDING_TIMEOUT_MS ?? "20000", 10),
  };
}

/**
 * pgvector's text input format: `[0.1,0.2,...]`. The RPC takes the vector as
 * text and casts it, because PostgREST has no JSON representation for a vector
 * and an array of 768 floats round-trips through JSON exactly.
 */
export function toVectorLiteral(values: number[]): string {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${values.length}. ` +
        `The column is vector(${EMBEDDING_DIMENSIONS}); a different model needs a migration, not a cast.`
    );
  }
  return `[${values.join(",")}]`;
}

/**
 * One embedding, or null if the service is unreachable or answered with
 * something unusable. Never throws on a network fault — see the file comment.
 */
export async function embed(
  text: string,
  config: EmbeddingConfig = embeddingConfig()
): Promise<number[] | null> {
  if (!text.trim()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, prompt: text }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { embedding?: unknown };
    const values = payload.embedding;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) return null;
    if (!values.every(value => typeof value === "number" && Number.isFinite(value))) {
      return null;
    }
    return values as number[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `embed`, already in pgvector's literal form. Null propagates. */
export async function embedToLiteral(
  text: string,
  config: EmbeddingConfig = embeddingConfig()
): Promise<string | null> {
  const values = await embed(text, config);
  return values ? toVectorLiteral(values) : null;
}
