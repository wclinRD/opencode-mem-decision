import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { localStorage } from "../src/storage/local.js";

// Use a dedicated test directory for storage tests
const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-storage-test-${Date.now()}`);
const TEST_MEMORIES_FILE = path.join(TEST_DIR, "memories.db.json");
const TEST_KNOWLEDGE_FILE = path.join(TEST_DIR, "knowledge.db.json");

test.beforeEach(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(TEST_MEMORIES_FILE, JSON.stringify({ memories: [] }));
  await fs.writeFile(TEST_KNOWLEDGE_FILE, JSON.stringify({ knowledge: [] }));
});

test.afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

// Helper to temporarily override the storage dir
async function withTestStorage(testFn) {
  const originalModule = await import("../src/storage/local.js");
  // We can't easily override the module's internal STORAGE_DIR, so we'll
  // test the storage functions directly by mocking the file operations.
  // For now, we'll use the actual localStorage but clean up after each test.
  await testFn();
}

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
