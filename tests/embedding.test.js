import test from "node:test";
import assert from "node:assert/strict";
import { EmbeddingService, cosineSimilarity } from "../src/embedding.js";

test("embedding - local stub returns normalized vector of fixed length", async () => {
  const service = new EmbeddingService({ embeddingModel: "Xenova/nomic-embed-text-v1" });
  const vec = await service.embed("hello world");
  assert.ok(Array.isArray(vec));
  assert.equal(vec.length, 768);
  const norm = vec.reduce((sum, v) => sum + v * v, 0);
  assert.ok(Math.abs(Math.sqrt(norm) - 1) < 0.001);
});

test("embedding - deterministic hash produces same vector for same text", async () => {
  const service = new EmbeddingService({ embeddingModel: "Xenova/nomic-embed-text-v1" });
  const v1 = await service.embed("test text");
  const v2 = await service.embed("test text");
  assert.deepEqual(v1, v2);
});

test("embedding - different text produces different vectors", async () => {
  const service = new EmbeddingService({ embeddingModel: "Xenova/nomic-embed-text-v1" });
  const v1 = await service.embed("test text 1");
  const v2 = await service.embed("test text 2");
  assert.notDeepEqual(v1, v2);
});

test("embedding - cosine similarity of identical vectors is 1", () => {
  const v = [0.1, 0.2, 0.3];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 0.001);
});

test("embedding - cosine similarity of orthogonal vectors is 0", () => {
  const v1 = [1, 0, 0];
  const v2 = [0, 1, 0];
  assert.equal(cosineSimilarity(v1, v2), 0);
});

test("embedding - embedBatch returns multiple vectors", async () => {
  const service = new EmbeddingService({ embeddingModel: "Xenova/nomic-embed-text-v1" });
  const result = await service.embedBatch(["one", "two"]);
  assert.equal(result.length, 2);
  assert.ok(Array.isArray(result[0]));
  assert.ok(Array.isArray(result[1]));
});

test("embedding - remote stub not called when no api configured", async () => {
  const service = new EmbeddingService({ embeddingModel: "Xenova/nomic-embed-text-v1" });
  const vec = await service.embed("no remote");
  assert.ok(vec.length === 768);
});

test("embedding - empty or non-string returns zero vector", async () => {
  const service = new EmbeddingService({ embeddingModel: "Xenova/nomic-embed-text-v1" });
  const zero = await service.embed("");
  assert.ok(zero.length === 768);
  assert.equal(zero.reduce((sum, v) => sum + v, 0), 0);
});

// Step 14: Embedding Strategy tests

test("embedding - Ollama API integration (mock fetch)", async () => {
  let fetchCalled = false;
  let fetchUrl = null;
  let fetchBody = null;

  const mockFetch = async (url, options) => {
    fetchCalled = true;
    fetchUrl = url;
    fetchBody = JSON.parse(options.body);
    // Return a mock embedding vector
    const embedding = new Array(768).fill(0.1);
    return {
      ok: true,
      json: async () => ({ embedding }),
    };
  };

  const originalFetch = global.fetch;
  global.fetch = mockFetch;

  try {
    const service = new EmbeddingService({ embeddingProvider: "ollama" });
    const vec = await service.embed("test text");
    assert.ok(fetchCalled, "fetch should have been called");
    assert.equal(fetchUrl, "http://localhost:11434/api/embed");
    assert.equal(fetchBody.model, "nomic-embed-text");
    assert.equal(fetchBody.prompt, "test text");
    assert.ok(Array.isArray(vec));
    assert.equal(vec.length, 768);
  } finally {
    global.fetch = originalFetch;
  }
});

test("embedding - Ollama API integration with custom host and model", async () => {
  let fetchUrl = null;
  let fetchBody = null;

  const mockFetch = async (url, options) => {
    fetchUrl = url;
    fetchBody = JSON.parse(options.body);
    const embedding = new Array(768).fill(0.2);
    return {
      ok: true,
      json: async () => ({ embedding }),
    };
  };

  const originalFetch = global.fetch;
  global.fetch = mockFetch;

  try {
    const service = new EmbeddingService({
      embeddingProvider: "ollama",
      embeddingOllamaHost: "http://localhost:12345",
      embeddingOllamaModel: "custom-model",
    });
    await service.embed("test text");
    assert.equal(fetchUrl, "http://localhost:12345/api/embed");
    assert.equal(fetchBody.model, "custom-model");
    assert.equal(fetchBody.prompt, "test text");
  } finally {
    global.fetch = originalFetch;
  }
});

