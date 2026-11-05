import fs from "fs/promises";
import path from "path";
import os from "os";
import { EmbeddingService, cosineSimilarity } from "../embedding.js";
import { redactCredentials } from "../security.js";
import { deriveKey, encryptData, decryptData } from "./encryption.js";
import { ensureSchema } from "./migrations.js";
import { findDuplicateMemories, buildDuplicateConfig } from "../dedup.js";
import { calculateSimilarity, summarizeLongText } from "../capture.js";
import { randomBytes } from "node:crypto";
import { buildHierarchicalGraph } from "../organize.js";
import { saveGraph, loadGraph, syncGraphToStorage, rebuildGraphIndexIfStale } from "./graph.js";
import { classifyMemory, calculateWeightedConfidence } from "../classify.js";
import { attachProjectContext } from "../retrieval.js";
import { resolveProjectContext } from "../projectShared.js";

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
  await syncGraphAfterMemoryChange(db, "default");
  return memory;
}

async function syncGraphAfterMemoryChange(db, scope) {
  try {
    const graphData = await loadGraph();
    if (!graphData) return;
    if (rebuildGraphIndexIfStale(db, graphData)) {
      await buildGraphAndPersist(scope);
    } else {
      await syncGraphToStorage(graphData, db);
    }
  } catch (e) {
    console.warn(`[opencode-mem] graph sync after memory change failed: ${e.message}`);
  }
}

export function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[a-z0-9_-]+/g) || [];
}

export function calculateMemoryUtilityScore(memory) {
  const typeScores = {
    preference: 0.9,
    rule: 0.85,
    lesson: 0.8,
    fact: 0.6,
    unknown: 0.4,
    sensitive: 0.5,
  };
  const base = typeScores[memory.type] || typeScores.fact || 0.6;
  const confidenceScore = Number(memory.confidence || 0) * 0.5;
  const tagRichness = Math.min((memory.tags?.length || 0) * 0.05, 0.25);
  const lengthScore = Math.min(String(memory.content || "").length / 500, 1) * 0.2;
  const priorityScore = (Number(memory.priority) || 0) * 0.05;
  const recencyScore = memory.updatedAt
    ? Math.max(0, 1 - (Date.now() - Date.parse(memory.updatedAt)) / (30 * 86400000))
    : 0;
  return Math.round((base + confidenceScore + tagRichness + lengthScore + priorityScore + recencyScore * 0.3) * 100) / 100;
}

export function getTtlDaysForMemory(memory, config) {
  const defaultDays = config?.memory?.ttl?.defaultDays || 90;
  const factDays = config?.memory?.ttl?.factDays || 180;
  const lowPriorityDays = config?.memory?.ttl?.lowPriorityDays || 30;
  const sensitiveDays = config?.memory?.ttl?.sensitiveDays || 365;
  const utilityScore = calculateMemoryUtilityScore(memory);

  if (memory.sensitivity === "sensitive") {
    return Math.max(defaultDays, sensitiveDays);
  }
  if (memory.priority === 0) {
    return Math.min(defaultDays, lowPriorityDays);
  }
  if (memory.type === "fact") {
    return factDays;
  }
  const utilityDays = Math.round(defaultDays * (1 + (utilityScore - 0.5) * 0.5));
  return Math.min(180, Math.max(30, utilityDays));
}

