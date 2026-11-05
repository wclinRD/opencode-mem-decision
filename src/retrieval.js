import { cosineSimilarity } from "./embedding.js";
import { buildHierarchicalGraph } from "./organize.js";

function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

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

function bm25Score(queryTokens, documentTokens, k1 = 1.2, b = 0.75, avgDocLen = documentTokens.length) {
  const docLen = documentTokens.length;
  if (avgDocLen <= 0) avgDocLen = docLen;
  let score = 0;
  const termFreqs = new Map();
  for (const t of documentTokens) {
    termFreqs.set(t, (termFreqs.get(t) || 0) + 1);
  }
  for (const qToken of queryTokens) {
    const tf = termFreqs.get(qToken) || 0;
    if (tf === 0) continue;
    const idf = Math.log(1 + (1 + tf) / (0.1 + tf));
    const termScore = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
    score += termScore;
  }
  return score;
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
    const documentTokens = m.textVector && Array.isArray(m.textVector) && m.textVector.length > 0 ? m.textVector : tokenize(m.content);
    const textScore = bm25Score(queryTokens, documentTokens);
    const score = Math.max(tagScore, textScore);
    return { memory: m, score };
  });

  return scored
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.memory);
}

function globalSelectionRoute(query, graphData, filters) {
  if (!graphData) return [];
  const categoryNodes = graphData.categoryNodes || [];
  const edges = graphData.edges || [];

  // Global selection: traverse from Category Node to related base memories based on query tags
  const queryTokens = tokenize(query);
  const queryTags = new Set(queryTokens.filter((t) => /[a-z]+/.test(t)));

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
    if (!node) return null;
    const documentTokens = node.textVector && Array.isArray(node.textVector) && node.textVector.length > 0 ? node.textVector : tokenize(node.content);
    const score = bm25Score(queryTokens, documentTokens);
    return {
      memory: {
        id: node.id,
        content: node.content,
        tags: node.tags,
        scope: node.scope,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      },
      score,
    };
  }).filter(Boolean);
}
