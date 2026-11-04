import test from "node:test";
import assert from "node:assert/strict";
import { calculateSimilarity, isDuplicate } from "../src/capture.js";

test("calculateSimilarity - identical text", async () => {
  const sim = await calculateSimilarity("React and Tailwind", "React and Tailwind");
  assert.equal(sim, 1.0);
});

test("calculateSimilarity - partial overlap", async () => {
  const sim = await calculateSimilarity("React Tailwind CSS", "React and CSS");
  assert.ok(sim > 0 && sim < 1);
});

test("isDuplicate - high similarity", async () => {
  const result = isDuplicate(
    "Project uses React and Tailwind CSS for frontend",
    [{ id: "mem_old", content: "Project uses React and Tailwind CSS for frontend" }],
    0.75
  );
  assert.equal(result.duplicate, true);
  assert.equal(result.existingId, "mem_old");
});

test("isDuplicate - low similarity", async () => {
  const result = isDuplicate(
    "Python data pipeline using pandas",
    [{ id: "mem_old", content: "React and Tailwind CSS" }],
    0.75
  );
  assert.equal(result.duplicate, false);
});