function normalizeContent(content) {
  return String(content || "").toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function deduplicateMemoriesArray(memories, threshold) {
  const exactGroups = new Map();
  const exactDeletedIds = [];
  const kept = [];

  for (const m of memories) {
    const key = normalizeContent(m.content);
    if (!exactGroups.has(key)) {
      exactGroups.set(key, m);
      kept.push(m);
    } else {
      const existing = exactGroups.get(key);
      const confA = Number(m.confidence || 0.5);
      const confB = Number(existing.confidence || 0.5);
      if (confA > confB || (confA === confB && new Date(m.updatedAt) > new Date(existing.updatedAt))) {
        exactGroups.set(key, m);
        exactDeletedIds.push(existing.id);
        const idx = kept.findIndex((x) => x.id === existing.id);
        if (idx !== -1) kept.splice(idx, 1);
        kept.push(m);
      } else {
        exactDeletedIds.push(m.id);
      }
    }
  }

  const similarityDeletedIds = [];
  const finalKept = [];

  for (const m of kept) {
    const redacted = redactCredentials(m.content || "");
    let dup = false;
    for (const existing of finalKept) {
      const existingRedacted = redactCredentials(existing.content || "");
      if (calculateSimilarity(redacted, existingRedacted) >= threshold) {
        dup = true;
        break;
      }
    }
    if (dup) {
      similarityDeletedIds.push(m.id);
    } else {
      finalKept.push(m);
    }
  }

  return {
    kept: finalKept,
    deletedExactIds: exactDeletedIds,
    deletedSimilarIds: similarityDeletedIds,
    deletedCount: exactDeletedIds.length + similarityDeletedIds.length,
  };
}

export async function mergeDedupAndDigestMemories(scope = "default", threshold = 0.65) {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  const allMemories = (db.memories || []).filter((m) => !m.isExpired && (m.confidence || 0) >= 0.3);

  const dedupResult = await deduplicateMemoriesArray(allMemories, threshold);
  const deduped = dedupResult.kept;

  const grouped = await organizeMemoriesWithLLM(null, deduped);
  const mergedMemories = [];
  const removedIds = [];
  let mergedGroupCount = 0;

  for (const group of grouped.groups) {
    const groupMemories = deduped.filter((m) => group.memoryIds.includes(m.id));
    if (groupMemories.length === 1) {
      mergedMemories.push(groupMemories[0]);
      continue;
    }

    let bestConfidence = 0;
    let bestType = "fact";
    let bestSensitivity = "normal";
    let bestPriority = 0;
    const allTags = new Set();
    const contentParts = new Set();
    let mostRecent = null;
    let earliest = null;

    for (const m of groupMemories) {
      const conf = Number(m.confidence || 0);
      if (conf > bestConfidence) {
        bestConfidence = conf;
        bestType = m.type || "fact";
        bestSensitivity = m.sensitivity || "normal";
        bestPriority = m.priority || 0;
      }
      if (m.tags) {
        for (const t of m.tags) allTags.add(t);
      }
      contentParts.add(m.content);
      if (!mostRecent || new Date(m.updatedAt) > new Date(mostRecent.updatedAt)) mostRecent = m;
      if (!earliest || new Date(m.createdAt) < new Date(earliest.createdAt)) earliest = m;
    }

    const uniqueContent = Array.from(contentParts).sort((a, b) => (a.length || 0) - (b.length || 0));
    const mergedContent = summarizeLongText(`${uniqueContent.join("\n\n")}`);
    const merged = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      content: mergedContent,
      type: bestType,
      confidence: bestConfidence,
      sensitivity: bestSensitivity,
      priority: bestPriority,
      tags: Array.from(allTags),
      scope: mostRecent ? mostRecent.scope || "default" : "default",
      projectName: mostRecent ? mostRecent.projectName || null : null,
      createdAt: earliest ? earliest.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mergedMemories.push(merged);
    removedIds.push(...groupMemories.map((m) => m.id));
    mergedGroupCount++;
  }

  const removedSet = new Set(removedIds);
  for (const m of deduped) {
    if (!removedSet.has(m.id)) {
      mergedMemories.push(m);
    }
  }

  db.memories = mergedMemories.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  await writeJsonFile(filePath, db);

  return {
    originalCount: allMemories.length,
    exactDeletedCount: dedupResult.deletedExactIds.length,
    similarityDeletedCount: dedupResult.deletedSimilarIds.length,
    mergedGroupCount,
    removedCount: dedupResult.deletedCount + removedIds.length,
    keptCount: mergedMemories.length,
    mergedMemories,
    stats: {
      dedup: dedupResult,
      digest: { mergedGroupCount, removedCount: removedIds.length, keptCount: mergedMemories.length },
    },
  };
}

export async function optimizeMemories(scope = "default", threshold = 0.65) {
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

  const similarityDeletedIds = [];
  const remaining = kept.filter((m) => !deletedIds.includes(m.id));
  const finalKept = [];
  for (const m of remaining) {
    const redacted = redactCredentials(m.content || "");
    let dup = false;
    for (const existing of finalKept) {
      const existingRedacted = redactCredentials(existing.content || "");
      if (calculateSimilarity(redacted, existingRedacted) >= threshold) {
        dup = true;
        break;
      }
    }
    if (dup) {
      similarityDeletedIds.push(m.id);
    } else {
      finalKept.push(m);
    }
  }

  db.memories = finalKept;
  await writeJsonFile(filePath, db);
  return {
    exactDeletedCount: deletedIds.length,
    similarityDeletedCount: similarityDeletedIds.length,
    deletedCount: deletedIds.length + similarityDeletedIds.length,
    keptCount: finalKept.length,
  };
}

export async function digestMemories(scope = "default", threshold = 0.65) {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  const memories = (db.memories || []).filter((m) => !m.isExpired && (m.confidence || 0) >= 0.3);
  const grouped = await organizeMemoriesWithLLM(null, memories);
  const mergedMemories = [];
  const removedIds = [];
  let mergedGroupCount = 0;

  for (const group of grouped.groups) {
    const groupMemories = memories.filter((m) => group.memoryIds.includes(m.id));
    if (groupMemories.length === 1) {
      mergedMemories.push(groupMemories[0]);
      continue;
    }

    let bestConfidence = 0;
    let bestType = "fact";
    let bestSensitivity = "normal";
    let bestPriority = 0;
    const allTags = new Set();
    const contentParts = new Set();
    let mostRecent = null;
    let earliest = null;

    for (const m of groupMemories) {
      const conf = Number(m.confidence || 0);
      if (conf > bestConfidence) {
        bestConfidence = conf;
        bestType = m.type || "fact";
        bestSensitivity = m.sensitivity || "normal";
        bestPriority = m.priority || 0;
      }
      if (m.tags) {
        for (const t of m.tags) allTags.add(t);
      }
      contentParts.add(m.content);
      if (!mostRecent || new Date(m.updatedAt) > new Date(mostRecent.updatedAt)) mostRecent = m;
      if (!earliest || new Date(m.createdAt) < new Date(earliest.createdAt)) earliest = m;
    }

    const uniqueContent = Array.from(contentParts).sort((a, b) => (a.length || 0) - (b.length || 0));
    const mergedContent = summarizeLongText(`${uniqueContent.join("\n\n")}`);
    const merged = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      content: mergedContent,
      type: bestType,
      confidence: bestConfidence,
      sensitivity: bestSensitivity,
      priority: bestPriority,
      tags: Array.from(allTags),
      scope: mostRecent ? mostRecent.scope || "default" : "default",
      projectName: mostRecent ? mostRecent.projectName || null : null,
      createdAt: earliest ? earliest.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mergedMemories.push(merged);
    removedIds.push(...groupMemories.map((m) => m.id));
    mergedGroupCount++;
  }

  // add non-merged single memories
  const removedSet = new Set(removedIds);
  for (const m of memories) {
    if (!removedSet.has(m.id)) {
      mergedMemories.push(m);
    }
  }

  db.memories = mergedMemories.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  await writeJsonFile(filePath, db);

  return {
    originalCount: memories.length,
    mergedGroupCount,
    removedCount: removedIds.length,
    keptCount: mergedMemories.length,
    mergedMemories,
  };
}

export async function organizeMemoriesWithLLM(config, memories) {
  const grouped = { groups: [], stats: { total: memories.length, grouped: 0, ungrouped: 0 } };
  if (!memories.length) return grouped;

  const apiBaseUrl = config?.extractionApiUrl || config?.embeddingApiUrl || null;
  const model = config?.extractionModel || config?.embeddingModel || "gpt-4o-mini";
  const apiKey = config?.extractionApiKey || config?.embeddingApiKey || null;

  if (apiBaseUrl) {
    const url = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/v1/chat/completions`;
    const prompt = `You are organizing memory items by topic/similarity. Return a JSON object with a "groups" array. Each group has a "category" (a short descriptive label) and "memoryIds" array of memory IDs. Group all memory IDs into meaningful categories. Do not include extra text. Input memories: ${JSON.stringify(memories.map((m) => ({ id: m.id, content: m.content, tags: m.tags || [], scope: m.scope || "default" })))}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Return a JSON object with key groups." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`LLM error: ${response.status}`);
    const data = await response.json();
    const content = data.choices && data.choices[0] ? data.choices[0].message?.content : data;
    try {
      const parsed = JSON.parse(content);
      const groups = parsed.groups || [];
      const seen = new Set();
      grouped.groups = groups.map((g) => ({ category: g.category || "Uncategorized", memoryIds: (g.memoryIds || []).filter((id) => !seen.has(id) && !seen.add(id)) }));
      grouped.stats.grouped = grouped.groups.reduce((sum, g) => sum + g.memoryIds.length, 0);
      grouped.stats.ungrouped = memories.length - grouped.stats.grouped;
    } catch {
      grouped.groups = [{ category: "Uncategorized", memoryIds: memories.map((m) => m.id) }];
      grouped.stats.ungrouped = memories.length;
    }
    return grouped;
  }

  return organizeLocal(memories);
}

function organizeLocal(memories) {
  const grouped = { groups: [], stats: { total: memories.length, grouped: 0, ungrouped: 0 } };
  const topics = new Map();
  const keywords = ["swift", "swiftui", "react", "typescript", "javascript", "python", "go", "rust", "database", "api", "system", "architecture", "design", "frontend", "backend", "mobile", "web", "machine learning", "deployment", "testing"];
  for (const m of memories) {
    const text = (m.content || "").toLowerCase();
    let category = "General";
    for (const kw of keywords) {
      if (text.includes(kw)) { category = kw; break; }
    }
    if (!topics.has(category)) topics.set(category, []);
    topics.get(category).push(m.id);
  }
  grouped.groups = Array.from(topics.entries()).map(([category, memoryIds]) => ({ category, memoryIds }));
  grouped.stats.grouped = grouped.groups.reduce((sum, g) => sum + g.memoryIds.length, 0);
  grouped.stats.ungrouped = 0;
  return grouped;
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
      const memoryCount = scoped.length;
      const nowMs = Date.now();
      return scoped
        .filter((memory) => memory.embedding && memory.embedding.length === queryVec.length)
        .map((memory) => {
          const sim = cosineSimilarity(memory.embedding, queryVec);
          const weightedConfidence = calculateWeightedConfidence(
            Number(memory.confidence) || 0.5,
            memory.sensitivity,
            memory.createdAt,
            undefined,
            memoryCount
          );
          const recencyFactor = memory.createdAt ? Math.max(0, 1 - (nowMs - Date.parse(memory.createdAt)) / (30 * 86400000)) : 1;
          const combinedScore = Math.max(0, sim + weightedConfidence * recencyFactor + Number(memory.priority) * 0.1);
          return { memory, combinedScore };
        })
        .filter((entry) => entry.combinedScore >= similarityThreshold)
        .sort((a, b) => b.combinedScore - a.combinedScore)
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

  // Compute memory count for context factor
  const memoryCount = scoped.length;
  const nowMs = Date.now();

  return scoped
    .map((memory) => {
      const memoryTokens = new Set(tokenize(memory.content));
      const score = queryTokens.reduce((total, token) => total + (memoryTokens.has(token) ? 1 : 0), 0);
      const weightedConfidence = calculateWeightedConfidence(
        Number(memory.confidence) || 0.5,
        memory.sensitivity,
        memory.createdAt,
        undefined, // context window usage not available here; use default factor
        memoryCount
      );
      const recencyFactor = memory.createdAt ? Math.max(0, 1 - (nowMs - Date.parse(memory.createdAt)) / (30 * 86400000)) : 1;
      const combinedScore = score > 0 ? (score + weightedConfidence * recencyFactor + Number(memory.priority) * 0.1) : 0;
      return { memory, combinedScore };
    })
    .filter((entry) => entry.combinedScore > 0)
    .sort((a, b) => b.combinedScore - a.combinedScore || new Date(b.createdAt) - new Date(a.createdAt))
    .map((entry) => attachProjectName(entry.memory));
}

export async function listAllMemories(scope = "default") {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  return (db.memories || []).map(attachProjectName);
}

export async function listMemories(limit = 50, scope = "default", ttlConfig = {}, filters = {}) {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);

  const memoryCount = db.memories.length;
  const nowMs = Date.now();

  const excludeNoise = filters.excludeNoise !== false;
  const minConfidence = filters.minConfidence !== undefined ? Number(filters.minConfidence) : 0;
  const excludedTypes = filters.excludedTypes || [];

  return db.memories
    .filter((m) => scope === "default" || m.scope === scope)
    .filter((memory) => {
      if (excludeNoise) {
        if (memory.type === "noise" || (minConfidence > 0 && Number(memory.confidence) < minConfidence)) return false;
        if (excludedTypes.includes(memory.type)) return false;
      }
      const cutoff = new Date(Date.now() - getTtlDaysForMemory(memory, ttlConfig) * 86400000).toISOString();
      return memory.createdAt >= cutoff;
    })
    .map((memory) => {
      const weightedConfidence = calculateWeightedConfidence(
        Number(memory.confidence) || 0.5,
        memory.sensitivity,
        memory.createdAt,
        undefined,
        memoryCount
      );
      const recencyFactor = memory.createdAt ? Math.max(0, 1 - (nowMs - Date.parse(memory.createdAt)) / (30 * 86400000)) : 1;
      const score = weightedConfidence * recencyFactor + Number(memory.priority) * 0.1;
      return { memory, score };
    })
    .sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((v) => attachProjectName(v.memory));
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
    await syncGraphAfterMemoryChange(db, "default");
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
  await syncGraphAfterMemoryChange(db, "default");
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

export async function buildGraphAndPersist(scope = "default") {
  const isProjectScope = scope && scope.startsWith("project:");
  const filePath = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), MEMORIES_FILE);
  const db = await readJsonFile(filePath);
  const memories = (db.memories || []).map(attachProjectName);
  const graphData = buildHierarchicalGraph(memories, { similarityThreshold: 0.4 });
  graphData.lastModified = new Date().toISOString();
  graphData.version = 1;
  await saveGraph(graphData);
  return graphData;
}

