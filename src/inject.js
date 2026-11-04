import { searchMemories, listMemories } from "./storage/local.js";

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

export async function injectMemories({ sessionData, memoryConfig, storage, contextWindowSize }) {
  if (!memoryConfig.chatMessage?.enabled) return [];

  const recallMode = memoryConfig.chatMessage.recall || "relevant";
  const maxMemories = memoryConfig.chatMessage.maxMemories || 3;
  const recallScope = memoryConfig.chatMessage.recallScope || "default";
  const excludeCurrentSession = memoryConfig.chatMessage.excludeCurrentSession !== false;

  let candidates = [];

  if (recallMode === "relevant" || recallMode === "both") {
    const query = sessionData?.latestMessage || sessionData?.messages?.slice(-1)?.[0]?.content || "";
    const filters = { scope: recallScope };
    candidates = await searchMemories(query, filters);

    // Default recall must still do something when nothing is relevant.
    if (recallMode === "relevant" && candidates.length === 0) {
      candidates = await listMemories(maxMemories * 2, recallScope);
    }
  }

  if (recallMode === "recent" || (recallMode === "both" && candidates.length < maxMemories)) {
    const recent = await listMemories(maxMemories * 2, recallScope);
    const relevantIds = new Set(candidates.map((m) => m.id));
    const recentUnique = recent.filter((m) => !relevantIds.has(m.id));
    candidates = [...candidates, ...recentUnique].slice(0, maxMemories);
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

  const filtered = candidates.slice(0, maxMemories);

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

  const blocks = memories
    .slice(0, maxChunks)
    .map((m) => {
      const text = truncateText(m.content, limit);
      return `--- Memory ${m.id} (${m.type}, conf ${m.confidence}) ---\n${text}\n---\n`;
    })
    .join("\n");

  return `=== Memory Context ===\n` + blocks + `=== End Memory ===\n\nPrecedence rules:\n1. Latest user instruction in the current dialogue always wins.\n2. Session-scoped notes override global defaults for this conversation.\n3. Global long-term memory is the baseline.\nWhen a current instruction contradicts a stored preference, follow the current instruction and update session notes accordingly.`;
}

function truncateText(text, limit) {
  return text.length > limit ? text.slice(0, limit - 3) + "..." : text;
}
