# OpenCode Mem-Decision Plugin 待辦清單

## 已完成（截至 2026-11-06）

- [x] Step 1：改善 auto-capture 內容質量
  - [x] 過濾 `[auto-capture]`、`tool_use`、`tool_result`、程式狀態訊息等雜訊。
  - [x] 修正 `classify.js` 正則匹配無限循環。
  - [x] 調整 confidence 門檻與 pattern 分類優先級。
  - [x] 補齊 `eventLog.test.js` 測試。

## 已完成（已提交並實作）

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

- [x] 研究靜態標籤分組與動態分層/圖檢索的最新演算法（Mnemis、MemTree、TagRAG、TAGGRAPH）。
- [x] 定義記憶分層模型：Base Memory（原始）、Summary Node（摘要）、Principle/Category Node（分類抽象）。
- [x] 實作 `src/organize.js`：
  - [x] 生成 Base / Summary / Category 節點並建立 adjacency graph。
  - [x] 支援 tag overlap / keyword 相似度建邊。
  - [x] 支援時間邊（temporal edges）。
- [x] 實作 `src/retrieval.js`：
  - [x] System-1 Similarity Search（tags + keyword/vector similarity）。
  - [x] System-2 Global Selection（沿 hierarchy 遍歷取相關社群與原始記憶）。
- [x] 實作 `src/storage/graph.js`：圖結構 JSON/Markdown 儲存與載入。
- [x] 更新 `src/static/ui.html`：增加「Organize Memory」section，顯示分層組織與檢索結果。
- [x] 實作 `POST /api/memory/organize` 與 `POST /api/memory/retrieve`。
- [x] 補充測試：`organize.test.js`、`retrieval.test.js`（`graph.test.js` 尚未實作，後續補充）。
- [ ] 更新 `doc/handover.md`。
- [ ] 同步 `src/static/ui.html` 至全局 plugin。

### Step 8：記憶效用分數與 TTL 動態調整

- [x] 實作 `calculateMemoryUtilityScore(memory)` 綜合分數（content length, type, tags, usage count, recency）。
- [x] 在 `getTtlDaysForMemory` 加入 utility 分數反比調整 TTL。
- [x] 新增 `memory.utility` tool 與 `/api/memory/utility` endpoint.
- [x] 測試：`tests/utility.test.js`，含分數計算與 TTL 動態計算。

### Step 9：情境化檢索與專案上下文整合

- [x] 實作 `resolveProjectContext(projectRoot)` 讀取 `.opencode-mem-project` 或 current project。
- [x] 更新 `searchMemoriesLayered` 與 `injectMemories` 加入 project context 權重。
- [x] 實作 `attachProjectContext(memories, projectRoot)` 對記憶附加專案相關性分數。
- [x] 在 `/api/memory/search` 與 `/api/memory/inject` 支援 `projectRoot` filter。
- [x] 更新 UI：「Contextual Search」與 project filter。
- [x] 測試：`tests/contextual.test.js`，驗證 project context 提升 recall。

### Step 10：分組與去重合併流程與 UI 更新

- [x] 實作 `deduplicateMemoriesArray` 與 `mergeDedupAndDigestMemories`，合併精確與相似去重和分群摘要。
- [x] 在 `src/storage/local.js` 和 `src/server.js` 新增 `/api/memory/merge` endpoint。
- [x] 更新 `src/static/ui.html`，將「Optimize Memory」與「Digest Memories」合併為「Deduplicate & Digest」按鈕，並顯示完整合併與去重統計。
- [x] 測試：`tests/merge.test.js`，涵蓋分群＋去重流程。

### Step 11：圖索引與儲存資料同步優化

- [x] 實作 `syncGraphToStorage(graph, storageDb)` 確保圖索引與記憶庫節點一致。
- [x] 在 `addMemory`/`updateMemory`/`deleteMemory` 觸發同步。
- [x] 實作 `rebuildGraphIndexIfStale(db, graph)`。
- [x] 更新 `src/storage/graph.js` 與 `local.js` 的同步流程。
- [x] 增加圖索引版本與同步時間戳記。

## 未完成

### Step 12：效能基準與使用追蹤，更新手冊

- [ ] 實作 `src/perf.js`：記錄 recall/precision, latency, injection hits/misses。
- [ ] 新增 `memory.benchmark` custom tool與 `/api/memory/benchmark` endpoint。
- [ ] 實作 `src/tracking.js` 記錄記憶生成、檢索與刪除使用次數。
- [ ] 更新 `doc/handover.md` 完整報告所有 Phase。
- [ ] 補充整體基準測試報告與 `tests/perf.test.js`。
- [ ] 最終 commit 並 push。

