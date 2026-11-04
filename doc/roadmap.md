# OpenCode Memory Plugin Roadmap

**Date:** 2026-11-04
**Current version:** 1.0.0 (JSON storage, keyword search, prompt-tail injection)

---

## Vision

Build a long-horizon memory system that is:

- **Selective:** stores high-signal, reusable facts; excludes noise, PII, and ephemeral context.
- **Retrieval-accurate:** finds relevant memories beyond keyword overlap using semantic search and metadata filters.
- **Context-aware:** injects only what fits the current context budget, avoids context pollution, and resolves contradictions.
- **Auditable:** append-only breadcrumbs plus summaries; easy to inspect, export, and restore.
- **Privacy-conscious:** redacts credentials before every write and gates sensitive data through classification.

---

## Architecture Targets

1. **Storage substrate**
   - Phase 1: Improve JSON store with metadata filters and time-based sorting.
   - Phase 2: Introduce local vector DB (libSQL/Turso or pgvector) for dense search plus sparse BM25.
   - Phase 3: Optional knowledge graph for multi-hop reasoning and conflict detection.

2. **Capture pipeline**
   - Phase 1: event log per step (append-only) + periodic summaries.
   - Phase 2: AI-assisted extraction with `save_memory_note` tool or hook-based extraction (structured output).
   - Phase 3: two-tier model — session event log (full fidelity, TTL) + long-term semantic store.

3. **Retrieval and injection**
   - Phase 1: metadata-filtered keyword search; dynamic injection depth based on context fill ratio; explicit precedence rules.
   - Phase 2: vector search with reranking; post-retrieval compression (filtering, summarization, or structured extraction).
   - Phase 3: optional attention/KV injection if supported by provider.

4. **Lifecycle governance**
   - Phase 1: async consolidation, simple retention, soft-delete/trash cleanup.
   - Phase 2: temporal decay, interference-based forgetting, and mature knowledge graph promotion.
   - Phase 3: explicit conflict resolution and versioned memories with confidence scores.

---

## Phase 1 — Immediate (2–4 weeks)

### Goals

- Make current JSON + keyword search usable for mid-size projects.
- Ensure capture writes are structured and traceable.
- Reduce prompt pollution from memory injection.

### Tasks

#### 1.1 Event logging and summaries

- Store per-step breadcrumb in append-only log (`events.log.json` or new JSON field).
- Fields: `timestamp`, `sessionID`, `actor` (user/agent), `event_type` (tool_call, decision, correction, outcome), `description`, `links` (related memory ids).
- Create periodic summary task that merges recent breadcrumbs into `session_summary` memory records with clear IDs and citations.

#### 1.2 Improved keyword search

- Add metadata filters: `scope`, `type`, `time_range`, `confidence`.
- Sort results by query-token hits + recency + priority/score.
- For empty query, return recent scoped memories rather than all memories.

#### 1.3 Dynamic injection budget

- Implement MOIM-like control: compute context fill ratio from current prompt and model context window if known.
- Four-tier injection:
  - `< 0.60`: up to 5 chunks × 600 chars.
  - `0.60–0.70`: 3 chunks × 400 chars.
  - `0.70–0.80`: 2 chunks × 250 chars.
  - `≥ 0.80`: suppress injection (compaction imminent).
- Keep semantic memory injection always enabled; episodic injection scales with fill ratio.

#### 1.4 Precedence rules in prompt

- Add explicit rule block to injection:
  - 1) latest user instruction in current dialogue wins.
  - 2) session-scoped notes override global defaults for this conversation.
  - 3) global long-term memory is baseline fallback.
- Instruct model to update session notes when current instruction contradicts stored preference.

#### 1.5 Privacy and classification

- Add `looksSensitive` check before writing new memories.
- Classify candidate memories as `fact/preference/rule/lesson/system`.
- `system` and sensitive contents are excluded from long-term memory or written only to encrypted/restricted bucket.

### Acceptance criteria

- `[ ]` event log exists and summaries link back to memories.
- `[ ]` keyword search supports scope/type/time filters and sorts by score + recency.
- `[ ]` injection dynamically adjusts chunk size/number based on estimated context ratio.
- `[ ]` precedence rules appear in every injection block.
- `[ ]` sensitive content is redacted and excluded from general recall.

---

## Phase 2 — Core infrastructure upgrade (1–3 months)

### Goals

- Replace pure keyword search with semantic retrieval and metadata filtering.
- Improve capture quality by using model-assisted extraction rather than whole-session text.
- Add lightweight lifecycle management (retention, consolidation, soft-delete cleanup).

### Tasks

#### 2.1 Local vector DB

- Introduce a local vector index (prefer libSQL/Turso with `F32_BLOB` or pgvector).
- Index format: `memory_id`, `content`, `embedding`, `scope`, `type`, `confidence`, `timestamp`.
- Retrieval supports dense vector search + sparse BM25 if available; metadata filters for scope/type/time.
- Fallback to existing JSON store if DB unavailable for specific devices (Intel Mac no native bindings).

#### 2.2 AI-assisted capture

- Implement `save_memory_note(note, scope, type, confidence)` tool or an extraction hook.
- Model decides what to store, rejecting speculative, PII, or system-level instructions.
- Convert captured text into atomic notes (target 150–300 characters) with `confidence` and `appliesTo` context.
- Store extraction candidates in event log before promotion to long-term memory.

