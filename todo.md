# OpenCode Mem-Decision Plugin 待辦清單

## 已完成（截至 2026-11-04）

- [x] Step 1：改善 auto-capture 內容質量
  - [x] 過濾 `[auto-capture]`、`tool_use`、`tool_result`、程式狀態訊息等雜訊。
  - [x] 修正 `classify.js` 正則匹配無限循環。
  - [x] 調整 confidence 門檻與 pattern 分類優先級。
  - [x] 補齊 `eventLog.test.js` 測試。

## 未完成

### Step 2：記憶 TTL / 過期清理機制

- [x] 設計記憶 TTL 規則（按 type/priority/sensitivity）。
- [x] 在 `storage/local.js` 實作 `getTtlDaysForMemory`、`cleanupExpiredMemories`、`listAllMemories`。
- [x] 在 `config.js` 加入 `memory.ttl.defaultDays`、`memory.ttl.factDays`、`memory.ttl.lowPriorityDays`、`memory.ttl.sensitiveDays`。
- [x] 實作 `memory.cleanup-expired` custom tool (dry-run/no-delete mode).
- [x] 在 `searchMemories`/`listMemories` 加入 TTL 篩選。
- [x] 更新 `server.js`, `plugin.js`, `inject.js`, `capture.js`, `dreaming.js`, `profile.js` 使用 TTL-aware list/search.
- [x] 測試：58/58 通過，包含 TTL-helper、cleanup、search TTL filter.

### Step 3：更新記憶時保留元數據

- [x] `autoCapture` updateOnCapture 時保留 `type`、`confidence`、`tags`、`priority`。
- [x] `storage/local.js::updateMemory` 支持元數據更新（type/confidence/priority/sensitive/tags）並保留未提供字段。
- [x] 新增 `memory.update` tool，支援更新 content/scope/metadata。
- [x] 補單元測試：`updateMemory preserves existing metadata when not provided`、`updateMemory updates metadata fields`、`updateMemory preserves id and original createdAt when not changed`。

### Step 4：記憶管理工具進階功能

- [x] `memory.search` 支援 `ttlFilter`、`confidenceFilter`、`scope`。
- [x] `memory.profile` 加入時間視窗與過期排除（`timeWindowHours`）。
- [x] `dreaming.js` 加入 soft-delete trash retention 自動清理。
- [x] 新增 `memory.forget` 為 soft-delete（移入 trash）。
- [x] 新增 `memory.cleanup-trash` 工具（清理逾齡 trash）。
- [x] 測試：61/61 通過。

### Step 5：高階記憶整合

- [x] 實作 `EmbeddingService`，支援遠端 OpenAI 相容 API、Hugging Face Inference，以及本地 stub（固定維度 768）。
- [x] `src/storage/local.js` 在 `addMemory`、`updateMemory` 儲存 `embedding`，`searchMemories` 支援 `vectorSearch`（餘弦相似度）。
- [x] `src/plugin.js` 初始化 embedding service 並註冊至 storage。
- [x] 建立 Database encryption at rest：在 `config.js` 加入 `memory.encryption`，`local.js` 使用 `AES-256-GCM` 加密/解密儲存檔（支援 salt 重現與未加密相容讀取）。
- [x] 建立 Schema migrations：`src/storage/migrations.js` 實作 `ensureSchema`、`readVersion`、`writeVersion`、鎖定與解鎖，確保 schema 升級與相容性。
- [x] 建立 Markdown Vault backend：`src/storage/markdown.js`，支援以 markdown front matter 儲存記憶，並完成 `addMemory`、`searchMemories`、`listMemories`、`getMemory`、`updateMemory`、`deleteMemory`。
- [x] `src/plugin.js` 依 `memoryBackend` 選擇 backend（`database` 或 `markdown`）。
- [x] 測試：80/80 通過（`embedding.test.js`、`migrations.test.js`、`markdown.test.js`、`storage.test.js`）。
- [x] 實作自動去重功能：`src/dedup.js` 提供 `findDuplicateMemories` 與 `buildDuplicateConfig`，`src/storage/local.js` 與 `markdown.js` 的 `addMemory` 依 `duplicateDetection` 配置進行相似度比對與更新/跳過。
- [x] 配置預設啟用自動去重：`src/config.js` 加入 `duplicateDetection: { enabled: true, similarityThreshold: 0.75, updateOnMatch: true }`，並將 `updateOnCaptureEnabled` 預設設為 `true`。
- [x] `src/capture.js` 的 auto-capture 現直接使用 storage `addMemory` 的內建去重並回傳 `update` 或 `add` 結果。
- [x] 測試：84/84 通過（含 `dedup.test.js`）。

