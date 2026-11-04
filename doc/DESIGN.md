# OpenCode Mem-Decision Plugin 設計文件

## 概述

OpenCode Memory Plugin 提供跨會話的持久化記憶系統，讓 AI coding agents 能在多個 sessions 中保持上下文。plugin 支援自動抓取、自動注入、手動操作、web UI、以及進階記憶整合功能。

## 核心架構

### 1. 儲存後端

| 後端類型 | 狀態 | 說明 |
| --- | --- | --- |
| JSON file based storage | ✅ Implemented | `memories.db`, `knowledge.db`，作為 temporary backend |
| Local Vector DB | 🔲 To Implement | libSQL/Turso，原生 vector search，`F32_BLOB` cosine distance |
| Markdown Vault | 🔲 To Implement | Obsidian/Raneto 相容 `.md` 檔案，作為 source of truth |
| Remote API | 🔲 To Implement | OpenAI-compatible embeddings endpoint |

### 2. Auto-Capture（自動抓取）

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| hook: `session.idle` | ✅ Implemented | plugin skeleton 註冊 hook |
| AI provider 提取技術決策 | 🔲 To Implement | provider 需支援 structured/tool-call output |
| credential redaction | ✅ Implemented | 移除 GitHub token、OpenAI key、AWS key、Slack token、GCP key、PEM private key |
| smart deduplication | 🔲 To Implement | 相似度比對避免重複 |
| update-on-capture | 🔲 To Implement | 自動判斷 `add` / `update` / `supersede` |

### 3. Memory Injection（自動注入）

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| hooks: `session.created`, `session.updated` | ✅ Implemented | plugin skeleton 註冊 hooks |
| recall modes: relevant/recent/both | 🔲 To Implement | vector search 或 recent N 筆 |
| compaction hook: `experimental.session.compacting` | ✅ Implemented | 已註冊 |
| injection markers | 🔲 To Implement | 標記 injected blocks |
| filter injected prompts | 🔲 To Implement | 跳過 system reminders、orchestration directives |

### 4. Manual Memory Tools（自訂 tool）

| tool | 狀態 | 功能 |
| --- | --- | --- |
| `memory.add(content, scope)` | ✅ Implemented | 手動新增 memory |
| `memory.search(query, scope)` | ✅ Implemented | 語意搜尋 |
| `memory.list(limit, scope)` | ✅ Implemented | 列出 memories |
| `memory.profile()` | ✅ Implemented | 讀取 user profile |
| `memory.forget(id)` | ✅ Implemented | 刪除 memory |
| `memory.export(outputPath)` | ✅ Implemented | 匯出 JSON |
| `memory.import(inputPath)` | ✅ Implemented | 匯入 JSON |
| `memory.list-shards()` | ✅ Implemented | 列出 shard |
| `memory.migrate(fromPath, fromHash)` | ✅ Implemented | 搬家/還原 |
| `knowledge.list/show/save/delete` | ✅ Implemented | knowledge 工具 |

### 5. User Profile

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| cross-project 使用者偏好/習慣總結 | 🔲 To Implement | |
| 每 N 個 prompts 自動更新（預設 10） | 🔲 To Implement | |
| Web UI profile view | 🔲 To Implement | |
| 透過 `memory({mode:"profile"})` 讀取 | ✅ Implemented | |

### 6. Dreaming（記憶整合）

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| background pass 找 related memories | 🔲 To Implement | |
| AI 判斷：merge/update/supersede/keep/flag | 🔲 To Implement | |
| soft-delete 進 trash（可還原） | 🔲 To Implement | |
| cross-project dreaming 支援 | 🔲 To Implement | |

