# Memory Plugin Strengthening Roadmap

## Phase 1: Dynamic Tag Extraction
- [x] Replace fixed `classify.js` tech regex with dynamic domain/skill tagging
- [x] Extend tag categories: language, framework, platform, error type, workflow
- [x] Add confidence-weighted tag extraction fallback (LLM or keyword clustering)
- [x] Unit tests for tag extraction across different memory types

## Phase 2: Graph Construction Layer
- [x] Implement similarity computation: Jaccard over tags + BM25/TF-IDF over text
- [x] Add semantic edges between Base Memory nodes based on threshold
- [x] Build community clustering (same tags + time proximity)
- [x] Create Summary Node generation from clustered communities
- [x] Add temporal edges (time-based links for AdaptiveGraph)
- [x] Validate graph consistency and no orphan nodes

## Phase 3: Dual-Route Retrieval
- [x] System-1 Similarity Search: tag-filtered keyword/vector lookup
- [x] System-2 Global Selection: traverse Category/Principle nodes via tag chains
- [x] Routing logic based on query type (fact vs global aggregation)
- [ ] Benchmark dual-route vs single flat search accuracy
- [x] Ensure backward compatibility with existing `search` and `list`

## Phase 4: Layered Storage Implementation
- [x] Introduce Base Memory, Summary Node, Category/Principle Node schemas
- [x] Extend storage API to manage graph edges and summary nodes
- [x] Update `addMemory` to build/update hierarchy on insert
- [x] Update `searchMemories` to use layered nodes when applicable
- [x] Add migration path for existing flat memories

## Phase 5: Capture Flow Optimization
- [ ] Pre-filter raw session text for noise removal
- [ ] Summarize before classification: reduce long raw snippets
- [ ] Apply sensitive pattern check before storage/injection
- [ ] Update auto-capture to emit summaries instead of raw text where appropriate
- [ ] Test capture quality and false positive rate

## Phase 6: Metadata Weighting & Cutoff Handling
- [ ] Revise confidence calculation: combine regex, length, time decay, context
- [ ] Introduce memory priority scoring based on usage recency and importance
- [ ] Split truncated injection across pages preserving context
- [ ] Add fallback retrieval for cut-off memory fragments
- [ ] Audit injection pipeline for sensitive leakage risk

## Verification & Commit Policy
- Each phase must pass unit and integration tests before commit.
- Commit per completed phase with clear description.
- If opencode context exceeds 75% of capacity, pause implementation and show user current state for review.

## Current Status
- Phase 1 committed: `c8e0637`
- Phase 2 committed: `bd73e05`
- Phase 3 core routing integrated into retrieval flow.
- Phase 4 committed: `fe50a97` layered storage schemas and dual-route integration.
- Phase 5–6 pending implementation and testing.
