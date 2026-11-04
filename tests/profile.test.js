import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { localStorage } from "../src/storage/local.js";
import { buildProfile, recordPrompt } from "../src/profile.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-profile-test-${process.pid}-${Date.now()}`);

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

test("profile - buildProfile returns totals, preferences, keywords and knowledge", async () => {
  await localStorage.addMemory("Deploys use Fly.io with pnpm", "project");
  await localStorage.addMemory("Always answer in Traditional Chinese", "global");
  await localStorage.addMemory("Prefer tabs over spaces", "user");
  await localStorage.addKnowledge("Deploy checklist for production releases", "kb_deploy");

  const profile = await buildProfile({ storage: localStorage, memoryConfig: {} });

  assert.equal(typeof profile.generatedAt, "string");
  assert.equal(profile.promptCount, 0);
  assert.equal(profile.totals.memories, 3);
  assert.equal(profile.totals.knowledge, 1);
  assert.deepEqual(profile.totals.scopes, { project: 1, global: 1, user: 1 });
  assert.equal(profile.userPreferences.length, 2);
  assert.equal(profile.recentMemories.length, 3);
  assert.ok(profile.topKeywords.some((entry) => entry.keyword === "deploys"));
  assert.equal(profile.knowledge.count, 1);
  assert.equal(profile.knowledge.recentTitles.length, 1);
});

test("profile - buildProfile redacts credentials in copied content", async () => {
  await localStorage.addMemory("token sk-abcdefghijklmnopqrstuvwxyz0123456789", "global");
  const profile = await buildProfile({ storage: localStorage, memoryConfig: {} });
  assert.match(profile.userPreferences[0].content, /\[REDACTED:OpenAI API Key\]/);
});

test("profile - recordPrompt persists the count and rebuilds on the interval", async () => {
  await localStorage.addMemory("Deploys use Fly.io", "project");
  const memoryConfig = { userProfileAnalysisInterval: 2 };

  const first = await recordPrompt({ storage: localStorage, memoryConfig });
  assert.equal(first, null);

  const persisted = JSON.parse(await fs.readFile(path.join(TEST_DIR, "profile.json"), "utf-8"));
  assert.equal(persisted.promptCount, 1);

  const second = await recordPrompt({ storage: localStorage, memoryConfig });
  assert.ok(second);
  assert.equal(second.promptCount, 2);
  assert.equal(second.totals.memories, 1);
});
