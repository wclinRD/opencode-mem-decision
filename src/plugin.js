import { createPlugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { registerMemoryTools, registerKnowledgeTools } from "./tools/memoryTools.js";
import { createWebServer } from "./server.js";

const plugin = createPlugin({
  name: "opencode-mem-decision",
  version: "1.0.0",
  async init({ config, session, storage, tools, events }) {
    const memoryConfig = loadConfig(config);

    // Register session hooks
    events.on("session.created", async (sessionData) => {
      // Memory injection will be implemented in Phase 2
    });

    events.on("session.idle", async (sessionData) => {
      // Auto-capture will be implemented in Phase 2
    });

    events.on("experimental.session.compacting", async (sessionData) => {
      // Compaction hook for memory consolidation
    });

    // Register memory tools
    registerMemoryTools({ tools, storage, memoryConfig });

    // Register knowledge tools
    registerKnowledgeTools({ tools, storage, memoryConfig });

    // Start web server if configured
    if (memoryConfig.webServerHost && memoryConfig.webServerHost !== "127.0.0.1") {
      createWebServer({ memoryConfig, storage });
    }
  },
});

export default plugin;
