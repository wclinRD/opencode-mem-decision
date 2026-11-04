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
- [x] 測試：73/73 通過（`embedding.test.js` 與 `storage.test.js` 包含加密測試）。

- [ ] Markdown Vault backend。
- [ ] Remote API backend（OpenAI-compatible embeddings）。
- [ ] Auto-Capture AI 提取 stub（provider structured output）。
- [ ] User Profile 自動更新（每 N 個 prompts）。
- [ ] Schema migrations & lock files。
- [ ] Shared project memory via `.opencode-mem-project`。
- [ ] Shared skills registry + REST API。

## 優先級建議

1. Step 2（TTL/清理）：直接提升記憶庫品質，減少垃圾。
2. Step 3（元數據保留）：確保 update 不會丟失質量標籤。
3. Step 4（工具增強）：便於管理與查詢。
4. Step 5（高階整合）：長期規劃，依資源安排。
