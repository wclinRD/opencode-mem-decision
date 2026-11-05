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

test("classifyMemory - extracts dynamic tags for task and rules", () => {
  const task = classifyMemory("How to deploy Next.js and Nuxt app with Vercel.");
  assert.equal(task.type, "task");
  assert.ok(task.tags.includes("howto"), "should include howto");
  assert.ok(task.tags.includes("nextjs"), "should include nextjs");
  assert.ok(task.tags.includes("vercel"), "should include vercel");

  const rule = classifyMemory("The policy requires JWT authentication for all APIs.");
  assert.equal(rule.type, "rule");
  assert.ok(rule.tags.includes("policy"), "should include policy");
  assert.ok(rule.tags.includes("jwt"), "should include jwt");

  const lesson = classifyMemory("Error E401 occurred when calling the service");
  assert.equal(lesson.type, "lesson");
  assert.ok(lesson.tags.includes("debug"), "should include debug");
  assert.ok(lesson.tags.some(t => t.includes("e401") || t.includes("401")), "should include error keyword");
});
