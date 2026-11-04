import { cosineSimilarity } from "./embedding.js";
import { redactCredentials } from "./security.js";
import { calculateSimilarity, isShortSubstringMatch } from "./capture.js";

export async function findDuplicateMemories(newText, existingMemories, threshold = 0.75, embeddingService = null) {
  const redacted = redactCredentials(newText);
  let newVec = null;
  if (embeddingService) {
    try {
      newVec = await embeddingService.embed(redacted);
    } catch (e) {
      console.error(`[opencode-mem] dedup embed failed: ${e.message}`);
    }
  }
  const matches = existingMemories
    .filter((m) => m.content && m.content.length > 0)
    .map((memory) => {
      const existingVec = memory.embedding;
      let sim = 0;
      if (newVec && existingVec && existingVec.length === newVec.length) {
        sim = cosineSimilarity(newVec, existingVec);
      } else {
        sim = calculateSimilarity(redacted, memory.content);
        if (isShortSubstringMatch(redacted, memory.content)) sim = 0.9;
      }
      return { memory, sim };
    });
  const bestMatch = matches
    .filter((entry) => entry.sim >= threshold)
    .sort((a, b) => b.sim - a.sim)[0];
  return bestMatch ? { duplicate: true, existingId: bestMatch.memory.id, similarity: bestMatch.sim } : { duplicate: false };
}

export function buildDuplicateConfig(duplicateConfig) {
  return {
    enabled: duplicateConfig?.enabled ?? true,
    similarityThreshold: Number.isFinite(duplicateConfig?.similarityThreshold) ? duplicateConfig.similarityThreshold : 0.75,
    updateOnMatch: duplicateConfig?.updateOnMatch ?? true,
  };
}
