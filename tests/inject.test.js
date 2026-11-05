import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { localStorage } from "../src/storage/local.js";
import {
  injectMemories,
  formatInjectedPrompt,
  stripInjectedBlock,
  INJECTION_MARKER,
} from "../src/inject.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-inject-test-${process.pid}-${Date.now()}`);

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

const config = (overrides = {}) => ({
  chatMessage: {
    enabled: true,
    recall: "relevant",
    recallScope: "default",
    maxMemories: 3,
    excludeCurrentSession: true,
    filterInjectedPrompts: true,
    ...overrides,
  },
});

test("inject - relevant recall returns matching memories", async () => {
  const memory = await localStorage.addMemory("Deploys use Fly.io", "default");
  await localStorage.addMemory("Unrelated gardening note", "default");

  const results = await injectMemories({
    sessionData: { id: "ses_1", latestMessage: "How do Fly deploys work?" },
    memoryConfig: config(),
    storage: localStorage,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, memory.id);
});

test("inject - relevant recall falls back to recent memories", async () => {
  const memory = await localStorage.addMemory("Deploys use Fly.io", "default");

  const results = await injectMemories({
    sessionData: { id: "ses_1", latestMessage: "quantum banana" },
    memoryConfig: config(),
    storage: localStorage,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, memory.id);
});

test("inject - excludes memories from the current session", async () => {
  await localStorage.addMemory("Same session memory", "project", "ses_1");

  const results = await injectMemories({
    sessionData: { id: "ses_1", latestMessage: "same session" },
    memoryConfig: config({ recall: "recent" }),
    storage: localStorage,
  });

  assert.equal(results.length, 0);
});

test("inject - duplicates by id are injected once", async () => {
  const memory = {
    id: "mem_duplicate",
    content: "Deploys use Fly.io",
    scope: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(TEST_DIR, "memories.db.json"),
    JSON.stringify({ memories: [memory, { ...memory }] })
  );

  const results = await injectMemories({
    sessionData: { id: "ses_1", latestMessage: "How do Fly deploys work?" },
    memoryConfig: config(),
    storage: localStorage,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "mem_duplicate");
});

test("inject - stripInjectedBlock cuts at the marker", () => {
  const original = "hello";
  const injected = `${original}\n\n${INJECTION_MARKER}\n${formatInjectedPrompt([{ id: "mem_1", content: "old fact" }])}`;
  assert.equal(stripInjectedBlock(injected), original);
  assert.equal(stripInjectedBlock(original), original);
});
