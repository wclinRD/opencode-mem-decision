# Memory Plugin Strengthening Roadmap

## Phase 1: Dynamic Tag Extraction
- [ ] Replace fixed `classify.js` tech regex with dynamic domain/skill tagging
- [ ] Extend tag categories: language, framework, platform, error type, workflow
- [ ] Add confidence-weighted tag extraction fallback (LLM or keyword clustering)
- [ ] Unit tests for tag extraction across different memory types

## Phase 2: Graph Construction Layer
- [ ] Implement similarity computation: Jaccard over tags + BM25/TF-IDF over text
- [ ] Add semantic edges between Base Memory nodes based on threshold
- [ ] Build community clustering (same tags + time proximity)
- [ ] Create Summary Node generation from clustered communities
- [ ] Add temporal edges (time-based links for AdaptiveGraph)
- [ ] Validate graph consistency and no orphan nodes

## Phase 3: Dual-Route Retrieval
- [ ] System-1 Similarity Search: tag-filtered keyword/vector lookup
- [ ] System-2 Global Selection: traverse Category/Principle nodes via tag chains
- [ ] Routing logic based on query type (fact vs global aggregation)
- [ ] Benchmark dual-route vs single flat search accuracy
- [ ] Ensure backward compatibility with existing `search` and `list`

## Phase 4: Layered Storage Implementation
- [ ] Introduce Base Memory, Summary Node, Category/Principle Node schemas
- [ ] Extend storage API to manage graph edges and summary nodes
- [ ] Update `addMemory` to build/update hierarchy on insert
- [ ] Update `searchMemories` to use layered nodes when applicable
- [ ] Add migration path for existing flat memories

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