- [x] Remote API backend（OpenAI-compatible embeddings）。
- [x] Auto-Capture AI 提取 stub（provider structured output）：整合 `src/extraction.js`，在 auto-capture 產生 summary/decisions/codeSnippets 記憶。
- [x] User Profile 自動更新（每 N 個 prompts）：`src/profile.js` 的 `recordPrompt` 已實現 promptCount 累計與 interval 時重建，`src/plugin.js` 於每次 prompt hook 觸發。
- [x] Shared project memory via `.opencode-mem-project`: 已實作 projectShared.js 讀寫標記與 shared-project scope。
- [x] Shared skills registry + REST API: 建立 `src/skills.js`，`plugin.js` 支援 skill-list/show/save/delete modes，`server.js` 提供 `/api/skills` 與 `/api/skills/search` 路由。

### Step 6：Web UI 設定頁面與設定更新

- [x] 新增 `GET /api/config`（安全回傳 config，隱藏敏感值如 API key/password）。
- [x] 新增 `POST /api/config`（寫回 plugin config 檔，並更新 server 監聽 port/Host）。
- [x] `src/server.js` 支持 `configPath` 參數（預設 `~/.config/opencode/plugins/opencode-mem-decision/config.json`）以讀寫設定檔。
- [x] `src/plugin.js` 計算 `configPath`（優先 `ctx.storeDir/config.json`，否則 fallback）並傳入 `createWebServer`。
- [x] `src/static/ui.html` 新增 Settings tab，包含 Web Server、Embedding、Extraction、Duplicate Detection、Markdown Vault、Encryption、Project Shared、Dreaming、Auto-capture、Profile、Event log 等控制項與表單驗證。
- [x] 測試：`tests/server.config.test.js`，驗證 config read/write、敏感值隱藏、設定更新流程。
- [x] 更新 `doc/handover.md` 與 `README.md`（標明 Web UI 為實作，說明設定頁功能）。
- [x] `git add -A && npm test && git commit`。

### Step 6：HybridTagGraph Memory（靜態標籤分組＋動態分層/圖檢索）

- [ ] 研究靜態標籤分組與動態分層/圖檢索的最新演算法（Mnemis、MemTree、TagRAG、TAGGRAPH）。
- [ ] 定義記憶分層模型：Base Memory（原始）、Summary Node（摘要）、Principle/Category Node（分類抽象）。
- [ ] 實作 `src/organize.js`：
  - [ ] 生成 Base / Summary / Category 節點並建立 adjacency graph。
  - [ ] 支援 tag overlap / keyword 相似度建邊。
  - [ ] 支援時間邊（temporal edges）。
- [ ] 實作 `src/retrieval.js`：
  - [ ] System-1 Similarity Search（tags + keyword/vector similarity）。
  - [ ] System-2 Global Selection（沿 hierarchy 遍歷取相關社群與原始記憶）。
- [ ] 實作 `src/storage/graph.js`：圖結構 JSON/Markdown 儲存與載入。
- [ ] 更新 `src/static/ui.html`：增加「Organize Memory」section，顯示分層組織與檢索結果。
- [ ] 實作 `POST /api/memory/organize` 與 `POST /api/memory/retrieve`。
- [ ] 補充測試（`organize.test.js`、`retrieval.test.js`、`graph.test.js`）。
- [ ] 更新 `doc/handover.md`。
- [ ] 同步 `src/static/ui.html` 至全局 plugin。

### Step 7：後續高階整合（Phase 2，可选）

- [ ] 整合 vector embedding（遠端 API / Hugging Face / local stub）。
- [ ] 使用 LLM summarization 生成 Summary / Principle 節點。
- [ ] AdaptiveGraph（personalized PageRank diffusion）與多跳查詢優化。

## 優先級建議

1. Step 6（HybridTagGraph）：補足靜態標籤分組的關聯與全局檢索能力，實用且可落地。
2. Step 2（TTL/清理）：直接提升記憶庫品質，減少垃圾。
3. Step 3（元數據保留）：確保 update 不會丟失質量標籤。
4. Step 4（工具增強）：便於管理與查詢。
5. Step 5（高階整合）：長期規劃，依資源安排。
