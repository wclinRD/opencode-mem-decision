import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { resolveProjectShared, createProjectMarker } from "../src/projectShared.js";

function makeTempDir() {
  return path.join(os.tmpdir(), `opencode-mem-project-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
}

test("projectShared - resolveProjectShared finds marker and returns project info", async () => {
  const tmpDir = makeTempDir();
  await fs.mkdir(tmpDir, { recursive: true });
  const markerFile = path.join(tmpDir, ".opencode-mem-project");
  await fs.writeFile(markerFile, "my-project-name\n", "utf8");
  const result = await resolveProjectShared({ memoryConfig: { projectShared: { enabled: true } }, cwd: tmpDir });
  assert.equal(result.projectDir, tmpDir);
  assert.equal(result.markerFileName, ".opencode-mem-project");
  assert.equal(result.projectName, "project:my-project-name");
});

test("projectShared - resolveProjectShared handles uppercase/special chars", async () => {
  const tmpDir = makeTempDir();
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(path.join(tmpDir, ".opencode-mem-project"), "My Project (alpha)\n", "utf8");
  const result = await resolveProjectShared({ memoryConfig: { projectShared: { enabled: true } }, cwd: tmpDir });
  assert.equal(result.projectName, "project:my-project-alpha");
});

test("projectShared - resolveProjectShared returns null when marker absent", async () => {
  const tmpDir = makeTempDir();
  await fs.mkdir(tmpDir, { recursive: true });
  const result = await resolveProjectShared({ memoryConfig: { projectShared: { enabled: true } }, cwd: tmpDir });
  assert.equal(result, null);
});

test("projectShared - resolveProjectShared disabled returns null", async () => {
  const tmpDir = makeTempDir();
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(path.join(tmpDir, ".opencode-mem-project"), "test\n", "utf8");
  const result = await resolveProjectShared({ memoryConfig: { projectShared: { enabled: false } }, cwd: tmpDir });
  assert.equal(result, null);
});

test("projectShared - createProjectMarker writes marker file", async () => {
  const tmpDir = makeTempDir();
  const result = await createProjectMarker(tmpDir, "test-shared");
  const content = await fs.readFile(path.join(tmpDir, ".opencode-mem-project"), "utf8");
  assert.equal(content.trim(), "test-shared");
  assert.equal(result.projectName, "test-shared");
});
