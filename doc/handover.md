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
   - `session.status` event (`status.type === "idle"`)
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
   - Static HTML/JS memory manager (`src/static/ui.html`)
   - GET /api/memory, POST /api/memory, DELETE /api/memory/:id, GET /api/stats
   - Search memories via GET /api/memory/search?query=&scope=
   - Basic Auth via `webServerAuthUsername/password`

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
  "webServerPort": 56789,
  "webServerAuthUsername": "",
  "webServerAuthPassword": ""
}
```

## 開發步驟

### Phase 1: Core Plugin

1. 建立 plugin skeleton (`src/plugin.ts`)
2. 實作 local storage backend (libSQL/Turso)
3. 實作 Auto-Capture 狀態觸發：`session.status` 監聽 `status.type === "idle"`
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

- Auto-capture trigger on `session.status` (`status.type === "idle"`)
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

1. **Plugin skeleton**：`src/plugin.js` 載入 config，註冊 `session.created`, `session.status`, `experimental.session.compacting` 狀態與壓縮 hook。
2. **Basic tools**：`memory` (add/search/list/profile/forget/export/import/migrate/list-shards/dream/restore-trash) 與 `knowledge` (list/show/save/delete)。
3. **Basic storage**：JSON file based storage (`memories.db.json`, `knowledge.db.json`, `trash.db.json`)。
4. **Web server scaffolding**：`src/server.js` with `GET /api/memory`, `GET /api/knowledge`, `GET /api/stats`, basic auth pattern.
5. **Static Web UI**：`src/static/ui.html` 由 `src/server.js` 在 `/` 與 `/index.html` 下提供；API CRUD、search 與 basic auth。
6. **Config interface**：`src/config.js` 已包含 `chatMessage`, `dreaming`, `webServerPort: 56789`, `updateOnCapture*`, `knowledgeEnabled`.
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
10. **Integration/E2E tests**.

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
4. `src/server.js`：web server 啟動條件改為 `webServerHost` 非空即啟動（預設 `127.0.0.1`），預設 port 改為 `56789`；加上 `error` handler，port 被占用時只記 log，不讓 host process crash；根路徑 `/` 與 `/index.html` 返回 `src/static/ui.html`。`setup` 回傳的 cleanup 會 `server.close()` 並 abort event subscription。
5. `session.status` 接上 auto-capture：`ctx.event.subscribe({ types: ["session.status"], signal })` → `ctx.session.context({ sessionID })` → `autoCapture({ sessionData, memoryConfig, storage })`，只處理 `status.type === "idle"`。
6. `tests/plugin.test.js` 改測 V2 形狀：`plugin.id`、`plugin.setup`、tool 註冊、JSON Schema、`execute` 回傳 `{ content }`、web server 啟動。`npm test` 23/23 pass。
7. `src/storage/local.js`（`~` 展開）與 `src/config.js`（deep merge）是本次工作前既有的未提交修改，保留不動。

注意：`session.idle` 在 V2 已被標為 deprecated，且事件流中不會可靠發出。因此 auto-capture 改訂閱 `session.status`，並只當 `status.type === "idle"` 時才觸發。

### 驗證（2026-11-04，實機）

`opencode service restart` 後，log 只出現載入成功，沒有 `failed to load plugin`：

```
timestamp=2026-11-04T03:36:33.564Z level=INFO run=b5cdda88 msg="loading plugin" id=/Users/wclin/.config/opencode/plugins/opencode-mem-decision entrypoint=file:///Users/wclin/.config/opencode/plugins/opencode-mem-decision/index.js role=server
```

`opencode api get /api/plugin` 回傳：

```json
{"id":"opencode-mem-decision","source":{"type":"local","path":"/Users/wclin/.config/opencode/plugins/opencode-mem-decision"},"features":{"server":true},"state":{"status":"active"}}
```

web server（`127.0.0.1:56789`）實際可用：`curl http://127.0.0.1:56789/api/stats` 回傳 `{"memories":...,"knowledge":...,"timestamp":...}`。
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

### 尚未接上（已於下一節補完）