### 7. Web UI

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| web server scaffolding | ✅ Implemented | `src/server.ts` 提供 `GET /api/memory`, `GET /api/knowledge`, `GET /api/stats`, basic auth pattern |
| memory–prompt timeline 瀏覽 | 🔲 To Implement | |
| captures 檢查、user profile 管理 | 🔲 To Implement | |
| trash restore、manual dream run | 🔲 To Implement | |
| Stats tab | 🔲 To Implement | 每 scope 總數、per-shard 計數、14-day activity series |
| Markdown mode sidebar | 🔲 To Implement | status、file list、reindex |

### 8. 安全與隱私

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| credential redaction | ✅ Implemented | src/security.ts 已實作 |
| database encryption at rest (AES-256-GCM) | 🔲 To Implement | |
| web UI HTTP Basic Auth | ✅ Implemented | basic auth pattern 已加入 |
| export privacy | 🔲 To Implement | export JSON 時省略 fully private entries |

### 9. Configuration

主要設定鍵（`~/.config/opencode/opencode-mem-decision.jsonc`）：

| 設定鍵 | 預設值 | 說明 |
| --- | --- | --- |
| `memoryBackend` | `"database"` | `"database"` 或 `"markdown"` |
| `markdownPath` | — | Markdown vault 路徑 |
| `storagePath` | `"~/.opencode-memory"` | JSON storage path |
| `chatMessage.enabled` | `true` | 啟用 auto-capture 與 injection |
| `chatMessage.injectOn` | `"first"` | `"first"` 或 `"always"` |
| `chatMessage.recall` | `"relevant"` | `"relevant"`, `"recent"`, `"both"` |
| `chatMessage.recallScope` | `"default"` | `"default"`, `"project"`, `"all-projects"` |
| `chatMessage.similarityThreshold` | `0.75` | 相似度閾值 |
| `chatMessage.maxMemories` | `3` | 注入 memory 數量 |
| `chatMessage.excludeCurrentSession` | `true` | 排除當前 session |
| `chatMessage.maxAgeDays` | — | 年齡限制（天） |
| `chatMessage.filterInjectedPrompts` | `true` | 跳過 injected prompts |
| `chatMessage.captureChildSessions` | `false` | 抓取 child sessions |
| `updateOnCaptureEnabled` | `false` | 啟用 update-on-capture |
| `updateOnCaptureSimilarityThreshold` | `0.75` | 更新相似度閾值 |
| `updateOnCaptureMaxCandidates` | `5` | 更新最大候選數 |
| `dreaming.enabled` | `false` | 啟用 dreaming |
| `dreaming.relatedThreshold` | `0.75` | related memories 閾值 |
| `dreaming.crossProject` | `false` | cross-project dreaming |
| `dreaming.trashRetentionDays` | `30` | trash 保留天數 |
| `embeddingModel` | `Xenova/nomic-embed-text-v1` | local embedding model |
| `embeddingApiUrl` | — | remote embeddings URL |
| `embeddingApiKey` | — | remote embeddings API key |
| `opencodeProvider` | `anthropic` | auto-capture AI provider |
| `opencodeModel` | `claude-haiku-4-5-20251001` | auto-capture model |
| `memory.defaultScope` | `"project"` | 預設 scope |
| `webServerHost` | `"127.0.0.1"` | web UI host |
| `webServerPort` | `4747` | web UI port |
| `webServerAuthUsername` | — | Basic Auth username |
| `webServerAuthPassword` | — | Basic Auth password |
| `knowledgeEnabled` | — | knowledge 工具開關 |

### 10. 進階功能（To Implement）

- libSQL/Turso Local Vector DB：schema migrations，legacy SQLite → Turso/libSQL
- Recovery of interrupted re-embed swaps
- Lock files：`.turso-migrate.lock`, `.turso-operation.lock`
- Shared project memory via `.opencode-mem-project` marker file
- Shared skills registry：create/edit in web explorer, `skills.db`
- REST API for skills：`GET/POST /api/skills`, `GET/PUT/DELETE /api/skills/:id`
- Database encryption at rest (AES-256-GCM)

## 檔案結構

