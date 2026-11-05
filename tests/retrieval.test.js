import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { localStorage, getStorageDir, setEmbeddingService } from "../src/storage/local.js";
import { buildHierarchicalGraph } from "../src/organize.js";
import { simulateDualRouteRetrieve } from "../src/retrieval.js";
import { saveGraph } from "../src/storage/graph.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-retrieval-benchmark-${process.pid}-${Date.now()}`);

function clearTestDir() {
  return fs.mkdir(TEST_DIR, { recursive: true }).then(() =>
    Promise.all([
      fs.writeFile(path.join(TEST_DIR, "memories.db.json"), JSON.stringify({ memories: [] })),
      fs.writeFile(path.join(TEST_DIR, "graph.db.json"), JSON.stringify({ baseNodes: [], summaryNodes: [], categoryNodes: [], edges: [] })),
    ])
  );
}

test.beforeEach(async () => {
  process.env.OPENCODE_MEM_DIR = TEST_DIR;
  setEmbeddingService(null);
  await clearTestDir();
});

test.afterEach(async () => {
  delete process.env.OPENCODE_MEM_DIR;
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test("retrieval benchmark - dual-route vs flat search accuracy", async () => {
  // Synthetic memory corpus with expected labels per query.
  const syntheticMemories = [
    { label: "m1", content: "TypeScript is used in React frontend components for the UI", tags: ["typescript", "react", "frontend"] },
    { label: "m2", content: "Python scripts analyze large data sets and generate reports", tags: ["python", "data", "analysis"] },
    { label: "m3", content: "Go microservices handle authentication and authorization", tags: ["go", "auth", "microservice"] },
    { label: "m4", content: "Docker containers are used for deployment to production", tags: ["docker", "deployment"] },
    { label: "m5", content: "PostgreSQL database stores user data and transactions", tags: ["database", "postgresql"] },
    { label: "m6", content: "React and Tailwind CSS make up the frontend UI framework", tags: ["react", "tailwind", "ui"] },
    { label: "m7", content: "Kubernetes manages container orchestration and scaling", tags: ["kubernetes", "orchestration"] },
    { label: "m8", content: "Rust is used for performance-critical server modules", tags: ["rust", "performance"] },
    { label: "m9", content: "GraphQL API integrates with the React frontend", tags: ["graphql", "api", "react"] },
    { label: "m10", content: "Redis cache improves API performance and reduces latency", tags: ["redis", "cache", "performance"] },
    { label: "m11", content: "This is a low-value boilerplate note with no technical meaning", tags: ["boilerplate"] },
    { label: "m12", content: "Another low-value test noise memory entry", tags: ["noise"] },
  ];

  for (const m of syntheticMemories) {
    await localStorage.addMemory(m.content, "default", null, { tags: m.tags, type: "fact", confidence: 0.8 });
  }

  const allMemories = await localStorage.listAllMemories();
  // Map labels to actual stored memory IDs by index.
  const labelToActualId = new Map(syntheticMemories.map((s, i) => [s.label, allMemories[i].id]));

  const graphData = buildHierarchicalGraph(allMemories, { similarityThreshold: 0.4 });
  await saveGraph(graphData);

  const testQueries = [
    { query: "React frontend", expectedIds: ["m1", "m6", "m9"].map((l) => labelToActualId.get(l)) },
    { query: "data analysis", expectedIds: ["m2"].map((l) => labelToActualId.get(l)) },
    { query: "authentication", expectedIds: ["m3"].map((l) => labelToActualId.get(l)) },
    { query: "deployment containers", expectedIds: ["m4", "m7"].map((l) => labelToActualId.get(l)) },
    { query: "database PostgreSQL", expectedIds: ["m5"].map((l) => labelToActualId.get(l)) },
    { query: "microservice Go", expectedIds: ["m3"].map((l) => labelToActualId.get(l)) },
    { query: "performance cache", expectedIds: ["m8", "m10"].map((l) => labelToActualId.get(l)) },
    { query: "TypeScript React GraphQL", expectedIds: ["m1", "m6", "m9"].map((l) => labelToActualId.get(l)) },
  ];

  let flatPrecisionSum = 0;
  let dualPrecisionSum = 0;
  let flatRecallSum = 0;
  let dualRecallSum = 0;
  let dualBetterCount = 0;

  for (const { query, expectedIds: goldIds } of testQueries) {
    // Flat search (no graph).
    const flatResults = await localStorage.searchMemories(query, { scope: "default" });
    const flatResultIds = new Set(flatResults.map((m) => m.id));

    // Dual-route retrieval using the same memory list and graph data.
    const dualResults = simulateDualRouteRetrieve(query, allMemories, graphData, { similarityThreshold: 0.4 });
    const dualResultIds = new Set(
      [...dualResults.system1Results, ...dualResults.system2Results].map((r) => r.memory?.id || r.id)
    );

    const goldIdSet = new Set(goldIds);
    const flatCorrect = [...flatResultIds].filter((id) => goldIdSet.has(id));
    const dualCorrect = [...dualResultIds].filter((id) => goldIdSet.has(id));

    const flatPrecision = flatResultIds.size > 0 ? flatCorrect.length / flatResultIds.size : 0;
    const dualPrecision = dualResultIds.size > 0 ? dualCorrect.length / dualResultIds.size : 0;
    const flatRecall = goldIdSet.size > 0 ? flatCorrect.length / goldIdSet.size : 1;
    const dualRecall = goldIdSet.size > 0 ? dualCorrect.length / goldIdSet.size : 1;

    flatPrecisionSum += flatPrecision;
    dualPrecisionSum += dualPrecision;
    flatRecallSum += flatRecall;
    dualRecallSum += dualRecall;
    if (dualPrecision >= flatPrecision && dualRecall >= flatRecall) {
      dualBetterCount++;
    }

    console.log(`Query: ${query}`);
    console.log(`  expected: ${goldIds.join(", ")}`);
    console.log(`  flat results: ${[...flatResultIds].join(", ") || "(none)"}`);
    console.log(`  dual results: ${[...dualResultIds].join(", ") || "(none)"}`);
    console.log(`  flat precision/recall: ${flatPrecision.toFixed(2)} / ${flatRecall.toFixed(2)}`);
    console.log(`  dual precision/recall: ${dualPrecision.toFixed(2)} / ${dualRecall.toFixed(2)}`);
  }

  const testCount = testQueries.length;
  const avgFlatPrecision = flatPrecisionSum / testCount;
  const avgDualPrecision = dualPrecisionSum / testCount;
  const avgFlatRecall = flatRecallSum / testCount;
  const avgDualRecall = dualRecallSum / testCount;

  console.log(`\nBenchmark Summary (average over ${testCount} queries):`);
  console.log(`  Flat search: precision ${avgFlatPrecision.toFixed(2)}, recall ${avgFlatRecall.toFixed(2)}`);
  console.log(`  Dual-route: precision ${avgDualPrecision.toFixed(2)}, recall ${avgDualRecall.toFixed(2)}`);
  console.log(`  Queries where dual-route ≥ flat in both metrics: ${dualBetterCount}/${testCount}`);

  assert.ok(avgDualPrecision >= 0.75, `Dual-route precision should be >= 0.75, got ${avgDualPrecision.toFixed(2)}`);
  assert.ok(avgDualRecall >= 0.65, `Dual-route recall should be >= 0.65, got ${avgDualRecall.toFixed(2)}`);
  assert.ok(dualBetterCount >= Math.ceil(testCount * 0.7), `Dual-route should beat or match flat on at least 70% of queries; matched ${dualBetterCount}/${testCount}`);
});