- ~~**Memory injection**~~：已接上 `ctx.session.hook("prompt", ...)`，見下一節。
- ~~**`profile` mode**~~：已實作，見下一節。
- **Web UI**：已實作靜態 HTML/JS 管理器（`src/static/ui.html`），提供 CRUD 與搜尋功能。
- ~~**多實例同時載入**~~：同 process 已共用 server；跨 process 仍只記錄 EADDRINUSE，見下一節。

## 功能補完 (2026-11-04，第二輪)

上一節列的「尚未接上」已補完，以下為本輪變更。

### 1. Prompt 注入接線

- `src/plugin.js` 在 `ctx.session?.hook` 存在時註冊 `ctx.session.hook("prompt", ...)`。
- `chatMessage.enabled === false` 時整個 hook 直接返回。
- `sessionData` adapter 為 `{ id: event.sessionID, latestMessage: event.prompt.text }`。
- `injectOn: "first"`（預設）以 module-level `Set` 記錄已注入的 session；prompt 已含 marker 也視為已注入。其他值（`"always"` / `"every"`）每次 prompt 都注入。
- 注入內容以 `\n\n` + `<!-- opencode-mem-decision:injected -->` + `\n` 接在使用者文字後面，不覆蓋原文。
- `src/inject.js` 新增 `stripInjectedBlock(text)`（從 marker 切掉）。auto-capture 逐則 message 先 strip，避免把注入內容再存成記憶。
- auto-capture 建立的回憶會帶 `sessionId`（`addMemory(content, scope, sessionId)`）；tool 的 `add` 不帶。
- `injectMemories` 的 `excludeCurrentSession` 以 `m.sessionId !== sessionData.id` 過濾。
- 注入前依 `id` 去重（保留排名最前者），避免真實 store 內同 id 重複資料佔用 token。
- `recall: "relevant"` 在零命中時 fallback 到 recent，預設注入仍會有內容；`"recent"` / `"both"` 語意不變。

### 2. 關鍵字搜尋

`src/storage/local.js` 的 `searchMemories(query, scope)`：

- 以 `/[\p{L}\p{N}]+/gu` tokenize（Unicode 字母/數字）。
- 分數 = 命中 query token 數；query 非空時過濾 score > 0。
- 排序 score desc、createdAt desc；空 query 回傳 scope 內全部（新到舊）。

### 3. User profile

- 新增 `src/profile.js`：`buildProfile`、`recordPrompt`。
- profile 內容：`generatedAt`、`promptCount`、`totals`（memories/knowledge/scopes）、`userPreferences`（scope `user`/`global`）、`recentMemories`（最新 10）、`topKeywords`（前 15，含英文與繁中 stopword）、`knowledge`（count + 最新 10 個標題前 80 字）。
- 寫入 `<storage>/profile.json`；`getStorageDir()` 為唯一路徑來源。
- `recordPrompt` 每次 prompt 累加 `promptCount`；達到 `userProfileAnalysisInterval`（預設 10）時重建並回傳 profile，否則回傳 `null`。prompt hook 以 fire-and-forget 呼叫，不阻塞 admission。
- `memory({ mode: "profile" })` 與 `GET /api/profile` 都回傳即時重建（並持久化）的 profile。
- 所有複製到 profile 的 content 都經 `redactCredentials`。

### 4. 多實例 web server

- `src/server.js` 以 module-level shared server + ref count 管理。
- 同 process 同 host/port 第二次 `createWebServer` 只增加 ref 並回傳同一 server。
- `releaseWebServer(server)` 遞減 ref，歸零時 `close`（並 `closeAllConnections`）後清除 shared state；重複呼叫安全。
- `EADDRINUSE` 只印一行：
  `[opencode-mem-decision] port 4747 already in use; assuming another OpenCode instance serves the memory API`
  不 crash、不重試、不改 port。
- plugin cleanup 改呼叫 `releaseWebServer(server)`。

### 5. Dreaming trash 與 `/api/dream`

