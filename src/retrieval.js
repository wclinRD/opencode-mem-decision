import { cosineSimilarity } from "./embedding.js";

function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}
import { buildHierarchicalGraph } from "./organize.js";

function tagOverlapScore(tagsA, tagsB) {
  const setA = new Set(tagsA.map((t) => t.toLowerCase()));
  const setB = new Set(tagsB.map((t) => t.toLowerCase()));
  let intersection = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersection++;
  }
  const unionSize = setA.size + setB.size - intersection;
  return unionSize === 0 ? 0 : intersection / unionSize;
}

export async function dualRouteRetrieve(query, scopes = "default", config = {}) {
  // Assume memory list and graph are preloaded by caller or fetched.
  // For this module, we require memories and graphData from external state.
  return {
    system1Results: [],
    system2Results: [],
  };
}

export function simulateDualRouteRetrieve(query, memories, graphData, filters = {}) {
  const system1Results = tagQueryFilter(query, memories, filters);
  const system2Results = globalSelectionRoute(query, graphData, filters);
  return {
    system1Results,
    system2Results,
    query,
    filters,
  };
}

function tagQueryFilter(query, memories, filters) {
  const queryTokens = tokenize(query);
  const queryTags = queryTokens.filter((t) => /[a-z]+/.test(t));
  const threshold = filters.similarityThreshold || 0.4;

  const scored = memories.map((m) => {
    const tagScore = tagOverlapScore(m.tags || [], queryTags);
    const textScore = textSimilarityScore(query, m.content);
    const score = Math.max(tagScore, textScore);
    return { memory: m, score };
  });

  return scored
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.memory);
}

function textSimilarityScore(query, content) {
  const qTokens = new Set(tokenize(query));
  const cTokens = new Set(tokenize(content));
  let intersection = 0;
  for (const t of qTokens) {
    if (cTokens.has(t)) intersection++;
  }
  const unionSize = qTokens.size + cTokens.size - intersection;
  return unionSize === 0 ? 0 : intersection / unionSize;
}

function globalSelectionRoute(query, graphData, filters) {
  if (!graphData) return [];
  const categoryNodes = graphData.categoryNodes || [];
  const edges = graphData.edges || [];

  // Global selection: traverse from Category Node to related base memories based on query tags
  const queryTags = new Set(tokenize(query).filter((t) => /[a-z]+/.test(t)));

  const selectedCategories = categoryNodes.filter((c) => {
    const overlap = tagOverlapScore(c.tags || [], Array.from(queryTags));
    return overlap >= (filters.similarityThreshold || 0.3);
  });

  const selectedMemories = new Set();
  for (const cat of selectedCategories) {
    const edgesForCat = edges.filter((e) => e.from === cat.id && e.type === "categorized_by");
    for (const e of edgesForCat) {
      selectedMemories.add(e.to);
    }
  }

  return Array.from(selectedMemories).map((id) => {
    const node = graphData.baseNodes.find((n) => n.id === id);
    return node
      ? {
          memory: {
            id: node.id,
            content: node.content,
            tags: node.tags,
            scope: node.scope,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
          },
          score: 1,
        }
      : null;
  }).filter(Boolean);
}
