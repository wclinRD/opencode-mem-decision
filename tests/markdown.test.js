import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { markdownStorage } from "../src/storage/markdown.js";
import { getStorageDir } from "../src/storage/local.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-markdown-test-${process.pid}-${Date.now()}`);

test.beforeEach(async () => {
  process.env.OPENCODE_MEM_DIR = TEST_DIR;
  await fs.mkdir(TEST_DIR, { recursive: true });
});

test.afterEach(async () => {
  delete process.env.OPENCODE_MEM_DIR;
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test("markdown storage - addMemory creates a markdown file", async () => {
  const memory = await markdownStorage.addMemory("Vault test content", "project");
  assert.ok(memory.id.startsWith("mem_"));
  const filePath = path.join(getStorageDir(), "vault", `${memory.id}.md`);
  const content = await fs.readFile(filePath, "utf8");
  assert.ok(content.includes("---"));
  assert.ok(content.includes("Vault test content"));
});

test("markdown storage - searchMemories returns matching markdowns", async () => {
  await markdownStorage.addMemory("Vault search keyword one", "project");
  await markdownStorage.addMemory("Vault search keyword two", "project");
  const results = await markdownStorage.searchMemories("Vault search keyword", { scope: "project" });
  assert.ok(results.length >= 2);
});

test("markdown storage - getMemory returns stored markdown", async () => {
  const memory = await markdownStorage.addMemory("Vault show content", "global");
  const found = await markdownStorage.getMemory(memory.id);
  assert.equal(found.content, "Vault show content");
  assert.equal(found.scope, "global");
});

test("markdown storage - deleteMemory removes file", async () => {
  const memory = await markdownStorage.addMemory("Vault delete content", "project");
  const deleted = await markdownStorage.deleteMemory(memory.id);
  assert.equal(deleted, true);
  const filePath = path.join(getStorageDir(), "vault", `${memory.id}.md`);
  await assert.rejects(fs.access(filePath));
});