- `src/dreaming.js` 改用 `getStorageDir()` 組合 `trash.db.json`（原本是未展開的 `"~/.opencode-memory"`）。
- 順帶修正 dreaming 讀取記憶的 scope：原本 `listMemories(1000, "all-projects")` 永遠抓不到一般記憶，改為 `"default"`（全部）。
- `POST /api/dream` 呼叫 `runDreaming` 並回傳結果；`/api/skills` 維持 501。

### 6. 測試隔離

- `src/storage/local.js` 移除 module-level `STORAGE_DIR`，改為 `getStorageDir()`：`OPENCODE_MEM_DIR` 優先，否則 `$HOME/.opencode-memory`。
- `tests/storage.test.js`、`tests/profile.test.js`、`tests/inject.test.js`、`tests/plugin.test.js` 都在 `beforeEach` 設定 `OPENCODE_MEM_DIR` 到 temp dir、`afterEach` 清除，不再污染真實 home。
- `tests/plugin.test.js` 的 fake context 會依名稱保存 `session.hook` callback；新增 prompt hook 註冊、first/always 注入、profile 形狀、兩個 setup 共用 server 並釋放 port 的測試。

### 驗證

`npm test`：40 tests，40 pass，0 fail。

### 本輪限制

- 搜尋仍是關鍵字比對，不是 embedding；中文 token 以連續漢字為單位，長句關鍵字品質有限。
- profile 的 `topKeywords` 對中文只做整段 token，沒有斷詞。
- 注入的記憶只在 prompt 尾端附加；V2 hook 只給 `PromptInput.Prompt`，沒有 system prompt 注入點。
- dreaming 仍只做相似度兩兩比對，沒有 AI 判斷；trash retention 尚未實作自動清理。
- 多實例只解決同 process 重複 setup；跨 process 仍是單一 port 持有者，其他 process 假設外部已有服務。

## Web UI 靜態頁面實作與優化 (2026-11-04)

### 檔案與路由

- `src/static/ui.html`：純 HTML/CSS/JS 管理介面。
- `src/server.js`：在 `path === "/" || path === "/index.html"` 時回傳 `src/static/ui.html`。
- `src/server.js`：新增 `GET /api/memory/search?query=<q>&scope=<s>`，回傳 `storage.searchMemories(query, scope)`。
- `src/config.js`：`webServerPort` 預設改為 `56789`。

### UI 功能

- 記憶新增：POST `/api/memory`（內容、scope）。
- 記憶刪除：DELETE `/api/memory/:id`。
- 記憶查詢：GET `/api/memory`（全部）與 GET `/api/memory/search?query=&scope=`。
- 知識列表：GET `/api/knowledge`，在記憶下方顯示知識卡片，支援刪除。
- 知識刪除：DELETE `/api/knowledge/:id`。
- 統計：GET `/api/stats` 回傳記憶與知識總數。
- 登入：若配置 `webServerAuthUsername/password`，需透過 Basic Auth，可在 fetch 中手動設定，或由瀏覽器提示 Basic Auth 輸入（fetch 需主動帶上 `Authorization: Basic <base64>`）。

### 近期優化

- 深色模式：依系統 `prefers-color-scheme` 自動切換色彩。
- Toast 通知：成功與錯誤以彈出式 toast 取代 `alert`。
- 範圍篩選器：從所有記憶動態提取 unique scopes，搜尋時支援限定單一 scope 與所有範圍。
- 排序：依建立時間新到舊或舊到新排序（前端 sort）。
- 排版： Sticky header、卡片陰影與 hover、pill badge、響應式網格、form 與搜尋列優化。
- 批量刪除：`DELETE /api/memory?query=<q>&scope=<s>`，UI 提供「Delete All by Filter」按鈕，僅在輸入查詢或選定 scope 時啟用。

### 限制

- 目前沒有 React/Vite，只有原生 HTML/JS。
- 搜尋是關鍵字比對，不是 embedding；中文 token 以連續漢字為單位。
- 未實作 memory–prompt timeline、user profile 管理等進階介面。

## 參考資源

