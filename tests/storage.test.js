import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { localStorage, getStorageDir } from "../src/storage/local.js";
import { buildProfile } from "../src/profile.js";
import { runDreaming, restoreTrashEntry } from "../src/dreaming.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-storage-test-${process.pid}-${Date.now()}`);

test.beforeEach(async () => {
  process.env.OPENCODE_MEM_DIR = TEST_DIR;
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(path.join(TEST_DIR, "memories.db.json"), JSON.stringify({ memories: [] }));
  await fs.writeFile(path.join(TEST_DIR, "knowledge.db.json"), JSON.stringify({ knowledge: [] }));
});

test.afterEach(async () => {
  delete process.env.OPENCODE_MEM_DIR;
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test("storage - uses OPENCODE_MEM_DIR for the storage directory", async () => {
  assert.equal(getStorageDir(), path.resolve(TEST_DIR));

  await localStorage.addMemory("Scoped to temp dir", "project");
  const raw = JSON.parse(await fs.readFile(path.join(TEST_DIR, "memories.db.json"), "utf-8"));
  assert.equal(raw.memories.length, 1);
});

test("storage - addMemory and searchMemories", async () => {
  const memory = await localStorage.addMemory("Test memory content", "project");
  assert.ok(memory.id.startsWith("mem_"));
  assert.equal(memory.scope, "project");
  assert.ok(memory.content.includes("Test memory content"));

  const results = await localStorage.searchMemories("Test memory", "project");
  assert.ok(results.length >= 1);
  const found = results.find((m) => m.id === memory.id);
  assert.ok(found);
});

test("storage - searchMemories ranks by query relevance", async () => {
  const target = await localStorage.addMemory("Deploys use Fly.io and staging is acme", "project");
  await localStorage.addMemory("Unrelated note about gardening", "project");

  const unrelated = await localStorage.searchMemories("quantum banana", "project");
  assert.equal(unrelated.length, 0);

  const matching = await localStorage.searchMemories("Fly staging", "project");
  assert.ok(matching.some((m) => m.id === target.id));

  const all = await localStorage.searchMemories("", "project");
  assert.equal(all.length, 2);
});

test("storage - sessionId is stored and filterable", async () => {
  const memory = await localStorage.addMemory("Session scoped memory", "project", "ses_abc");
  assert.equal(memory.sessionId, "ses_abc");

  const withoutSession = await localStorage.addMemory("No session memory", "project");
  assert.equal(withoutSession.sessionId, undefined);

  const listed = await localStorage.listMemories(10, "project");
  const forSession = listed.filter((m) => m.sessionId === "ses_abc");
  assert.equal(forSession.length, 1);
  assert.equal(forSession[0].id, memory.id);
});

test("storage - listMemories", async () => {
  await localStorage.addMemory("Memory 1", "project");
  await localStorage.addMemory("Memory 2", "global");

  const projectMemories = await localStorage.listMemories(10, "project");
  const globalMemories = await localStorage.listMemories(10, "global");
  const allMemories = await localStorage.listMemories(10, "default");

  assert.ok(projectMemories.length >= 1);
  assert.ok(globalMemories.length >= 1);
  assert.ok(allMemories.length >= 2);
});

test("storage - deleteMemory", async () => {
  const memory = await localStorage.addMemory("To be deleted", "project");
  const deleted = await localStorage.deleteMemory(memory.id);
  assert.equal(deleted, true);

  const results = await localStorage.searchMemories("To be deleted", "project");
  const found = results.find((m) => m.id === memory.id);
  assert.ok(!found);
});

test("storage - export and import", async () => {
  await localStorage.addMemory("Export me", "project");
  const exportPath = path.join(TEST_DIR, "exported.json");
  await localStorage.exportMemories(exportPath);

  const importedCount = await localStorage.importMemories(exportPath);
  assert.ok(importedCount >= 1);
});

test("storage - addKnowledge and getKnowledge", async () => {
  const knowledge = await localStorage.addKnowledge("Knowledge content", "kb_test");
  assert.equal(knowledge.id, "kb_test");
  assert.ok(knowledge.content.includes("Knowledge content"));

  const retrieved = await localStorage.getKnowledge("kb_test");
  assert.equal(retrieved.id, "kb_test");
  assert.equal(retrieved.content, "Knowledge content");
});

test("storage - deleteKnowledge", async () => {
  await localStorage.addKnowledge("To be deleted", "kb_delete");
  const deleted = await localStorage.deleteKnowledge("kb_delete");
  assert.equal(deleted, true);

  const retrieved = await localStorage.getKnowledge("kb_delete");
  assert.equal(retrieved, null);
});

test("storage - profile builder writes profile.json in the temp dir", async () => {
  await localStorage.addMemory("Deploys use Fly.io", "project");
  await localStorage.addMemory("Prefer pnpm over npm", "global");
  await localStorage.addKnowledge("Knowledge about deploys", "kb_deploy");

  const profile = await buildProfile({ storage: localStorage, memoryConfig: {} });
  assert.equal(profile.totals.memories, 2);
  assert.equal(profile.totals.knowledge, 1);
  assert.equal(profile.userPreferences.length, 1);

  const raw = JSON.parse(await fs.readFile(path.join(TEST_DIR, "profile.json"), "utf-8"));
  assert.equal(raw.totals.memories, 2);
  assert.equal(typeof raw.generatedAt, "string");
});

test("storage - dreaming trash round-trip uses the temp dir", async () => {
  const shared = Array.from({ length: 9 }, (_, i) => `token${i}`).join(" ");
  await localStorage.addMemory(`${shared} alpha`, "project");
  await localStorage.addMemory(`${shared} beta`, "project");

  const result = await runDreaming({ memoryConfig: { dreaming: { enabled: true, relatedThreshold: 0.75 } }, storage: localStorage });
  assert.equal(result.action, "dreamed");

  const trashFile = path.join(TEST_DIR, "trash.db.json");
  const trash = JSON.parse(await fs.readFile(trashFile, "utf-8"));
  assert.ok(trash.entries.length >= 1);

  const restored = await restoreTrashEntry(trash.entries[0].id);
  assert.deepEqual(restored, { restored: true });
});

test("storage - getTtlDaysForMemory respects type, priority, sensitivity", () => {
  const defaultConfig = {
    memory: {
      ttl: { defaultDays: 90, factDays: 180, lowPriorityDays: 30, sensitiveDays: 365 },
    },
  };
  const factMem = { type: "fact", priority: 1, sensitivity: "normal", createdAt: "..." };
  const sensitiveMem = { type: "fact", priority: 1, sensitivity: "sensitive", createdAt: "..." };
  const lowPriorityMem = { type: "fact", priority: 0, sensitivity: "normal", createdAt: "..." };
  assert.equal(localStorage.getTtlDaysForMemory(factMem, defaultConfig), 180);
  assert.equal(localStorage.getTtlDaysForMemory(sensitiveMem, defaultConfig), 365);
  assert.equal(localStorage.getTtlDaysForMemory(lowPriorityMem, defaultConfig), 30);
});

test("storage - cleanupExpiredMemories removes expired memories", async () => {
  const config = {
    memory: {
      ttl: { defaultDays: 90, factDays: 180, lowPriorityDays: 30, sensitiveDays: 365 },
    },
  };
  const now = new Date();
  const oldDate = new Date(now.getTime() - 200 * 86400000).toISOString();
  const recentDate = new Date(now.getTime() - 10 * 86400000).toISOString();

  await localStorage.addMemory("Old expired fact", "project", undefined, {
    type: "fact", confidence: 0.5, priority: 1, sensitivity: "normal",
  });
  await localStorage.addMemory("Recent fact", "project", undefined, {
    type: "fact", confidence: 0.5, priority: 1, sensitivity: "normal",
  });
  await localStorage.addMemory("Low priority old fact", "project", undefined, {
    type: "fact", confidence: 0.5, priority: 0, sensitivity: "normal",
  });
  await localStorage.addMemory("Sensitive old", "project", undefined, {
    type: "fact", confidence: 0.5, priority: 1, sensitive: true,
  });

  // Overwrite createdAt to simulate old memories
  const allBefore = await localStorage.listAllMemories();
  for (const m of allBefore) {
    if (m.content === "Old expired fact") {
      await localStorage.updateMemory(m.id, { createdAt: oldDate, updatedAt: oldDate });
    } else if (m.content === "Recent fact") {
      await localStorage.updateMemory(m.id, { createdAt: recentDate, updatedAt: recentDate });
    } else if (m.content === "Low priority old fact") {
      await localStorage.updateMemory(m.id, { createdAt: oldDate, updatedAt: oldDate });
    } else if (m.content === "Sensitive old") {
      await localStorage.updateMemory(m.id, { createdAt: oldDate, updatedAt: oldDate });
    }
  }

  const result = await localStorage.cleanupExpiredMemories(config);
  assert.equal(result.deletedCount, 2); // old fact and old low priority
  assert.equal(result.deletedIds.length, 2);

  const remaining = await localStorage.listAllMemories();
  const remainingContents = remaining.map((m) => m.content);
  assert.ok(remainingContents.includes("Recent fact"));
  assert.ok(remainingContents.includes("Sensitive old"));
});

test("storage - searchMemories excludes expired by default", async () => {
  const config = {
    memory: {
      ttl: { defaultDays: 90, factDays: 180, lowPriorityDays: 30, sensitiveDays: 365 },
    },
  };
  const now = new Date();
  const oldDate = new Date(now.getTime() - 200 * 86400000).toISOString();

  const mem = await localStorage.addMemory("Search expired fact", "project", undefined, {
    type: "fact", confidence: 0.5, priority: 1, sensitivity: "normal",
  });
  await localStorage.updateMemory(mem.id, { createdAt: oldDate, updatedAt: oldDate });

  const defaultSearch = await localStorage.searchMemories("Search expired fact", { scope: "project" });
  assert.equal(defaultSearch.length, 0); // expired by default

  const includeExpiredSearch = await localStorage.searchMemories("Search expired fact", { scope: "project", includeExpired: true });
  assert.equal(includeExpiredSearch.length, 1);

  const ttlDaysSearch = await localStorage.searchMemories("Search expired fact", { scope: "project", ttlDays: 300 });
  assert.equal(ttlDaysSearch.length, 1);
});
