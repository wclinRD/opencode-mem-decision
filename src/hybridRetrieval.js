/**
 * Hybrid Retrieval: Combines embedding cosine similarity with BM25 lexical matching
 * using Reciprocal Rank Fusion (RRF) for robust retrieval.
 */
import { cosineSimilarity } from "./embedding.js";

function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

/**
 * Compute BM25 score for a query against a document.
 * Uses a simplified IDF that doesn't depend on term frequency.
 * @param {string[]} queryTokens - Tokenized query
 * @param {string[]} docTokens - Tokenized document
 * @param {number} avgDocLen - Average document length across corpus
 * @param {object} config - BM25 parameters
 * @returns {number} BM25 score
 */
export function bm25Score(queryTokens, docTokens, avgDocLen, config = {}) {
  const k1 = config.k1 ?? 1.2;
  const b = config.b ?? 0.75;
  const docLen = docTokens.length;
  if (avgDocLen <= 0) avgDocLen = docLen;

  // Compute term frequencies in document
  const termFreqs = new Map();
  for (const t of docTokens) {
    termFreqs.set(t, (termFreqs.get(t) || 0) + 1);
  }

  let score = 0;
  for (const qToken of queryTokens) {
    const tf = termFreqs.get(qToken) || 0;
    if (tf === 0) continue;

    // Use a constant IDF approximation (log of inverted doc frequency)
    // In a real implementation, this would be computed from corpus statistics
    const idf = config.idf ? (config.idf(qToken) || 1) : 1;
    const norm = 1 - b + b * (docLen / avgDocLen);
    const termScore = idf * (tf * (k1 + 1)) / (tf + k1 * norm);
    score += termScore;
  }

  return score;
}

/**
 * Compute embedding similarity score for a query vector against a document vector.
 * @param {number[]} queryVec - Query embedding vector
 * @param {number[]} docVec - Document embedding vector
 * @returns {number} Cosine similarity score (range: -1 to 1, typically 0 to 1 for normalized vectors)
 */
export function embeddingScore(queryVec, docVec) {
  if (!queryVec || !docVec || queryVec.length !== docVec.length) return 0;
  return Math.max(0, cosineSimilarity(queryVec, docVec));
}

/**
 * Reciprocal Rank Fusion (RRF) combines rankings from multiple sources.
 * @param {number} rank - Rank position (1-based)
 * @param {number} k - RRF constant (default 60)
 * @returns {number} RRF score
 */
export function rrfScore(rank, k = 60) {
  return 1 / (k + rank);
}

/**
 * Hybrid retrieval that combines embedding similarity with BM25 scoring.
 * @param {string} query - Search query
 * @param {Array} memories - Array of memory objects
 * @param {object} options - Retrieval options
 * @param {Function} options.embed - Async function to embed text
 * @param {number} options.embWeight - Weight for embedding similarity (default 0.5)
 * @param {number} options.bm25Weight - Weight for BM25 score (default 0.5)
 * @param {number} options.rrfK - RRF constant (default 60)
 * @param {number} options.maxResults - Maximum number of results to return (default 20)
 * @param {number} options.similarityThreshold - Minimum combined score threshold (default 0)
 * @returns {Promise<Array>} Ranked memory objects with scores
 */
