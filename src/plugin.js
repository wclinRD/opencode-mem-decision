import { createPlugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { registerMemoryTools, registerKnowledgeTools } from "./tools/memoryTools.js";
import { createWebServer } from "./server.js";
import { autoCapture } from "./capture.js";
import { injectMemories, formatInjectedPrompt } from "./inject.js";
import { runDreaming } from "./dreaming.js";

const plugin = createPlugin({
  name: "opencode-mem-decision",
  version: "1.0.0",
  async init({ config, session, storage, tools, events }) {
    const memoryConfig = loadConfig(config);

    // Memory injection hook
    events.on("session.created", async (sessionData) => {
      if (!memoryConfig.chatMessage?.enabled) return;
      const injected = await injectMemories({ sessionData, memoryConfig, storage });
      if (injected.length > 0) {
        const prompt = formatInjectedPrompt(injected);
        sessionData.injectedPrompt = prompt;
      }
    });

    events.on("session.updated", async (sessionData) => {
      if (memoryConfig.chatMessage?.injectOn === "always") {
        const injected = await injectMemories({ sessionData, memoryConfig, storage });
        if (injected.length > 0) {
          const prompt = formatInjectedPrompt(injected);
          sessionData.injectedPrompt = prompt;
        }
      }
    });

    // Auto-capture hook
    events.on("session.idle", async (sessionData) => {
      const result = await autoCapture({ sessionData, memoryConfig, storage });
      if (result.action === "add") console.log(`[mem-decision] captured memory ${result.id}`);
      if (result.action === "update") console.log(`[mem-decision] updated memory ${result.id}`);
    });

    // Compaction / dreaming hook
    events.on("experimental.session.compacting", async (sessionData) => {
      const result = await runDreaming({ memoryConfig, storage });
      if (result.action === "dreamed" && result.count > 0) {
        console.log(`[mem-decision] dreaming consolidated ${result.count} memories`);
      }
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