### Step 7：後續高階整合（Phase 2，可选）

- [ ] 整合 vector embedding（遠端 API / Hugging Face / local stub）。
- [ ] 使用 LLM summarization 生成 Summary / Principle 節點。
- [ ] AdaptiveGraph（personalized PageRank diffusion）與多跳查詢優化。

## 後端功能評估與改進建議

### LLM 使用策略
**`ctx.model()`**：OpenCode V2 plugin API 提供的模型呼叫介面，直接使用當前 session 的 LLM。
- ✅ 不需要額外 API key
- ✅ 支援所有 OpenCode 後端（OpenAI、Anthropic、Ollama、本地模型）
- ⚠️ 只在 prompt hook 或 tool execution 時可用（有 session context）
- ❌ 無法在 background timer 中直接使用

**適用場景：**
- AI Extraction（Step 13）— prompt hook 時觸發
- LLM Reranking（Step 19）— inject hook 時觸發
- AI-Based Dreaming（Step 18）— 改設計為 tool trigger
- Graph Summary Generation — tool trigger

**不適用場景：**
- Embedding generation（需要 embedding API，非 chat completion）
- Background consolidation（沒有 session context）

### 現有強項
- 記憶工具完整：add/list/search/profile/forget/export/import/dream/organize/retrieve/utility
- 自動捕捉：session 完成/idle 時自動儲存
- 去重：向量相似度 + Jaccard
- 分類與標籤：type/confidence/tags
- 雙路徑檢索：tag filter + graph traversal
- Graph 組織：base/summary/category 節點
- 動態注入預算：根據 context fill ratio 調整
- 專案範圍隔離：project scope + shared project marker
- 安全：credential redaction + encryption at rest
- Web API + UI

### 弱點與改善建議

#### Step 13：AI Extraction（拆分 Auto-Capture）
**問題：** Auto-capture 存整段 session 為一個大記憶，LLM 難以利用。
**改善：**
- [x] 使用 `ctx.session.generate()` 呼叫當前 session LLM（不需額外 API key）
- [x] 將 session 拆成獨立記憶（每個 decision/fact/lesson 一條）
- [x] 提升記憶品質與粒度
- [x] 測試：10 new tests in `tests/extraction.test.js`，134/134 通過

#### Step 14：Embedding 策略
**問題：** 本地 stub 是 token-hash，不是語意向量，相似度計算不準。
**改善：**
- [ ] `ctx.model()` 不支援 embedding（只有 chat completion）
- [ ] 預設使用 OpenAI-compatible API（`embeddingApiUrl`）
- [ ] 支援 Ollama 本地模型 embedding
- [ ] 支援 @xenova/transformers 本地模型
- [ ] 測試：驗證 embedding 相似度準確率提升

#### Step 15：Graph 增量更新
**問題：** Graph 重建 O(n²)，記憶多時很慢。
**改善：**
- [ ] 增量更新 graph，只為新增/修改的記憶計算邊
- [ ] Persist graph index，避免每次都重算
- [ ] 效能基準：比較全量重建 vs 增量更新
- [ ] 測試：驗證增量更新正確性

#### Step 16：Memory Access Tracking
**問題：** 不知道哪些記憶實際被用到、哪些是垃圾。
**改善：**
- [ ] 記錄 memory access log（每次 recall/inject）
- [ ] 計算真實 utility score（基於實際使用）
- [ ] 低效用記憶自動降級或移除
- [ ] 新增 `/api/memory/access-stats` endpoint
- [ ] 測試：驗證 access tracking 正確性

#### Step 17：Hybrid Retrieval（Embedding + BM25）
**問題：** 目前檢索是 keyword/BM25，沒有語意搜索。查詢「怎麼 deploy」找不到「deployment uses Fly.io」。
**改善：**
- [ ] 混合檢索 = embedding cosine similarity + BM25 score
- [ ] 實現 HNSW 向量索引，支援快速 ANN search
- [ ] 可調配的 weighting（semantic vs keyword）
- [ ] 測試：驗證 recall@k 提升

#### Step 18：AI-Based Dreaming
**問題：** Dreaming consolidation 是啟發式，沒有 AI 理解內容。
**改善：**
- [ ] 使用 `ctx.model()` 判斷哪些記憶矛盾、重複、過時
- [ ] 改設計：透過 `memory.dream` tool trigger（非 background timer）
- [ ] 提升 consolidation 品質
- [ ] 測試：驗證 consolidation 準確率

