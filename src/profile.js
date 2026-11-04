import fs from "fs/promises";
import path from "path";
import { getStorageDir } from "./storage/local.js";
import { redactCredentials } from "./security.js";

const PROFILE_FILE = "profile.json";
const RECENT_LIMIT = 10;
const KEYWORD_LIMIT = 15;
const KNOWLEDGE_TITLE_LIMIT = 80;

const STOPWORDS = new Set([
  // English
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "can",
  "could", "did", "do", "does", "for", "from", "had", "has", "have", "he", "her",
  "here", "him", "his", "i", "if", "in", "into", "is", "it", "its", "just", "me",
  "more", "most", "my", "no", "not", "of", "on", "or", "our", "out", "she", "should",
  "so", "some", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "those", "to", "too", "up", "us", "use", "used", "using", "was",
  "we", "were", "what", "when", "where", "which", "who", "will", "with", "would",
  "you", "your",
  // Traditional Chinese
  "的", "了", "是", "在", "和", "與", "或", "就", "也", "都", "而", "及", "這", "那",
  "我", "你", "他", "她", "它", "們", "有", "沒有", "不", "要", "會", "可以", "使用",
  "一個", "為", "對", "從", "到", "把", "被", "讓", "請", "需要", "然後", "因為", "所以",
]);

function profilePath() {
  return path.join(getStorageDir(), PROFILE_FILE);
}

async function readProfileFile() {
  try {
    const data = await fs.readFile(profilePath(), "utf-8");
    return JSON.parse(data);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

async function writeProfileFile(profile) {
  const filePath = profilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(profile, null, 2), "utf-8");
}

function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function topKeywords(memories) {
  const counts = new Map();
  for (const memory of memories) {
    for (const token of tokenize(redactCredentials(memory.content || ""))) {
      if (token.length < 2 || STOPWORDS.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, KEYWORD_LIMIT);
}

export async function buildProfile({ storage }) {
  const existing = await readProfileFile();
  const promptCount = Number.isInteger(existing?.promptCount) ? existing.promptCount : 0;

  const memories = await storage.listMemories(10000, "default");
  const knowledge = await storage.listKnowledge();

  const scopes = {};
  for (const memory of memories) {
    const scope = memory.scope || "default";
    scopes[scope] = (scopes[scope] || 0) + 1;
  }

  const userPreferences = memories
    .filter((m) => m.scope === "user" || m.scope === "global")
    .map((m) => ({
      id: m.id,
      content: redactCredentials(m.content || ""),
      updatedAt: m.updatedAt,
    }));

  const recentMemories = memories.slice(0, RECENT_LIMIT).map((m) => ({
    id: m.id,
    content: redactCredentials(m.content || ""),
    scope: m.scope,
    createdAt: m.createdAt,
  }));

  const recentKnowledge = [...knowledge]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, RECENT_LIMIT)
    .map((k) => redactCredentials(k.content || "").slice(0, KNOWLEDGE_TITLE_LIMIT));

  const profile = {
    generatedAt: new Date().toISOString(),
    promptCount,
    totals: {
      memories: memories.length,
      knowledge: knowledge.length,
      scopes,
    },
    userPreferences,
    recentMemories,
    topKeywords: topKeywords(memories),
    knowledge: {
      count: knowledge.length,
      recentTitles: recentKnowledge,
    },
  };

  await writeProfileFile(profile);
  return profile;
}

export async function recordPrompt({ storage, memoryConfig }) {
  const existing = await readProfileFile();
  const promptCount = (Number.isInteger(existing?.promptCount) ? existing.promptCount : 0) + 1;
  const interval = Number(memoryConfig?.userProfileAnalysisInterval ?? 10);

  await writeProfileFile({
    ...(existing || {}),
    promptCount,
    generatedAt: existing?.generatedAt ?? null,
  });

  if (!Number.isFinite(interval) || interval <= 0 || promptCount % interval !== 0) return null;

  return buildProfile({ storage, memoryConfig });
}
