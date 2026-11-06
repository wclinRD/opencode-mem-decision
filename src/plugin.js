import { Plugin } from "@opencode/plugin";
import { loadConfig, getMemoryBackend } from "./config.js";
import { autoCapture, filterSessionText } from "./capture.js";
import { runDreaming } from "./dreaming.js";
import { createWebServer, releaseWebServer } from "./server.js";
import { injectMemories, formatInjectedPrompt, stripInjectedBlock, INJECTION_MARKER, calculateFillRatio } from "./inject.js";
import { buildProfile, recordPrompt } from "./profile.js";
import { logEvent, summarizeRecentEvents } from "./eventLog.js";
import { classifyMemory } from "./classify.js";
import { EmbeddingService } from "./embedding.js";
import { ExtractionService } from "./extraction.js";
import { setEmbeddingService, calculateMemoryUtilityScore, getTtlDaysForMemory } from "./storage/local.js";
import { skillsStorage } from "./skills.js";
import { resolveProjectShared } from "./projectShared.js";
import { simulateDualRouteRetrieve } from "./retrieval.js";
import path from "path";
import os from "os";

// Sessions that already received the one-shot injection. Module level because
// the hook registration lives for the whole process.
const injectedSessions = new Set();

const MEMORY_MODES = [
  "add", "search", "list", "profile", "forget", "migrate",
  "export", "import", "list-shards", "dream", "restore-trash",
  "organize", "retrieve", "utility",
  "benchmark", "access-stats", "clear-tracking",
  "knowledge-list", "knowledge-show", "knowledge-save", "knowledge-delete", "knowledge-search", "knowledge-import",
  "skill-list", "skill-show", "skill-save", "skill-delete",
];

// V2 tools take JSON Schema, not a schema builder.
const MEMORY_TOOL_INPUT = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: MEMORY_MODES,
      description: "Operation to perform.",
    },
    project: {
      type: "string",
      description: "Project name to scope memory operations to; if omitted, defaults to current project or global.",
    },
    content: {
      type: "string",
      description: "Memory or knowledge text (add, knowledge-save).",
    },
    query: {
      type: "string",
      description: "Search query (search).",
    },
    scope: {
      type: "string",
      description: "Memory scope filter (add, search, list).",
    },
    id: {
      type: "string",
      description: "Memory, knowledge or trash entry id (forget, knowledge-show, knowledge-delete, restore-trash).",
    },
    limit: {
      type: "integer",
      minimum: 1,
      description: "Maximum number of entries to return (list).",
    },
    outputPath: {
      type: "string",
      description: "Export destination path (export).",
    },
    inputPath: {
      type: "string",
      description: "Import source path (import).",
    },
    fromPath: {
      type: "string",
      description: "Legacy database path (migrate).",
    },
    buildGraph: {
      type: "boolean",
      description: "Build or update hierarchical graph after add memory.",
    },
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          expectedIds: { type: "array", items: { type: "string" } },
          expectedCount: { type: "integer" },
        },
        required: ["query"],
      },
      description: "Benchmark queries with expected results (benchmark mode).",
    },
    name: {
      type: "string",
      description: "Benchmark name (benchmark mode).",
    },
    includeExpired: {
      type: "boolean",
      description: "Include expired memories in search/benchmark.",
    },
    hybrid: {
      type: "boolean",
      description: "Use hybrid retrieval (embedding + BM25) for search.",
    },
    vectorSearch: {
      type: "boolean",
      description: "Use vector embedding search (legacy, superseded by hybrid).",
    },
  },
  required: ["mode"],
  additionalProperties: false,
};

