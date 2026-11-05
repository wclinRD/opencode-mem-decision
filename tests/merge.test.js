import { describe, test } from "node:test";
import assert from "node:assert";
import path from "path";
import os from "os";
import { mkdir, rm, writeFile } from "fs/promises";
import { deduplicateMemoriesArray, mergeDedupAndDigestMemories } from "../src/storage/local.js";

let tempDir;

function setup() {
  tempDir = path.join(os.tmpdir(), `opencode-mem-test-${Date.now()}`);
  process.env.OPENCODE_MEM_DIR = tempDir;
}

function teardown() {
  try {
    rm(tempDir, { recursive: true, force: true });
  } catch {}
  delete process.env.OPENCODE_MEM_DIR;
}

describe("deduplicateMemoriesArray", () => {
  test("removes exact duplicates, keeps high confidence or recent", async () => {
    setup();
    const mems = [
      { id: "m1", content: "same text", confidence: 0.5, updatedAt: "2026-01-01T00:00:00Z" },
      { id: "m2", content: "same text", confidence: 0.8, updatedAt: "2026-01-01T00:00:00Z" },
      { id: "m3", content: "different", confidence: 0.6 },
    ];
    const result = await deduplicateMemoriesArray(mems, 0.7);
    assert.equal(result.deletedCount, 1);
    assert.equal(result.kept.length, 2);
    assert.equal(result.kept[0].id, "m2");
    assert.equal(result.deletedExactIds[0], "m1");
    assert.deepEqual(result.deletedSimilarIds, []);
    teardown();
  });

  test("removes near duplicates by similarity threshold", async () => {
    setup();
    const mems = [
      { id: "m1", content: "React frontend code is good and useful for building apps." },
      { id: "m2", content: "React frontend code is good and useful for web apps." },
      { id: "m3", content: "Different topic here." },
    ];
    const result = await deduplicateMemoriesArray(mems, 0.7);
    assert.ok(result.deletedCount >= 1);
    assert.equal(result.kept.length, 2);
    teardown();
  });
});

describe("mergeDedupAndDigestMemories", () => {
  test("combines exact, similarity dedup and grouping into one flow", async () => {
    setup();
    const file = path.join(tempDir, "memories.db.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({
      memories: [
        { id: "m1", content: "same exact", confidence: 0.5, type: "fact", scope: "default", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "m2", content: "same exact", confidence: 0.8, type: "fact", scope: "default", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
        { id: "m3", content: "similar text one is important for the project.", confidence: 0.7 },
        { id: "m4", content: "similar text two is important for the project.", confidence: 0.6 },
        { id: "m5", content: "unique content", confidence: 0.9 },
      ],
    }, null, 2));

    const result = await mergeDedupAndDigestMemories("default", 0.7);
    assert.ok(result.exactDeletedCount >= 1);
    assert.ok(result.similarityDeletedCount >= 1);
    assert.ok(result.mergedGroupCount >= 1);
    assert.ok(result.keptCount <= result.originalCount);
    teardown();
  });
});
