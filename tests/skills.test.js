import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { skillsStorage } from "../src/skills.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-skills-test-${process.pid}-${Date.now()}`);

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

test("skills - addSkill and getSkill work", async () => {
  const skill = await skillsStorage.addSkill("Use TypeScript for new modules", "project", { tags: ["type"] });
  assert.equal(skill.content, "Use TypeScript for new modules");
  assert.equal(skill.scope, "project");
  assert.ok(skill.id);

  const found = await skillsStorage.getSkill(skill.id);
  assert.equal(found.content, "Use TypeScript for new modules");
});

test("skills - listSkills and searchSkills filter by scope", async () => {
  await skillsStorage.addSkill("Global caching rule", "global");
  await skillsStorage.addSkill("Project test framework", "project");

  const all = await skillsStorage.listSkills("global");
  assert.ok(all.length >= 2);

  const project = await skillsStorage.listSkills("project");
  assert.ok(project.length === 1);
  assert.equal(project[0].content, "Project test framework");

  const searched = await skillsStorage.searchSkills("test framework", "project");
  assert.ok(searched.some((s) => s.content.includes("test framework")));
});

test("skills - updateSkill and deleteSkill work", async () => {
  const skill = await skillsStorage.addSkill("Original skill content", "global");
  const updated = await skillsStorage.updateSkill(skill.id, { content: "Updated skill content", tags: ["v2"] });
  assert.equal(updated.content, "Updated skill content");
  assert.deepEqual(updated.tags, ["v2"]);

  const deleted = await skillsStorage.deleteSkill(skill.id);
  assert.equal(deleted, true);
  const gone = await skillsStorage.getSkill(skill.id);
  assert.equal(gone, null);
});