async function runMemoryMode(args, { storage, memoryConfig, activeProject }) {
  const mode = args.mode;
  if (!mode) throw new Error("mode is required");

  // Derive project scope if a project was explicitly requested
  const projectScope = args.project
    ? `project:${args.project}`
    : activeProject?.projectName
      ? `project:${activeProject.projectName}`
      : null;

  // Memory modes
  if (mode.startsWith("skill-")) {
    const sm = mode.replace("skill-", "");
    if (sm === "list") return skillsStorage.listSkills(args.scope || "global", args.limit || 100);
    if (sm === "show") return skillsStorage.getSkill(args.id);
    if (sm === "save") return skillsStorage.addSkill(args.content, args.scope || "global", args.metadata || {});
    if (sm === "delete") return skillsStorage.deleteSkill(args.id);
    throw new Error(`Unknown skill mode: ${sm}`);
  }
  if (mode.startsWith("knowledge-")) {
    const km = mode.replace("knowledge-", "");
    if (km === "list") return storage.listKnowledge();
    if (km === "show") return storage.getKnowledge(args.id);
    if (km === "save") return storage.addKnowledge(args.content, args.id);
    if (km === "delete") return storage.deleteKnowledge(args.id);
    if (km === "search") return storage.searchKnowledge(args.query, { limit: args.limit });
    if (km === "import") {
      const { importKnowledgeFromDirectory } = await import("./storage/local.js");
      const dir = args.directory || process.cwd();
      return importKnowledgeFromDirectory(dir);
    }
    throw new Error(`Unknown knowledge mode: ${km}`);
  }

  if (mode === "add") {
    const classified = classifyMemory(args.content);
    const duplicateConfig = memoryConfig.duplicateDetection || { enabled: true, similarityThreshold: 0.75, updateOnMatch: true };
    const effectiveScope = projectScope || (args.scope || "project");
    if (args.buildGraph === true) {
      return storage.addMemoryLayered(args.content, effectiveScope, null, {
        type: classified.type,
        confidence: classified.confidence,
        sensitive: classified.sensitive,
      }, duplicateConfig, { buildGraph: true });
    }
    return storage.addMemory(args.content, effectiveScope, null, {
      type: classified.type,
      confidence: classified.confidence,
      sensitive: classified.sensitive,
    }, duplicateConfig);
  }
  if (mode === "update") {
    const updates = { ...(args.content && { content: args.content }), ...(args.scope && { scope: args.scope }) };
    if (args.project) {
      updates.scope = `project:${args.project}`;
    }
    if (args.metadata) {
      if (args.metadata.type !== undefined) updates.type = args.metadata.type;
      if (args.metadata.confidence !== undefined) updates.confidence = args.metadata.confidence;
      if (args.metadata.priority !== undefined) updates.priority = args.metadata.priority;
      if (args.metadata.sensitive !== undefined || args.metadata.sensitivity !== undefined) updates.sensitive = args.metadata.sensitive ?? args.metadata.sensitivity;
      if (args.metadata.tags !== undefined) updates.tags = args.metadata.tags;
    }
    return storage.updateMemory(args.id, updates);
  }
  if (mode === "search") {
    return storage.searchMemories(args.query, {
      scope: projectScope || (args.scope || "default"),
      includeExpired: args.includeExpired !== true,
      ttlDays: args.ttlDays,
      vectorSearch: args.hybrid || args.vectorSearch || false,
      hybrid: args.hybrid || false,
    });
  }
  if (mode === "list") return storage.listMemories(args.limit || 50, projectScope || (args.scope || "default"), memoryConfig);
  if (mode === "profile") return buildProfile({ storage, memoryConfig });
  if (mode === "forget") return storage.deleteMemory(args.id);
  if (mode === "export") return storage.exportMemories(args.outputPath, projectScope || (args.scope || "default"));
  if (mode === "import") return storage.importMemories(args.inputPath, projectScope || (args.scope || "default"));
  if (mode === "list-shards") return storage.listShards();
  if (mode === "migrate") return storage.migrate(args.fromPath);
  if (mode === "dream") return runDreaming({ memoryConfig, storage, activeProject });
  if (mode === "restore-trash") return (await import("./dreaming.js")).restoreTrashEntry(args.id, activeProject);
  if (mode === "organize") {
    const effectiveScope = activeProject?.projectName ? `project:${activeProject.projectName}` : (args.scope || "default");
    const graphData = await storage.buildGraphAndPersist(effectiveScope);
    const tagsCount = (graphData.categoryNodes || []).reduce((sum, c) => sum + (c.tags?.length || 0), 0);
    return { ...graphData, tagsCount };
  }
  if (mode === "retrieve") {
    const effectiveScope = activeProject?.projectName ? `project:${activeProject.projectName}` : (args.scope || "default");
    const baseMemories = await storage.searchMemories(args.query || "", { scope: effectiveScope, includeExpired: true });
    const graphData = await storage.buildGraphAndPersist(effectiveScope);
    const layeredFilter = args.filters?.layered || args.filters?.useGraph ? { layered: true, useGraph: true } : null;
    let memories;
    if (layeredFilter) {
      memories = await storage.searchMemoriesLayered(args.query || "", { ...layeredFilter, scope: effectiveScope, includeExpired: true });
    } else {
      memories = baseMemories;
    }
    return simulateDualRouteRetrieve(args.query || "", memories, graphData, args.filters || {});
  }
  if (mode === "utility") {
    const effectiveScope = projectScope || (args.scope || "default");
    const memories = await storage.listMemories(args.limit || 500, effectiveScope);
    return memories.map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      confidence: m.confidence,
      tags: m.tags,
      priority: m.priority,
      sensitivity: m.sensitivity,
      utilityScore: calculateMemoryUtilityScore(m),
      ttlDays: getTtlDaysForMemory(m, memoryConfig),
    }));
  }

  if (mode === "benchmark") {
    const { runBenchmark, getBenchmarks } = await import("./perf.js");
    if (args.queries && Array.isArray(args.queries)) {
      const effectiveScope = projectScope || (args.scope || "default");
      const filters = { scope: effectiveScope };
      if (args.includeExpired !== undefined) filters.includeExpired = args.includeExpired;
      const result = await runBenchmark(
        args.name || "manual-benchmark",
        args.queries,
        async (query) => await storage.searchMemories(query, filters),
        filters,
      );
      return result;
    }
    return getBenchmarks();
  }

  if (mode === "access-stats") {
    const { getAccessStats } = await import("./tracking.js");
    return getAccessStats();
  }

  if (mode === "clear-tracking") {
    const { clearTracking } = await import("./tracking.js");
    const { clearBenchmarkData } = await import("./perf.js");
    await clearTracking();
    await clearBenchmarkData();
    return { cleared: true };
  }

  throw new Error(`Unknown memory mode: ${mode}`);
}

