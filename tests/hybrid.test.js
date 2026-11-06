import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  bm25Score,
  embeddingScore,
  rrfScore,
  hybridRetrieve,
  dualHybridRetrieve,
} from "../src/hybridRetrieval.js";

// Helper: create a simple embedding function for tests
function makeEmbedFn(vectors) {
  const map = new Map();
  vectors.forEach((item) => {
    map.set(item.text, item.vector);
  });
  return async (text) => {
    return map.get(text) || [0, 0, 0];
  };
}

describe("bm25Score", () => {
  test("returns 0 for non-matching query", () => {
    const score = bm25Score(["apple"], ["banana", "cherry"], 10);
    assert.strictEqual(score, 0);
  });

  test("returns positive score for matching query", () => {
    const score = bm25Score(["apple"], ["apple", "banana", "cherry"], 10);
    assert.ok(score > 0);
  });

  test("higher term frequency gives higher score", () => {
    const lowFreq = bm25Score(["apple"], ["apple"], 10);
    const highFreq = bm25Score(["apple"], ["apple", "apple", "apple"], 10);
    assert.ok(highFreq > lowFreq);
  });
});

describe("embeddingScore", () => {
  test("returns 0 for null vectors", () => {
    assert.strictEqual(embeddingScore(null, null), 0);
    assert.strictEqual(embeddingScore(null, [1, 2, 3]), 0);
    assert.strictEqual(embeddingScore([1, 2, 3], null), 0);
  });

  test("returns 0 for different length vectors", () => {
    assert.strictEqual(embeddingScore([1, 2], [1, 2, 3]), 0);
  });

  test("returns 1 for identical vectors", () => {
    const vec = [0.6, 0.8];
    assert.ok(Math.abs(embeddingScore(vec, vec) - 1) < 0.00001);
  });

  test("returns 0 for orthogonal vectors", () => {
    const a = [1, 0];
    const b = [0, 1];
    assert.strictEqual(embeddingScore(a, b), 0);
  });
});

describe("rrfScore", () => {
  test("returns higher score for better rank", () => {
    assert.ok(rrfScore(1) > rrfScore(2));
    assert.ok(rrfScore(1) > rrfScore(10));
  });

  test("uses k constant", () => {
    assert.ok(rrfScore(1, 10) > rrfScore(1, 60));
  });

  test("rank 1 with default k is ~0.0167", () => {
    assert.ok(Math.abs(rrfScore(1) - 1 / 61) < 0.0001);
  });
});

describe("hybridRetrieve", () => {
  const memories = [
    { id: "m1", content: "React component state management with useState hook", embedding: [0.8, 0.2, 0.1] },
    { id: "m2", content: "Python async programming with asyncio library", embedding: [0.1, 0.8, 0.1] },
    { id: "m3", content: "React useState hook for component state", embedding: [0.9, 0.1, 0.05] },
    { id: "m4", content: "JavaScript array methods filter map reduce", embedding: [0.2, 0.2, 0.8] },
    { id: "m5", content: "TypeScript generics and type safety", embedding: [0.1, 0.1, 0.9] },
  ];

  const embed = makeEmbedFn([
    { text: "React state", vector: [0.85, 0.15, 0.05] },
    { text: "Python async", vector: [0.1, 0.9, 0.05] },
    { text: "JavaScript arrays", vector: [0.2, 0.2, 0.9] },
  ]);

  test("returns results for matching query", async () => {
    const results = await hybridRetrieve("React state", memories, { embed });
    assert.ok(results.length > 0);
    // Both React-related memories should be in the top 2
    const topIds = results.slice(0, 2).map((r) => r.memory.id);
    assert.ok(topIds.includes("m1") && topIds.includes("m3"));
    // React memories should be ranked higher than non-React
    assert.ok(results.findIndex((r) => r.memory.id === "m2") > 1);
  });

  test("returns empty array for non-matching query", async () => {
    const results = await hybridRetrieve("xyzzy", memories, { embed, similarityThreshold: 0.001 });
    assert.strictEqual(results.length, 0);
  });

  test("respects maxResults limit", async () => {
    const results = await hybridRetrieve("React state", memories, { embed, maxResults: 2 });
    assert.ok(results.length <= 2);
  });

  test("applies similarity threshold", async () => {
    // With such a high threshold, no results should pass
    const results = await hybridRetrieve("xyzzy", memories, { embed, similarityThreshold: 0.5 });
    assert.strictEqual(results.length, 0);
  });

  test("includes score metadata", async () => {
    const results = await hybridRetrieve("React state", memories, { embed });
    assert.ok("score" in results[0]);
    assert.ok("bm25Score" in results[0]);
    assert.ok("embeddingScore" in results[0]);
    assert.ok("rank" in results[0]);
  });

  test("works without embedding (BM25 only)", async () => {
    const memoriesNoEmb = memories.map(({ embedding, ...rest }) => rest);
    const results = await hybridRetrieve("React state", memoriesNoEmb, { embed: null });
    assert.ok(results.length > 0);
    // Both React memories should be in the top 2
    const topIds = results.slice(0, 2).map((r) => r.memory.id);
    assert.ok(topIds.includes("m1") && topIds.includes("m3"));
  });

  test("weights affect ranking", async () => {
    const embHeavy = await hybridRetrieve("React state", memories, { embed, embWeight: 1, bm25Weight: 0 });
    const bm25Heavy = await hybridRetrieve("React state", memories, { embed, embWeight: 0, bm25Weight: 1 });
    assert.ok(embHeavy.length > 0);
    assert.ok(bm25Heavy.length > 0);
  });
});

describe("dualHybridRetrieve", () => {
  const memories = [
    { id: "m1", content: "React component state management with useState hook", embedding: [0.8, 0.2, 0.1] },
    { id: "m2", content: "Python async programming with asyncio library", embedding: [0.1, 0.8, 0.1] },
    { id: "m3", content: "React useState hook for component state", embedding: [0.9, 0.1, 0.05] },
    { id: "m4", content: "JavaScript array methods filter map reduce", embedding: [0.2, 0.2, 0.8] },
    { id: "m5", content: "TypeScript generics and type safety", embedding: [0.1, 0.1, 0.9] },
  ];

  const embed = makeEmbedFn([
    { text: "React state", vector: [0.85, 0.15, 0.05] },
    { text: "Python async", vector: [0.1, 0.9, 0.05] },
  ]);

  test("returns results for matching query", async () => {
    const results = await dualHybridRetrieve("React state", memories, { embed });
    assert.ok(results.length > 0);
  });

  test("uses RRF fusion", async () => {
    const results = await dualHybridRetrieve("React state", memories, { embed });
    assert.ok("rrfScore" in results[0]);
    assert.ok(results[0].rrfScore > 0);
  });

  test("works without embedding", async () => {
    const memoriesNoEmb = memories.map(({ embedding, ...rest }) => rest);
    const results = await dualHybridRetrieve("React state", memoriesNoEmb, { embed: null });
    assert.ok(results.length > 0);
  });

  test("respects maxResults", async () => {
    const results = await dualHybridRetrieve("React state", memories, { embed, maxResults: 2 });
    assert.ok(results.length <= 2);
  });
});
