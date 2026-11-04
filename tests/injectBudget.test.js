import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateFillRatio, dynamicBudget, formatInjectedPrompt } from "../src/inject.js";

test("calculateFillRatio - computes ratio", () => {
  assert.equal(calculateFillRatio("hello", 10), 0.5);
  assert.equal(calculateFillRatio("1".repeat(200000), 100000), 1);
});

test("dynamicBudget - suppresses injection at high fill ratio", () => {
  assert.deepEqual(dynamicBudget(0.85), { enabled: false });
});

test("dynamicBudget - scales chunks at high pressure", () => {
  assert.deepEqual(dynamicBudget(0.75), { enabled: true, maxChunks: 2, chunkLimit: 250 });
  assert.deepEqual(dynamicBudget(0.65), { enabled: true, maxChunks: 3, chunkLimit: 400 });
  assert.deepEqual(dynamicBudget(0.5), { enabled: true, maxChunks: 5, chunkLimit: 600 });
});

test("formatInjectedPrompt - adds precedence rules and truncates", () => {
  const memories = [
    { id: "mem_1", content: "A short memory about Fastify".repeat(20), type: "fact", confidence: 0.8 },
    { id: "mem_2", content: "User prefers JSON output".repeat(15), type: "preference", confidence: 0.7 },
  ];
  const block = formatInjectedPrompt(memories, 0.5);
  assert.ok(block.includes("Precedence rules:"));
  assert.ok(block.includes("Latest user instruction"));
});
