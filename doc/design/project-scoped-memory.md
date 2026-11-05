# Project-Scoped Memory Architecture

## Problem

Previously, all memories were stored in a single global database (`~/.opencode-memory/memories.db.json` or markdown vault), and the `scope` field (e.g., `"project"`, `"shared-project"`) was only a generic string, not an actual project identifier. Search and recall always fell back to `scope === "default"`, meaning all project memories were returned in every session, causing cross-project memory contamination.

## Solution

### 1. Per-Project Storage Isolation

Memories are now routed to project-specific storage:

- Global memories stay in `~/.opencode-memory/memories.db.json`.
- Project memories are stored in `~/.opencode-memory/projects/<project-id>/memories.db.json`.
- Both database and markdown backends support per-project routing via `projectStoragePath(projectName)`.

A project identifier is derived from the `.opencode-mem-project` marker file via `resolveProjectShared(cwd)`. The scope is stored as `project:<project-name>` and used to select the project-specific store.

### 2. Automatic Project Resolution

At plugin setup, `activeProject` is resolved from the current working directory:

```js
activeProject = await resolveProjectShared({ memoryConfig, cwd: process.cwd() });
```

If no marker file exists, the session defaults to global scope `"default"`.

### 3. Systematic Injection Flow

Injection now follows a deterministic pipeline:

1. **Resolve project** – Use `activeProject.projectName` if a marker is present; otherwise use the configured `recallScope`.
2. **Project-scoped recall** – Query only `project:<project-name>` memories for relevance.
3. **Project-scoped fallback** – If relevant recall returns nothing, fall back to recent memories within the same project scope.
4. **Session exclusion** – Exclude memories from the current session if `excludeCurrentSession` is true.
5. **Deduplication & filtering** – Remove duplicates, system prompts, and sensitive memories.
6. **Dynamic budget** – Apply fill-ratio-based chunk limits before formatting and injecting.

The `memory` tool now accepts an optional `project` parameter, allowing explicit cross-project queries when needed:

```json
{ "mode": "search", "project": "my-project", "query": "..." }
```

## Configuration Defaults

`config.js` now defaults `chatMessage.recallScope` to `"project:<current>"` to emphasize the project-scoped default. If a project marker is missing, the plugin falls back to `"default"` to preserve existing behavior.

## Migration Notes

Existing global memories remain in `memories.db.json`. Auto-capture now writes new memories into the project-specific store when a marker is present. Manual exports/imports support an optional `scope` parameter to target projects:

```js
await storage.exportMemories(outputPath, "project:my-project");
await storage.importMemories(inputPath, "project:my-project");
```