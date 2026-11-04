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
- **Plugin Framework**: `@opencode/plugin` (V2, 2.2.x)

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
2. **Basic tools**：`memory` (add/search/list/profile/forget/export/import/migrate/list-shards/dream/restore-trash) 與 `knowledge` (list/show/save/delete)。
3. **Basic storage**：JSON file based storage (`memories.db.json`, `knowledge.db.json`, `trash.db.json`)。
4. **Web server scaffolding**：`src/server.js` with `GET /api/memory`, `GET /api/knowledge`, `GET /api/stats`, basic auth pattern.
5. **Config interface**：`src/config.js` 已包含 `chatMessage`, `dreaming`, `webServerPort`, `updateOnCapture*`, `knowledgeEnabled`.
6. **Credential redaction**：`src/security.js` 實作移除 GitHub token、OpenAI key、AWS key、Slack token、GCP key、PEM private key.
7. **Storage interface**：`src/storage/local.js` 提供 add/search/list/delete/export/import 介面.
8. **Auto-Capture core**：`src/capture.js` 實作 simHash + Jaccard similarity, smart deduplication, update-on-capture.
9. **Memory Injection**：`src/inject.js` 實作 relevant/recent/both recall modes, injection markers, filter injected prompts.
10. **Dreaming**：`src/dreaming.js` 實作 merge/supersede/update decisions, soft-delete to trash, restore-trash tool.
11. **Unit tests**：`tests/security.test.js`, `tests/capture.test.js` 覆蓋 credential redaction 與 similarity.

### 未完成 (To Implement)

1. **libSQL/Turso Local Vector DB**：實作 vector search，`F32_BLOB` cosine distance.
2. **Markdown Vault backend**：Obsidian/Raneto 相容 `.md` 檔案.
3. **Remote API backend**：OpenAI-compatible embeddings endpoint.
4. **Auto-Capture AI extraction stub**：provider 需支援 structured/tool-call output.
5. **User Profile logic**：每 N 個 prompts 自動更新.
6. **Database encryption at rest (AES-256-GCM)**.
7. **Schema migrations & lock files**.
8. **Shared project memory via `.opencode-mem-project` marker file**.
9. **Shared skills registry + REST API**.
10. **Web UI (React/Vite)**.
11. **Integration/E2E tests**.

## 已知限制

1. **Intel Mac (`darwin/x64`) 不支援**：local embeddings 與 Turso/libSQL 無 x64 native binding。
2. **No MLX backend**：local embeddings 使用 `@huggingface/transformers` + ONNX，非 Apple MLX。
3. **Remote embeddings**：需 OpenAI-compatible API endpoint 與 API key。
4. **Structured output requirement**：auto-capture 與 profile learning 需要 provider 支援 structured/tool-call output。

## V2 Plugin Migration (2026-11-04)

### 問題

OpenCode 已升級到 v2.2.0，但 plugin 仍是 V1 形狀 `export default { id, server }`，使用 `@opencode-ai/plugin/tool`。V2 loader 直接拒絕載入，log 證據：

```
level=WARN message="failed to load plugin" target=/Users/wclin/.config/opencode/plugins/opencode-mem-decision
cause="Cause([Fail(PluginModule.LoadError: Plugin must export a default definition with an id and an effect or setup function.
(cause: SchemaError(Missing key at ["default"]["effect"] Missing key at ["default"]["setup"])))])"
```

另一個中間錯誤（已排除）：從 `@opencode-ai/plugin/dist/promise/index.js` 匯入不存在的 `createPlugin`。

### 修正內容

1. `package.json`：依賴由 `@opencode-ai/plugin@^1.0.0` 改為 `@opencode/plugin@^2.2.5`，`package-lock.json` 與 `node_modules` 同步更新。
2. `src/plugin.js`：改為 `export default Plugin.define({ id: "opencode-mem-decision", async setup(ctx) {...} })`。
   - 設定改從 `ctx.options` 讀取。
   - `memory` tool 由 `await ctx.tool.transform((editor) => editor.add({...}))` 註冊；callback 保持同步，config/storage 在 transform 之前載入。
   - `input` 由 `tool.schema` 改為 JSON Schema（`type: "object"`、`required: ["mode"]`、`additionalProperties: false`）。
   - `execute` 回傳 `{ content }`；非字串結果以 `JSON.stringify` 序列化。
   - 15 個 mode 全部保留（add/search/list/profile/forget/migrate/export/import/list-shards/dream/restore-trash/knowledge-*）。
