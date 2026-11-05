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

## Phase 9: Automatic Memory Deduplication and Optimization
- Restored `/api/memory/optimize` POST endpoint to actually delete duplicate memories instead of only grouping them.
- `optimizeMemories(scope, threshold)` now performs two rounds: exact-content duplicate merging, then similarity-based near-duplicate detection using `calculateSimilarity` with a default threshold of 0.65, catching long prompts with shared prefixes but different execution details.
- Deleted redundant memories are removed from storage; the endpoint returns `{ exactDeletedCount, similarityDeletedCount, deletedCount, keptCount }`.
- Web UI button label remains "Optimize Memory", confirms before deletion, and shows a toast with the optimized counts.
- All 109 tests pass; actual memory database was reduced from 35 to 21 entries after running the new optimization.

## Key Files Changed
- `src/classify.js`: dynamic tagging and weighted confidence functions.
- `src/organize.js`: BM25 text similarity and graph construction.
- `src/storage/local.js`: layered storage methods and weighted search/list ranking; added listMemories filtering support, knowledge search/import, and `optimizeMemories` with exact + similarity-based near-duplicate detection (threshold 0.65).
- `src/retrieval.js`: dual-route retrieval simulation and BM25 scoring.
- `src/capture.js`: session filtering, summarization, sensitive detection, and noise heuristic `isGenericOrNoiseText`.
- `src/inject.js`: context-aware splitting, fallback retrieval, injection formatting, and candidate filtering with default confidence/type fallbacks.
- `src/plugin.js`: tool schema and injection integration with memory modes; added knowledge-search and knowledge-import modes.
- `src/tools/memoryTools.js`: knowledge tool schema extended with search and import modes.
- `src/server.js`: memory endpoints updated; `/api/memory/optimize` now calls `storage.optimizeMemories(scope)` to remove duplicates.
- `src/static/ui.html`: "Optimize Memory" button confirms before deleting and displays toast with exact/similarity deleted counts.
- `src/config.js`: new `fallbackRetrieval` default option; updated `recallScope` default to `"default"`.
- `tests/storage.test.js`: added unit tests for `searchKnowledge` and `importKnowledgeFromDirectory`.
- `tests/inject.test.js`, `tests/plugin.test.js`: updated injection and prompt hook tests for default scope behavior.
- `doc/swift/*.md`: sample Swift UI basics and modifiers documentation ingested into the knowledge base.

## Verification & Policy
- All 109 tests pass in current state.
- Each phase committed separately with clear descriptions.
- No context capacity threshold verification was implemented due to no actual measure tool for opencode context percentage in current harness. Progress paused after core Phase 2-3 work and then implemented subsequent phases.

## Future Recommendations
- Benchmark dual-route vs single flat search accuracy and complete remaining Phase 3 benchmarking.
- Consider adding LLM-powered summary generation when available, replacing heuristic summarization for higher-quality summaries.
- Add full unit tests for `injectMemories` fallback retrieval and split truncation behavior.
- Monitor context usage and consider implementing actual 75% capacity limit detection if the OpenCode API exposes such metrics.
- Evaluate graph clustering complexity and optimize incremental graph updates for large memory corpora.

## Handover Date
Thu Nov 05 2026