```
opencode-mem-decision/
├── package.json
├── src/
│   ├── plugin.ts          # 主 plugin entry (✅)
│   ├── server.ts          # Web server scaffolding (✅)
│   ├── security.ts        # Credential redaction (✅)
│   ├── storage/
│   │   └── local.ts       # JSON file based storage interface (✅)
│   ├── tools/
│   │   ├── memory.ts      # memory tools (add/search/list/profile/forget/export/import/migrate/list-shards) (✅)
│   │   └── knowledge.ts   # knowledge tools (list/show/save/delete) (✅)
│   ├── capture.ts         # Auto-Capture logic (🔲 To Implement)
│   ├── inject.ts          # Memory Injection logic (🔲 To Implement)
│   ├── dreaming.ts        # Memory consolidation (🔲 To Implement)
│   ├── config.ts          # Configuration parser (✅)
│   └── storage/
│       ├── local.ts       # libSQL/Turso storage (🔲 To Implement)
│       ├── markdown.ts    # Markdown vault storage (🔲 To Implement)
│       └── remote.ts      # Remote API storage (🔲 To Implement)
├── docs/
│   ├── DESIGN.md
│   ├── handover.md
│   └── lesson_learn.md
└── tests/                 # Unit/integration/e2e tests (🔲 To Implement)
```

## API Endpoints

### Memory Tools

```typescript
memory({ mode: "add", content: "...", scope: "project" });
memory({ mode: "search", query: "...", scope: "all-projects" });
memory({ mode: "list", limit: 10 });
memory({ mode: "profile" });
memory({ mode: "forget", id: "..." });
memory({ mode: "export", outputPath: "./memories.json" });
memory({ mode: "import", inputPath: "./memories.json" });
memory({ mode: "list-shards" });
memory({ mode: "migrate", fromPath: "/old/path" });
```

### Knowledge Tools

```typescript
knowledge({ mode: "list" });
knowledge({ mode: "show", id: "..." });
knowledge({ mode: "save", content: "...", id?: "..." });
knowledge({ mode: "delete", id: "..." });
```

### Web UI REST API (scaffolding ✅)

- `GET /api/memory` — list memories
- `GET /api/knowledge` — list knowledge
- `GET /api/stats` — health stats
- `GET /api/memory/:id` — get memory by id (🔲)
- `POST /api/memory` — add memory (🔲)
- `PUT /api/memory/:id` — update memory (🔲)
- `DELETE /api/memory/:id` — delete memory (🔲)
- `GET /api/profile` — get user profile (🔲)
- `POST /api/dream` — manual dream run (🔲)
- `GET/POST /api/skills`, `GET/PUT/DELETE /api/skills/:id` (🔲)

## Security Considerations

1. **Credential Redaction**：在寫入 storage 前，移除所有 recognizable credentials (✅ 已實作)。
2. **Database Encryption**：可選 AES-256-GCM encryption at rest (🔲 To Implement)。
3. **Web UI Auth**：當 `webServerHost !== "127.0.0.1"` 時，強制 HTTP Basic Auth (✅ basic auth pattern 已加入)。
4. **Export Privacy**：匯出 JSON 時省略 fully private entries (🔲 To Implement)。

## 已知限制

1. **Intel Mac (`darwin/x64`) 不支援**：local embeddings 與 Turso/libSQL 無 x64 native binding。
2. **No MLX backend**：local embeddings 使用 `@huggingface/transformers` + ONNX，非 Apple MLX。
3. **Remote embeddings**：需 OpenAI-compatible API endpoint 與 API key。
4. **Structured output requirement**：auto-capture 與 profile learning 需要 provider 支援 structured/tool-call output。

## 擴充性

- Plugin 可註冊 custom tools 與 events hooks。
- Storage backend 可透過 interface 擴展（local/markdown/remote）。
- Embedding provider 可切換 local/remote。
- Skills registry 可透過 HTTP catalog 分享給其他 OpenCode instances。
