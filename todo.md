# OpenCode Mem-Decision Plugin 待辦清單

## 已完成（截至 2026-11-04）

- [x] Step 1：改善 auto-capture 內容質量
  - [x] 過濾 `[auto-capture]`、`tool_use`、`tool_result`、程式狀態訊息等雜訊。
  - [x] 修正 `classify.js` 正則匹配無限循環。
  - [x] 調整 confidence 門檻與 pattern 分類優先級。
  - [x] 補齊 `eventLog.test.js` 測試。

## 未完成

### Step 2：記憶 TTL / 過期清理機制

- [ ] 設計記憶 TTL 規則（按 type/confidence/priority）。
- [ ] 在 `storage/local.js` 實作自動清理過期記憶。
- [ ] 在 `config.js` 加入 `memory.ttl.defaultDays`、`memory.ttl.factDays` 等參數。
- [ ] 實作 `memory.cleanup-expired` custom tool。
- [ ] 在 `searchMemories` 加入 TTL 篩選。

### Step 3：更新記憶時保留元數據

- [ ] `autoCapture` updateOnCapture 時保留 `type`、`confidence`、`tags`、`priority`。
- [ ] `storage/local.js::updateMemory` 支持元數據更新。
- [ ] 補單元測試。

### Step 4：記憶管理工具進階功能

- [ ] `memory.search` 支援 `ttlFilter`、`confidenceFilter`、`scope`。
- [ ] `memory.profile` 加入時間視窗與過期排除。
- [ ] `dreaming.js` 加入 soft-delete trash retention 自動清理。

### Step 5：高階記憶整合

- [ ] libSQL/Turso Local Vector DB。
- [ ] Markdown Vault backend。
- [ ] Remote API backend（OpenAI-compatible embeddings）。
- [ ] Auto-Capture AI 提取 stub（provider structured output）。
- [ ] User Profile 自動更新（每 N 個 prompts）。
- [ ] Database encryption at rest（AES-256-GCM）。
- [ ] Schema migrations & lock files。
- [ ] Shared project memory via `.opencode-mem-project`。
- [ ] Shared skills registry + REST API。

## 優先級建議

1. Step 2（TTL/清理）：直接提升記憶庫品質，減少垃圾。
2. Step 3（元數據保留）：確保 update 不會丟失質量標籤。
3. Step 4（工具增強）：便於管理與查詢。
4. Step 5（高階整合）：長期規劃，依資源安排。
