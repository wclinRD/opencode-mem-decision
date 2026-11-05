import { describe, test } from "node:test";
import assert from "node:assert";
import { calculateMemoryUtilityScore, getTtlDaysForMemory } from "../src/storage/local.js";

const now = Date.now();
const baseMemory = { content: "Sample memory", type: "fact", confidence: 0.7, tags: ["js"], priority: 1, sensitivity: "normal" };

describe("calculateMemoryUtilityScore", () => {
  test("returns expected base score for fact memory", () => {
    const score = calculateMemoryUtilityScore(baseMemory);
    assert.ok(score >= 0.8, `expected score at least 0.8, got ${score}`);
  });

  test("preferences score higher than facts", () => {
    const pref = { ...baseMemory, type: "preference" };
    const fact = { ...baseMemory, type: "fact" };
    assert.ok(calculateMemoryUtilityScore(pref) > calculateMemoryUtilityScore(fact));
  });

  test("low confidence reduces score", () => {
    const lowConf = { ...baseMemory, confidence: 0.2 };
    const highConf = { ...baseMemory, confidence: 0.9 };
    assert.ok(calculateMemoryUtilityScore(lowConf) < calculateMemoryUtilityScore(highConf));
  });

  test("tags and length increase score", () => {
    const enriched = { ...baseMemory, tags: ["js", "web", "api"], content: "a".repeat(1000) };
    const minimal = baseMemory;
    assert.ok(calculateMemoryUtilityScore(enriched) > calculateMemoryUtilityScore(minimal));
  });

  test("recency boosts score slightly", () => {
    const fresh = { ...baseMemory, updatedAt: new Date(now).toISOString() };
    const stale = { ...baseMemory, updatedAt: new Date(now - 30 * 86400000).toISOString() };
    assert.ok(calculateMemoryUtilityScore(fresh) >= calculateMemoryUtilityScore(stale));
  });
});

describe("getTtlDaysForMemory dynamic TTL", () => {
  const config = { memory: { ttl: { defaultDays: 90, factDays: 180, lowPriorityDays: 30, sensitiveDays: 365 } } };

  test("high utility extends TTL above default", () => {
    const m = { ...baseMemory, content: "x".repeat(1000), tags: ["a", "b", "c"], confidence: 0.9, type: "rule" };
    const days = getTtlDaysForMemory(m, config);
    assert.ok(days > 90, `expected >90, got ${days}`);
  });

  test("low utility reduces TTL below default for non-fact type", () => {
    const m = { ...baseMemory, type: "unknown", confidence: 0.0, tags: [], content: "", priority: 1 };
    const days = getTtlDaysForMemory(m, config);
    assert.ok(days < 90, `expected <90, got ${days}`);
  });

  test("sensitive always returns max TTL", () => {
    const s = { ...baseMemory, sensitivity: "sensitive" };
    assert.strictEqual(getTtlDaysForMemory(s, config), 365);
  });

  test("priority 0 returns min default/low priority", () => {
    const p = { ...baseMemory, priority: 0 };
    assert.strictEqual(getTtlDaysForMemory(p, config), 30);
  });
});