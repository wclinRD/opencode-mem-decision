import fs from "fs/promises";
import path from "path";
import os from "os";
import { EmbeddingService, cosineSimilarity } from "../embedding.js";
import { redactCredentials } from "../security.js";
import { deriveKey, encryptData, decryptData } from "./encryption.js";
import { ensureSchema } from "./migrations.js";
import { findDuplicateMemories, buildDuplicateConfig } from "../dedup.js";
import { randomBytes } from "node:crypto";

let currentEmbeddingService = null;
let encryptionKey = null;

export function setEmbeddingService(service) {
  currentEmbeddingService = service;
}

export function getEmbeddingService() {
  return currentEmbeddingService;
}

export async function initEncryption(config) {
  const enc = config?.memory?.encryption;
  if (!enc || enc.enabled !== true) return;
  const password = enc.password;
  if (!password) {
    console.warn("[opencode-mem] encryption enabled but no password provided; generating random key in session");
    encryptionKey = randomBytes(32);
    return;
  }
  const saltPath = path.join(getStorageDir(), "encryption");
  await ensureDir(saltPath);
  let salt;
  try {
    const data = await fs.readFile(path.join(saltPath, "salt.json"), "utf8");
    const parsed = JSON.parse(data);
    salt = parsed.salt;
  } catch (e) {
    if (e.code === "ENOENT") {
      salt = randomBytes(16).toString("base64");
      await fs.writeFile(path.join(saltPath, "salt.json"), JSON.stringify({ salt }), "utf8");
    } else {
      throw e;
    }
  }
  encryptionKey = await deriveKey(password, salt);
}

export async function initStorage(config) {
  await ensureSchema();
}

const HOME_DIR = process.env.HOME || os.homedir() || "~";
const MEMORIES_FILE = "memories.db.json";
const KNOWLEDGE_FILE = "knowledge.db.json";
const TRASH_FILE = "trash.db.json";
const PROJECTS_DIR = "projects";

export function getStorageDir() {
  const override = process.env.OPENCODE_MEM_DIR;
  if (override) return path.resolve(override);
  return path.join(HOME_DIR, ".opencode-memory");
}

function sanitizeProjectId(projectName) {
  return String(projectName)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/[-_]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "global";
}

export function projectStoragePath(projectName) {
  const sanitized = sanitizeProjectId(projectName);
  return path.join(getStorageDir(), PROJECTS_DIR, sanitized, "memories.db.json");
}

function attachProjectName(memory) {
  if (memory && memory.scope && memory.scope.startsWith("project:")) {
    return { ...memory, projectName: memory.scope.slice("project:".length) };
  }
  return memory;
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
    if (encryptionKey) {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object" && parsed.iv && parsed.data) {
        const plaintext = decryptData(parsed, encryptionKey);
        return JSON.parse(plaintext);
      }
    }
    return JSON.parse(data);
  } catch (e) {
    if (e.code === "ENOENT") return { memories: [], knowledge: [] };
    throw e;
  }
}

async function writeJsonFile(filePath, data) {
  let content = JSON.stringify(data, null, 2);
  if (encryptionKey) {
    content = JSON.stringify(encryptData(content, encryptionKey));
  }
  await fs.writeFile(filePath, content, "utf-8");
}

