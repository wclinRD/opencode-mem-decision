import { redactCredentials } from "./security.js";
import { searchMemories } from "./storage/local.js";
import { stripInjectedBlock } from "./inject.js";
import { logEvent, summarizeRecentEvents } from "./eventLog.js";
import { classifyMemory as defaultClassifyMemory } from "./classify.js";

const simHash = (text) => {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const seen = new Set();
  return words.filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  }).sort().join("|");
};

export function calculateSimilarity(a, b) {
  const hashA = simHash(a);
  const hashB = simHash(b);
  if (hashA === hashB) return 1.0;
  const setA = new Set(hashA.split("|"));
  const setB = new Set(hashB.split("|"));
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function isDuplicate(newContent, existingMemories, threshold = 0.75) {
  const redacted = redactCredentials(newContent);
  for (const mem of existingMemories) {
    const sim = calculateSimilarity(redacted, mem.content || "");
    if (sim >= threshold) return { duplicate: true, existingId: mem.id, similarity: sim };
  }
  return { duplicate: false };
}

export async function autoCapture({ sessionData, memoryConfig, storage, classifyMemory }) {
  if (!memoryConfig.chatMessage?.enabled) return;

  const sessionText =
    (sessionData?.messages || [])
      .map((m) => stripInjectedBlock(m?.content || ""))
      .filter(Boolean)
      .join("\n") || "";
  if (!sessionText) return;

  const classified = classifyMemory ? classifyMemory() : defaultClassifyMemory(sessionText);
  await logEvent({
    sessionID: sessionData?.id,
    actor: "system",
    event_type: "auto-capture",
    description: `Captured session of length ${sessionText.length}, type ${classified.type}`,
    related_memory_ids: [],
  });

  const existingMemories = await storage.listMemories(1000);
  const dedup = isDuplicate(sessionText, existingMemories, memoryConfig.updateOnCaptureSimilarityThreshold || 0.75);

  if (dedup.duplicate && memoryConfig.updateOnCaptureEnabled) {
    const existing = await storage.getMemory(dedup.existingId);
    await storage.updateMemory(dedup.existingId, {
      content: redactCredentials(sessionText),
      updatedAt: new Date().toISOString(),
    });
    return { action: "update", id: dedup.existingId, similarity: dedup.similarity };
  }

  if (!dedup.duplicate) {
    const memory = await storage.addMemory(sessionText, "project", sessionData?.id, {
      type: classified.type,
      confidence: classified.confidence,
      sensitive: classified.sensitive,
    });
    const summary = await summarizeRecentEvents({ hours: 24 });
    if (summary) {
      await storage.addMemory(
        `Session Summary: ${summary.summary}\nRelated memory IDs: ${summary.related_memory_ids.join(",")}`,
        "project",
        null,
        { type: "summary", confidence: 0.8, sensitivity: "normal", tags: ["auto-summary"] }
      );
    }
    return { action: "add", id: memory.id };
  }

  return { action: "skip", reason: "below similarity threshold" };
}