#### 2.3 Post-retrieval compression

- After vector/search results, filter weakly relevant candidates.
- Optionally rerank results with BERT-style reranker or simple score adjustment.
- Summarize or extract structured facts (entities, attributes, temporal relations) for injection.
- Keep original evidence for traceable facts when needed.

#### 2.4 Lifecycle management

- Implement async LLM consolidation: merge session notes into global memory, resolving conflicts by recency and specificity.
- Add retention policy:
  - ephemeral memories TTL (days–weeks) based on `type`.
  - low-confidence memories fade into summaries/tombstones after X days.
- Implement soft-delete/trash cleanup by configured retention days (current `dreaming.trashRetentionDays`).

#### 2.5 Web UI enhancements

- Show memory type and confidence badges.
- Support filtering by scope/type/time and confidence.
- Display recent summaries and linked breadcrumbs.
- Add manual export/import and cleanup UI.

### Acceptance criteria

- `[ ]` vector DB integrated with fallback path; dense + sparse search operational.
- `[ ]` capture uses model-extracted atomic notes with type and confidence.
- `[ ]` retrieval filters and compresses results before injection.
- `[ ]` async consolidation runs at session end without blocking user.
- `[ ]` retention policy applies to memories and deletes old low-priority entries.

---

## Phase 3 — Advanced reasoning (3–6 months)

### Goals

- Enable multi-hop reasoning and contradiction detection over memories.
- Explore non-prompt-token injection methods with provider support.
- Support cross-project memory sharing and collaboration.

### Tasks

#### 3.1 Knowledge graph layer

- Build entity-level graph from memories (persons, tools, decisions, constraints).
- Support multi-hop traversal queries and temporal/causal relations.
- Use graph as long-term semantic store alongside vector episodic store.

#### 3.2 Two-tier memory

- Short-term: in-memory cache with TTL (minutes–hours) for current session facts.
- Medium-term: full-fidelity vector events with importance scores and TTL (days–weeks).
- Long-term: knowledge graph summaries and mature semantic memories (permanent until forgotten).
- Hybrid retrieval: prioritize recent memory in short-term; fall back to vector episodic; mature memories use graph.

#### 3.3 Attention/KV injection

- Evaluate Dynamic KV Injection (DKI) or Layer-Level Prompting if model provider supports attention-level injection.
- Maintain text injection as fallback; switch only for reasoning-intensive tasks with high context pressure.
- Track accuracy and latency trade-offs.

#### 3.4 Cross-project sharing

- Create `.opencode-mem-project` marker file in shared projects.
- Shared skills/memory registry accessible by multiple OpenCode instances via local HTTP API.
- Define access policies (user-level vs team-level) and data ownership.

### Acceptance criteria

- `[ ]` knowledge graph supports multi-hop queries and contradiction checks.
- `[ ]` three-tier retrieval prioritizes correct time scope and evidence type.
- `[ ]` attention/KV injection implemented for at least one supported provider.
- `[ ]` shared project memory works across instances with permission controls.

---

## Non-functional requirements

- **Security:**
  - All writes go through credential redaction.
  - Optional encryption at rest (AES-256-GCM) for sensitive buckets.
  - Web API serves over loopback; require Basic Auth if bound externally.

- **Reliability:**
  - JSON writes with file locks or at least write-copy-rename to avoid corruption.
  - DB schema migrations and lock files for interrupted re-embed swaps.
  - Backup and restore procedures documented.

- **Performance:**
  - Memory injection adds minimal latency; keep summary extraction asynchronous.
  - Vector index re-embedding handled periodically; do not block user interactions.

- **Observability:**
  - Log injection decisions, recall hits, consolidation actions, and errors.
  - Expose stats endpoint with memory counts by type/scope and retention metrics.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Embedding quality and drift | retrieval errors, noisy injection | Use local + remote fallback; periodic re-embedding; confidence scoring |
| Model hallucination in extraction/consolidation | false facts stored | Always require citations or event links; allow manual correction; confidence weighting |
| Context window pressure despite injection | response truncation or quality drop | Dynamic injection budget; suppress when fill ratio ≥ 0.80; use two-phase recall |
| Cross-platform binary dependencies | Intel Mac, Linux build failures | Provide pure JS fallback; avoid native bindings where possible |
| Data privacy and compliance | leaks of sensitive info | sensitive-data classifier; encrypted bucket; audit logs |
| Provider lock-in | attention/KV injection unavailable elsewhere | keep text injection as universal fallback; document supported providers |

---

## Milestones

- **M1 (End of month 1):** Event log, dynamic injection budget, precedence rules, sensitive filtering, keyword search filters.
- **M2 (End of month 2):** Vector DB integration, AI extraction pipeline, async consolidation, retention cleanup.
- **M3 (End of month 3):** Web UI update with filters/types/summaries, full JSON fallback path.
- **M4 (Month 3–4):** Knowledge graph prototype, contradiction detection, summary/tombstone forgetting.
- **M5 (Month 4–5):** Attention/KV injection evaluation and integration with a compatible provider.
- **M6 (Month 5–6):** Cross-project shared memory and permissions, production-hardened logging and backup.