// V2 tools return structured content: a string or an array of content parts.
function toToolResult(value) {
  const content = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return { content };
}

function sessionText(messages) {
  const parts = [];
  for (const message of messages || []) {
    if (typeof message?.text === "string") parts.push(stripInjectedBlock(message.text));
    if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (part?.type === "text" && typeof part.text === "string") parts.push(stripInjectedBlock(part.text));
      }
    }
  }
  return parts.join("\n");
}

function resolveDynamicCwdFromPrompt(event) {
  const prompt = event?.prompt;
  if (prompt?.directory) return prompt.directory;
  const files = prompt?.files || [];
  const firstFile = files.find((f) => f?.uri && f.uri.startsWith("file://"));
  if (firstFile) {
    const uri = firstFile.uri;
    const clean = uri.startsWith("file://") ? uri.slice(7) : uri;
    return path.dirname(clean);
  }
  return null;
}

function deriveSessionDirFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const latest = messages[messages.length - 1];
  const files = latest?.files || latest?.parts?.find((p) => p?.type === "text")?.files || [];
  const firstFile = files.find((f) => f?.uri && f.uri.startsWith("file://"));
  if (firstFile) {
    const uri = firstFile.uri;
    const clean = uri.startsWith("file://") ? uri.slice(7) : uri;
    return path.dirname(clean);
  }
  return null;
}

