import fs from "fs/promises";
import path from "path";
import os from "os";

const HOME_DIR = process.env.HOME || os.homedir() || "~";

function getStorageDir() {
  const override = process.env.OPENCODE_MEM_DIR;
  if (override) return path.resolve(override);
  return path.join(HOME_DIR, ".opencode-memory");
}

export function getGraphStoragePath() {
  return path.join(getStorageDir(), "graph.db.json");
}

export async function saveGraph(graphData) {
  const filePath = getGraphStoragePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(graphData, null, 2), "utf-8");
}

export async function loadGraph() {
  const filePath = getGraphStoragePath();
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function syncGraphToStorage(graphData, db) {
  if (!graphData || !db) return graphData;
  const memoryIds = new Set((db.memories || []).map((m) => m.id));
  const baseNodes = (graphData.baseNodes || []).filter((n) => memoryIds.has(n.id));
  graphData.baseNodes = baseNodes;

  const categoryIds = new Set();
  baseNodes.forEach((n) => {
    categoryIds.add(n.id);
  });
  const categoryNodes = (graphData.categoryNodes || []).filter((n) => categoryIds.has(n.id) || n.memoryIds.some((id) => memoryIds.has(id)));
  graphData.categoryNodes = categoryNodes;

  const baseIds = new Set(baseNodes.map((n) => n.id));
  const summaryNodes = (graphData.summaryNodes || []).filter((n) => baseIds.has(n.baseId) || n.baseIds && n.baseIds.some((id) => baseIds.has(id)));
  graphData.summaryNodes = summaryNodes;

  const edges = (graphData.edges || []).filter((e) => baseIds.has(e.from) && baseIds.has(e.to) && !e.memoryIds?.some((id) => !memoryIds.has(id)));
  graphData.edges = edges;

  graphData.lastSyncAt = new Date().toISOString();
  await saveGraph(graphData);
  return graphData;
}

export function rebuildGraphIndexIfStale(db, graphData) {
  if (!graphData) return true;
  const memoryUpdated = (db.memories || []).map((m) => new Date(m.updatedAt));
  const lastModified = graphData.lastModified || graphData.lastSyncAt;
  if (!lastModified) return true;
  const latestMemory = memoryUpdated.length ? new Date(Math.max(...memoryUpdated.map((d) => d.getTime()))) : new Date(0);
  const graphTime = new Date(lastModified);
  return latestMemory > graphTime;
}
