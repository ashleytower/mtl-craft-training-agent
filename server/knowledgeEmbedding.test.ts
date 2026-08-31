import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  embed,
  embedToLiteral,
  embeddingConfig,
  toVectorLiteral,
} from "./knowledgeEmbedding";

const CONFIG = { baseUrl: "http://embed.test", model: "nomic-embed-text", timeoutMs: 50 };
const VECTOR = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / 1000);

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondWith(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, json: async () => body } as unknown as Response)
  );
}

describe("toVectorLiteral", () => {
  it("emits pgvector's text form", () => {
    expect(toVectorLiteral([1, 2, 3].concat(Array(765).fill(0)))).toMatch(/^\[1,2,3,0/);
  });

  it("refuses a vector of the wrong width instead of letting the cast fail later", () => {
    expect(() => toVectorLiteral([1, 2, 3])).toThrow(/Expected 768 dimensions, got 3/);
  });
});

describe("embed", () => {
  it("returns the vector when the service answers", async () => {
    respondWith({ embedding: VECTOR });
    await expect(embed("water activity", CONFIG)).resolves.toEqual(VECTOR);
  });

  it("returns null when the service is unreachable, so search degrades not breaks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(embed("water activity", CONFIG)).resolves.toBeNull();
  });

  it("returns null on a non-2xx rather than throwing", async () => {
    respondWith({ error: "model not found" }, false);
    await expect(embed("water activity", CONFIG)).resolves.toBeNull();
  });

  it("rejects a vector of the wrong width — a 1536-dim model is a migration, not a cast", async () => {
    respondWith({ embedding: Array(1536).fill(0.1) });
    await expect(embed("water activity", CONFIG)).resolves.toBeNull();
  });

  it("rejects non-finite values that would poison the index", async () => {
    const poisoned = [...VECTOR];
    poisoned[0] = Number.NaN;
    respondWith({ embedding: poisoned });
    await expect(embed("water activity", CONFIG)).resolves.toBeNull();
  });

  it("does not call out at all for empty input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(embed("   ", CONFIG)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("embedToLiteral", () => {
  it("propagates null so the caller can report text_only honestly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(embedToLiteral("emulsions", CONFIG)).resolves.toBeNull();
  });
});

describe("embeddingConfig", () => {
  it("defaults to the local Ollama and the 768-dim model already installed", () => {
    const config = embeddingConfig({} as NodeJS.ProcessEnv);
    expect(config.baseUrl).toBe("http://127.0.0.1:11434");
    expect(config.model).toBe("nomic-embed-text");
  });

  it("is overridable without a code change", () => {
    const config = embeddingConfig({
      BEVERAGE_EMBEDDING_URL: "http://elsewhere:1234/",
      BEVERAGE_EMBEDDING_MODEL: "other",
    } as NodeJS.ProcessEnv);
    expect(config.baseUrl).toBe("http://elsewhere:1234");
    expect(config.model).toBe("other");
  });
});
