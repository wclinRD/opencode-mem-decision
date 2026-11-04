# OpenCode Mem-Decision Plugin 交接文件

## 專案概述

OpenCode Memory Plugin 提供跨會話的持久化記憶系統，讓 AI coding agents 能在多個 sessions 中保持上下文。plugin 支援自動抓取、自動注入、手動操作、web UI、以及進階記憶整合功能。

## 功能模組清單

### 核心模組（必須實作）

1. **Storage Backend**
   - Local Vector DB (libSQL/Turso)
   - Markdown Vault backend
   - Remote API backend

2. **Auto-Capture**
   - `session.idle` hook
   - AI provider 提取技術決策
   - Credential redaction
   - Smart deduplication

3. **Memory Injection**
   - `session.created`, `session.updated` hooks
   - Recall modes: `relevant`, `recent`, `both`
   - Compaction hook: `experimental.session.compacting`
   - Injection markers

4. **Manual Memory Tools**
   - `memory.add`, `memory.search`, `memory.list`
   - `memory.profile`, `memory.forget`
   - `memory.export`, `memory.import`
   - `memory.list-shards`, `memory.migrate`

### 可選模組（全部實作）

5. **User Profile**
   - Cross-project 使用者偏好總結
   - 每 N 個 prompts 自動更新
   - Web UI profile view

6. **Dreaming**
   - Background pass 找 related memories
   - Merge/update/supersede/keep/flag
   - Soft-delete 進 trash

7. **Web UI**
   - Memory–prompt timeline
   - Captures 檢查、user profile 管理
   - Trash restore、manual dream run
   - Stats tab

8. **Security & Privacy**
   - Credential redaction
   - Database encryption at rest (AES-256-GCM)
   - Web UI HTTP Basic Auth
   - Export privacy

9. **Advanced Features**
   - Schema migrations (legacy SQLite → Turso/libSQL)
   - Recovery of interrupted re-embed swaps
   - Lock files
   - Shared project memory via `.opencode-mem-project`
   - Shared skills registry + REST API

## 技術堆疊

- **Language**: TypeScript / JavaScript
- **Storage**: libSQL/Turso (local), Markdown files, Remote API
- **Embeddings**: `@huggingface/transformers` (local), OpenAI-compatible API (remote)
- **AI Providers**: Anthropic, OpenAI, OpenRouter, GitHub Copilot
- **Web UI**: React + Vite (或 Next.js)
- **Plugin Framework**: `@opencode-ai/plugin`

## 安裝與配置

### Plugin 註冊

`opencode.json` 或 `opencode-mem-decision.jsonc`:

```json
{
  "plugins": ["opencode-mem-decision@latest"]
}
```

### 設定檔

`~/.config/opencode/opencode-mem-decision.jsonc`:

```json
{
  "memoryBackend": "database",
  "markdownPath": "~/Documents/LLM-Wiki",
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
  "webServerAuthPassword": ""
}
```

## 開發步驟

### Phase 1: Core Plugin

1. 建立 plugin skeleton (`src/plugin.ts`)
2. 實作 local storage backend (libSQL/Turso)
3. 實作 Auto-Capture hook (`session.idle`)
4. 實作 Memory Injection hooks (`session.created`, `session.updated`)
5. 實作 memory custom tools (`add`, `search`, `list`)

### Phase 2: Advanced Tools

6. 實作 `profile`, `forget`, `export`, `import`, `list-shards`, `migrate`

### Phase 3: Optional Modules

7. 實作 Markdown Vault & Remote API backends
8. 實作 User Profile logic
9. 實作 Dreaming logic
10. 實作 Web UI (React/Vite)

### Phase 4: Security & Advanced

11. 實作 credential redaction
12. 實作 database encryption at rest
13. 實作 schema migrations & lock files
14. 實作 shared skills registry + REST API

## 測試計畫

### Unit Tests

- Storage backend read/write operations
- Credential redaction patterns
- Configuration parser
- Tool execution logic

### Integration Tests

- Auto-capture trigger on `session.idle`
- Memory injection on `session.created`
- Manual tool calls (`add`, `search`, `list`)
- Web UI REST API endpoints

### E2E Tests

- Full lifecycle: start session → capture → end session → restart → inject
- Cross-project memory sharing via `.opencode-mem-project`
- Dreaming consolidation flow
- Markdown vault sync

## 當前實作狀態

### 已完成 (Implemented)

1. **Plugin skeleton**：`src/plugin.js` 載入 config，註冊 `session.created`, `session.idle`, `experimental.session.compacting` hooks。
2. **Basic tools**：`memory` (add/search/list/profile/forget/export/import/migrate/list-shards) 與 `knowledge` (list/show/save/delete)。
3. **Basic storage**：JSON file based storage (`memories.db.json`, `knowledge.db.json`)。
4. **Web server scaffolding**：`src/server.js` with `GET /api/memory`, `GET /api/knowledge`, `GET /api/stats`, basic auth pattern。
5. **Config interface**：`src/config.js` 已包含 `chatMessage`, `dreaming`, `webServerPort`, `updateOnCapture*`, `knowledgeEnabled`。
6. **Credential redaction**：`src/security.js` 實作移除 GitHub token、OpenAI key、AWS key、Slack token、GCP key、PEM private key。
7. **Storage interface**：`src/storage/local.js` 提供 add/search/list/delete/export/import介面。
8. **Unit tests**：`tests/security.test.js` 覆蓋 credential redaction。

### 未完成 (To Implement)

1. **libSQL/Turso Local Vector DB**：實作 vector search，`F32_BLOB` cosine distance。
2. **Markdown Vault backend**：Obsidian/Raneto 相容 `.md` 檔案。
3. **Remote API backend**：OpenAI-compatible embeddings endpoint。
4. **Auto-Capture core**：AI provider 提取技術決策、bug 解決、架構選擇；credential redaction 已完成但 AI extraction stub。
5. **Smart deduplication & update-on-capture**。
6. **Memory Injection 完整邏輯**：relevant/recent/both recall modes。
7. **Dreaming (memory consolidation)**：merge/update/supersede/keep/flag，soft-delete 進 trash。
8. **User Profile logic**：每 N 個 prompts 自動更新。
9. **Database encryption at rest (AES-256-GCM)**。
10. **Schema migrations & lock files**。
11. **Shared project memory via `.opencode-mem-project` marker file**。
12. **Shared skills registry + REST API**。
13. **Web UI (React/Vite)**。
14. **Integration/E2E tests**。

## 已知限制

1. **Intel Mac (`darwin/x64`) 不支援**：local embeddings 與 Turso/libSQL 無 x64 native binding。
2. **No MLX backend**：local embeddings 使用 `@huggingface/transformers` + ONNX，非 Apple MLX。
3. **Remote embeddings**：需 OpenAI-compatible API endpoint 與 API key。
4. **Structured output requirement**：auto-capture 與 profile learning 需要 provider 支援 structured/tool-call output。

## 參考資源

- 官方 Plugin docs: https://opencode.ai/docs/plugins/
- `opencode-mem` 原始碼: https://github.com/tickernelz/opencode-mem
- Memwyre OpenCode Plugin: https://memwyre.tech/opencode-memory
- OpenChamber Extensions: https://openchamber.dev/extensions/

## 下一步

1. 確認功能模組清單無誤。
2. 開始實作 Phase 1: Core Plugin。
3. 建立 repo 與 CI/CD pipeline。
4. 撰寫 unit tests 與 integration tests。
5. 發佈 npm package (`opencode-mem-decision@latest`)。
