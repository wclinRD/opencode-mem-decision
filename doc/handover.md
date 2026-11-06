# Memory Plugin Strengthening Handover

## Objective
Strengthen the `opencode-mem-decision` plugin by implementing dynamic tag extraction, graph construction, dual-route retrieval, layered storage, capture optimization, and metadata weighting as complete phases.

## Completed Phases

### Phase 1: Dynamic Tag Extraction
- Replaced fixed `classify.js` tech regex with dynamic domain/skill tagging.
- Extended tag categories: language, framework, platform, error type, workflow.
- Confidence-weighted tag extraction fallback using keyword clustering.
- Unit tests added across memory types.
- Commit: `c8e0637`

### Phase 2: Graph Construction Layer
- Implemented similarity computation: Jaccard over tags + BM25/TF-IDF over text.
- Added semantic edges between Base Memory nodes based on threshold.
- Built community clustering (same tags + time proximity).
- Created Summary Node generation from clustered communities.
- Added temporal edges (time-based links for AdaptiveGraph).
- Validated graph consistency and no orphan nodes.
- Commit: `bd73e05`

### Phase 3: Dual-Route Retrieval
- System-1 Similarity Search: tag-filtered keyword/vector lookup.
- System-2 Global Selection: traverse Category/Principle nodes via tag chains.
- Routing logic based on query type (fact vs global aggregation).
- Benchmarking pending; core routing integrated.
- Backward compatibility maintained with existing `search` and `list`.
- Commit: `5ddd839`

### Phase 4: Layered Storage Implementation
- Introduced Base Memory, Summary Node, Category/Principle Node schemas in graph layer.
- Extended storage API to manage graph edges and summary nodes (`addSummaryNode`, `addCategoryNode`, `addGraphEdge`, `updateGraphEdges`, `getSummaryNodes`, `getCategoryNodes`, `getGraphEdges`).
- Updated `addMemory` flow via `addMemoryLayered` to build/update hierarchy on insert.
- Updated `searchMemories` to use layered nodes when `layered` or `useGraph` filter is true via `searchMemoriesLayered`.
- Added migration path for existing flat memories (`migrateFlatToLayered`).
- Commit: `fe50a97`

### Phase 5: Capture Flow Optimization
- Pre-filtered raw session text for noise removal (tool outputs, JSON blocks, private keys, timestamps, stack traces).
- Added `summarizeLongText` heuristic summarizer using keyword scoring and sentence selection.
- Integrated `checkSensitive` before storage/injection to detect sensitive patterns and redact/skip high-risk content.
- Updated `autoCapture` to summarize long text before classification and emit summaries instead of raw text where appropriate.
- Added unit tests for `summarizeLongText`, `filterSessionText`, and `checkSensitive`.
- Commit: `79909ae`

### Phase 6: Metadata Weighting & Cutoff Handling
- Revised confidence calculation with time decay, context factor, and sensitivity adjustment in `classifyMemory` and `calculateWeightedConfidence`.
- Introduced memory priority scoring based on usage recency and importance in `searchMemories` and `listMemories`.
- Implemented split memory content across pages with context preservation via `splitMemoryContent` and page-aware `formatInjectedPrompt`.
- Added fallback retrieval for cut-off memory fragments via `buildFallbackRetrievalNote` and integration in `injectMemories` when `fallbackEnabled`.
- Audited injection pipeline for sensitive leakage risk; ensured sensitive memories are filtered and credentials are redacted.
- Commit: `859ed87`

## Phase 7: Noise Filter and Injection Reliability
- Added `isGenericOrNoiseText` heuristic with length and keyword scoring to block generic/noise chat from storage and injection.
- Lowered short-text length threshold to 4 words to allow short technical statements like "Deploys use Fly.io" through noise filtering.
- Updated `injectMemories` to default missing `confidence` to 0.5 and missing `type` to "unknown" so valid memories are not silently dropped.
- Changed `config.js` default `recallScope` from `"project"` to `"default"` so prompt hooks by default search all default memories.
- Extended `storage/local.js` `listMemories` with filters `excludeNoise`, `minConfidence`, `excludedTypes`.
- Updated web server `/api/memory` and `/api/stats` to exclude noise by default using new filters.
- Fixed prompt hook tests by ensuring memory scope matches default recall scope and injection filters don't overfilter.
- All 107 tests currently pass.

