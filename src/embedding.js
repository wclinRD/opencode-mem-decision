import { randomUUID } from "node:crypto";

const LOCAL_VECTOR_DIM = 768;

function deterministicHash(text, seed) {
  let h = 0;
  const key = String(seed) + String(text);
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    h = ((h << 5) - h) + char;
    h &= h;
  }
  return h;
}

function hashText(text) {
  const vector = new Float32Array(LOCAL_VECTOR_DIM);
  for (let i = 0; i < LOCAL_VECTOR_DIM; i++) {
    vector[i] = (deterministicHash(text, i) % 10000) / 10000;
  }
  let norm = 0;
  for (let i = 0; i < LOCAL_VECTOR_DIM; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < LOCAL_VECTOR_DIM; i++) vector[i] /= norm;
  return Array.from(vector);
}

export class EmbeddingService {
  constructor(config = {}) {
    this.config = config;
  }

  async embed(text) {
    if (!text || typeof text !== "string") {
      return Array.from(new Float32Array(LOCAL_VECTOR_DIM));
    }
    if (this.config.embeddingApiUrl) {
      return this._embedRemote(text, this.config.embeddingModel || "text-embedding-3-small", this.config.embeddingApiUrl, this.config.embeddingApiKey);
    }
    const model = this.config.embeddingModel || "Xenova/nomic-embed-text-v1";
    if (model.startsWith("Xenova/")) {
      return this._embedLocal(text);
    }
    return this._embedHfInference(text, model);
  }

  async embedBatch(texts) {
    const results = await Promise.all(texts.map((text) => this.embed(text)));
    return results;
  }

  async _embedRemote(text, model, apiBaseUrl, apiKey) {
    const url = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/v1/embeddings`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: text }),
    });
    if (!response.ok) throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    if (data && data.data && data.data[0]) return data.data[0].embedding;
    if (data && Array.isArray(data.data)) return data.data[0];
    if (data && Array.isArray(data)) return data[0];
    return data?.embedding || data;
  }

  _embedLocal(text) {
    return hashText(text);
  }

  async _embedHfInference(text, model) {
    const hfToken = this.config.hfToken || process.env.HF_TOKEN;
    const url = `https://api-inference.huggingface.co/models/${model}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}),
      },
      body: JSON.stringify({ inputs: text }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HuggingFace Inference error ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    if (Array.isArray(data)) {
      return data[0] && data[0].length === LOCAL_VECTOR_DIM ? data[0] : data;
    }
    if (data && data.data && Array.isArray(data.data[0])) return data.data[0];
    return data?.data || data;
  }
}

export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const norm = Math.sqrt(normA) * Math.sqrt(normB);
  return norm === 0 ? 0 : dot / norm;
}