#### Step 19：LLM Reranking
**問題：** 檢索結果直接注入，沒有效率排序。
**改善：**
- [ ] 檢索 top-k → `ctx.model()` rerank → 注入 top-n
- [ ] 在 inject hook 時呼叫（有 session context）
- [ ] 提升相關性（增加延遲）
- [ ] 可選啟用（基於效能考量）
- [ ] 測試：驗證 reranking 品質提升

#### Step 20：BM25 Corpus TF/IDF
**問題：** BM25 只用 local avgDocLen，沒有 corpus TF/IDF，rank 不準。
**改善：**
- [ ] 計算整個 corpus 的 document frequency
- [ ] 建立 TF-IDF 索引
- [ ] 更新 BM25 scoring
- [ ] 測試：驗證 ranking 準確率提升

### 建議優先順序（後端）
1. Step 13（AI Extraction）→ 提升記憶品質（最高優先）
2. Step 14（真實 Embedding API）→ 提升檢索準確度
3. Step 17（Hybrid Retrieval）→ 提升 recall
4. Step 16（Memory Access Tracking）→ 提升效用分數
5. Step 15（Graph 增量更新）→ 提升效能
6. Step 18（AI-Based Dreaming）→ 提升 consolidation 品質
7. Step 20（BM25 TF/IDF）→ 提升 ranking
8. Step 19（LLM Reranking）→ 提升相關性（高延遲，可選）

## WebUI 評估與改進

### 現有強項
- Dark/light mode 支援
- 多 tab（Memories、Knowledge、Events、Organize、Settings）
- 豐富搜尋篩選（scope、project、type、confidence、priority、time、sort）
- Add/delete memory
- Settings 管理（load/save）
- Toast notifications
- Project awareness
- Graph organization display
- Dual-route search UI

### 弱點與改善建議

1. **無記憶編輯功能**：只能 add/delete，不能修正或更新記憶內容。
   - 改善：新增編輯 modal，支援修改 content/scope/type/confidence/tags。

2. **無記憶詳情視圖**：內容在卡片顯示，無法展開看完整內容與關聯。
   - 改善：新增詳情 modal，顯示完整內容、關聯記憶、utility score、access history。

3. **Graph 可視化是文字列表**：顯示 node ID 清單，不是真正的圖形。
   - 改善：使用 Cytoscape.js 或 Sigma.js 可視化 graph，展示 node 關係與 community structure。

4. **無記憶關係顯示**：無法看見記憶之間的關聯。
   - 改善：在詳情 modal 顯示相關記憶（semantic links、temporal links）。

5. **無 utility scoring 顯示**：無法知道哪些記憶有用、哪些是垃圾。
   - 改善：新增 utility score 柱狀圖、access count、最後使用時間。

6. **無 access tracking 顯示**：無法看到記憶被檢索的頻率。
   - 改善：新增 access log 與統計。

7. **無分頁**：所有記憶一次載入，資料多時慢。
   - 改善：新增分頁或 infinite scroll。

8. **無 export/import UI**：只有 API。
   - 改善：新增 export/import 按鈕與檔案選擇。

9. **搜尋無 debounce**：每次輸入都觸發 API 請求。
   - 改善：加入 300ms debounce。

10. **Settings 頁面太擁擠**：大量欄位無分組指引。
    - 改善：使用 collapsible accordion 分組、加入說明文字、group by category。

11. **無 recall/injection 品質監控**：無法看到記憶體注入的相關性。
    - 改善：新增 recall quality dashboard（precision、recall、latency）。

12. **無 memory health dashboard**：無法一覽記憶庫健康狀況。
    - 改善：新增 dashboard 顯示總數、平均 confidence、重複率、過期率、效用分佈。

### 建議優先順序（WebUI）
1. Memory edit functionality → 提升使用者控制力
2. Graph visualization（Cytoscape.js）→ 直覺理解記憶結構
3. Recall/injection quality dashboard → 驗證系統有效性
4. Utility/access tracking display → 識別垃圾記憶
5. Search debouncing → 效能改善
6. Settings layout improvement → 使用者體驗

## 優先級建議

1. Step 6（HybridTagGraph）：補足靜態標籤分組的關聯與全局檢索能力，實用且可落地。
2. WebUI Graph Visualization：直覺理解記憶結構，驗證 HybridTagGraph 效果。
3. Recall/Injection Quality Dashboard：驗證系統是否真正提升 LLM 效能。
4. Step 2（TTL/清理）：直接提升記憶庫品質，減少垃圾。
5. WebUI Edit Functionality：提升使用者控制力。
6. Step 3（元數據保留）：確保 update 不會丟失質量標籤。
7. Step 4（工具增強）：便於管理與查詢。
8. Step 5（高階整合）：長期規劃，依資源安排。