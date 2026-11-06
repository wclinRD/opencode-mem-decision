import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { localStorage, getStorageDir, setEmbeddingService, calculateMemoryUtilityScore, calculateActualUtilityScore, demoteLowUtilityMemories, removeLowUtilityMemories } from "../src/storage/local.js";
import { EmbeddingService } from "../src/embedding.js";
import {
  recordGeneration,
  recordSearch,
  recordInjectionHit,
  getAccessStats,
  getAccessLog,
  getAccessLogByMemory,
  clearTracking,
} from "../src/tracking.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-access-tracking-test-${process.pid}-${Date.now()}`);

async function setupTestEnvironment() {
  process.env.OPENCODE_MEM_DIR = TEST_DIR;
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(path.join(TEST_DIR, "memories.db.json"), JSON.stringify({ memories: [] }));
  const stubService = new EmbeddingService({ embeddingProvider: "local" });
  setEmbeddingService(stubService);
}

async function cleanupTestEnvironment() {
  delete process.env.OPENCODE_MEM_DIR;
  setEmbeddingService(null);
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch (e) {
    // ignore cleanup errors
  }
}

describe("Access Log Tracking", () => {
  beforeEach(async () => {
    await setupTestEnvironment();
    await clearTracking();
  });

  afterEach(async () => {
    await cleanupTestEnvironment();
  });

  test("recordSearch creates detailed access logs for each result", async () => {
    const mem1 = await localStorage.addMemory("SwiftUI views use declarative syntax", "default");
    const mem2 = await localStorage.addMemory("Node.js uses event-driven architecture", "default");

    // Search should trigger access log entries for each retrieved memory
    const results = await localStorage.searchMemories("swift");
    assert.ok(results.length >= 1, "search should return at least 1 result");

    const logs = await getAccessLog(10);
    const recallLogs = logs.filter((l) => l.type === "recall");
    assert.ok(recallLogs.length >= 1, "search should create recall access logs");

    // Check that the logs have the correct structure
    const log = recallLogs[0];
    assert.equal(log.type, "recall");
    assert.equal(log.query, "swift");
    assert.ok(log.recordedAt, "log should have timestamp");
  });

  test("recordInjectionHit creates inject access logs", async () => {
    const mem = await localStorage.addMemory("Important preference: use TypeScript", "default");
    await recordGeneration(mem.id, "default");
    await recordInjectionHit(mem.id);

    const logs = await getAccessLog(10);
    const injectLogs = logs.filter((l) => l.type === "inject");
    assert.equal(injectLogs.length, 1, "injection hit should create 1 inject access log");
    assert.equal(injectLogs[0].memoryId, mem.id);
    assert.equal(injectLogs[0].type, "inject");
  });

  test("getAccessLog supports limit and offset", async () => {
    // Create several access events
    const mem = await localStorage.addMemory("Test memory for pagination", "default");
    await recordGeneration(mem.id, "default");

    await recordSearch("query1", [mem.id], 1);
    await recordSearch("query2", [mem.id], 1);
    await recordInjectionHit(mem.id);

    const allLogs = await getAccessLog(50);
    assert.ok(allLogs.length >= 3, "should have at least 3 access logs");

    const limited = await getAccessLog(2, 0);
    assert.equal(limited.length, 2, "limit should return exactly 2 logs");

    const offsetLogs = await getAccessLog(1, 1);
    assert.equal(offsetLogs.length, 1, "offset should skip first log");
    assert.notEqual(limited[0].id, offsetLogs[0].id, "offset should return different log");
  });

  test("getAccessLogByMemory filters by memory ID", async () => {
    const mem1 = await localStorage.addMemory("Memory A", "default");
    const mem2 = await localStorage.addMemory("Memory B", "default");

    await recordSearch("A", [mem1.id], 1);
    await recordSearch("B", [mem2.id], 1);

    const mem1Logs = await getAccessLogByMemory(mem1.id);
    assert.ok(mem1Logs.length >= 1, "mem1 should have logs");
    assert.equal(mem1Logs[0].memoryId, mem1.id);

    const mem2Logs = await getAccessLogByMemory(mem2.id);
    assert.ok(mem2Logs.length >= 1, "mem2 should have logs");
    assert.equal(mem2Logs[0].memoryId, mem2.id);
  });

  test("access log entries have proper structure", async () => {
    const mem = await localStorage.addMemory("Structured log test", "default");
    await recordGeneration(mem.id, "default");
    await recordSearch("test query", [mem.id], 1);

    const logs = await getAccessLogByMemory(mem.id);
    const recallLog = logs.find((l) => l.type === "recall");
    assert.ok(recallLog, "should have recall log");
    assert.equal(typeof recallLog.id, "string");
    assert.equal(recallLog.memoryId, mem.id);
    assert.equal(recallLog.query, "test query");
    assert.equal(recallLog.type, "recall");
    assert.ok(recallLog.recordedAt);
    assert.ok(typeof recallLog.rank === "number");
  });

  test("access stats include total access logs and lastAccessedAt", async () => {
    const mem = await localStorage.addMemory("Stats test memory", "default");
    await recordGeneration(mem.id, "default");
    await recordSearch("test", [mem.id], 1);
    await recordInjectionHit(mem.id);

    const stats = await getAccessStats();
    assert.ok(stats.totalAccessLogs >= 2, "should have at least 2 access logs");

    const memStat = stats.memoryStats.find((s) => s.memoryId === mem.id);
    assert.ok(memStat, "should have stats for the memory");
    assert.ok(memStat.lastAccessedAt, "lastAccessedAt should be set");
    assert.ok(memStat.accessCount >= 1, "accessCount should be incremented");
  });
});

