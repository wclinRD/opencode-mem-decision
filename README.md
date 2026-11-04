# opencode-mem-decision

OpenCode Memory Plugin — cross-session persistent memory system for AI coding agents.

## Features

- Auto-capture on `session.idle`
- Memory injection on `session.created`, `session.updated`
- Manual memory tools: `add`, `search`, `list`, `profile`, `forget`, `export`, `import`, `list-shards`, `migrate`
- Knowledge tools: `list`, `show`, `save`, `delete`
- Credential redaction (GitHub token, OpenAI key, AWS key, Slack token, GCP key, PEM private key)
- Web server with HTTP Basic Auth
- JSON file based storage (temporary backend)

## Status

- ✅ Plugin skeleton, basic tools, JSON storage, web server scaffolding, credential redaction
- 🔲 libSQL/Turso vector DB, Markdown Vault, Remote API
- 🔲 Auto-Capture core, Memory Injection logic, Dreaming, User Profile
- 🔲 Web UI (React/Vite), integration/e2e tests

See `doc/DESIGN.md` and `doc/handover.md` for details.

## Installation to OpenCode

### Step 1: Register plugin in OpenCode config

Edit `~/.config/opencode/opencode.jsonc` and add the plugin to the `plugins` array:

```json
{
  "plugins": ["opencode-mem-decision"]
}
```

If the file does not exist, create it with the `plugins` array.

### Step 2: Configure the plugin

Create or edit `~/.config/opencode/opencode-mem-decision.jsonc`:

```json
{
  "memoryBackend": "database",
  "storagePath": "~/.opencode-memory",
  "chatMessage": {
    "enabled": true,
    "injectOn": "first",
    "recall": "relevant",
    "recallScope": "default",
    "similarityThreshold": 0.75,
    "maxMemories": 3,
    "excludeCurrentSession": true,
    "maxAgeDays": null,
    "filterInjectedPrompts": true,
    "captureChildSessions": false
  },
  "updateOnCaptureEnabled": false,
  "updateOnCaptureSimilarityThreshold": 0.75,
  "updateOnCaptureMaxCandidates": 5,
  "dreaming": {
    "enabled": false,
    "relatedThreshold": 0.75,
    "crossProject": false,
    "trashRetentionDays": 30
  },
  "embeddingModel": "Xenova/nomic-embed-text-v1",
  "embeddingApiUrl": "",
  "embeddingApiKey": "",
  "opencodeProvider": "anthropic",
  "opencodeModel": "claude-haiku-4-5-20251001",
  "webServerHost": "127.0.0.1",
  "webServerPort": 4747,
  "webServerAuthUsername": "",
  "webServerAuthPassword": "",
  "knowledgeEnabled": true
}
```

### Step 3: Load the plugin

Restart OpenCode or reload the plugin configuration. The plugin entry point is `index.js`.

Verify the plugin is loaded by checking OpenCode logs for `opencode-mem-decision` initialization.

### Step 4: Use memory tools

In an OpenCode session, call memory tools:

```typescript
memory({ mode: "add", content: "Remember the project uses React + Tailwind.", scope: "project" });
memory({ mode: "search", query: "frontend stack" });
memory({ mode: "list", limit: 10 });
memory({ mode: "profile" });
memory({ mode: "forget", id: "mem_xxx" });
```

Knowledge tools:

```typescript
knowledge({ mode: "save", content: "Architecture notes..." });
knowledge({ mode: "list" });
knowledge({ mode: "show", id: "kb_xxx" });
knowledge({ mode: "delete", id: "kb_xxx" });
```

## Troubleshooting

### Plugin not loading

- Ensure `opencode.jsonc` has `"plugins": ["opencode-mem-decision"]`.
- The plugin uses JavaScript (not Bun ESM bundle). Entry point is `index.js`.
- Check OpenCode logs for plugin load errors.

### Credential redaction not working

- Verify `src/security.js` patterns match your credential formats.
- Redaction applies before writing to storage.

### Web server not starting

- Web server starts only when `webServerHost !== "127.0.0.1"`.
- Ensure `webServerAuthUsername` and `webServerAuthPassword` are set for non-loopback hosts.

## Documentation

- `doc/DESIGN.md` — full design document
- `doc/handover.md` — implementation status and next steps
- `doc/lesson_learn.md` — lessons learned from plugin loading issues