export async function addSummaryNode(node) {
  const graphData = await loadGraph();
  if (!graphData) return null;
  if (!graphData.summaryNodes) graphData.summaryNodes = [];
  graphData.summaryNodes.push(node);
  await saveGraph(graphData);
  return node;
}

export async function addCategoryNode(node) {
  const graphData = await loadGraph();
  if (!graphData) return null;
  if (!graphData.categoryNodes) graphData.categoryNodes = [];
  graphData.categoryNodes.push(node);
  await saveGraph(graphData);
  return node;
}

export async function addGraphEdge(edge) {
  const graphData = await loadGraph();
  if (!graphData) return null;
  if (!graphData.edges) graphData.edges = [];
  graphData.edges.push(edge);
  await saveGraph(graphData);
  return edge;
}

export async function updateGraphEdges(edges) {
  const graphData = await loadGraph();
  if (!graphData) return null;
  graphData.edges = edges;
  await saveGraph(graphData);
  return edges;
}

export async function getSummaryNodes(scope = "default") {
  const graphData = await loadGraph();
  if (!graphData) return [];
  if (scope === "default") return (graphData.summaryNodes || []).slice(0);
  const baseNodes = (graphData.baseNodes || []).filter(b => b.scope === scope);
  const baseIds = new Set(baseNodes.map(b => b.id));
  return (graphData.summaryNodes || []).filter(s => baseIds.has(s.baseId) || s.baseIds.some(id => baseIds.has(id)));
}