export async function hybridRetrieve(query, memories, options = {}) {
  const embed = options.embed || (async () => null);
  const embWeight = options.embWeight ?? 0.5;
  const bm25Weight = options.bm25Weight ?? 0.5;
  const rrfK = options.rrfK ?? 60;
  const maxResults = options.maxResults ?? 20;
  const similarityThreshold = options.similarityThreshold ?? 0;

  if (!memories || memories.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Compute average document length for BM25
  const docTokensList = memories.map((m) => tokenize(m.content));
  const avgDocLen = docTokensList.reduce((sum, tokens) => sum + tokens.length, 0) / docTokensList.length;

  // Compute scores for each memory
  const scoredMemories = [];
  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i];
    const docTokens = docTokensList[i];

    // BM25 score
    const bm25 = bm25Score(queryTokens, docTokens, avgDocLen);

    // Embedding score
    let embSim = 0;
    if (memory.embedding && embed) {
      try {
        const queryVec = await embed(query);
        embSim = embeddingScore(queryVec, memory.embedding);
      } catch (e) {
        // Embedding failed, continue with BM25 only
      }
    }

    // Weighted combination
    const combinedScore = embWeight * embSim + bm25Weight * bm25;

    scoredMemories.push({ memory, combinedScore, bm25, embSim });
  }

  // Sort by combined score
  scoredMemories.sort((a, b) => b.combinedScore - a.combinedScore);

  // Apply threshold and limit
  const results = scoredMemories
    .filter((entry) => entry.combinedScore >= similarityThreshold)
    .slice(0, maxResults)
    .map((entry, rank) => {
      const rrf = rrfScore(rank + 1, rrfK);
      return {
        memory: entry.memory,
        score: entry.combinedScore,
        bm25Score: entry.bm25,
        embeddingScore: entry.embSim,
        rrfScore: rrf,
        rank: rank + 1,
      };
    });

  return results;
}

/**
 * Dual-path hybrid retrieval with separate embedding and BM25 rankings fused via RRF.
 * This is more robust than simple weighted combination.
 * @param {string} query - Search query
 * @param {Array} memories - Array of memory objects
 * @param {object} options - Retrieval options
 * @returns {Promise<Array>} Ranked memory objects with scores
 */
export async function dualHybridRetrieve(query, memories, options = {}) {
  const embed = options.embed || (async () => null);
  const rrfK = options.rrfK ?? 60;
  const maxResults = options.maxResults ?? 20;
  const similarityThreshold = options.similarityThreshold ?? 0;

  if (!memories || memories.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Compute average document length for BM25
  const docTokensList = memories.map((m) => tokenize(m.content));
  const avgDocLen = docTokensList.reduce((sum, tokens) => sum + tokens.length, 0) / docTokensList.length;

  // BM25 ranking
  const bm25Scores = memories.map((m, i) => ({
    memory: m,
    score: bm25Score(queryTokens, docTokensList[i], avgDocLen),
  }));
  bm25Scores.sort((a, b) => b.score - a.score);

  // Embedding ranking
  let embScores = [];
  const memoriesWithEmbedding = memories.filter((m) => m.embedding && embed);
  if (memoriesWithEmbedding.length > 0) {
    try {
      const queryVec = await embed(query);
      embScores = memoriesWithEmbedding.map((m) => ({
        memory: m,
        score: embeddingScore(queryVec, m.embedding),
      }));
      embScores.sort((a, b) => b.score - a.score);
    } catch (e) {
      // Embedding failed, continue with BM25 only
    }
  }

  // Compute RRF scores for each memory from BM25 ranking
  const rrfMap = new Map();
  bm25Scores.forEach((entry, rank) => {
    const id = entry.memory.id;
    const existing = rrfMap.get(id) || { memory: entry.memory, rrf: 0, bm25Score: entry.score, embSim: 0 };
    existing.rrf += rrfScore(rank + 1, rrfK);
    existing.bm25Score = entry.score;
    rrfMap.set(id, existing);
  });

  // Add RRF scores from embedding ranking
  embScores.forEach((entry, rank) => {
    const id = entry.memory.id;
    const existing = rrfMap.get(id) || { memory: entry.memory, rrf: 0, bm25Score: 0, embSim: entry.score };
    existing.rrf += rrfScore(rank + 1, rrfK);
    existing.embSim = entry.score;
    rrfMap.set(id, existing);
  });

  // Combine and sort by RRF score
  const results = Array.from(rrfMap.values())
    .sort((a, b) => b.rrf - a.rrf)
    .filter((entry) => entry.rrf >= similarityThreshold)
    .slice(0, maxResults)
    .map((entry, rank) => ({
      memory: entry.memory,
      score: entry.rrf,
      bm25Score: entry.bm25Score,
      embeddingScore: entry.embSim,
      rrfScore: entry.rrf,
      rank: rank + 1,
    }));

  return results;
}