3. `index.js`：只保留 `export { default } from "./src/plugin.js"`，移除失效的 named `plugin` export。
4. `src/server.js`：web server 啟動條件改為 `webServerHost` 非空即啟動（預設 `127.0.0.1`）；加上 `error` handler，port 被占用時只記 log，不讓 host process crash。`setup` 回傳的 cleanup 會 `server.close()` 並 abort event subscription。
5. `session.idle` 接上 auto-capture：`ctx.event.subscribe({ types: ["session.idle"], signal })` → `ctx.session.context({ sessionID })` → `autoCapture({ sessionData, memoryConfig, storage })`。
6. `tests/plugin.test.js` 改測 V2 形狀：`plugin.id`、`plugin.setup`、tool 註冊、JSON Schema、`execute` 回傳 `{ content }`、web server 啟動。`npm test` 23/23 pass。
7. `src/storage/local.js`（`~` 展開）與 `src/config.js`（deep merge）是本次工作前既有的未提交修改，保留不動。

### 驗證（2026-11-04，實機）

`opencode service restart` 後，log 只出現載入成功，沒有 `failed to load plugin`：

```
timestamp=2026-11-04T03:36:33.564Z level=INFO run=b5cdda88 msg="loading plugin" id=/Users/wclin/.config/opencode/plugins/opencode-mem-decision entrypoint=file:///Users/wclin/.config/opencode/plugins/opencode-mem-decision/index.js role=server
```

`opencode api get /api/plugin` 回傳：

```json
{"id":"opencode-mem-decision","source":{"type":"local","path":"/Users/wclin/.config/opencode/plugins/opencode-mem-decision"},"features":{"server":true},"state":{"status":"active"}}
```

web server（`127.0.0.1:4747`）實際可用：`curl http://127.0.0.1:4747/api/stats` 回傳 `{"memories":...,"knowledge":...,"timestamp":...}`。
全域 `index.js` 以 `node -e "import(...)"` 載入，`default.id === "opencode-mem-decision"`、`typeof default.setup === "function"`。

> 註：`03:36:29` 有一次短暫的 `failed to load plugin`（`createPlugin` 匯入錯誤），發生在複製檔案與 `npm install` 之間的空窗；安裝完成後 reload 即恢復，屬已排除的暫時狀態。

### 載入路徑

實際載入的是全域副本，不是本 repo：

```
~/.config/opencode/plugins/opencode-mem-decision/
```

修改 repo 後必須同步 `index.js`、`package.json`、`package-lock.json`、`src/`，並在全域目錄執行 `npm install`。驗證方式：

```sh
opencode service restart
opencode service status
opencode api get /api/plugin | grep opencode-mem-decision
grep "opencode-mem-decision" ~/.local/share/opencode/log/opencode.log | tail
```

成功時只有 `loading plugin`，沒有 `failed to load plugin`；`memory` tool 會出現在工具清單。

### 尚未接上

- **Memory injection**：尚未註冊 `ctx.session.hook("prompt", ...)`。V2 的 `SessionPrompt` 只給 `prompt`（`PromptInput.Prompt`）與 `metadata`，與 `injectMemories({ sessionData, ... })` 期待的 `sessionData.messages` 形狀不合，需先確認可安全改寫 prompt 的方式；`src/inject.js` 目前沒有被 plugin 呼叫。
- **`profile` mode**：仍是 stub。
- **Web UI**：只有 REST API，尚無前端。
- **多實例同時載入**：每個 opencode process 都會嘗試綁 `127.0.0.1:4747`，第二個實例會拿到 `EADDRINUSE`（只記 log、不影響載入）。若要多實例共用，需改成單一持有者或可設定的 port。

## 參考資源

- 官方 Plugin docs (V2): https://opencode.ai/v2/docs/build/plugins
- `opencode-mem` 原始碼: https://github.com/tickernelz/opencode-mem
- Memwyre OpenCode Plugin: https://memwyre.tech/opencode-memory
- OpenChamber Extensions: https://openchamber.dev/extensions/

## 下一步

1. 確認功能模組清單無誤。
2. 開始實作 Phase 1: Core Plugin。
3. 建立 repo 與 CI/CD pipeline。
4. 撰寫 unit tests 與 integration tests。
5. 發佈 npm package (`opencode-mem-decision@latest`)。
