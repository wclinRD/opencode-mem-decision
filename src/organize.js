import { cosineSimilarity } from "./embedding.js";

function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
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

/**
 * Build hierarchical memory graph from stored memories.
 * @param {Array} memories - Array of memory objects.
 * @param {Object} config - Optional organization config.
 * @returns {Object} Graph data with baseNodes, summaryNodes, categoryNodes, edges.
 */
export function buildHierarchicalGraph(memories, config = {}) {
  const baseNodes = [];
  const summaryNodes = [];
  const categoryNodes = [];
  const edges = [];

  // Base graph: each memory as node with tags/text vector
  for (const memory of memories) {
    baseNodes.push({
      id: memory.id,
      type: memory.type || "fact",
      tags: memory.tags || [],
      textVector: memory.embedding || tokenize(memory.content),
      content: memory.content,
      scope: memory.scope,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    });
  }

  // Build tags map for similarity edges
  const tagCounts = new Map();
  for (const node of baseNodes) {
    for (const tag of node.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  // Create similarity edges between base nodes with shared tags or BM25 text similarity
  const allTokens = new Map();
  for (const node of baseNodes) {
    const tokens = node.textVector && Array.isArray(node.textVector) && node.textVector.length > 0 ? node.textVector : tokenize(node.content);
    for (const t of tokens) {
      allTokens.set(t, (allTokens.get(t) || 0) + 1);
    }
  }
  const avgTokens = allTokens.size > 0 ? baseNodes.reduce((sum, n) => sum + (n.textVector && Array.isArray(n.textVector) && n.textVector.length > 0 ? n.textVector.length : tokenize(n.content).length), 0) / baseNodes.length : 1;

  for (let i = 0; i < baseNodes.length; i++) {
    for (let j = i + 1; j < baseNodes.length; j++) {
      const a = baseNodes[i];
      const b = baseNodes[j];
      const tagOverlap = tagOverlapScore(a.tags, b.tags);
      const aTokens = a.textVector && Array.isArray(a.textVector) && a.textVector.length > 0 ? a.textVector : tokenize(a.content);
      const bTokens = b.textVector && Array.isArray(b.textVector) && b.textVector.length > 0 ? b.textVector : tokenize(b.content);
      const textSim = bm25Score(aTokens, bTokens, undefined, undefined, avgTokens);
      const score = Math.max(tagOverlap, textSim);
      if (score >= (config.similarityThreshold || 0.4)) {
        edges.push({
          from: a.id,
          to: b.id,
          type: "semantic",
          score,
          weight: score,
          timestamp: Math.min(new Date(a.createdAt), new Date(b.createdAt)),
        });
      }
    }
  }

  // Add temporal edges (same project/scope within 30 days)
  const timeWindowMs = 30 * 86400000;
  baseNodes
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .forEach((node, i) => {
      let j = i + 1;
      while (j < baseNodes.length) {
        const other = baseNodes[j];
        if (new Date(other.createdAt) - new Date(node.createdAt) > timeWindowMs) break;
        if (node.scope === other.scope) {
          edges.push({
            from: node.id,
            to: other.id,
            type: "temporal",
            score: 1 - (new Date(other.createdAt) - new Date(node.createdAt)) / timeWindowMs,
            weight: 1 - (new Date(other.createdAt) - new Date(node.createdAt)) / timeWindowMs,
            timestamp: new Date(other.createdAt),
          });
        }
        j++;
      }
    });

  // Create Summary Nodes by clustering base nodes with high similarity
  const visited = new Set();
  const summaries = [];
  for (const base of baseNodes) {
    if (visited.has(base.id)) continue;
    const cluster = [base];
    for (const other of baseNodes) {
      if (base.id === other.id || visited.has(other.id)) continue;
      const tagOverlap = tagOverlapScore(base.tags, other.tags);
      const baseTokens = base.textVector && Array.isArray(base.textVector) && base.textVector.length > 0 ? base.textVector : tokenize(base.content);
      const otherTokens = other.textVector && Array.isArray(other.textVector) && other.textVector.length > 0 ? other.textVector : tokenize(other.content);
      const textSim = bm25Score(baseTokens, otherTokens, undefined, undefined, avgTokens);
      if (Math.max(tagOverlap, textSim) >= (config.similarityThreshold || 0.4)) {
        cluster.push(other);
      }
    }
    cluster.forEach((node) => visited.add(node.id));
    summaries.push({
      id: `summary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      content: cluster.map((m) => m.content).join(" "),
      baseIds: cluster.map((m) => m.id),
      tags: Array.from(new Set(cluster.flatMap((m) => m.tags))),
      createdAt: Math.min(...cluster.map((m) => new Date(m.createdAt))),
      updatedAt: Math.max(...cluster.map((m) => new Date(m.updatedAt))),
    });
  }
  for (const summary of summaries) {
    summaryNodes.push(summary);
    edges.push(
      ...summary.baseIds.map((baseId) => ({
        from: summary.id,
        to: baseId,
        type: "belongs_to",
        score: 1,
        weight: 1,
      }))
    );
  }

  // Create Category Nodes (project, lesson, knowledge by tags/domain)
  const categoryMap = new Map();
  const lessonTags = ["debug", "error", "fix", "lesson"];
  const knowledgeTags = ["python", "javascript", "typescript", "go", "rust", "database", "system"];
  const projectScopes = new Set();
  for (const memory of memories) {
    if (memory.scope && memory.scope.startsWith("project:")) {
      projectScopes.add(memory.scope);
    }
  }
  const categoryEntries = [];
  for (const memory of memories) {
    const tags = new Set((memory.tags || []).map((t) => t.toLowerCase()));
    let category;
    if (Array.from(tags).some((t) => lessonTags.includes(t))) {
      category = "lesson";
    } else if (Array.from(tags).some((t) => knowledgeTags.includes(t)) || memory.type === "knowledge") {
      category = "knowledge";
    } else if (memory.scope && memory.scope.startsWith("project:")) {
      category = memory.scope;
    } else {
      category = "general";
    }
    categoryEntries.push({ category, memory });
  }
  for (const [category, entries] of groupBy(categoryEntries, "category")) {
    categoryNodes.push({
      id: `category_${category}`,
      category,
      memoryIds: entries.map((e) => e.memory.id),
      tags: Array.from(new Set(entries.flatMap((e) => e.memory.tags || []))),
      count: entries.length,
    });
  }
  for (const projectScope of projectScopes) {
    if (!categoryMap.has(projectScope)) {
      projectScopes.add(projectScope);
    }
  }
  for (const node of categoryNodes) {
    edges.push(
      ...node.memoryIds.map((memId) => ({
        from: node.id,
        to: memId,
        type: "categorized_by",
        score: 1,
        weight: 1,
      }))
    );
  }

  return {
    baseNodes,
    summaryNodes,
    categoryNodes,
    edges,
  };
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

function textSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  if (vecA.length === 0 || vecB.length === 0) return 0;
  if (vecA.length !== vecB.length) {
    const minLen = Math.min(vecA.length, vecB.length);
    return cosineSimilarity(vecA.slice(0, minLen), vecB.slice(0, minLen));
  }
  return cosineSimilarity(vecA, vecB);
}

function groupBy(items, key) {
  return items.reduce((map, item) => {
    const k = item[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
    return map;
  }, new Map());
}
