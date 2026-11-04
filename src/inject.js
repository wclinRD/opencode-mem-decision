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
