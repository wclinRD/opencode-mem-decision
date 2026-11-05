# Web UI Project Isolation Update

## Purpose
Added project-scoped memory display and filtering to the Web UI to match the backend project isolation changes.

## Changes
### Backend
- `src/storage/local.js`: Added `listProjectCounts()` function to aggregate per-project memory counts.
- `src/server.js`: Added `/api/projects` endpoint returning active project counts; updated `/api/memory/search`, `/api/memory` POST and DELETE to accept and route by `project` parameter.

### Frontend (`src/static/ui.html`)
- Header now displays current project status (`Project: <name> (count)` or global fallback).
- Added project filter select to memory search controls.
- Added project input to memory add form (default: `current`).
- Memory cards now show a `project` pill when `projectName` is present.
- Project memory counts are loaded via `/api/projects` and used to populate the project filter and project status.
- Delete All by Filter now respects project filter as well as scope.

## Testing Notes
- Run web server and open `http://localhost:4747`.
- Create a `.opencode-mem-project` file in the target project directory and ensure it contains a project name to see project-scoped memory flow in action.
- Memory added from the Web UI with `project` field populated will route to `~/.opencode-memory/projects/<sanitized-project-id>/memories.db.json`.
- The project filter in the UI allows browsing memory by project without cross-project contamination.