## Phase 10: Memory Digestion Feature
- Added `digestMemories(scope, threshold)` to `src/storage/local.js` that groups existing memories by topic, merges similar/duplicate memories into consolidated summaries using `summarizeLongText`, updates metadata (type, confidence, tags, scope), removes original duplicate IDs, and returns a report with merged group count, removed count, and consolidated memory list.
- Exposed `POST /api/memory/digest` endpoint in `src/server.js` to trigger digestion for a given scope.
- Updated web UI (`src/static/ui.html`) with a new "Digest Memories" button that confirms before digesting, displays the result summary, and shows merged memory cards.
- Imported `summarizeLongText` in `src/storage/local.js` and added `digestMemories` to the exported storage object.
- All 109 tests continue to pass.

## Phase 8: Performance Benchmarking and Access Tracking (Step 12)
- Implemented `src/perf.js` with `calculateRecall`, `calculatePrecision`, `runBenchmark`, `getBenchmarks`, and `clearBenchmarkData` functions for benchmark query recall/precision/latency measurement.
- Implemented `src/tracking.js` with `recordGeneration`, `recordSearch`, `recordDeletion`, `recordInjectionHit`, `recordInjectionMiss`, `getAccessStats`, and `clearTracking` functions to track memory generation, retrieval, deletion, and injection usage.
- Integrated tracking into `src/storage/local.js`: `addMemory` calls `recordGeneration`, `searchMemories` calls `recordSearch`, `deleteMemory` calls `recordDeletion`.
- Integrated injection tracking into `src/inject.js`: `injectMemories` calls `trackInjectionResults` which records hits for each injected memory and misses when no memories are injected.
- Added `benchmark`, `access-stats`, and `clear-tracking` tool modes to `src/plugin.js` memory tool.
- Added `/api/memory/benchmark` (POST and GET) and `/api/memory/access-stats` (GET and DELETE) endpoints to `src/server.js`.
- Added `tests/perf.test.js` covering perf.js functions and tracking integration (20 tests).
- All 162 tests pass.
- Commit: `8432465`

## Phase 9: Hybrid Retrieval (Step 17)
- Implemented `src/hybridRetrieval.js` with two retrieval strategies:
  - `hybridRetrieve`: weighted combination of embedding cosine similarity and BM25 lexical matching
  - `dualHybridRetrieve`: separate BM25 and embedding rankings fused via Reciprocal Rank Fusion (RRF)
- BM25 scoring with simplified IDF and configurable k1/b parameters
- `searchMemories` in `src/storage/local.js` now uses hybrid retrieval by default when embedding service is available
- Added search tracking to hybrid retrieval paths to maintain access statistics
- Updated `src/retrieval.js` to export hybrid retrieval functions
- Updated `src/plugin.js` to support `hybrid` and `vectorSearch` parameters in the memory tool schema
- Updated `src/server.js` search API to support `?hybrid=true` parameter
- Added 21 targeted tests in `tests/hybrid.test.js` covering BM25 scoring, embedding scoring, RRF fusion, and both hybrid retrieval strategies
- All 183 tests pass (up from 162).
- Commit: `625de35`

## Step 16: Memory Access Tracking
- Extended `src/tracking.js` with detailed access logging:
  - `recordAccessLog({ memoryId, query, type, rank })` records each recall/inject event to `accessLogs` array
  - `getAccessLog(limit, offset)` retrieves access logs with pagination support
  - `getAccessLogByMemory(memoryId)` filters access logs by specific memory
  - `recordSearch` now creates individual access log entries for each retrieved memory
  - `recordInjectionHit` now records detailed inject access logs
  - Access logs are capped at 10,000 entries to prevent unbounded growth
  - `getAccessStats` now includes `totalAccessLogs` count and `lastAccessedAt` per memory
- Added actual utility score calculation in `src/storage/local.js`:
  - `calculateActualUtilityScore(memory, accessStats)` combines content quality score with usage-based factors:
    - Log-scale access count (bounded 0.15)
    - Injection hit count (bounded 0.1)
    - Recent usage recency (bounded 0.15, tiered by hours since last access)
    - Penalty for never-accessed memories (-0.2)
  - Returns detailed breakdown: `score`, `qualityScore`, `usageAccessScore`, `injectionScore`, `recentUsageScore`, `neverAccessedPenalty`, `accessCount`, `injectionHitCount`, `lastAccessedAt`