describe("Actual Utility Score", () => {
  beforeEach(async () => {
    await setupTestEnvironment();
    await clearTracking();
  });

  afterEach(async () => {
    await cleanupTestEnvironment();
  });

  test("calculateActualUtilityScore returns detailed score breakdown", async () => {
    const mem = {
      id: "test_mem",
      type: "fact",
      confidence: 0.8,
      content: "This is a test memory with some content",
      tags: ["test"],
      priority: 1,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const scoreInfo = await calculateActualUtilityScore(mem);
    assert.ok(scoreInfo.score >= 0 && scoreInfo.score <= 1.3, "score should be in range");
    assert.ok(scoreInfo.qualityScore > 0, "qualityScore should be positive");
    assert.ok(typeof scoreInfo.usageAccessScore === "number");
    assert.ok(typeof scoreInfo.injectionScore === "number");
    assert.ok(typeof scoreInfo.recentUsageScore === "number");
    assert.ok(typeof scoreInfo.accessCount === "number");
    assert.ok(typeof scoreInfo.injectionHitCount === "number");
  });

  test("frequently accessed memory gets higher actual utility score", async () => {
    const mem = await localStorage.addMemory("Frequently accessed memory about Swift programming", "default");
    await recordGeneration(mem.id, "default");

    // Record several search accesses
    for (let i = 0; i < 5; i++) {
      await recordSearch("swift", [mem.id], 1);
    }
    await recordInjectionHit(mem.id);

    // Fresh memory with no access
    const freshMem = await localStorage.addMemory("Fresh memory with no access yet", "default");
    await recordGeneration(freshMem.id, "default");

    const accessedScore = await calculateActualUtilityScore(mem);
    const freshScore = await calculateActualUtilityScore(freshMem);

    assert.ok(accessedScore.score > freshScore.score, "frequently accessed memory should have higher score");
    assert.ok(accessedScore.accessCount > 0, "accessed memory should have access count");
    assert.ok(freshScore.accessCount === 0, "fresh memory should have 0 access count");
  });

  test("never accessed memory gets penalty", async () => {
    const mem = {
      id: "never_accessed",
      type: "fact",
      confidence: 0.5,
      content: "Some forgotten content",
      tags: [],
      priority: 0,
      updatedAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    };

    const scoreInfo = await calculateActualUtilityScore(mem);
    assert.equal(scoreInfo.neverAccessedPenalty, -0.2, "never accessed should have penalty");
  });

  test("injection hits increase utility score", async () => {
    const mem = await localStorage.addMemory("Memory that gets injected often", "default");
    await recordGeneration(mem.id, "default");

    for (let i = 0; i < 3; i++) {
      await recordInjectionHit(mem.id);
    }

    const scoreInfo = await calculateActualUtilityScore(mem);
    assert.ok(scoreInfo.injectionScore > 0, "injection hits should increase score");
    assert.ok(scoreInfo.injectionHitCount === 3, "injection hit count should be 3");
  });

  test("recent access increases utility score", async () => {
    const mem = {
      id: "recently_accessed",
      type: "fact",
      confidence: 0.8,
      content: "Recently accessed memory",
      tags: [],
      priority: 1,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const stats = {
      memoryStats: [{
        memoryId: mem.id,
        accessCount: 2,
        injectionHitCount: 0,
        lastAccessedAt: new Date().toISOString(),
      }],
    };

    const scoreInfo = await calculateActualUtilityScore(mem, stats);
    assert.ok(scoreInfo.recentUsageScore > 0, "recent access should increase score");
  });
});

describe("Demote Low Utility Memories", () => {
  beforeEach(async () => {
    await setupTestEnvironment();
    await clearTracking();
  });

  afterEach(async () => {
    await cleanupTestEnvironment();
  });

  test("demoteLowUtilityMemories demotes low-score memories", async () => {
    // Create a low-quality, never-accessed memory
    const lowMem = await localStorage.addMemory("Just some random noise content", "default");
    await recordGeneration(lowMem.id, "default");
    // Make it old so quality score is low
    await localStorage.updateMemory(lowMem.id, {
      updatedAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      confidence: 0.1,
      priority: 0,
    });

    // Create a high-quality, frequently accessed memory
    const highMem = await localStorage.addMemory("Important Swift programming best practices", "default");
    await recordGeneration(highMem.id, "default");
    await recordSearch("swift", [highMem.id], 1);
    await recordSearch("swift", [highMem.id], 1);

    const result = await demoteLowUtilityMemories({}, 0.5, "default");

    // The low-quality memory should be demoted
    const lowMemAfter = await localStorage.getMemory(lowMem.id);
    assert.equal(lowMemAfter.type, "garbage", "low quality memory should be demoted to garbage");
    assert.equal(lowMemAfter.priority, 0, "demoted memory should have priority 0");

    // The high-quality memory should not be demoted
    const highMemAfter = await localStorage.getMemory(highMem.id);
    assert.notEqual(highMemAfter.type, "garbage", "high quality memory should not be demoted");

    assert.ok(result.demotedCount >= 1, "should demote at least 1 memory");
  });

  test("demoteLowUtilityMemories returns correct report", async () => {
    const lowMem = await localStorage.addMemory("Low quality content here", "default");
    await recordGeneration(lowMem.id, "default");
    await localStorage.updateMemory(lowMem.id, {
      updatedAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      confidence: 0.1,
      priority: 0,
    });

    const result = await demoteLowUtilityMemories({}, 0.5, "default");
    assert.ok(Array.isArray(result.demotedIds), "should have demotedIds array");
    assert.ok(result.demotedIds.includes(lowMem.id), "should include demoted memory ID");
    assert.equal(result.threshold, 0.5);
    assert.ok(Array.isArray(result.details), "should have details array");
  });

  test("demoteLowUtilityMemories does not demote already garbage memories", async () => {
    const mem = await localStorage.addMemory("Already garbage", "default");
    await recordGeneration(mem.id, "default");
    await localStorage.updateMemory(mem.id, { type: "garbage" });

    const result = await demoteLowUtilityMemories({}, 0.5, "default");
    assert.equal(result.demotedCount, 0, "should not demote already garbage memory");
  });
});

describe("Remove Low Utility Memories", () => {
  beforeEach(async () => {
    await setupTestEnvironment();
    await clearTracking();
  });

  afterEach(async () => {
    await cleanupTestEnvironment();
  });

  test("removeLowUtilityMemories soft-deletes low-score memories", async () => {
    const lowMem = await localStorage.addMemory("Very low quality forgotten content", "default");
    await recordGeneration(lowMem.id, "default");
    await localStorage.updateMemory(lowMem.id, {
      updatedAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      confidence: 0.05,
      priority: 0,
    });

    const highMem = await localStorage.addMemory("Important frequently used content", "default");
    await recordGeneration(highMem.id, "default");
    await recordSearch("important", [highMem.id], 1);

    const result = await removeLowUtilityMemories({}, 0.5, "default");

    // Low quality memory should be removed from main storage
    const lowMemAfter = await localStorage.getMemory(lowMem.id);
    assert.ok(lowMemAfter === null, "low quality memory should be soft-deleted");

    // High quality memory should remain
    const highMemAfter = await localStorage.getMemory(highMem.id);
    assert.ok(highMemAfter, "high quality memory should remain");

    assert.ok(result.removedCount >= 1, "should remove at least 1 memory");
  });

  test("removeLowUtilityMemories returns correct report", async () => {
    const lowMem = await localStorage.addMemory("Remove me, I'm garbage", "default");
    await recordGeneration(lowMem.id, "default");
    await localStorage.updateMemory(lowMem.id, {
      updatedAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      confidence: 0.05,
    });

    const result = await removeLowUtilityMemories({}, 0.5, "default");
    assert.ok(Array.isArray(result.removedIds), "should have removedIds array");
    assert.ok(result.removedIds.includes(lowMem.id), "should include removed memory ID");
    assert.equal(result.threshold, 0.5);
    assert.ok(Array.isArray(result.details), "should have details array");
  });
});

describe("Utility Score Integration", () => {
  beforeEach(async () => {
    await setupTestEnvironment();
    await clearTracking();
  });

  afterEach(async () => {
    await cleanupTestEnvironment();
  });

  test("actual utility score differs from quality score for frequently accessed memory", async () => {
    const mem = await localStorage.addMemory("Test content for score difference", "default");
    await recordGeneration(mem.id, "default");

    // Record multiple accesses
    for (let i = 0; i < 10; i++) {
      await recordSearch("test", [mem.id], 1);
    }

    const qualityScore = calculateMemoryUtilityScore(mem);
    const actualScoreInfo = await calculateActualUtilityScore(mem);

    assert.ok(actualScoreInfo.score > qualityScore, "actual score should be higher for frequently accessed memory");
    assert.ok(actualScoreInfo.usageAccessScore > 0, "usage score should be positive");
  });
});