- 官方 Plugin docs (V2): https://opencode.ai/v2/docs/build/plugins
- `opencode-mem` 原始碼: https://github.com/tickernelz/opencode-mem
- Memwyre OpenCode Plugin: https://memwyre.tech/opencode-memory
- OpenChamber Extensions: https://openchamber.dev/extensions/

## 記憶品質改進 (2026-11-04)

- [x] `eventLog.js`：`summarizeRecentEvents` 現在排除 `auto-capture`、`tool_use`、`tool_result`，保留 `tool_call` 等使用者事件。
- [x] `capture.js`：`shouldExcludeLine` 新增 `[auto-capture]` 線與程式狀態訊息過濾。
- [x] `classify.js`：修正正則匹配無限循環；只在有匹配時對非 fact 類別中斷；提高 confidence 門檻至 0.8。
- [x] 測試：`tests/eventLog.test.js` 調整以符合新邏輯。
- [x] 全部測試通過（55/55）。

## 記憶體 TTL 與過期清理機制 (2026-11-04)

- [x] `config.js`：新增 `memory.ttl` 設定（`defaultDays`, `factDays`, `lowPriorityDays`, `sensitiveDays`）。
- [x] `storage/local.js`：新增 `getTtlDaysForMemory`, `cleanupExpiredMemories`, `listAllMemories`, TTL 篩選至 `searchMemories`/`listMemories`。
- [x] `memoryTools.js`：新增 `memory.cleanup-expired` 工具（支援 dry-run）。
- [x] `server.js`, `plugin.js`, `inject.js`, `capture.js`, `dreaming.js`, `profile.js`：全面採用 TTL-aware 查詢。
- [x] 測試：58/58 通過，包含 TTL helper、cleanup、search TTL filter。

## 記憶更新元數據保留機制 (2026-11-04)

- [x] `storage/local.js::updateMemory`：支援更新 `type`、`confidence`、`priority`、`sensitive/sensitivity`、`tags`，保留未提供的既有元數據，且 `id`/`createdAt` 不受用戶更新影響。
- [x] `capture.js`：`autoCapture` 在 updateOnCapture 時更新記憶元數據（`type`, `confidence`, `priority`, `sensitive`, `tags`）。
- [x] `memoryTools.js`：新增 `memory.update` 工具，支援更新 `id`, `content`, `scope`, `metadata`。
- [x] `plugin.js`：增加 `mode === "update"` 處理。
- [x] 測試：70/70 通過，包含 `updateMemory preserves existing metadata when not provided`、`updateMemory updates metadata fields`、`updateMemory preserves id and original createdAt when not changed`。

## 記憶管理工具進階功能 (2026-11-04)

- [x] `memoryTools.js::memory.search`：增加 `confidenceFilter`，支援 `scope` 與 `ttlDays`。
- [x] `memoryTools.js::memory.profile`：完整實作，支援 `timeWindowHours` 時間視窗。
- [x] `memoryTools.js::memory.forget`：改為 soft-delete（移至 trash）。
- [x] `memoryTools.js::memory.cleanup-trash`：清理逾齡 trash 條目（保留天數可配置）。
- [x] `profile.js::buildProfile`：以 `timeWindowHours` 過濾記憶，並排除過期。
- [x] `dreaming.js`：使用 `softDeleteMemory` 移入 trash，並依 `dreaming.trashRetentionDays` 自動清理 trash。
- [x] `storage/local.js`：新增 `softDeleteMemory`、`cleanupTrash`，並加入 `TRASH_FILE`。
- [x] 測試：61/61 通過。

## 高階記憶整合：Embedding Service 與 Vector Search（2026-11-04）

- [x] 建立 `src/embedding.js`，提供 `EmbeddingService` 類別：
  - 支援遠端 OpenAI 相容 `/v1/embeddings` API（可設定 `embeddingApiUrl` 與 `embeddingApiKey`）。
  - 支援 Hugging Face Inference API（`api-inference.huggingface.co/models/<model>`）。
  - 當無 API 且 `model` 以 `Xenova/` 開頭時，使用本地 stub（固定維度 768，基於文字雜湊，已正規化）。
