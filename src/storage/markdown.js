import fs from "fs/promises";
import path from "path";
import { getStorageDir, projectStoragePath } from "./local.js";
import { redactCredentials } from "../security.js";
import { findDuplicateMemories, buildDuplicateConfig } from "../dedup.js";

const VAULT_DIR = "vault";

function vaultPath() {
  return path.join(getStorageDir(), VAULT_DIR);
}

function ensureVault() {
  return fs.mkdir(vaultPath(), { recursive: true });
}

function memoryFilePath(id, scope) {
  const isProjectScope = scope && scope.startsWith("project:");
  const base = isProjectScope ? projectStoragePath(scope) : path.join(getStorageDir(), VAULT_DIR);
  return path.join(base, `${id}.md`);
}

function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const frontMatter = match[1];
  const body = match[2] || "";
  const metadata = {};
  for (const line of frontMatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value.startsWith("[")) {
      metadata[key] = value.slice(1, -1).split(",").map((v) => v.trim());
    } else {
      try {
        metadata[key] = JSON.parse(value);
      } catch {
        metadata[key] = value;
      }
    }
  }
  return { metadata, content: body };
}

function createFrontMatter(memory) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(memory)) {
    if (key === "content") continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else if (typeof value === "object") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  lines.push(memory.content || "");
  return lines.join("\n");
}

async function readMarkdownFile(id, scope) {
  const filePath = memoryFilePath(id, scope);
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = parseFrontMatter(content);
    if (!parsed) return null;
    return { ...parsed.metadata, content: parsed.content };
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function addMemory(content, scope = "project", sessionId, metadata = {}, duplicateConfig = null) {
  const dupConfig = buildDuplicateConfig(duplicateConfig);
  const isProjectScope = scope && scope.startsWith("project:");
  const baseDir = isProjectScope ? path.dirname(projectStoragePath(scope)) : vaultPath();
  await fs.mkdir(baseDir, { recursive: true });
  const allMemories = await listAllMemories(scope);
  const existingMemories = allMemories.filter((m) => m.content && m.content.length > 0);
  const redacted = redactCredentials(content);

  if (dupConfig.enabled) {
    const dedup = await findDuplicateMemories(redacted, existingMemories, dupConfig.similarityThreshold, null);
    if (dedup.duplicate && dupConfig.updateOnMatch) {
      const existing = allMemories.find((m) => m.id === dedup.existingId);
      if (existing) {
        existing.content = redacted;
        existing.scope = scope || existing.scope;
        existing.sessionId = sessionId || existing.sessionId;
        existing.type = metadata?.type || existing.type;
        existing.confidence = metadata?.confidence !== undefined ? Number(metadata.confidence) : existing.confidence;
        existing.sensitivity = metadata?.sensitive === true ? "sensitive" : existing.sensitivity;
        existing.priority = metadata?.priority !== undefined ? Number(metadata.priority) : existing.priority;
        existing.tags = metadata?.tags || existing.tags;
        existing.updatedAt = new Date().toISOString();
        const frontMatter = createFrontMatter(existing);
        await fs.writeFile(memoryFilePath(existing.id, scope), frontMatter, "utf8");
        return existing;
      }
    }
    if (dedup.duplicate && !dupConfig.updateOnMatch) {
      return null;
    }
  }

  const memoryId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const memory = {
    id: memoryId,
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
  };
  const frontMatter = createFrontMatter(memory);
  await fs.writeFile(memoryFilePath(memoryId, scope), frontMatter, "utf8");
  return memory;
}

export async function searchMemories(query, filters = {}) {
  const effectiveScope = typeof filters === "string" ? filters : (filters.scope || "default");
  const isProjectScope = effectiveScope && effectiveScope.startsWith("project:");
  const baseDir = isProjectScope ? path.dirname(projectStoragePath(effectiveScope)) : vaultPath();
  await fs.mkdir(baseDir, { recursive: true });
  const files = (await fs.readdir(baseDir, { withFileTypes: true }))
    .filter((d) => d.name.endsWith(".md"))
    .map((d) => d.name.slice(0, -3));

  if (!query || !query.trim()) {
    const memories = await Promise.all(files.map((id) => readMarkdownFile(id, effectiveScope)));
    return memories.filter(Boolean);
  }

  const queryTokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const allMemories = (await Promise.all(files.map((id) => readMarkdownFile(id, effectiveScope)))).filter(Boolean);
  const matched = allMemories
    .filter((memory) => {
      const memoryTokens = new Set((memory.content || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
      return queryTokens.some((token) => memoryTokens.has(token));
    });
  return matched;
}

export async function listMemories(limit = 50, scope = "default") {
  const isProjectScope = scope && scope.startsWith("project:");
  const baseDir = isProjectScope ? path.dirname(projectStoragePath(scope)) : vaultPath();
  await fs.mkdir(baseDir, { recursive: true });
  const files = (await fs.readdir(baseDir, { withFileTypes: true }))
    .filter((d) => d.name.endsWith(".md"))
    .map((d) => d.name.slice(0, -3));

  const memories = await Promise.all(files.map((id) => readMarkdownFile(id, scope)));
  const scoped = scope === "default" ? memories : memories.filter((m) => m.scope === scope);
  return scoped
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}

export async function getMemory(id, scope = "default") {
  return readMarkdownFile(id, scope);
}

export async function updateMemory(id, updates, scope = "default") {
  const existing = await getMemory(id, scope);
  if (!existing) return null;
  const memory = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  const frontMatter = createFrontMatter(memory);
  await fs.writeFile(memoryFilePath(id, scope), frontMatter, "utf8");
  return memory;
}

export async function deleteMemory(id, scope = "default") {
  const filePath = memoryFilePath(id, scope);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}

export async function listAllMemories(scope = "default") {
  return listMemories(10000, scope);
}

export const markdownStorage = {
  addMemory,
  searchMemories,
  listAllMemories,
  listMemories,
  getMemory,
  updateMemory,
  deleteMemory,
};
