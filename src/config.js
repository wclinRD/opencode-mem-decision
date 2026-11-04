const DEFAULT_CONFIG = {
  memoryBackend: "database",
  markdownPath: null,
  storagePath: "~/.opencode-memory",
  chatMessage: {
    enabled: true,
    injectOn: "first",
    recall: "relevant",
    recallScope: "default",
    similarityThreshold: 0.75,
    maxMemories: 3,
    excludeCurrentSession: true,
    maxAgeDays: null,
    filterInjectedPrompts: true,
    captureChildSessions: false,
  },
  updateOnCaptureEnabled: false,
  updateOnCaptureSimilarityThreshold: 0.75,
  updateOnCaptureMaxCandidates: 5,
  userProfileAnalysisInterval: 10,
  dreaming: {
    enabled: false,
    relatedThreshold: 0.75,
    crossProject: false,
    trashRetentionDays: 30,
  },
  embeddingModel: "Xenova/nomic-embed-text-v1",
  embeddingApiUrl: "",
  embeddingApiKey: "",
  opencodeProvider: "anthropic",
  opencodeModel: "claude-haiku-4-5-20251001",
  memory: {
    defaultScope: "project",
  },
  webServerHost: "127.0.0.1",
  webServerPort: 56789,
  webServerAuthUsername: "",
  webServerAuthPassword: "",
  knowledgeEnabled: true,
};

export function loadConfig(userConfig = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    chatMessage: { ...DEFAULT_CONFIG.chatMessage, ...(userConfig.chatMessage || {}) },
    dreaming: { ...DEFAULT_CONFIG.dreaming, ...(userConfig.dreaming || {}) },
    memory: { ...DEFAULT_CONFIG.memory, ...(userConfig.memory || {}) },
  };
}

export function getMemoryBackend(config) {
  return config.memoryBackend || "database";
}
