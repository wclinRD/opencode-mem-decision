import { describe, test } from "node:test";
import assert from "node:assert";
import { attachProjectContext } from "../src/retrieval.js";
import { resolveProjectContext as resolveProjectContextShared } from "../src/projectShared.js";

const memories = [
  { id: "m1", content: "React frontend code", tags: ["react", "frontend"], scope: "default" },
  { id: "m2", content: "Go microservice API", tags: ["go", "backend"], scope: "default" },
  { id: "m3", content: "Project X uses React", tags: ["react"], scope: "project:X" },
];

describe("attachProjectContext", () => {
  test("adds projectContextScore for project context", () => {
    const ctx = { projectName: "X", keywords: ["react", "api"] };
    const result = attachProjectContext(memories, ctx);
    assert.ok(result[0].projectContextScore >= 0.2);
    assert.ok(result[1].projectContextScore >= 0);
    assert.ok(result[2].projectContextScore >= 0.5);
  });

  test("no context adds zero score", () => {
    const result = attachProjectContext(memories, null);
    assert.equal(result[0].projectContextScore, 0);
  });
});

describe("resolveProjectContext", () => {
  test("returns null when no marker", async () => {
    const ctx = await resolveProjectContextShared("/nonexistent/path");
    assert.equal(ctx, null);
  });
});