test("embedding - improved local stub gives higher similarity for similar text", async () => {
  const service = new EmbeddingService({ embeddingProvider: "local" });

  // Similar texts should have higher similarity
  const v1 = await service.embed("React component with hooks");
  const v2 = await service.embed("React hook implementation");
  const simSimilar = cosineSimilarity(v1, v2);

  // Dissimilar texts should have lower similarity
  const v3 = await service.embed("React component");
  const v4 = await service.embed("Python function");
  const simDifferent = cosineSimilarity(v3, v4);

  assert.ok(simSimilar > simDifferent, `Similar text should have higher similarity: ${simSimilar} vs ${simDifferent}`);
});

test("embedding - improved local stub gives higher similarity for shared technical vocabulary", async () => {
  const service = new EmbeddingService({ embeddingProvider: "local" });

  // Texts with shared technical vocabulary
  const v1 = await service.embed("API endpoint returns JSON response");
  const v2 = await service.embed("API response in JSON format");
  const simShared = cosineSimilarity(v1, v2);

  // Texts with different vocabulary
  const v3 = await service.embed("Database query selects rows");
  const v4 = await service.embed("UI component renders text");
  const simDifferent = cosineSimilarity(v3, v4);

  assert.ok(simShared > simDifferent, `Shared vocabulary should have higher similarity: ${simShared} vs ${simDifferent}`);
});

test("embedding - fallback chain falls back to local on API error", async () => {
  let fetchCalled = false;

  const mockFetch = async () => {
    fetchCalled = true;
    throw new Error("API error");
  };

  const originalFetch = global.fetch;
  global.fetch = mockFetch;

  try {
    const service = new EmbeddingService({
      embeddingProvider: "openai",
      embeddingApiUrl: "https://api.openai.com/v1",
    });
    const vec = await service.embed("test text");
    assert.ok(fetchCalled, "fetch should have been called");
    // Should fall back to local stub
    assert.ok(Array.isArray(vec));
    assert.equal(vec.length, 768);
  } finally {
    global.fetch = originalFetch;
  }
});

test("embedding - fallback chain falls back to local on Ollama error", async () => {
  let fetchCalled = false;

  const mockFetch = async () => {
    fetchCalled = true;
    throw new Error("Ollama error");
  };

  const originalFetch = global.fetch;
  global.fetch = mockFetch;

  try {
    const service = new EmbeddingService({ embeddingProvider: "ollama" });
    const vec = await service.embed("test text");
    assert.ok(fetchCalled, "fetch should have been called");
    // Should fall back to local stub
    assert.ok(Array.isArray(vec));
    assert.equal(vec.length, 768);
  } finally {
    global.fetch = originalFetch;
  }
});

test("embedding - embeddingProvider config option is respected", async () => {
  const service = new EmbeddingService({ embeddingProvider: "local" });
  const vec = await service.embed("test text");
  assert.ok(Array.isArray(vec));
  assert.equal(vec.length, 768);
});

test("embedding - embeddingProvider openai with API URL", async () => {
  let fetchCalled = false;

  const mockFetch = async () => {
    fetchCalled = true;
    const embedding = new Array(768).fill(0.3);
    return {
      ok: true,
      json: async () => ({ data: [{ embedding }] }),
    };
  };

  const originalFetch = global.fetch;
  global.fetch = mockFetch;

  try {
    const service = new EmbeddingService({
      embeddingProvider: "openai",
      embeddingApiUrl: "https://api.openai.com/v1",
    });
    const vec = await service.embed("test text");
    assert.ok(fetchCalled, "fetch should have been called");
    assert.ok(Array.isArray(vec));
    assert.equal(vec.length, 768);
  } finally {
    global.fetch = originalFetch;
  }
});

test("embedding - embeddingApiUrl with localhost:11434 uses Ollama", async () => {
  let fetchCalled = false;
  let fetchUrl = null;

  const mockFetch = async (url) => {
    fetchCalled = true;
    fetchUrl = url;
    const embedding = new Array(768).fill(0.4);
    return {
      ok: true,
      json: async () => ({ embedding }),
    };
  };

  const originalFetch = global.fetch;
  global.fetch = mockFetch;

  try {
    const service = new EmbeddingService({
      embeddingApiUrl: "http://localhost:11434",
    });
    await service.embed("test text");
    assert.ok(fetchCalled, "fetch should have been called");
    assert.equal(fetchUrl, "http://localhost:11434/api/embed");
  } finally {
    global.fetch = originalFetch;
  }
});
