import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { localStorage, getStorageDir, setEmbeddingService } from "../src/storage/local.js";
import { EmbeddingService } from "../src/embedding.js";
import {
  calculateRecall,
  calculatePrecision,
  runBenchmark,
  getBenchmarks,
  clearBenchmarkData,
} from "../src/perf.js";
import {
  recordGeneration,
  recordSearch,
  recordDeletion,
  recordInjectionHit,
  recordInjectionMiss,
  getAccessStats,
  clearTracking,
} from "../src/tracking.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-perf-test-${process.pid}-${Date.now()}`);

async function setupTestEnvironment() {
  process.env.OPENCODE_MEM_DIR = TEST_DIR;
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(path.join(TEST_DIR, "memories.db.json"), JSON.stringify({ memories: [] }));
  // Use stub embedding service for tests
  const stubService = new EmbeddingService({ embeddingProvider: "local" });
  setEmbeddingService(stubService);
}

async function cleanupTestEnvironment() {
  delete process.env.OPENCODE_MEM_DIR;
  setEmbeddingService(null);
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

beforeEach(async () => {
  await setupTestEnvironment();
  await clearBenchmarkData();
  await clearTracking();
});

afterEach(async () => {
  await cleanupTestEnvironment();
});

describe("calcualeRecall", () => {
  test("perfect recall", () => {
    const expected = ["a", "b", "c"];
    const returned = ["a", "b", "c", "d"];
    assert.strictEqual(calculateRecall(expected, returned), 1);
  });

  test("partial recall", () => {
    const expected = ["a", "b", "c"];
    const returned = ["a", "d"];
    assert.strictEqual(calculateRecall(expected, returned), 1 / 3);
  });

  test("zero recall", () => {
    const expected = ["a", "b"];
    const returned = ["c", "d"];
    assert.strictEqual(calculateRecall(expected, returned), 0);
  });

  test("empty expected returns 1", () => {
    const expected = [];
    const returned = ["a", "b"];
    assert.strictEqual(calculateRecall(expected, returned), 1);
  });
});

describe("calculatePrecision", () => {
  test("perfect precision", () => {
    const expected = ["a", "b", "c"];
    const returned = ["a", "b"];
    assert.strictEqual(calculatePrecision(expected, returned), 1);
  });

  test("partial precision", () => {
    const expected = ["a", "b"];
    const returned = ["a", "c", "d"];
    assert.strictEqual(calculatePrecision(expected, returned), 1 / 3);
  });

  test("zero precision", () => {
    const expected = ["a"];
    const returned = ["b", "c"];
    assert.strictEqual(calculatePrecision(expected, returned), 0);
  });

  test("empty returned returns 1", () => {
    const expected = ["a", "b"];
    const returned = [];
    assert.strictEqual(calculatePrecision(expected, returned), 1);
  });
});

describe("runBenchmark", () => {
  test("runs benchmark with queries and calculates scores", async () => {
    // Add some memories first
    const mem1 = await localStorage.addMemory("Apple iPhone is a smartphone", "default");
    const mem2 = await localStorage.addMemory("Banana is a fruit", "default");
    const mem3 = await localStorage.addMemory("Google Android is a mobile OS", "default");

    const queries = [
      {
        query: "smartphone",
        expectedIds: [mem1.id],
        expectedCount: 1,
      },
      {
        query: "fruit",
        expectedIds: [mem2.id],
        expectedCount: 1,
      },
      {
        query: "nonexistent term",
        expectedIds: [],
        expectedCount: 0,
      },
    ];

    const result = await runBenchmark(
      "test-benchmark",
      queries,
      async (query) => await localStorage.searchMemories(query, { scope: "default" }),
      { scope: "default" },
    );

    assert.ok(result.id.startsWith("bench_"));
    assert.strictEqual(result.name, "test-benchmark");
    assert.strictEqual(result.queriesCount, 3);
    assert.ok(result.avgRecall >= 0 && result.avgRecall <= 1);
    assert.ok(result.avgPrecision >= 0 && result.avgPrecision <= 1);
    assert.ok(result.results.length === 3);
    assert.ok(result.timestamp);
  });

  test("benchmark results are saved and retrievable", async () => {
    const benchmark = await runBenchmark("save-test", [], null);
    const benchmarks = await getBenchmarks();
    assert.ok(benchmarks.some((b) => b.name === "save-test"));
  });

  test("clearBenchmarkData removes all benchmarks", async () => {
    await runBenchmark("to-clear", [], null);
    await clearBenchmarkData();
    const benchmarks = await getBenchmarks();
    assert.strictEqual(benchmarks.length, 0);
  });
});

describe("Tracking Integration", () => {
  test("addMemory records generation", async () => {
    const memory = await localStorage.addMemory("Tracked memory", "default");
    const stats = await getAccessStats();
    assert.ok(stats.totalGenerated >= 1);
    const tracked = stats.memoryStats.find((s) => s.memoryId === memory.id);
    assert.ok(tracked);
    assert.strictEqual(tracked.scope, "default");
  });

  test("searchMemories records search", async () => {
    const memory = await localStorage.addMemory("Search tracked memory", "default");
    await localStorage.searchMemories("Search tracked", { scope: "default" });
    const stats = await getAccessStats();
    assert.ok(stats.totalRetrievals >= 1);
    // Check that access count was incremented
    const tracked = stats.memoryStats.find((s) => s.memoryId === memory.id);
    assert.ok(tracked);
    assert.ok(tracked.accessCount >= 1);
  });

  test("deleteMemory records deletion", async () => {
    const memory = await localStorage.addMemory("Delete tracked memory", "default");
    await localStorage.deleteMemory(memory.id);
    const stats = await getAccessStats();
    assert.ok(stats.totalDeletions >= 1);
    const tracked = stats.memoryStats.find((s) => s.memoryId === memory.id);
    assert.ok(tracked);
    assert.ok(tracked.deletedAt);
  });

  test("recordInjectionHit increments hit count", async () => {
    const memory = await localStorage.addMemory("Injection hit test", "default");
    await recordInjectionHit(memory.id);
    await recordInjectionHit(memory.id);
    const stats = await getAccessStats();
    const tracked = stats.memoryStats.find((s) => s.memoryId === memory.id);
    assert.ok(tracked);
    assert.strictEqual(tracked.injectionHitCount, 2);
    assert.strictEqual(stats.injectionHits, 2);
  });

  test("recordInjectionMiss increments miss count", async () => {
    await recordInjectionMiss();
    await recordInjectionMiss();
    const stats = await getAccessStats();
    assert.strictEqual(stats.injectionMisses, 2);
  });

  test("clearTracking removes all tracking data", async () => {
    const memory = await localStorage.addMemory("Will be cleared", "default");
    await localStorage.searchMemories("Will be cleared", { scope: "default" });
    await clearTracking();
    const stats = await getAccessStats();
    assert.strictEqual(stats.totalGenerated, 0);
    assert.strictEqual(stats.totalRetrievals, 0);
    assert.strictEqual(stats.totalDeletions, 0);
  });
});

describe("Benchmark with Storage", () => {
  test("benchmark measures latency", async () => {
    // Add memories to make search non-trivial
    for (let i = 0; i < 10; i++) {
      await localStorage.addMemory(`Memory item about topic ${i} with details`, "default");
    }

    const queries = [
      { query: "topic 5", expectedIds: [], expectedCount: 1 },
      { query: "topic 9", expectedIds: [], expectedCount: 1 },
    ];

    const result = await runBenchmark(
      "latency-test",
      queries,
      async (query) => await localStorage.searchMemories(query, { scope: "default" }),
      { scope: "default" },
    );

    // Latency should be non-negative
    for (const q of result.results) {
      assert.ok(q.latencyMs >= 0);
    }
  });

  test("benchmark with no search function returns empty results", async () => {
    const result = await runBenchmark("no-search", [{ query: "test", expectedIds: [], expectedCount: 0 }], null);
    assert.strictEqual(result.results[0].returnedCount, 0);
    assert.strictEqual(result.results[0].recall, 1);
    assert.strictEqual(result.results[0].precision, 1);
  });
});
