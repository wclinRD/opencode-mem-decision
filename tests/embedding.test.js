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