export async function getCategoryNodes(scope = "default") {
  const graphData = await loadGraph();
  if (!graphData) return [];
  if (scope === "default") return (graphData.categoryNodes || []).slice(0);
  const baseNodes = (graphData.baseNodes || []).filter(b => b.scope === scope);
  const baseIds = new Set(baseNodes.map(b => b.id));
  return (graphData.categoryNodes || []).filter(c => baseIds.has(c.baseId) || c.memoryIds.some(id => baseIds.has(id)));
}

export async function getGraphEdges(scope = "default") {
  const graphData = await loadGraph();
  if (!graphData) return [];
  if (scope === "default") return (graphData.edges || []).slice(0);
  const baseNodes = (graphData.baseNodes || []).filter(b => b.scope === scope);
  const baseIds = new Set(baseNodes.map(b => b.id));
  return (graphData.edges || []).filter(e => [e.from, e.to].some(id => baseIds.has(id)));
}

export async function addMemoryLayered(content, scope = "default", sessionId, metadata = {}, duplicateConfig = null, options = {}) {
  const memory = await addMemory(content, scope, sessionId, metadata, duplicateConfig);
  if (options?.buildGraph !== false) {
    try {
      await buildGraphAndPersist(scope);
    } catch (e) {
      console.warn(`[opencode-mem] graph build after memory add failed: ${e.message}`);
    }
  }
  return memory;
}

