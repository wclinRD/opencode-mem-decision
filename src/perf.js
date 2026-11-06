import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "node:crypto";

const HOME_DIR = process.env.HOME || os.homedir() || "~";

function getStorageDir() {
  const override = process.env.OPENCODE_MEM_DIR;
  if (override) return path.resolve(override);
  return path.join(HOME_DIR, ".opencode-memory");
}

const BENCHMARK_FILE = "benchmarks.json";

let benchmarks = [];

async function loadBenchmarks() {
  try {
    const filePath = path.join(getStorageDir(), BENCHMARK_FILE);
    const data = await fs.readFile(filePath, "utf-8");
    benchmarks = JSON.parse(data).benchmarks || [];
  } catch {
    benchmarks = [];
  }
}

async function saveBenchmarks() {
  try {
    const filePath = path.join(getStorageDir(), BENCHMARK_FILE);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ benchmarks }, null, 2), "utf-8");
  } catch (e) {
    console.warn(`[opencode-mem] failed to save benchmarks: ${e.message}`);
  }
}

async function clearBenchmarks() {
  benchmarks = [];
  try {
    const filePath = path.join(getStorageDir(), BENCHMARK_FILE);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ benchmarks: [] }, null, 2), "utf-8");
  } catch {
    // File may not exist yet
  }
}

export function calculateRecall(expectedIds, returnedIds) {
  if (expectedIds.length === 0) return 1;
  const hit = expectedIds.filter((id) => returnedIds.includes(id)).length;
  return hit / expectedIds.length;
}

export function calculatePrecision(expectedIds, returnedIds) {
  if (returnedIds.length === 0) return 1;
  const hit = expectedIds.filter((id) => returnedIds.includes(id)).length;
  return hit / returnedIds.length;
}

export async function runBenchmark(name, queries, searchFn, filters = {}) {
  const results = [];
  let totalRecall = 0;
  let totalPrecision = 0;
  let totalLatency = 0;

  for (const q of queries) {
    const expectedIds = q.expectedIds || [];
    const expectedCount = q.expectedCount ?? expectedIds.length;
    let returned = [];
    let latencyMs = 0;

    if (searchFn) {
      try {
        const start = Date.now();
        returned = await searchFn(q.query, filters);
        latencyMs = Date.now() - start;
      } catch (e) {
        console.warn(`[opencode-mem] benchmark query failed: ${e.message}`);
        returned = [];
      }
    }

    const returnedIds = returned.map((m) => m.id);
    let recall = 0;
    let precision = 0;

    if (expectedCount > 0) {
      const hitCount = expectedIds.filter((id) => returnedIds.includes(id)).length;
      recall = hitCount / expectedCount;
      precision = returnedIds.length > 0 ? hitCount / returnedIds.length : 0;
    } else {
      // No expected results: recall is 1, precision is 1 if no results, 0 otherwise
      recall = returnedIds.length === 0 ? 1 : 0;
      precision = returnedIds.length === 0 ? 1 : 0;
    }

    totalRecall += recall;
    totalPrecision += precision;
    totalLatency += latencyMs;

    results.push({
      query: q.query,
      expectedCount,
      returnedCount: returned.length,
      recalledCount: expectedIds.filter((id) => returnedIds.includes(id)).length,
      recall,
      precision,
      latencyMs,
    });
  }

  const count = queries.length;
  const benchmark = {
    id: `bench_${Date.now()}_${randomUUID().slice(0, 8)}`,
    name,
    timestamp: new Date().toISOString(),
    queriesCount: count,
    avgRecall: count > 0 ? totalRecall / count : 0,
    avgPrecision: count > 0 ? totalPrecision / count : 0,
    avgLatencyMs: count > 0 ? totalLatency / count : 0,
    results,
  };

  benchmarks.push(benchmark);
  await saveBenchmarks();

  return benchmark;
}

export async function getBenchmarks() {
  await loadBenchmarks();
  return benchmarks;
}

export async function clearBenchmarkData() {
  await clearBenchmarks();
}

export default {
  calculateRecall,
  calculatePrecision,
  runBenchmark,
  getBenchmarks,
  clearBenchmarkData,
};