export async function addMemory(content, scope = "project", sessionId, metadata = {}, duplicateConfig = null) {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  await ensureDir(path.dirname(filePath));
  const db = await readJsonFile(filePath);

  const redacted = redactCredentials(content);
  let embedding = null;
  if (currentEmbeddingService) {
    try {
      embedding = await currentEmbeddingService.embed(redacted);
    } catch (e) {
      console.error(`[opencode-mem] embedding failed: ${e.message}`);
    }
  }

  const dupConfig = buildDuplicateConfig(duplicateConfig);

  if (dupConfig.enabled) {
    const existingMemories = (db.memories || []).filter((m) => m.content && m.content.length > 0);
    const dedup = await findDuplicateMemories(redacted, existingMemories, dupConfig.similarityThreshold, currentEmbeddingService);
    if (dedup.duplicate && dupConfig.updateOnMatch) {
      const existing = db.memories.find((m) => m.id === dedup.existingId);
      if (existing) {
        existing.content = redacted;
        existing.embedding = embedding;
        existing.scope = scope || existing.scope;
        existing.sessionId = sessionId || existing.sessionId;
        existing.type = metadata?.type || existing.type;
        existing.confidence = metadata?.confidence !== undefined ? Number(metadata.confidence) : existing.confidence;
        existing.sensitivity = metadata?.sensitive === true ? "sensitive" : existing.sensitivity;
        existing.priority = metadata?.priority !== undefined ? Number(metadata.priority) : existing.priority;
        existing.tags = metadata?.tags || existing.tags;
        existing.updatedAt = new Date().toISOString();
        await writeJsonFile(filePath, db);
        return existing;
      }
    }
    if (dedup.duplicate && !dupConfig.updateOnMatch) {
      return null;
    }
  }

  const memory = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    content: redacted,
    scope,
    type: metadata?.type || "fact",
    confidence: Number.isFinite(metadata?.confidence) ? Number(metadata.confidence) : 0.5,
    sensitivity: metadata?.sensitive === true ? "sensitive" : "normal",
    priority: Number.isFinite(metadata?.priority) ? Number(metadata.priority) : 1,
    tags: metadata?.tags || [],
    ...(sessionId ? { sessionId } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(embedding ? { embedding } : {}),
  };

  db.memories.push(memory);
  await writeJsonFile(filePath, db);
  return memory;
}

function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

export function getTtlDaysForMemory(memory, config) {
  const defaultDays = config?.memory?.ttl?.defaultDays || 90;
  const factDays = config?.memory?.ttl?.factDays || 180;
  const lowPriorityDays = config?.memory?.ttl?.lowPriorityDays || 30;
  const sensitiveDays = config?.memory?.ttl?.sensitiveDays || 365;

  if (memory.sensitivity === "sensitive") {
    return Math.max(defaultDays, sensitiveDays);
  }
  if (memory.priority === 0) {
    return Math.min(defaultDays, lowPriorityDays);
  }
  if (memory.type === "fact") {
    return factDays;
  }
  return defaultDays;
}

