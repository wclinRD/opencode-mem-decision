import { runDreaming, restoreTrashEntry } from "../dreaming.js";

export function registerMemoryTools({ tools, storage, memoryConfig }) {
  tools.define("memory", {
    description: "Manage cross-session memories",
    modes: {
      add: {
        description: "Add a new memory",
        parameters: {
          content: { type: "string", description: "Memory content" },
          scope: { type: "string", description: "Memory scope", default: "project" },
        },
        handler: async ({ content, scope = "project" }) => {
          return storage.addMemory(content, scope);
        },
      },
      search: {
        description: "Search memories by query",
        parameters: {
          query: { type: "string", description: "Search query" },
          scope: { type: "string", description: "Memory scope", default: "default" },
          ttlDays: { type: "number", description: "Optional TTL days filter; if omitted, use memory type TTL" },
          includeExpired: { type: "boolean", description: "Include expired memories despite TTL", default: false },
        },
        handler: async ({ query, scope = "default", ttlDays, includeExpired }) => {
          return storage.searchMemories(query, { scope, ttlDays, includeExpired });
        },
      },
      list: {
        description: "List memories",
        parameters: {
          limit: { type: "number", description: "Max results", default: 50 },
          scope: { type: "string", description: "Memory scope", default: "default" },
        },
        handler: async ({ limit = 50, scope = "default" }) => {
          return storage.listMemories(limit, scope, memoryConfig);
        },
      },
      profile: {
        description: "Read user profile",
        parameters: {},
        handler: async () => {
          return { type: "info", message: "User profile not yet implemented" };
        },
      },
      forget: {
        description: "Delete a memory by id",
        parameters: { id: { type: "string", description: "Memory id" } },
        handler: async ({ id }) => {
          return storage.deleteMemory(id);
        },
      },
      export: {
        description: "Export memories to JSON",
        parameters: { outputPath: { type: "string", description: "Output file path" } },
        handler: async ({ outputPath }) => {
          return storage.exportMemories(outputPath);
        },
      },
      import: {
        description: "Import memories from JSON",
        parameters: { inputPath: { type: "string", description: "Input file path" } },
        handler: async ({ inputPath }) => {
          return storage.importMemories(inputPath);
        },
      },
      "list-shards": {
        description: "List memory shards",
        parameters: {},
        handler: async () => {
          return storage.listShards();
        },
      },
      migrate: {
        description: "Migrate memories from old path",
        parameters: { fromPath: { type: "string", description: "Source path" } },
        handler: async ({ fromPath }) => {
          return storage.migrate(fromPath);
        },
      },
      "cleanup-expired": {
        description: "Delete expired memories based on TTL rules",
        parameters: {
          dryRun: { type: "boolean", description: "If true, only return expired memories without deleting", default: false },
        },
        handler: async ({ dryRun = false }) => {
          if (dryRun) {
            const allMemories = await storage.listAllMemories();
            const expired = allMemories.filter((m) => {
              const ttlDays = storage.getTtlDaysForMemory(m, memoryConfig);
              const cutoff = new Date(Date.now() - ttlDays * 86400000).toISOString();
              return m.createdAt < cutoff;
            });
            return { expired, count: expired.length, deletedCount: 0 };
          }
          return storage.cleanupExpiredMemories(memoryConfig);
        },
      },
      update: {
        description: "Update an existing memory by id",
        parameters: {
          id: { type: "string", description: "Memory id" },
          content: { type: "string", description: "New content (optional)" },
          scope: { type: "string", description: "New scope (optional)" },
          metadata: { type: "object", description: "Metadata fields to update: type, confidence, priority, sensitive/sensitivity, tags (optional)" },
        },
        handler: async ({ id, content, scope, metadata }) => {
          const updates = { ...(content && { content }), ...(scope && { scope }) };
          if (metadata) {
            if ("type" in metadata) updates.type = metadata.type;
            if ("confidence" in metadata) updates.confidence = metadata.confidence;
            if ("priority" in metadata) updates.priority = metadata.priority;
            if ("sensitive" in metadata || "sensitivity" in metadata) updates.sensitive = metadata.sensitive ?? metadata.sensitivity;
            if ("tags" in metadata) updates.tags = metadata.tags;
          }
          return storage.updateMemory(id, updates);
        },
      },
      dream: {
        description: "Run manual memory consolidation (dreaming)",
        parameters: {},
        handler: async () => {
          return runDreaming({ memoryConfig, storage });
        },
      },
      "restore-trash": {
        description: "Restore a deleted memory from trash by id",
        parameters: { id: { type: "string", description: "Trash entry id" } },
        handler: async ({ id }) => {
          return restoreTrashEntry(id);
        },
      },
    },
  });
}

export function registerKnowledgeTools({ tools, storage, memoryConfig }) {
  if (!memoryConfig.knowledgeEnabled) return;

  tools.define("knowledge", {
    description: "Manage knowledge base entries",
    modes: {
      list: {
        description: "List knowledge entries",
        parameters: {},
        handler: async () => {
          return storage.listKnowledge();
        },
      },
      show: {
        description: "Show a knowledge entry by id",
        parameters: { id: { type: "string", description: "Knowledge id" } },
        handler: async ({ id }) => {
          return storage.getKnowledge(id);
        },
      },
      save: {
        description: "Save or update a knowledge entry",
        parameters: {
          content: { type: "string", description: "Knowledge content" },
          id: { type: "string", description: "Optional existing id" },
        },
        handler: async ({ content, id }) => {
          return storage.addKnowledge(content, id);
        },
      },
      delete: {
        description: "Delete a knowledge entry by id",
        parameters: { id: { type: "string", description: "Knowledge id" } },
        handler: async ({ id }) => {
          return storage.deleteKnowledge(id);
        },
      },
    },
  });
}
