import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { EmbeddingService } from "../src/embedding.js";
import { setEmbeddingService, getStorageDir } from "../src/storage/local.js";
import { findDuplicateMemories, buildDuplicateConfig } from "../src/dedup.js";

function makeTempDir() {
  return path.join(os.tmpdir(), `opencode-mem-dedup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
}

test("dedup - findDuplicateMemories uses embedding similarity when available", async () => {
  const tmpDir = makeTempDir();
  process.env.OPENCODE_MEM_DIR = tmpDir;
  const service = new EmbeddingService({ embeddingModel: "Xenova/nomic-embed-text-v1" });
  setEmbeddingService(service);

  const mem1 = { id: "m1", content: "hello world today is fine", embedding: await service.embed("hello world today is fine") };
  const mem2 = { id: "m2", content: "hello world today is great", embedding: await service.embed("hello world today is great") };
  const mem3 = { id: "m3", content: "completely unrelated content here", embedding: await service.embed("completely unrelated content here") };

  const result1 = await findDuplicateMemories("hello world today is fine", [mem1, mem2, mem3], 0.75, service);
  assert.ok(result1.duplicate);
  assert.equal(result1.existingId, "m1");
  assert.ok(result1.similarity >= 0.9);

  const result2 = await findDuplicateMemories("completely unrelated content here", [mem1, mem2, mem3], 0.75, service);
  assert.ok(result2.duplicate);
  assert.equal(result2.existingId, "m3");

  const result3 = await findDuplicateMemories("this is not related to any of them", [mem1, mem2, mem3], 0.75, service);
  assert.ok(!result3.duplicate);
});

test("dedup - buildDuplicateConfig normalizes defaults", () => {
  assert.deepEqual(buildDuplicateConfig(null), { enabled: true, similarityThreshold: 0.75, updateOnMatch: true });
  assert.deepEqual(buildDuplicateConfig({}), { enabled: true, similarityThreshold: 0.75, updateOnMatch: true });
  assert.deepEqual(buildDuplicateConfig({ enabled: false }), { enabled: false, similarityThreshold: 0.75, updateOnMatch: true });
  assert.deepEqual(buildDuplicateConfig({ similarityThreshold: 0.9, updateOnMatch: false }), { enabled: true, similarityThreshold: 0.9, updateOnMatch: false });
});

test("dedup - uses text similarity when no embedding service", async () => {
  const tmpDir = makeTempDir();
  process.env.OPENCODE_MEM_DIR = tmpDir;
  setEmbeddingService(null);

  const mem1 = { id: "m1", content: "the quick brown fox jumps over the lazy dog" };
  const mem2 = { id: "m2", content: "the quick brown fox jumps over a lazy dog" };
  const result = await findDuplicateMemories("the quick brown fox jumps over the lazy dog", [mem1, mem2], 0.75, null);
  assert.ok(result.duplicate);
  assert.equal(result.existingId, "m1");
});

test("dedup - short text fallback is substring match", async () => {
  const mem1 = { id: "m1", content: "this is a very short piece of text" };
  const mem2 = { id: "m2", content: "this is a very short piece of text with suffix" };
  const result = await findDuplicateMemories("this is a very short piece of text", [mem1, mem2], 0.75, null);
  assert.ok(result.duplicate);
  assert.equal(result.existingId, "m1");
});
