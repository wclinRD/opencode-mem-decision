import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHierarchicalGraph } from "../src/organize.js";
import { simulateDualRouteRetrieve } from "../src/retrieval.js";

test("buildHierarchicalGraph - creates base summary category nodes and edges", () => {
  const memories = [
    { id: "m1", content: "TypeScript is used in this project", tags: ["typescript"], type: "fact", scope: "project:demo", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "m2", content: "Use Python to analyze data", tags: ["python"], type: "fact", scope: "project:demo", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
    { id: "m3", content: "Fix the bug in authentication module", tags: ["debug", "authentication"], type: "lesson", scope: "project:demo", createdAt: "2026-01-03T00:00:00Z", updatedAt: "2026-01-03T00:00:00Z" },
  ];
  const graphData = buildHierarchicalGraph(memories, { similarityThreshold: 0.4 });
  assert.equal(graphData.baseNodes.length, 3);
  assert.ok(graphData.summaryNodes.length > 0);
  assert.ok(graphData.categoryNodes.length > 0);
  assert.ok(graphData.edges.length > 0);
  const semanticEdges = graphData.edges.filter((e) => e.type === "semantic");
  const temporalEdges = graphData.edges.filter((e) => e.type === "temporal");
  assert.ok(semanticEdges.length > 0 || temporalEdges.length > 0);
});

test("buildHierarchicalGraph - handles no embeddings and uses token BM25", () => {
  const memories = [
    { id: "g1", content: "The app uses Fastify and runs on port 3000", tags: ["fastify"], type: "fact", scope: "default", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "g2", content: "Fastify is a web framework for Node.js", tags: ["fastify", "node"], type: "fact", scope: "default", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
  ];
  const graphData = buildHierarchicalGraph(memories, { similarityThreshold: 0.3 });
  const semanticEdges = graphData.edges.filter((e) => e.type === "semantic");
  assert.ok(semanticEdges.length > 0, "should create semantic edges between similar text");
});

test("simulateDualRouteRetrieve - uses system1 and system2 routes", () => {
  const memories = [
    { id: "r1", content: "React is a UI library", tags: ["react"], type: "fact", scope: "default", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "r2", content: "Use React for building components", tags: ["react"], type: "lesson", scope: "default", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
  ];
  const graphData = buildHierarchicalGraph(memories, { similarityThreshold: 0.4 });
  const result = simulateDualRouteRetrieve("React component", memories, graphData, { similarityThreshold: 0.3 });
  assert.ok(result.system1Results.length > 0 || result.system2Results.length > 0);
  assert.ok(result.query === "React component");
});
