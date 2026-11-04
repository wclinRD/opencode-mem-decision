import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMemory, looksSensitive } from "../src/classify.js";

test("classifyMemory - detects preferences", () => {
  const result = classifyMemory("I prefer using TypeScript over JavaScript.");
  assert.equal(result.type, "preference");
  assert.ok(result.confidence > 0.5);
  assert.equal(result.sensitive, false);
});

test("classifyMemory - detects rules", () => {
  const result = classifyMemory("The system must not expose debug APIs to users.");
  assert.equal(result.type, "rule");
  assert.ok(result.confidence > 0.5);
  assert.equal(result.sensitive, false);
});

test("classifyMemory - detects lessons", () => {
  const result = classifyMemory("The root cause of the bug was a race condition in the auth module.");
  assert.equal(result.type, "lesson");
  assert.ok(result.confidence > 0.5);
  assert.equal(result.sensitive, false);
});

test("classifyMemory - detects facts", () => {
  const result = classifyMemory("The app uses Fastify and runs on port 56789.");
  assert.equal(result.type, "fact");
  assert.ok(result.confidence >= 0.5);
  assert.equal(result.sensitive, false);
});

test("classifyMemory - detects sensitive content", () => {
  const result = classifyMemory("Use GitHub token ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.");
  assert.equal(result.sensitive, true);
  assert.equal(result.type, "fact");
});

test("looksSensitive - matches emails and keys", () => {
  assert.ok(looksSensitive("Contact is test@example.com and key is sk-12345678901234567890123456789012"));
});
