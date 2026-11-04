import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { localStorage, getStorageDir } from "../src/storage/local.js";
import { ensureSchema, readVersion, writeVersion, SCHEMA_VERSION } from "../src/storage/migrations.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-migrations-test-${process.pid}-${Date.now()}`);

test.beforeEach(async () => {
  process.env.OPENCODE_MEM_DIR = TEST_DIR;
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.rm(path.join(TEST_DIR, "storage-version.json"), { force: true });
});

test.afterEach(async () => {
  delete process.env.OPENCODE_MEM_DIR;
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test("migrations - readVersion defaults to 1", async () => {
  const version = await readVersion();
  assert.equal(version, 1);
});

test("migrations - ensureSchema writes schema version", async () => {
  const version = await ensureSchema();
  assert.equal(version, SCHEMA_VERSION);
  const stored = JSON.parse(await fs.readFile(path.join(getStorageDir(), "storage-version.json"), "utf8"));
  assert.equal(stored.version, SCHEMA_VERSION);
});

test("migrations - writeVersion and readVersion consistency", async () => {
  await writeVersion(3);
  const version = await readVersion();
  assert.equal(version, 3);
});
