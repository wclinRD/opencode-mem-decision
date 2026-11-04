import { searchMemories, listMemories } from "./storage/local.js";

export async function injectMemories({ sessionData, memoryConfig, storage }) {
  if (!memoryConfig.chatMessage?.enabled) return [];

  const recallMode = memoryConfig.chatMessage.recall || "relevant";
  const maxMemories = memoryConfig.chatMessage.maxMemories || 3;
  const recallScope = memoryConfig.chatMessage.recallScope || "default";
  const excludeCurrentSession = memoryConfig.chatMessage.excludeCurrentSession !== false;

  let candidates = [];

  if (recallMode === "relevant" || recallMode === "both") {
    const query = sessionData?.latestMessage || sessionData?.messages?.slice(-1)?.[0]?.content || "";
    candidates = await searchMemories(query, recallScope);
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

  const filtered = candidates.slice(0, maxMemories);

  if (memoryConfig.chatMessage.filterInjectedPrompts) {
    return filtered.filter((m) => !isSystemPrompt(m.content));
  }

  return filtered;
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

export function formatInjectedPrompt(memories) {
  if (!memories.length) return "";
  const blocks = memories.map((m) => `--- Memory ${m.id} ---\n${m.content}\n---\n`);
  return "Relevant memories from previous sessions:\n\n" + blocks.join("\n");
}
