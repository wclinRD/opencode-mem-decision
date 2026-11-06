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

const TRACKING_FILE = "tracking.json";

async function loadTracking() {
  const filePath = path.join(getStorageDir(), TRACKING_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return { version: 1, generated: {}, retrievals: [], deletions: [], injections: { hits: 0, misses: 0 } };
  }
}

async function saveTracking(tracking) {
  const filePath = path.join(getStorageDir(), TRACKING_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(tracking, null, 2), "utf-8");
}

export async function recordGeneration(memoryId, scope) {
  const tracking = await loadTracking();
  if (!tracking.generated[memoryId]) {
    tracking.generated[memoryId] = {
      scope: scope || "default",
      createdAt: new Date().toISOString(),
      accessCount: 0,
    };
  }
  await saveTracking(tracking);
}

export async function recordSearch(query, memoryIds, resultCount) {
  const tracking = await loadTracking();
  const entry = {
    id: randomUUID(),
    query,
    resultCount,
    retrievedMemoryIds: memoryIds,
    recordedAt: new Date().toISOString(),
  };
  (tracking.retrievals || (tracking.retrievals = [])).push(entry);
  for (const id of memoryIds) {
    const info = tracking.generated[id];
    if (info) {
      info.accessCount = (info.accessCount || 0) + 1;
    }
  }
  await saveTracking(tracking);
}

export async function recordDeletion(memoryId) {
  const tracking = await loadTracking();
  const info = tracking.generated[memoryId];
  if (info) {
    info.deletedAt = new Date().toISOString();
  }
  (tracking.deletions || (tracking.deletions = [])).push({
    id: randomUUID(),
    memoryId,
    deletedAt: new Date().toISOString(),
  });
  await saveTracking(tracking);
}

export async function recordInjectionHit(memoryId) {
  const tracking = await loadTracking();
  const info = tracking.generated[memoryId];
  if (info) {
    info.injectionHitCount = (info.injectionHitCount || 0) + 1;
  }
  if (tracking.injections) tracking.injections.hits = (tracking.injections.hits || 0) + 1;
  await saveTracking(tracking);
}

export async function recordInjectionMiss() {
  const tracking = await loadTracking();
  if (tracking.injections) tracking.injections.misses = (tracking.injections.misses || 0) + 1;
  await saveTracking(tracking);
}

export async function getAccessStats() {
  const tracking = await loadTracking();
  const stats = {
    totalGenerated: Object.keys(tracking.generated || {}).length,
    totalRetrievals: (tracking.retrievals || []).length,
    totalDeletions: (tracking.deletions || []).length,
    injectionHits: (tracking.injections && tracking.injections.hits) || 0,
    injectionMisses: (tracking.injections && tracking.injections.misses) || 0,
    memoryStats: Object.entries(tracking.generated || {}).map(([id, info]) => ({
      memoryId: id,
      scope: info.scope,
      createdAt: info.createdAt,
      accessCount: info.accessCount || 0,
      injectionHitCount: info.injectionHitCount || 0,
      deletedAt: info.deletedAt,
    })),
  };
  return stats;
}

export async function clearTracking() {
  const tracking = { version: 1, generated: {}, retrievals: [], deletions: [], injections: { hits: 0, misses: 0 } };
  await saveTracking(tracking);
  return tracking;
}

export default {
  recordGeneration,
  recordSearch,
  recordDeletion,
  recordInjectionHit,
  recordInjectionMiss,
  getAccessStats,
  clearTracking,
};