function normalizeContent(content) {
  return String(content || "").toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function optimizeMemories(scope = "default") {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  const groups = new Map();
  for (const m of db.memories || []) {
    const key = normalizeContent(m.content);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  const kept = [];
  const deletedIds = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    group.sort((a, b) => {
      const confA = Number(a.confidence || 0.5);
      const confB = Number(b.confidence || 0.5);
      if (confB !== confA) return confB - confA;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
    kept.push(group[0]);
    deletedIds.push(...group.slice(1).map((m) => m.id));
  }

  db.memories = kept;
  await writeJsonFile(filePath, db);
  return { deletedCount: deletedIds.length, keptCount: kept.length };
}

export async function cleanupExpiredMemories(config) {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  const deletedIds = [];
  db.memories = db.memories.filter((memory) => {
    const ttlDays = getTtlDaysForMemory(memory, config);
    const cutoff = new Date(Date.now() - ttlDays * 86400000).toISOString();
    if (memory.createdAt < cutoff) {
      deletedIds.push(memory.id);
      return false;
    }
    return true;
  });

  await writeJsonFile(filePath, db);
  return { deletedCount: deletedIds.length, deletedIds };
}

export async function searchMemories(query, filters = {}) {
  const effectiveScope = typeof filters === "string" ? filters : (filters.scope || "default");
  const isProjectScope = effectiveScope && effectiveScope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(effectiveScope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  const vectorSearch = filters.vectorSearch === true;
  const typeFilter = filters.type;
  const confidenceFilter = filters.confidence;
  const priorityFilter = filters.priority;
  const timeRange = filters.timeRange;
  const similarityThreshold = filters.similarityThreshold || 0.5;

  let scoped = db.memories.filter((m) => effectiveScope === "default" || m.scope === effectiveScope);

  // TTL filter by default unless explicitly includeExpired: true
  if (filters.includeExpired !== true) {
    const ttlDaysFilter = typeof filters.ttlDays === "number" ? filters.ttlDays : null;
    scoped = scoped.filter((memory) => {
      const ttlDays = ttlDaysFilter !== null ? ttlDaysFilter : getTtlDaysForMemory(memory, {});
      const cutoff = new Date(Date.now() - ttlDays * 86400000).toISOString();
      return memory.createdAt >= cutoff;
    });
  }

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

  // Filter by query vector if vectorSearch is enabled and embedding available
  if (vectorSearch && currentEmbeddingService && query && query.length > 0) {
    try {
      const queryVec = await currentEmbeddingService.embed(query);
      return scoped
        .filter((memory) => memory.embedding && memory.embedding.length === queryVec.length)
        .map((memory) => ({ memory, similarity: cosineSimilarity(memory.embedding, queryVec) }))
        .filter((entry) => entry.similarity >= similarityThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .map((entry) => attachProjectName(entry.memory));
    } catch (e) {
      console.error(`[opencode-mem] vector search failed: ${e.message}`);
      // fallback to string search below
    }
  }

  const queryTokens = query ? [...new Set(tokenize(query))] : [];

  if (!queryTokens.length) {
    return scoped
      .sort((a, b) => Number(b.priority) - Number(a.priority) || new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50)
      .map(attachProjectName);
  }

  return scoped
    .map((memory) => {
      const memoryTokens = new Set(tokenize(memory.content));
      const score = queryTokens.reduce((total, token) => total + (memoryTokens.has(token) ? 1 : 0), 0);
      return { memory, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt))
    .map((entry) => attachProjectName(entry.memory));
}

export async function listAllMemories(scope = "default") {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  return (db.memories || []).map(attachProjectName);
}

export async function listMemories(limit = 50, scope = "default", ttlConfig = {}) {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  return db.memories
    .filter((m) => scope === "default" || m.scope === scope)
    .filter((memory) => {
      const cutoff = new Date(Date.now() - getTtlDaysForMemory(memory, ttlConfig) * 86400000).toISOString();
      return memory.createdAt >= cutoff;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(attachProjectName);
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

export async function softDeleteMemory(id) {
  const memory = await getMemory(id);
  if (!memory) return false;

  const trashFilePath = path.join(getStorageDir(), TRASH_FILE);
  let trashData = { entries: [] };
  try {
    const data = await fs.readFile(trashFilePath, "utf-8");
    trashData = JSON.parse(data);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  trashData.entries.push({ id, content: memory.content, addedAt: new Date().toISOString(), deletedAt: new Date().toISOString() });
  await fs.mkdir(path.dirname(trashFilePath), { recursive: true });
  await fs.writeFile(trashFilePath, JSON.stringify(trashData, null, 2), "utf-8");

  return deleteMemory(id);
}

export async function cleanupTrash(retentionDays = 90) {
  const trashFilePath = path.join(getStorageDir(), TRASH_FILE);
  let trashData = { entries: [] };
  try {
    const data = await fs.readFile(trashFilePath, "utf-8");
    trashData = JSON.parse(data);
  } catch (e) {
    if (e.code === "ENOENT") return { deletedCount: 0, removedEntries: [] };
    throw e;
  }

  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  const removedEntries = trashData.entries.filter((e) => e.deletedAt && e.deletedAt < cutoff);
  trashData.entries = trashData.entries.filter((e) => !e.deletedAt || e.deletedAt >= cutoff);

  await fs.writeFile(trashFilePath, JSON.stringify(trashData, null, 2), "utf-8");
  return { deletedCount: removedEntries.length, removedEntries };
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

  const allowedFields = ["content", "scope", "sessionId", "type", "confidence", "priority", "tags", "sensitive", "sensitivity", "createdAt", "updatedAt"];
  for (const key of allowedFields) {
    if (key in updates) {
      if (key === "sensitive" || key === "sensitivity") {
        memory.sensitivity = updates[key] === true ? "sensitive" : "normal";
      } else if (key === "confidence") {
        memory.confidence = Number.isFinite(updates[key]) ? Number(updates[key]) : memory.confidence;
      } else if (key === "priority") {
        memory.priority = Number.isFinite(updates[key]) ? Number(updates[key]) : memory.priority;
      } else if (key === "tags") {
        memory.tags = Array.isArray(updates[key]) ? updates[key] : memory.tags;
      } else if (key === "type") {
        memory.type = String(updates[key]);
      } else {
        memory[key] = updates[key];
      }
    }
  }

  if (updates.content) {
    let embedding = null;
    if (currentEmbeddingService) {
      try {
        embedding = await currentEmbeddingService.embed(redactCredentials(updates.content));
      } catch (e) {
        console.error(`[opencode-mem] embedding failed: ${e.message}`);
      }
    }
    memory.embedding = embedding;
  }

  Object.assign(memory, { updatedAt: new Date().toISOString() });
  await writeJsonFile(filePath, db);
  return memory;
}

export async function exportMemories(outputPath, scope = "default") {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  await fs.writeFile(outputPath, JSON.stringify(db.memories, null, 2), "utf-8");
  return outputPath;
}

export async function importMemories(inputPath, scope = "default") {
  const isProjectScope = scope && scope.startsWith("project:");
  const targetFile = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const data = JSON.parse(await fs.readFile(inputPath, "utf-8"));
  await ensureDir(path.dirname(targetFile));
  const db = await readJsonFile(targetFile);
  db.memories.push(...data);
  await writeJsonFile(targetFile, db);
  return db.memories.length;
}

export async function listShards() {
  const filePath = path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  const shards = new Set(db.memories.map((m) => m.scope || "default"));
  // Add project shards if they exist
  const projectsDir = path.join(getStorageDir(), PROJECTS_DIR);
  try {
    const projects = await fs.readdir(projectsDir);
    for (const project of projects) {
      const projectDbPath = projectStoragePath(project);
      try {
        const projectDb = await readJsonFile(projectDbPath);
        for (const m of projectDb.memories || []) {
          shards.add(m.scope || "default");
        }
      } catch (e) {
        // ignore unreadable project files
      }
    }
  } catch (e) {
    // projects dir does not exist
  }
  return Array.from(shards);
}

export async function listProjectCounts() {
  const projectsDir = path.join(getStorageDir(), PROJECTS_DIR);
  const counts = [];
  try {
    const projects = await fs.readdir(projectsDir);
    for (const project of projects) {
      const projectDbPath = projectStoragePath(project);
      try {
        const projectDb = await readJsonFile(projectDbPath);
        const projectMemories = (projectDb.memories || []).filter((m) => m.scope && m.scope.startsWith("project:"));
        if (projectMemories.length) {
          counts.push({
            name: project,
            count: projectMemories.length,
            scope: projectMemories[0].scope,
          });
        }
      } catch (e) {
        // ignore unreadable project files
      }
    }
  } catch (e) {
    // projects dir does not exist
  }
  return counts.sort((a, b) => Number(b.count) - Number(a.count));
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
  listAllMemories,
  listMemories,
  getMemory,
  deleteMemory,
  softDeleteMemory,
  deleteMemories,
  updateMemory,
  exportMemories,
  importMemories,
  listShards,
  listProjectCounts,
  migrate,
  addKnowledge,
  listKnowledge,
  getKnowledge,
  deleteKnowledge,
  cleanupExpiredMemories,
  cleanupTrash,
  getTtlDaysForMemory,
  optimizeMemories,
};
