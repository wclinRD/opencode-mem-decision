import { Plugin } from "@opencode/plugin";
import { loadConfig } from "./config.js";
import { autoCapture } from "./capture.js";
import { runDreaming } from "./dreaming.js";
import { createWebServer } from "./server.js";

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

  if (mode === "add") return storage.addMemory(args.content, args.scope || "project");
  if (mode === "search") return storage.searchMemories(args.query, args.scope || "default");
  if (mode === "list") return storage.listMemories(args.limit || 50, args.scope || "default");
  if (mode === "profile") return { type: "info", message: "User profile not yet implemented" };
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
    if (typeof message?.text === "string") parts.push(message.text);
    if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (part?.type === "text" && typeof part.text === "string") parts.push(part.text);
      }
    }
  }
  return parts.join("\n");
}

export default Plugin.define({
  id: "opencode-mem-decision",
  async setup(ctx) {
    const memoryConfig = loadConfig(ctx.options || {});
    const { localStorage } = await import("./storage/local.js");

    const cleanups = [];

    if (memoryConfig.webServerHost) {
      try {
        const server = createWebServer({ memoryConfig, storage: localStorage });
        cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
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
          toToolResult(await runMemoryMode(input || {}, { storage: localStorage, memoryConfig })),
      });
    });

    // Auto-capture runs on idle sessions. Injection needs a prompt-rewrite API
    // that this module does not use yet; see doc/handover.md.
    if (ctx.event?.subscribe && ctx.session?.context) {
      const controller = new AbortController();
      cleanups.push(() => controller.abort());
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({
            types: ["session.idle"],
            signal: controller.signal,
          })) {
            if (event?.type !== "session.idle") continue;
            const sessionID = event.data?.sessionID;
            if (!sessionID) continue;
            const messages = await ctx.session.context({ sessionID });
            const text = sessionText(messages);
            if (!text) continue;
            await autoCapture({
              sessionData: { id: sessionID, messages: [{ content: text }] },
              memoryConfig,
              storage: localStorage,
            });
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