export default Plugin.define({
  id: "opencode-mem-decision",
  async setup(ctx) {
    const memoryConfig = loadConfig(ctx.options || {});
    const backend = getMemoryBackend(memoryConfig);
    let storage;

    // Initialize encryption if configured
    const { initEncryption } = await import("./storage/local.js");
    await initEncryption(memoryConfig);

    // Initialize schema migrations
    const { initStorage } = await import("./storage/local.js");
    await initStorage(memoryConfig);

    // Initialize embedding service
    const embeddingService = new EmbeddingService(memoryConfig);
    setEmbeddingService(embeddingService);

    // Initialize extraction service with generateFn
    let generateFn = null;
    if (ctx.session?.generate) {
      generateFn = async (sessionID, prompt) => {
        try {
          const result = await ctx.session.generate({ sessionID, prompt });
          return result?.text || result?.content || "";
        } catch (e) {
          console.error(`[opencode-mem-decision] generateFn failed for session ${sessionID}: ${e.message}`);
          return "";
        }
      };
    }
    const extractionService = new ExtractionService({
      ...memoryConfig,
      generateFn,
    });

    if (backend === "markdown") {
      console.log("[opencode-mem-decision] using Markdown Vault backend");
      const { markdownStorage } = await import("./storage/markdown.js");
      storage = markdownStorage;
    } else {
      console.log("[opencode-mem-decision] using database backend");
      const { localStorage } = await import("./storage/local.js");
      storage = localStorage;
    }

    const cleanups = [];

    if (memoryConfig.webServerHost) {
      try {
        const storeDir = ctx.storeDir || path.join(os.homedir(), ".config", "opencode", "plugins", "opencode-mem-decision");
        const configPath = path.join(storeDir, "config.json");
        const server = createWebServer({ memoryConfig, storage, configPath });
        cleanups.push(() => releaseWebServer(server));
      } catch (error) {
        console.error(`[opencode-mem-decision] web server failed to start: ${error.message}`);
      }
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "memory",
        description: "Manage cross-session memories and knowledge",
        input: MEMORY_TOOL_INPUT,
        execute: async (input) => {
          const activeProject = await resolveProjectShared({ memoryConfig, cwd: process.cwd() }).catch(() => null);
          return toToolResult(await runMemoryMode(input || {}, { storage, memoryConfig, activeProject }));
        },
      });
    });

    if (typeof ctx.session?.hook === "function") {
      const registration = await ctx.session.hook("prompt", async (event) => {
        if (!memoryConfig.chatMessage?.enabled) return;
        if (!event?.prompt || typeof event.prompt.text !== "string") return;

        void recordPrompt({ storage, memoryConfig }).catch(() => {});

        const injectOn = memoryConfig.chatMessage.injectOn || "first";
        const sessionID = event.sessionID;

        if (injectOn === "first") {
          if (injectedSessions.has(sessionID)) return;
          if (event.prompt.text.includes(INJECTION_MARKER)) {
            injectedSessions.add(sessionID);
            return;
          }
        }

        const promptCwd = resolveDynamicCwdFromPrompt(event);
        let activeProject = null;
        if (promptCwd) {
          activeProject = await resolveProjectShared({ memoryConfig, cwd: promptCwd }).catch(() => null);
        } else if (typeof ctx.session?.context === "function") {
          try {
            const messages = await ctx.session.context({ sessionID });
            const sessionDir = deriveSessionDirFromMessages(messages);
            activeProject = await resolveProjectShared({ memoryConfig, cwd: sessionDir || process.cwd() }).catch(() => null);
          } catch (error) {
            console.error(`[opencode-mem-decision] session context failed: ${error?.message || error}`);
          }
        } else {
          activeProject = await resolveProjectShared({ memoryConfig, cwd: process.cwd() }).catch(() => null);
        }

        const memories = await injectMemories({
          sessionData: { id: sessionID, latestMessage: event.prompt.text },
          memoryConfig,
          storage,
          contextWindowSize: memoryConfig.chatMessage?.contextWindowSize || 128000,
          activeProject,
          fallbackEnabled: memoryConfig.chatMessage?.fallbackRetrieval !== false,
        });
        const fillRatio = calculateFillRatio(event.prompt.text, memoryConfig.chatMessage?.contextWindowSize || 128000);
        const block = formatInjectedPrompt(memories, fillRatio);
        if (!block) return;

        event.prompt.text = `${event.prompt.text}\n\n${INJECTION_MARKER}\n${block}`;
        if (injectOn === "first") injectedSessions.add(sessionID);
      });
      cleanups.push(() => registration?.dispose?.());
    }

    // Auto-capture runs on session completion or idle transitions.
    // Relies on session.execution.* for reliable completion in V2;
    // session.status.type === "idle" may occur between internal turns.
    if (ctx.event?.subscribe && ctx.session?.context) {
      const controller = new AbortController();
      cleanups.push(() => controller.abort());
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({
            types: ["session.status", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"],
            signal: controller.signal,
          })) {
            const status = event?.data?.status;
            const sessionID = event?.data?.sessionID;
            if (!sessionID) continue;

            // session.execution.* are reliable completion events in V2.
            // session.status.type === "idle" may occur between internal turns.
            let isCompletionOrIdle = event?.type?.startsWith("session.execution.") || status?.type === "idle";
            if (!isCompletionOrIdle) continue;

            console.log(`[opencode-mem-decision] auto-capture triggered for session ${sessionID}, event type ${event?.type}`);

            const messages = await ctx.session.context({ sessionID }).catch((err) => {
              console.error(`[opencode-mem-decision] ctx.session.context failed for sessionID ${sessionID}: ${err?.message || err}`);
              return null;
            });
            const rawText = sessionText(messages);
            const filteredText = filterSessionText(rawText);
            if (!filteredText) {
              console.log(`[opencode-mem-decision] no filtered session text for session ${sessionID}, skip capture`);
              continue;
            }

            const classified = classifyMemory(filteredText, { contextWindowUsage: 0.5, memoryCount: 1 });
            console.log(`[opencode-mem-decision] auto-capture classify: ${classified.type}, text length ${filteredText.length}`);

            await logEvent({
              sessionID,
              actor: "system",
              event_type: "auto-capture",
              description: `Auto-captured filtered session of length ${filteredText.length} with type ${classified.type}`,
            });

            const action = await autoCapture({
              sessionData: { id: sessionID, messages: [{ content: rawText }] },
              memoryConfig,
              storage,
              classifyMemory: () => classified,
              extractionService,
              extractionSessionID: sessionID,
            });
            console.log(`[opencode-mem-decision] auto-capture action:`, action);
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            console.error(`[opencode-mem-decision] auto-capture stopped: ${error?.message || error}`);
          }
        }
      })();
    }

    return async () => {
      for (const cleanup of cleanups.reverse()) await cleanup();
    };
  },
});