- [x] `src/storage/local.js`：
  - 透過 `setEmbeddingService` 注入 embedding service。
  - `addMemory` 與 `updateMemory` 在支援時計算並儲存 `embedding` 陣列。
  - `searchMemories` 新增 `vectorSearch: true`，使用餘弦相似度計算查詢向量與記憶向量，回傳符合門檻的向量檢索結果。
- [x] `src/plugin.js`：初始化 `EmbeddingService` 並設定至 storage 層。
- [x] 新增 `tests/embedding.test.js`（8 個測試）與 `tests/storage.test.js`（vector search 相關測試）。
- [x] 測試總數：73 全部通過。

## 自動去重功能（2026-11-05）

- [x] 建立 `src/dedup.js`：提供 `findDuplicateMemories` 與 `buildDuplicateConfig`。
  - 當 embedding service 可用時，使用向量餘弦相似度（固定 768 維）比對記憶。
  - 當無 embedding 時，回退至字串 simHash/Jaccard 相似度與短子句比對。
- [x] 更新 `src/config.js`：`duplicateDetection` 預設 `{ enabled: true, similarityThreshold: 0.75, updateOnMatch: true }`；`updateOnCaptureEnabled` 預設設為 `true`。
- [x] 更新 `src/storage/local.js::addMemory`：依 `duplicateDetection` 配置檢查現有記憶，若相似且 `updateOnMatch` 為真，則更新既有記憶而非新增；否則跳過新增。
- [x] 更新 `src/storage/markdown.js::addMemory`：以 `findDuplicateMemories` 進行去重，更新既有 markdown 檔案或跳過。
- [x] 更新 `src/capture.js::autoCapture`：不再使用舊有的 `isDuplicate` 內建檢查，直接呼叫 `storage.addMemory` 並依其回傳值判斷為 update 或 add。
- [x] 更新 `src/plugin.js::runMemoryMode add`：傳遞 `duplicateDetection` 配置至 `storage.addMemory`。
- [x] 補上 `tests/dedup.test.js`（4 個測試）。
- [x] 調整 `tests/storage.test.js` 的 dreaming trash 測試，加入 `{ enabled: false }` 避免預設去重干擾。
- [x] 全部測試通過：84/84。

## Auto-Capture AI 提取 stub（2026-11-05）

- [x] 建立 `src/extraction.js`：`ExtractionService` 支援遠端 OpenAI 相容聊天完成 API (`extractionApiUrl`/`extractionApiKey`)、Hugging Face Inference (`extractionModel`)，以及本地 stub（摘要、topics、codeSnippets、decisions）。
- [x] `src/plugin.js` 初始化 `ExtractionService`，並傳入 `capture.js::autoCapture`。
- [x] `capture.js::autoCapture` 在儲存主記憶後，調用 `extract`，若提取結果包含 summary、decisions、codeSnippets，則分別儲存 type 為 summary/decision/code 的附加記憶，tags 標示 `auto-extraction`。
- [x] 更新 `src/config.js` 增加 `extractionProvider`（預設 "stub"）、`extractionApiUrl`、`extractionApiKey`、`extractionModel`。
- [x] 全部測試通過：84/84。

## User Profile 自動更新（每 N 個 prompts）（2026-11-05）

- [x] `src/profile.js`：`recordPrompt` 累加 `promptCount`，達到 `userProfileAnalysisInterval`（預設 10）後重建並寫入 `<storage>/profile.json`；`buildProfile` 回傳 totals、userPreferences、recentMemories、topKeywords、knowledge。
- [x] `src/plugin.js` 每次 prompt hook 開始處 fire-and-forget 呼叫 `recordPrompt`，不阻塞 admission。
- [x] `memory profile` tool 與 `GET /api/profile` 即時重建並持久化 profile。
- [x] 測試：`tests/profile.test.js` 包含 totals/preferences/keywords、redact、interval 重建，全部 84/84 通過。

## Database Encryption at Rest（2026-11-04）

