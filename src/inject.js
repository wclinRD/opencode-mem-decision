import { searchMemories, listMemories, buildGraphAndPersist } from "./storage/local.js";
import { loadConfig } from "./config.js";
import { simulateDualRouteRetrieve } from "./retrieval.js";
import { isGenericOrNoiseText } from "./capture.js";

export const INJECTION_MARKER = "<!-- opencode-mem-decision:injected -->";

// Injected memories are appended at the end of a prompt, after the marker.
// Cut the text at the marker so the memory block is not fed back into capture.
export function stripInjectedBlock(text) {
  if (typeof text !== "string") return text;
  const index = text.indexOf(INJECTION_MARKER);
  if (index === -1) return text;
  return text.slice(0, index).trimEnd();
}

export function calculateFillRatio(promptText, contextWindowSize) {
  const encoder = (str) => str.length;
  const promptTokens = encoder(promptText);
  return contextWindowSize ? Math.min(1, promptTokens / contextWindowSize) : 0;
}

export function dynamicBudget(fillRatio) {
  if (fillRatio >= 0.80) return { enabled: false };
  if (fillRatio >= 0.70) return { enabled: true, maxChunks: 2, chunkLimit: 250 };
  if (fillRatio >= 0.60) return { enabled: true, maxChunks: 3, chunkLimit: 400 };
  return { enabled: true, maxChunks: 5, chunkLimit: 600 };
}

