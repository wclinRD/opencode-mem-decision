import fs from "fs/promises";
import path from "path";
import os from "os";
import { redactCredentials } from "../security.js";

const HOME_DIR = process.env.HOME || os.homedir() || "~";
const MEMORIES_FILE = "memories.db.json";
const KNOWLEDGE_FILE = "knowledge.db.json";

export function getStorageDir() {
  const override = process.env.OPENCODE_MEM_DIR;
  if (override) return path.resolve(override);
  return path.join(HOME_DIR, ".opencode-memory");
}

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
}

async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    if (e.code === "ENOENT") return { memories: [], knowledge: [] };
    throw e;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function addMemory(content, scope = "project", sessionId, metadata = {}) {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  await ensureDir(path.dirname(filePath));
  const db = await readJsonFile(filePath);

  const memory = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    content: redactCredentials(content),
    scope,
    type: metadata.type || "fact",
    confidence: Number.isFinite(metadata.confidence) ? metadata.confidence : 0.5,
    sensitivity: metadata.sensitive === true ? "sensitive" : "normal",
    priority: Number.isFinite(metadata.priority) ? metadata.priority : 1,
    tags: metadata.tags || [],
    ...(sessionId ? { sessionId } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.memories.push(memory);
  await writeJsonFile(filePath, db);
  return memory;
}

function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

export async function searchMemories(query, filters = {}) {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  const effectiveScope = typeof filters === "string" ? filters : (filters.scope || "default");
  const typeFilter = filters.type;
  const confidenceFilter = filters.confidence;
  const priorityFilter = filters.priority;
  const timeRange = filters.timeRange;

  let scoped = db.memories.filter((m) => effectiveScope === "default" || m.scope === effectiveScope);

  if (typeFilter) scoped = scoped.filter((m) => m.type === typeFilter);
  if (confidenceFilter && typeof confidenceFilter === "number") {
    scoped = scoped.filter((m) => Number(m.confidence) >= confidenceFilter);
  }
  if (priorityFilter !== undefined && priorityFilter !== "all") {
    scoped = scoped.filter((m) => Number(m.priority) === Number(priorityFilter));
  }
  if (timeRange) {
    const cutoff = new Date(Date.now() - timeRange).toISOString();
    scoped = scoped.filter((m) => m.createdAt >= cutoff);
  }

  const queryTokens = query ? [...new Set(tokenize(query))] : [];

  if (!queryTokens.length) {
    return scoped
      .sort((a, b) => Number(b.priority) - Number(a.priority) || new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
  }

  return scoped
    .map((memory) => {
      const memoryTokens = new Set(tokenize(memory.content));
      const score = queryTokens.reduce((total, token) => total + (memoryTokens.has(token) ? 1 : 0), 0);
      return { memory, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt))
    .map((entry) => entry.memory);
}

export async function listMemories(limit = 50, scope = "default") {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  return db.memories
    .filter((m) => scope === "default" || m.scope === scope)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export async function getMemory(id) {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  return db.memories.find((m) => m.id === id) || null;
}

export async function deleteMemory(id) {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  const index = db.memories.findIndex((m) => m.id === id);
  if (index >= 0) {
    db.memories.splice(index, 1);
    await writeJsonFile(filePath, db);
    return true;
  }
  return false;
}

export async function deleteMemories(query, scope = "default") {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  const scoped = db.memories.filter((m) => scope === "default" || m.scope === scope);
  const queryTokens = [...new Set(tokenize(query))];
  const toDeleteIds = scoped
    .filter((memory) => {
      if (!queryTokens.length) return true;
      const memoryTokens = new Set(tokenize(memory.content));
      return queryTokens.some((token) => memoryTokens.has(token));
    })
    .map((m) => m.id);

  const deletedCount = db.memories.filter((m) => toDeleteIds.includes(m.id)).length;
  db.memories = db.memories.filter((m) => !toDeleteIds.includes(m.id));
  await writeJsonFile(filePath, db);
  return deletedCount;
}

export async function updateMemory(id, updates) {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  const memory = db.memories.find((m) => m.id === id);
  if (!memory) return null;

  Object.assign(memory, updates, { updatedAt: new Date().toISOString() });
  await writeJsonFile(filePath, db);
  return memory;
}

export async function exportMemories(outputPath) {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  await fs.writeFile(outputPath, JSON.stringify(db.memories, null, 2), "utf-8");
  return outputPath;
}

export async function importMemories(inputPath) {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const data = JSON.parse(await fs.readFile(inputPath, "utf-8"));
  const db = await readJsonFile(filePath);
  db.memories.push(...data);
  await writeJsonFile(filePath, db);
  return db.memories.length;
}

export async function listShards() {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  const shards = new Set(db.memories.map((m) => m.scope || "default"));
  return Array.from(shards);
}

export async function migrate(fromPath) {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const fromDb = JSON.parse(await fs.readFile(fromPath, "utf-8"));
  const toDb = await readJsonFile(filePath);
  toDb.memories.push(...fromDb.memories || []);
  await writeJsonFile(filePath, toDb);
  return toDb.memories.length;
}

export async function addKnowledge(content, id) {
  const filePath = path.join(getStorageDir(), KNOWLEDGE_FILE);
  await ensureDir(path.dirname(filePath));
  const db = await readJsonFile(filePath);

  const knowledge = {
    id: id || `kb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    content: redactCredentials(content),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const existing = db.knowledge.find((k) => k.id === knowledge.id);
  if (existing) {
    Object.assign(existing, knowledge);
  } else {
    db.knowledge.push(knowledge);
  }
  await writeJsonFile(filePath, db);
  return knowledge;
}

export async function listKnowledge() {
  const filePath = path.join(getStorageDir(), KNOWLEDGE_FILE);
  const db = await readJsonFile(filePath);
  return db.knowledge || [];
}

export async function getKnowledge(id) {
  const filePath = path.join(getStorageDir(), KNOWLEDGE_FILE);
  const db = await readJsonFile(filePath);
  return (db.knowledge || []).find((k) => k.id === id) || null;
}

export async function deleteKnowledge(id) {
  const filePath = path.join(getStorageDir(), KNOWLEDGE_FILE);
  const db = await readJsonFile(filePath);
  const index = (db.knowledge || []).findIndex((k) => k.id === id);
  if (index >= 0) {
    db.knowledge.splice(index, 1);
    await writeJsonFile(filePath, db);
    return true;
  }
  return false;
}

export const localStorage = {
  addMemory,
  searchMemories,
  listMemories,
  getMemory,
  deleteMemory,
  deleteMemories,
  updateMemory,
  exportMemories,
  importMemories,
  listShards,
  migrate,
  addKnowledge,
  listKnowledge,
  getKnowledge,
  deleteKnowledge,
};