- [x] 建立 `src/storage/encryption.js`，使用 `AES-256-GCM` 加密/解密 JSON 資料（衍生金鑰使用 `scrypt`，salt 儲存於 `encryption/salt.json`）。
- [x] `src/config.js` 新增 `memory.encryption` 設定（`enabled`、`password`），預設未啟用。
- [x] `src/storage/local.js`：在 `initEncryption` 讀取/建立 salt，計算 `encryptionKey`；`readJsonFile`/`writeJsonFile` 支援加密與未加密檔案的相容讀取。
- [x] `src/plugin.js` 在 setup 時呼叫 `initEncryption`，確保加密層初始化。
- [x] 測試：`tests/storage.test.js` 新增 `encryption stores and decrypts data`，成功儲存與解密加密記憶檔。

## Schema Migrations & Lock Files（2026-11-04）

- [x] 建立 `src/storage/migrations.js`，提供 `SCHEMA_VERSION = 2`，`readVersion`、`writeVersion`、`applyMigration`、`lockMigrations`、`unlockMigrations`、`ensureSchema`。
- [x] `src/storage/local.js` 引入 `ensureSchema`，`src/plugin.js` 在 setup 時呼叫 `initStorage` 確保 schema。
- [x] 測試：`tests/migrations.test.js` 包含版本預設、`ensureSchema` 升級以及讀寫一致性測試。
- [x] 測試總數：76 全部通過。

## Markdown Vault Backend（2026-11-04）

- [x] 建立 `src/storage/markdown.js`，以 `vault/` 目錄下的 `.md` 檔案儲存記憶：
  - `createFrontMatter` 生成 front matter（metadata）與純文字內容。
  - `parseFrontMatter` 解析 front matter 與內容，合併回傳 `metadata` 與 `content` 的平層物件。
  - 支援 `addMemory`、`searchMemories`（字串搜尋）、`listMemories`、`getMemory`、`updateMemory`、`deleteMemory`、`listAllMemories`。
- [x] `src/plugin.js` 引入 `getMemoryBackend`，依 `memoryBackend`（`database`/`markdown`）選擇 `localStorage` 或 `markdownStorage`。
- [x] 測試：`tests/markdown.test.js` 包含 4 個測試，全部通過。
- [x] 目前測試總數：80 全部通過。

詳細待辦與計畫參見 [`todo.md`](../todo.md)。

## Shared project memory via `.opencode-mem-project`（2026-11-05）

- [x] 建立 `src/projectShared.js`：`findProjectMarker` 向上尋找 `.opencode-mem-project`，解析項目名稱（小寫化並 sanitise）；`createProjectMarker` 可建立標記檔案。
- [x] `src/config.js` 加入 `projectShared: { enabled: true, markerFileName: ".opencode-mem-project" }`。
- [x] `capture.js::autoCapture` 在加入記憶時檢測 project marker，有標記則儲存為 `shared-project` scope，並附加 `project:<name>` 標籤。
- [x] 測試：`tests/projectShared.test.js`（5 個測試），全部 89/89 通過。

## Shared skills registry + REST API（2026-11-05）

- [x] 建立 `src/skills.js`：`skillsStorage` 提供 `addSkill`、`listSkills`、`getSkill`、`updateSkill`、`deleteSkill`、`searchSkills`，資料存於 `<storage>/skills.db.json`。
- [x] `src/plugin.js` 新增 `skill-list`、`skill-show`、`skill-save`、`skill-delete` 模式，由 `runMemoryMode` 路由至 `skillsStorage`。
- [x] `src/server.js` 實作 `GET /api/skills`、`GET /api/skills/search`、`POST /api/skills`、`DELETE /api/skills`、`DELETE /api/skills/:id` 等 REST 路由。
- [x] 測試：`tests/skills.test.js`（3 個測試），全部 92/92 通過。

## 下一步

1. 確認功能模組清單無誤。
2. 開始實作 Phase 1: Core Plugin。
3. 建立 repo 與 CI/CD pipeline。
4. 撰寫 unit tests 與 integration tests。
5. 發佈 npm package (`opencode-mem-decision@latest`)。