export async function injectMemories({
  sessionData,
  memoryConfig,
  storage,
  contextWindowSize,
  activeProject,
  fallbackEnabled = false,
}) {
  if (!memoryConfig.chatMessage?.enabled) return [];

  const recallMode = memoryConfig.chatMessage.recall || "relevant";
  const maxMemories = memoryConfig.chatMessage.maxMemories || 3;
  const recallScope = memoryConfig.chatMessage.recallScope || "default";

  // Resolve actual project scope for the active project before any query
  const effectiveScope = activeProject?.projectName ? `project:${activeProject.projectName}` : recallScope;
  const excludeCurrentSession = memoryConfig.chatMessage.excludeCurrentSession !== false;

  let candidates = [];

  if (recallMode === "dual" || recallMode === "both") {
    const query = sessionData?.latestMessage || sessionData?.messages?.slice(-1)?.[0]?.content || "";
    const filters = { scope: effectiveScope, includeExpired: false };
    const memories = await storage.searchMemories("", { scope: effectiveScope, includeExpired: true });
    const graphData = await storage.buildGraphAndPersist(effectiveScope);
    const result = simulateDualRouteRetrieve(query, memories, graphData, filters);
    const system1 = result.system1Results || [];
    const system2 = result.system2Results || [];
    const allIds = new Set([...system1, ...system2].map((m) => m.id));
    candidates = [...system1, ...system2].filter((m) => allIds.has(m.id)).slice(0, maxMemories * 2);

    // Default recent fallback when dual returns little
    if (recallMode === "both" && candidates.length < maxMemories) {
      const relevantIds = new Set(candidates.map((m) => m.id));
      const defaultConfig = loadConfig();
      const recent = await listMemories(maxMemories * 2, effectiveScope, defaultConfig);
      const recentUnique = recent.filter((m) => !relevantIds.has(m.id));
      candidates = [...candidates, ...recentUnique].slice(0, maxMemories);
    }
  } else if (recallMode === "relevant") {
    const query = sessionData?.latestMessage || sessionData?.messages?.slice(-1)?.[0]?.content || "";
    const defaultConfig = loadConfig();
    const filters = { scope: effectiveScope, includeExpired: false };
    candidates = await searchMemories(query, filters);

    if (candidates.length === 0) {
      candidates = await listMemories(maxMemories * 2, effectiveScope, defaultConfig);
    }
  } else if (recallMode === "recent") {
    const defaultConfig = loadConfig();
    candidates = await listMemories(maxMemories * 2, effectiveScope, defaultConfig);
  }

  if (excludeCurrentSession && sessionData?.id) {
    candidates = candidates.filter((m) => m.sessionId !== sessionData.id);
  }

  const seenIds = new Set();
  candidates = candidates.filter((m) => {
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  // Fallback retrieval for cut-off fragments
  let fallbackResults = [];
  if (fallbackEnabled) {
    const budget = dynamicBudget(0.75);
    const limit = budget.chunkLimit || 600;
    const query = sessionData?.latestMessage || sessionData?.messages?.slice(-1)?.[0]?.content || "";
    const truncated = candidates.some((m) => m.content.length > limit);
    if (truncated) {
      fallbackResults = await buildFallbackRetrievalNote(query, effectiveScope, storage);
      const fallbackIds = new Set(fallbackResults.map((m) => m.id));
      for (const m of fallbackResults) {
        if (!seenIds.has(m.id) && !fallbackIds.has(m.id)) {
          seenIds.add(m.id);
          candidates.push(m);
        }
      }
    }
  }

  const filtered = candidates
    .filter((m) => Number(m.confidence || 0.5) >= 0.5)
    .filter((m) => (m.type || "unknown") !== "noise")
    .filter((m) => !isGenericOrNoiseText(m.content))
    .slice(0, maxMemories);

  if (memoryConfig.chatMessage.filterInjectedPrompts) {
    return filtered.filter((m) => !isSystemPrompt(m.content));
  }

  return filtered.filter((m) => m.sensitivity !== "sensitive");
}

function isSystemPrompt(content) {
  const sysKeywords = [
    "system reminder",
    "orchestration directive",
    "system prompt",
    "follow these instructions",
  ];
  return sysKeywords.some((k) => (content || "").toLowerCase().includes(k));
}

export function formatInjectedPrompt(memories, fillRatio) {
  if (!memories.length) return "";
  const budget = dynamicBudget(fillRatio);
  if (!budget.enabled) return "";

  const limit = budget.chunkLimit || 600;
  const maxChunks = budget.maxChunks || 5;

  let pages = [];
  let truncatedCount = 0;

  const blocks = memories
    .slice(0, maxChunks)
    .map((m) => {
      const split = splitMemoryContent(m.content, limit, { id: m.id, type: m.type, confidence: m.confidence, priority: m.priority });
      const pageBlocks = split.map((page) => formatPageInjectedPrompt(page, fillRatio));
      const combined = pageBlocks.join("\n");
      if (split.length > 1) truncatedCount += split.length - 1;
      return combined;
    })
    .filter(Boolean)
    .join("\n");

  const fallbackNote = formatFallbackRetrievalNote(truncatedCount);

  return `=== Memory Context ===\n` + blocks + (fallbackNote ? fallbackNote : "") + `\n=== End Memory ===\n\nPrecedence rules:\n1. Latest user instruction in the current dialogue always wins.\n2. Session-scoped notes override global defaults for this conversation.\n3. Global long-term memory is the baseline.\nWhen a current instruction contradicts a stored preference, follow the current instruction and update session notes accordingly.`;
}

function truncateText(text, limit) {
  return text.length > limit ? text.slice(0, limit - 3) + "..." : text;
}

export function splitMemoryContent(content, limit, metadata = {}) {
  if (content.length <= limit) return [{ page: 1, text: content, truncated: false, metadata }];
  const sentences = content.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  const pages = [];
  let currentPage = "";
  let page = 1;
  for (const s of sentences) {
    const candidate = currentPage + (currentPage ? " " : "") + s;
    if (candidate.length <= limit) {
      currentPage = candidate;
    } else {
      pages.push({ page, text: currentPage, truncated: currentPage.length === limit, metadata });
      currentPage = s;
      page++;
    }
  }
  if (currentPage) pages.push({ page, text: currentPage, truncated: currentPage.length === limit, metadata });
  return pages;
}

export function formatPageInjectedPrompt(page, fillRatio) {
  const budget = dynamicBudget(fillRatio);
  if (!budget.enabled) return "";
  return `--- Memory Page ${page.page} (${page.metadata.id}, ${page.metadata.type}, conf ${page.metadata.confidence}) ---\n${page.text}\n---\n`;
}

export function buildFallbackRetrievalNote(query, scope, storage) {
  // Fallback retrieval for cut-off memory fragments: retrieve related memories by query and scope.
  // We perform a broad search for keywords from the cut-off fragment and return top related memories.
  const queryTokens = query.split(/\s+/).filter(Boolean);
  if (queryTokens.length < 2) return { related: [] };
  const keywordQuery = queryTokens.slice(0, 5).join(" ");
  return storage.searchMemories(keywordQuery, { scope, includeExpired: true, limit: 5 }) || [];
}

export function formatFallbackRetrievalNote(truncatedCount) {
  if (truncatedCount <= 0) return "";
  return `\n[Note] ${truncatedCount} memory items were truncated due to context limits. Use the memory tool retrieve mode with scope filters to recover full fragments or related memories.\n`;
}
