import { randomUUID } from "node:crypto";

const LOCAL_VECTOR_DIM = 768;

// Fixed vocabulary of common technical terms for improved local embedding
const VOCABULARY = [
  // Programming languages
  "javascript", "typescript", "python", "java", "c", "cpp", "csharp", "go", "rust", "swift", "kotlin",
  "php", "ruby", "perl", "bash", "shell", "sql", "html", "css", "json", "xml", "yaml", "toml",
  // React
  "react", "component", "hook", "hooks", "state", "props", "render", "effect", "usestate", "useeffect",
  "usememo", "useref", "usecallback", "reducer", "context", "provider", "router", "route", "navigation",
  // Vue
  "vue", "directive", "computed", "watch", "template",
  // Angular
  "angular", "service", "controller", "module", "injector",
  // Node.js
  "node", "express", "middleware", "server", "client", "socket", "websocket",
  // Python
  "def", "import", "from", "as", "self", "method", "function", "class", "object", "array", "list",
  "dict", "tuple", "set", "string", "integer", "float", "boolean", "none", "null", "undefined",
  // Data structures
  "tree", "graph", "stack", "queue", "heap", "hashmap", "hash", "linked-list",
  // Algorithms
  "sort", "search", "binary-search", "binary-tree", "dynamic-programming", "greedy", "backtracking", "dfs", "bfs",
  // API
  "api", "endpoint", "request", "response", "header", "body", "status", "error", "get", "post", "put",
  "delete", "patch", "fetch", "axios", "curl",
  // Database
  "database", "db", "table", "row", "column", "index", "query", "select", "insert", "update",
  "join", "primary-key", "foreign-key", "mysql", "postgres", "sqlite", "mongodb", "redis",
  // Cloud
  "aws", "azure", "gcp", "cloud", "serverless", "lambda", "s3", "ec2", "kubernetes", "docker",
  "container", "pod", "deployment",
  // DevOps
  "ci", "cd", "pipeline", "build", "test", "deploy", "release", "version", "git", "github", "gitlab",
  "commit", "branch", "merge", "rebase",
  // Testing
  "unit", "integration", "e2e", "mock", "stub", "spy", "coverage", "jest", "mocha", "cypress", "playwright",
  // Frontend
  "browser", "dom", "element", "event", "click", "submit", "form", "input", "button", "textarea",
  "select", "option", "label", "checkbox", "radio",
  // UI/UX
  "ui", "ux", "design", "layout", "responsive", "mobile", "desktop", "accessibility", "theme",
  // Security
  "security", "auth", "authentication", "authorization", "token", "jwt", "oauth", "sso", "password",
  "encryption", "hashing", "salt",
  // Networking
  "http", "https", "tcp", "udp", "ip", "dns", "proxy", "firewall", "ssh",
  // Performance
  "performance", "optimization", "caching", "lazy", "loading", "bundle", "webpack", "rollup", "vite",
  // Error handling
  "exception", "try", "catch", "finally", "throw", "stack-trace", "debug", "logging", "monitoring",
  // Configuration
  "config", "configuration", "environment", "env", "variable", "constant", "setting", "option",
  "parameter", "argument",
  // Documentation
  "doc", "documentation", "readme", "api-docs", "swagger", "openapi",
  // Other
  "memory", "storage", "file", "directory", "path", "url", "uri", "plugin", "extension", "package",
  "dependency", "interface", "implementation", "abstraction", "encapsulation", "inheritance",
  "polymorphism", "oop", "functional", "paradigm", "pattern", "singleton", "factory",
  "observer", "strategy", "decorator", "adapter", "proxy", "mediator", "facade",
];

function hashTerm(term) {
  let h = 0;
  for (let i = 0; i < term.length; i++) {
    h = ((h << 5) - h) + term.charCodeAt(i);
    h &= h;
  }
  return Math.abs(h);
}

function textToVector(text) {
  const words = text.toLowerCase().split(/\s+/);
  const vector = new Float32Array(LOCAL_VECTOR_DIM);

  // Compute term frequencies
  const tf = {};
  for (const word of words) {
    tf[word] = (tf[word] || 0) + 1;
  }

  // Also add 2-grams
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    tf[bigram] = (tf[bigram] || 0) + 1;
  }

  // Map terms to vector dimensions using vocabulary
  for (const [term, count] of Object.entries(tf)) {
    if (VOCABULARY.includes(term)) {
      const idx = VOCABULARY.indexOf(term);
      vector[idx] += count;
    } else {
      // Hash unknown terms to a dimension
      const idx = (VOCABULARY.length + hashTerm(term)) % LOCAL_VECTOR_DIM;
      vector[idx] += count;
    }
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < LOCAL_VECTOR_DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < LOCAL_VECTOR_DIM; i++) {
      vector[i] /= norm;
    }
  }

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

    const provider = this.config.embeddingProvider;

    try {
      // If provider is explicitly set, use it
      if (provider) {
        if (provider === "openai" && this.config.embeddingApiUrl) {
          return await this._embedRemote(text, this.config.embeddingModel || "text-embedding-3-small", this.config.embeddingApiUrl, this.config.embeddingApiKey);
        }
        if (provider === "ollama") {
          return await this._embedOllama(text);
        }
        if (provider === "hf") {
          const model = this.config.embeddingModel || "Xenova/nomic-embed-text-v1";
          if (!model.startsWith("Xenova/")) {
            return await this._embedHfInference(text, model);
          }
        }
        if (provider === "local") {
          return this._embedLocal(text);
        }
      }

      // Fallback chain based on config (when provider is not set)
      if (this.config.embeddingApiUrl && !this._isOllamaUrl(this.config.embeddingApiUrl)) {
        return await this._embedRemote(text, this.config.embeddingModel || "text-embedding-3-small", this.config.embeddingApiUrl, this.config.embeddingApiKey);
      }
      if (this._isOllamaUrl(this.config.embeddingApiUrl)) {
        return await this._embedOllama(text);
      }
      const model = this.config.embeddingModel || "Xenova/nomic-embed-text-v1";
      if (!model.startsWith("Xenova/")) {
        return await this._embedHfInference(text, model);
      }

      return this._embedLocal(text);
    } catch (error) {
      console.warn(`Embedding provider error, falling back to local: ${error.message}`);
      return this._embedLocal(text);
    }
  }

  async embedBatch(texts) {
    const results = await Promise.all(texts.map((text) => this.embed(text)));
    return results;
  }

  _isOllamaUrl(url) {
    return url && (url.startsWith("http://localhost:11434") || url.startsWith("https://localhost:11434"));
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
    return textToVector(text);
  }

  async _embedOllama(text) {
    const host = this.config.embeddingOllamaHost || "http://localhost:11434";
    const model = this.config.embeddingOllamaModel || "nomic-embed-text";
    const url = `${host}/api/embed`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data && data.embedding) {
      return data.embedding;
    }

    throw new Error("Ollama embedding API returned unexpected response");
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
