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
const MAX_ACCESS_LOGS = 10000;

async function loadTracking() {
  const filePath = path.join(getStorageDir(), TRACKING_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    // Ensure accessLogs array exists
    if (!parsed.accessLogs) {
      parsed.accessLogs = [];
    }
    return parsed;
  } catch {
    return {
      version: 1,
      generated: {},
      retrievals: [],
      deletions: [],
      injections: { hits: 0, misses: 0 },
      accessLogs: [],
    };
  }
}

async function saveTracking(tracking) {
  const filePath = path.join(getStorageDir(), TRACKING_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Trim access logs to prevent unbounded growth
  if (tracking.accessLogs && tracking.accessLogs.length > MAX_ACCESS_LOGS) {
    tracking.accessLogs = tracking.accessLogs.slice(-MAX_ACCESS_LOGS);
  }
  await fs.writeFile(filePath, JSON.stringify(tracking, null, 2), "utf-8");
}

export async function recordAccessLog({ memoryId, query, type, rank }) {
  const tracking = await loadTracking();
  const entry = {
    id: randomUUID(),
    memoryId,
    query: query || null,
    type: type || "recall",
    rank: rank !== undefined ? rank : null,
    recordedAt: new Date().toISOString(),
  };
  tracking.accessLogs.push(entry);
  // Also update per-memory access counts
  if (memoryId && tracking.generated[memoryId]) {
    tracking.generated[memoryId].accessCount = (tracking.generated[memoryId].accessCount || 0) + 1;
    tracking.generated[memoryId].lastAccessedAt = entry.recordedAt;
  }
  await saveTracking(tracking);
  return entry;
}

export async function getAccessLog(limit, offset) {
  const tracking = await loadTracking();
  const logs = tracking.accessLogs || [];
  const start = offset !== undefined ? offset : Math.max(0, logs.length - (limit || 50));
  const end = limit !== undefined ? start + limit : logs.length;
  return logs.slice(start, end);
}

export async function getAccessLogByMemory(memoryId) {
  const tracking = await loadTracking();
  return (tracking.accessLogs || []).filter((l) => l.memoryId === memoryId);
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
      info.lastAccessedAt = entry.recordedAt;
    }
  }
  await saveTracking(tracking);
  // Record detailed access logs for each retrieved memory
  for (let i = 0; i < memoryIds.length; i++) {
    try {
      await recordAccessLog({
        memoryId: memoryIds[i],
        query,
        type: "recall",
        rank: i,
      });
    } catch (e) {
      console.warn(`[opencode-mem] tracking access log failed: ${e.message}`);
    }
  }
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
  try {
    await recordAccessLog({
      memoryId,
      query: null,
      type: "inject",
      rank: null,
    });
  } catch (e) {
    console.warn(`[opencode-mem] tracking injection access log failed: ${e.message}`);
  }
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
    totalAccessLogs: (tracking.accessLogs || []).length,
    injectionHits: (tracking.injections && tracking.injections.hits) || 0,
    injectionMisses: (tracking.injections && tracking.injections.misses) || 0,
    memoryStats: Object.entries(tracking.generated || {}).map(([id, info]) => ({
      memoryId: id,
      scope: info.scope,
      createdAt: info.createdAt,
      accessCount: info.accessCount || 0,
      injectionHitCount: info.injectionHitCount || 0,
      lastAccessedAt: info.lastAccessedAt || null,
      deletedAt: info.deletedAt,
    })),
  };
  return stats;
}

export async function clearTracking() {
  const tracking = {
    version: 1,
    generated: {},
    retrievals: [],
    deletions: [],
    injections: { hits: 0, misses: 0 },
    accessLogs: [],
  };
  await saveTracking(tracking);
  return tracking;
}

export default {
  recordAccessLog,
  getAccessLog,
  getAccessLogByMemory,
  recordGeneration,
  recordSearch,
  recordDeletion,
  recordInjectionHit,
  recordInjectionMiss,
  getAccessStats,
  clearTracking,
};
