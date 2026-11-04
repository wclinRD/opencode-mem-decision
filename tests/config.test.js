import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, getMemoryBackend } from "../src/config.js";

test("loadConfig - returns defaults when no config provided", () => {
  const config = loadConfig();
  assert.equal(config.memoryBackend, "database");
  assert.equal(config.storagePath, "~/.opencode-memory");
  assert.equal(config.chatMessage.enabled, true);
  assert.equal(config.chatMessage.injectOn, "first");
});

test("loadConfig - merges user config with defaults", () => {
  const userConfig = {
    memoryBackend: "markdown",
    chatMessage: { enabled: false },
  };
  const config = loadConfig(userConfig);
  assert.equal(config.memoryBackend, "markdown");
  assert.equal(config.chatMessage.enabled, false);
  assert.equal(config.chatMessage.injectOn, "first"); // default preserved
});

test("getMemoryBackend - returns database by default", () => {
  assert.equal(getMemoryBackend({}), "database");
});

test("getMemoryBackend - returns configured backend", () => {
  assert.equal(getMemoryBackend({ memoryBackend: "markdown" }), "markdown");
});