export async function migrateFlatToLayered(scope = "default") {
  return buildGraphAndPersist(scope);
}

export async function searchMemoriesLayered(query, filters = {}) {
  const effectiveScope = typeof filters === "string" ? filters : (filters.scope || "default");
  const projectContextFilter = filters.projectContext;
  const graphData = await loadGraph();
  if (!graphData) {
    const baseResults = await searchMemories(query, filters);
    return projectContextFilter ? attachProjectContext(baseResults, projectContextFilter) : baseResults;
  }
  const baseResults = await searchMemories(query, filters);
  if (!filters.layered && !filters.useGraph) {
    return projectContextFilter ? attachProjectContext(baseResults, projectContextFilter) : baseResults;
  }
  const baseNodes = (graphData.baseNodes || []).filter(b => b.scope === effectiveScope || effectiveScope === "default");
  const baseIdSet = new Set(baseNodes.map(b => b.id));
  const categoryNodes = (graphData.categoryNodes || []).filter(c => c.memoryIds.some(id => baseIdSet.has(id)));
  const system2Ids = new Set();
  for (const cat of categoryNodes) {
    for (const id of cat.memoryIds) {
      if (baseIdSet.has(id)) system2Ids.add(id);
    }
  }
  const system2Results = baseNodes.filter(b => system2Ids.has(b.id)).map(b => ({ id: b.id, content: b.content, tags: b.tags, scope: b.scope, createdAt: b.createdAt, updatedAt: b.updatedAt }));
  const merged = new Map();
  for (const m of baseResults) merged.set(m.id, m);
  for (const m of system2Results) {
    if (!merged.has(m.id)) merged.set(m.id, m);
  }
  const resultArray = Array.from(merged.values());
  return projectContextFilter ? attachProjectContext(resultArray, projectContextFilter) : resultArray;
}

