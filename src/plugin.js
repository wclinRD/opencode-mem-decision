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
import { setEmbeddingService } from "./storage/local.js";

// Sessions that already received the one-shot injection. Module level because
// the hook registration lives for the whole process.
const injectedSessions = new Set();

const MEMORY_MODES = [
  "add", "search", "list", "profile", "forget", "migrate",
  "export", "import", "list-shards", "dream", "restore-trash",
  "knowledge-list", "knowledge-show", "knowledge-save", "knowledge-delete",
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
  },
  required: ["mode"],
  additionalProperties: false,
};

async function runMemoryMode(args, { storage, memoryConfig }) {
  const mode = args.mode;
  if (!mode) throw new Error("mode is required");

  // Memory modes
  if (mode.startsWith("knowledge-")) {
    const km = mode.replace("knowledge-", "");
    if (km === "list") return storage.listKnowledge();
    if (km === "show") return storage.getKnowledge(args.id);
    if (km === "save") return storage.addKnowledge(args.content, args.id);
    if (km === "delete") return storage.deleteKnowledge(args.id);
    throw new Error(`Unknown knowledge mode: ${km}`);
  }

  if (mode === "add") {
    const classified = classifyMemory(args.content);
    return storage.addMemory(args.content, args.scope || "project", null, {
      type: classified.type,
      confidence: classified.confidence,
      sensitive: classified.sensitive,
    });
  }
  if (mode === "update") {
    const updates = { ...(args.content && { content: args.content }), ...(args.scope && { scope: args.scope }) };
    if (args.metadata) {
      if (args.metadata.type !== undefined) updates.type = args.metadata.type;
      if (args.metadata.confidence !== undefined) updates.confidence = args.metadata.confidence;
      if (args.metadata.priority !== undefined) updates.priority = args.metadata.priority;
      if (args.metadata.sensitive !== undefined || args.metadata.sensitivity !== undefined) updates.sensitive = args.metadata.sensitive ?? args.metadata.sensitivity;
      if (args.metadata.tags !== undefined) updates.tags = args.metadata.tags;
    }
    return storage.updateMemory(args.id, updates);
  }
  if (mode === "search") return storage.searchMemories(args.query, { scope: args.scope || "default", includeExpired: args.includeExpired !== true, ttlDays: args.ttlDays });
  if (mode === "list") return storage.listMemories(args.limit || 50, args.scope || "default", memoryConfig);
  if (mode === "profile") return buildProfile({ storage, memoryConfig });
  if (mode === "forget") return storage.deleteMemory(args.id);
  if (mode === "export") return storage.exportMemories(args.outputPath);
  if (mode === "import") return storage.importMemories(args.inputPath);
  if (mode === "list-shards") return storage.listShards();
  if (mode === "migrate") return storage.migrate(args.fromPath);
  if (mode === "dream") return runDreaming({ memoryConfig, storage });
  if (mode === "restore-trash") return (await import("./dreaming.js")).restoreTrashEntry(args.id);

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
        const server = createWebServer({ memoryConfig, storage });
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
        execute: async (input) =>
          toToolResult(await runMemoryMode(input || {}, { storage, memoryConfig })),
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

        const memories = await injectMemories({
          sessionData: { id: sessionID, latestMessage: event.prompt.text },
          memoryConfig,
          storage,
          contextWindowSize: memoryConfig.chatMessage?.contextWindowSize || 128000,
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

            const classified = classifyMemory(filteredText);
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