- Added low-utility memory management in `src/storage/local.js`:
  - `demoteLowUtilityMemories(config, threshold, scope)` demotes memories below threshold to type "garbage" with priority 0
  - `removeLowUtilityMemories(config, threshold, scope)` soft-deletes (moves to trash) memories below threshold
  - Both use `calculateActualUtilityScore` to identify low-utility memories
- Exposed new tool modes in `src/plugin.js`:
  - `access-log`: retrieve access logs with optional limit/offset
  - `demote-low-utility`: demote low-score memories with configurable threshold (default 0.35)
  - `remove-low-utility`: soft-delete low-score memories with configurable threshold (default 0.2)
  - Added `threshold` and `offset` fields to memory tool JSON schema
- Added new API endpoints in `src/server.js`:
  - `GET /api/memory/access-log`: retrieve access logs (supports `?limit=` and `?offset=`)
  - `POST /api/memory/demote-low-utility`: demote low-score memories (body: `{threshold, scope}`)
  - `POST /api/memory/remove-low-utility`: remove low-score memories (body: `{threshold, scope}`)
- Added 17 comprehensive tests in `tests/accessTracking.test.js`:
  - Access log recording for searches and injection hits
  - Log pagination and filtering by memory ID
  - Access stats integration
  - Actual utility score calculation and usage-based boosting
  - Demotion and removal of low-utility memories
- Fixed `updateMemory` to respect explicitly provided `updatedAt` value (previously always overwritten)
- All 200 tests pass (183 existing + 17 new).

## Key Files Changed
- `src/storage/local.js`: layered storage methods and weighted search/list ranking; added listMemories filtering support, knowledge search/import, `optimizeMemories` with exact + similarity-based near-duplicate detection (threshold 0.65), and new `digestMemories` for grouping and merging similar existing memories into consolidated summaries. Added `calculateActualUtilityScore`, `demoteLowUtilityMemories`, `removeLowUtilityMemories` for usage-based utility scoring and low-utility memory management.
- `src/server.js`: memory endpoints updated; `/api/memory/optimize` calls `storage.optimizeMemories(scope)` to remove duplicates; added `/api/memory/digest` to execute memory digestion. Added `/api/memory/access-log`, `/api/memory/demote-low-utility`, `/api/memory/remove-low-utility` endpoints.
- `src/tracking.js`: extended with detailed access logging (`recordAccessLog`, `getAccessLog`, `getAccessLogByMemory`), integrated into search and injection tracking flows.
- `src/plugin.js`: added `access-log`, `demote-low-utility`, `remove-low-utility` tool modes with threshold and offset parameters.
- `src/static/ui.html`: added "Digest Memories" button, digest results container, and event listener to display merged summaries after digestion.
- `tests/storage.test.js`: added unit tests for `searchKnowledge` and `importKnowledgeFromDirectory`.
- `tests/inject.test.js`, `tests/plugin.test.js`: updated injection and prompt hook tests for default scope behavior.
- `tests/accessTracking.test.js`: new test file with 17 tests covering access log tracking, actual utility scoring, and low-utility memory demotion/removal.
- `doc/swift/*.md`: sample Swift UI basics and modifiers documentation ingested into the knowledge base.

## Verification & Policy
- All 162 tests pass in current state, including new tracking and benchmark tests.
- Each phase committed separately with clear descriptions.
- No context capacity threshold verification was implemented due to no actual measure tool for opencode context percentage in current harness. Progress paused after core Phase 2-3 work and then implemented subsequent phases.

## Future Recommendations
- Benchmark dual-route vs single flat search accuracy using the new perf.js benchmarking infrastructure.
- Consider adding LLM-powered summary generation when available, replacing heuristic summarization for higher-quality summaries.
- Add full unit tests for `injectMemories` fallback retrieval and split truncation behavior.
- Monitor context usage and consider implementing actual 75% capacity limit detection if the OpenCode API exposes such metrics.
- Evaluate graph clustering complexity and optimize incremental graph updates for large memory corpora.

## Handover Date
Fri Nov 06 2026