export async function listGraphMetrics() {
  const graphData = await loadGraph();
  if (!graphData) return { baseNodes: 0, summaryNodes: 0, categoryNodes: 0, edges: 0 };
  return {
    baseNodes: (graphData.baseNodes || []).length,
    summaryNodes: (graphData.summaryNodes || []).length,
    categoryNodes: (graphData.categoryNodes || []).length,
    edges: (graphData.edges || []).length,
  };
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

export async function searchKnowledge(query, filters = {}) {
  const filePath = path.join(getStorageDir(), KNOWLEDGE_FILE);
  const db = await readJsonFile(filePath);
  const knowledge = db.knowledge || [];

  const queryTokens = query ? [...new Set(tokenize(query))] : [];
  if (!queryTokens.length) {
    return knowledge.slice(0, filters.limit || 20);
  }

  const nowMs = Date.now();
  return knowledge
    .map((item) => {
      const textTokens = new Set(tokenize(item.content));
      const matchCount = queryTokens.reduce((total, token) => total + (textTokens.has(token) ? 1 : 0), 0);
      const recencyFactor = item.updatedAt ? Math.max(0, 1 - (nowMs - Date.parse(item.updatedAt)) / (30 * 86400000)) : 1;
      const score = matchCount > 0 ? matchCount + 0.5 * recencyFactor : 0;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, filters.limit || 20)
    .map((entry) => entry.item);
}

export async function importKnowledgeFromDirectory(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const textOrMarkdown = entries.filter((e) => e.isFile() && /\.(md|txt|swift|swiftui)$/i.test(e.name));
  const results = [];
  for (const entry of textOrMarkdown) {
    const content = await fs.readFile(path.join(dir, entry.name), "utf-8");
    const id = `swift_sdk_${entry.name.replace(/[^a-z0-9._-]/gi, "_")}`;
    const knowledge = await addKnowledge(content, id);
    results.push(knowledge.id);
  }
  return results;
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
  searchKnowledge,
  importKnowledgeFromDirectory,
  cleanupExpiredMemories,
  cleanupTrash,
  getTtlDaysForMemory,
  deduplicateMemoriesArray,
  mergeDedupAndDigestMemories,
  rebuildGraphIndexIfStale,
  syncGraphToStorage,
  optimizeMemories,
  digestMemories,
  organizeMemoriesWithLLM,
  buildGraphAndPersist,
  listGraphMetrics,
  addSummaryNode,
  addCategoryNode,
  addGraphEdge,
  updateGraphEdges,
  getSummaryNodes,
  getCategoryNodes,
  getGraphEdges,
  addMemoryLayered,
  migrateFlatToLayered,
  searchMemoriesLayered,
};
