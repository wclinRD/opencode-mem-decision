import test from "node:test";
import assert from "node:assert/strict";
import { calculateSimilarity, isDuplicate, summarizeLongText, checkSensitive, filterSessionText } from "../src/capture.js";

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

test("summarizeLongText - extracts key sentences", () => {
  const longText = [
    "First sentence is general background.",
    "The project uses TypeScript and React to build a frontend application.",
    "Then it configures Docker and deploys to Kubernetes.",
    "Some repeated boilerplate code here",
    "Security authentication is handled by OAuth2 and JWT tokens.",
    "The database is PostgreSQL with migrations handled by Prisma.",
    "Finally, the team runs unit tests with Jest and integration tests with Playwright.",
  ].join(" ");
  const summary = summarizeLongText(longText, 3);
  assert.ok(summary.includes("TypeScript") && summary.includes("React"));
  assert.ok(summary.includes("PostgreSQL") || summary.includes("OAuth2") || summary.includes("unit tests"));
});

test("filterSessionText - removes low-value lines", () => {
  const raw = `User query about React components.
[tool_use] some json
[tool_result] another block
-----BEGIN PRIVATE KEY-----
abc
-----END PRIVATE KEY-----
Git commit info branch master
Actual code comment for the feature.`;
  const filtered = filterSessionText(raw);
  assert.ok(!filtered.includes("[tool_use]"));
  assert.ok(!filtered.includes("[tool_result]"));
  assert.ok(!filtered.includes("BEGIN PRIVATE KEY"));
  assert.ok(filtered.includes("React components"));
  assert.ok(filtered.includes("Actual code comment"));
});

test("checkSensitive - detects sensitive patterns", () => {
  assert.equal(checkSensitive("My API key is sk-1234567890abcdef1234567890abcdef"), "sensitive");
  assert.equal(checkSensitive("General text without secrets"), "normal");
});
