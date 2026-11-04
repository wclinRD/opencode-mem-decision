# opencode-mem-decision

Cross-session persistent memory for [OpenCode](https://opencode.ai) 2.x agents.

OpenCode sessions forget everything when they end. This plugin gives the agent a durable memory store: decisions, project facts, preferences, and reusable knowledge that survive restarts and can be recalled in later sessions.

> **Status:** early implementation (`1.0.0`). Storage is JSON-based; semantic search and embeddings are not implemented yet. See [Feature status](#feature-status) before relying on a feature in production.

---

## Table of contents

- [What it does](#what-it-does)
- [Feature status](#feature-status)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Configure](#configure)
- [Usage](#usage)
- [Web API](#web-api)
- [Storage](#storage)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [License](#license)

---

## What it does

- **Remembers across sessions.** Store project facts, architectural decisions, user preferences, and debugging notes, then read them back in a later session.
- **Captures automatically.** When a session goes idle, the plugin saves the conversation as a memory, classifies it, and logs events for traceability.
- **Deduplicates and classifies.** Similar memories are detected with a word-set similarity score; new memories are tagged by type (`fact`, `preference`, `rule`, `lesson`, `system`) and confidence.
- **Redacts credentials and sensitive content.** GitHub tokens, OpenAI keys, AWS keys, Slack tokens, GCP keys, PEM private keys, emails, and phone numbers are replaced before writing. Sensitive items are excluded from automatic recall.
- **Exposes a memory tool.** The agent can add, list, search, export, import, and delete memories, and manage a separate knowledge base.
- **Searches with filters.** Keyword search supports `scope`, `type`, `confidence`, and `timeRange` filters.
- **Injects dynamically.** Memory injection adapts chunk size and count to the current context window pressure, and adds explicit precedence rules when recalling memories.
- **Serves a local HTTP API.** Read memories, knowledge, and stats over HTTP, optionally protected by Basic Auth.

Example memory:

```json
{
  "id": "mem_1793763404758_bzth932",
  "content": "The API uses Fastify, not Express. Auth is handled by a preHandler hook in src/auth.ts.",
  "scope": "project",
  "type": "fact",
  "confidence": 0.8,
  "sensitivity": "normal",
  "priority": 1,
  "tags": [],
  "createdAt": "2026-11-04T03:36:44.758Z",
  "updatedAt": "2026-11-04T03:36:44.758Z"
}
```

---

## Feature status

| Feature | Status | Notes |
|---|---|---|
| `memory` tool | ✅ Implemented | All modes are callable (see [Usage](#usage)) |
| JSON storage | ✅ Implemented | `~/.opencode-memory/*.db.json` |
| Credential / sensitive redaction | ✅ Implemented | Applied on write; sensitive items excluded from recall |
| Memory classification & confidence | ✅ Implemented | Auto-classifies as fact/preference/rule/lesson/system |
| Web server + Basic Auth | ✅ Implemented | Defaults to `127.0.0.1:4747` |
| Auto-capture on session idle | ⚠️ Partial | Captures whole session text as one memory when `session.status.type === "idle"`; logs events and summaries |
| Deduplication | ⚠️ Partial | Word-set Jaccard similarity, not embeddings |
| Knowledge base | ✅ Implemented | Separate JSON file |
| Dreaming / consolidation | ⚠️ Partial | Works when enabled; trash uses the storage directory |
| Memory injection into prompts | ✅ Implemented | Dynamic injection budget, precedence rules |
| Keyword search with filters | ✅ Implemented | Supports scope, type, confidence, timeRange |
| Semantic search / embeddings | 🔲 Planned | Keyword matching only |
| Event logging | ✅ Implemented | Append-only events.log.json with summaries |
| User profile | ✅ Implemented | Built from memories, rebuilt every N prompts |
| Web UI | 🔲 Planned | HTTP API only |
| Markdown Vault backend | 🔲 Planned | — |
| Remote API backend | 🔲 Planned | — |

---

## How it works

```
prompt hook (ctx.session.hook("prompt"))
     │  count prompt (profile)
     │  calculate context fill ratio
     │  recall relevant / recent memories, filter by type/confidence/time
     │  dynamic budget decides max chunks and char length per chunk
     │  append `=== Memory Context ===` block with precedence rules
     ▼
event.prompt.text += "\n\n<!-- opencode-mem-decision:injected -->\n..."   (once per session by default)

session.status (status.type === "idle")
     │
     ▼
autoCapture()
     │  strip injected blocks, redact credentials and sensitive data
     │  classify content by type and confidence
     │  compare with existing memories (Jaccard similarity)
     │  log event to events.log.json, generate summary when threshold met
     ▼
~/.opencode-memory/memories.db.json
     │
     ├── memory tool (agent) ──► add / list / search / export / forget / profile
     ├── web server ───────────► GET /api/memory, /api/stats, /api/profile, POST /api/dream
     └── dream mode ───────────► merge / supersede / update related memories
```

The plugin is a single V2 server plugin:

```js
import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "opencode-mem-decision",
  async setup(ctx) {
    // register the `memory` tool
    // register the prompt hook for injection
    // subscribe to session.status for idle state
    // start the optional HTTP server
  },
});
```

---

## Requirements

- **OpenCode 2.x** (`opencode --version` → `2.x`). V1 plugin API is not supported.
- **Node.js 18+** (the plugin uses ESM and `node --test`).
- No build step. The entry point is plain JavaScript.

---

## Install

The plugin must be reachable by the OpenCode server. Pick one of the options below.

### Option A — global plugin directory (recommended for local development)

OpenCode auto-loads every directory under `~/.config/opencode/plugins/`.

```sh
mkdir -p ~/.config/opencode/plugins
cp -R /path/to/opencode_mem ~/.config/opencode/plugins/opencode-mem-decision
cd ~/.config/opencode/plugins/opencode-mem-decision
npm install
```

The directory must contain `package.json` with `"main": "index.js"` and `index.js` must default-export the plugin definition.

Reload and verify:

```sh
opencode service restart
opencode service status

grep "opencode-mem-decision" ~/.local/share/opencode/log/opencode.log | tail
```

A successful load shows `loading plugin` and **no** `failed to load plugin`.

> Changes made in the source repository do not reach OpenCode automatically. Re-copy `index.js`, `package.json`, and `src/` to the global directory, or use a symlink:
>
> ```sh
> ln -s /path/to/opencode_mem ~/.config/opencode/plugins/opencode-mem-decision
> ```
>
> If you use a symlink, run `npm install` inside the repository.

### Option B — register a directory in `opencode.jsonc`

Use this when the plugin lives outside the global plugin directory.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode_mem",
      "options": {
        "chatMessage": { "enabled": true },
        "webServerPort": 4747
      }
    }
  ]
}
```

- `package` must point to a **directory**, not a single file.
- `options` is passed to the plugin as `ctx.options`; this is the only supported configuration channel.
- OpenCode reloads plugins when configuration files change. Use `/reload` or `opencode service restart` if needed.

### Option C — project-local plugin

Place the plugin under the project:

```
<project>/.opencode/plugins/opencode-mem-decision/
```

OpenCode loads it for that project only. This is useful for testing a change without touching the global install.

### Verify the install

```sh
opencode service restart
opencode api get /api/info
```

Then ask the agent to call the `memory` tool:

```
memory({ mode: "add", content: "This project uses pnpm, not npm.", scope: "project" })
memory({ mode: "list", limit: 5 })
```

If the tool is missing, see [Troubleshooting](#troubleshooting).

---

## Configure

Configuration is passed through the plugin entry's `options` object (Option B) or left at defaults (Option A/C). There is **no separate config file** read by the plugin.

Full example:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode_mem",
      "options": {
        "memoryBackend": "database",
        "chatMessage": {
          "enabled": true,
          "injectOn": "first",
          "recall": "relevant",
          "recallScope": "default",
          "maxMemories": 3,
          "excludeCurrentSession": true,
          "filterInjectedPrompts": true
        },
        "userProfileAnalysisInterval": 10,
        "updateOnCaptureEnabled": false,
        "updateOnCaptureSimilarityThreshold": 0.75,
        "dreaming": {
          "enabled": false,
          "relatedThreshold": 0.75
        },
        "webServerHost": "127.0.0.1",
        "webServerPort": 4747,
        "webServerAuthUsername": "",
        "webServerAuthPassword": ""
      }
    }
  ]
}
```

### Active options

| Option | Default | Effect |
|---|---|---|
| `chatMessage.enabled` | `true` | Master switch for auto-capture and prompt injection. When `false`, both hooks do nothing. |
| `chatMessage.injectOn` | `"first"` | `"first"` injects at most once per session; any other value injects on every prompt. |
| `chatMessage.recall` | `"relevant"` | `"relevant"` ranks by query tokens (falls back to recent when nothing matches), `"recent"` uses newest memories, `"both"` combines them. |
| `chatMessage.recallScope` | `"default"` | Scope filter for recall. `"default"` means all scopes. |
| `chatMessage.maxMemories` | `3` | Maximum memories appended to one prompt. |
| `chatMessage.excludeCurrentSession` | `true` | Do not inject memories captured in the same session. |
| `chatMessage.filterInjectedPrompts` | `true` | Drop memories that look like system prompts. |
| `chatMessage.contextWindowSize` | `128000` | Context window size estimate; dynamic injection adjusts chunk size and count based on fill ratio. |
| `userProfileAnalysisInterval` | `10` | Rebuild `profile.json` every N prompts. |
| `updateOnCaptureEnabled` | `false` | When a captured session is similar to an existing memory, update that memory instead of skipping. |
| `updateOnCaptureSimilarityThreshold` | `0.75` | Similarity threshold (`0`–`1`) for deduplication and update. |
| `dreaming.enabled` | `false` | Enables the `dream` tool mode and `POST /api/dream`. |
| `dreaming.relatedThreshold` | `0.75` | Similarity threshold used by dream consolidation. |
| `eventLog.enabled` | `true` | Write events.log.json for capture/decisions. |
| `eventLog.summaryHours` | `24` | Summarize recent events if more than 3 events within this window. |
| `webServerHost` | `127.0.0.1` | HTTP server bind address. Set to `""` to disable the server. |
| `webServerPort` | `4747` | HTTP server port. A busy port is shared or assumed to be another instance; OpenCode does not crash. |
| `webServerAuthUsername` | `""` | Basic Auth username. Auth is enforced only when **both** username and password are set. |
| `webServerAuthPassword` | `""` | Basic Auth password. |

### Reserved options

These are accepted and merged, but not used yet:

`memoryBackend`, `markdownPath`, `storagePath`, `chatMessage.similarityThreshold`, `chatMessage.maxAgeDays`, `chatMessage.captureChildSessions`, `updateOnCaptureMaxCandidates`, `dreaming.crossProject`, `dreaming.trashRetentionDays`, `embeddingModel`, `embeddingApiUrl`, `embeddingApiKey`, `opencodeProvider`, `opencodeModel`, `memory.defaultScope`, `knowledgeEnabled`.

> `storagePath` is currently ignored: storage is always `~/.opencode-memory`. Tests override the directory with `OPENCODE_MEM_DIR`.

---

## Usage

The plugin registers one tool, `memory`. Select the operation with `mode`.

### Memory modes

| Mode | Arguments | Result |
|---|---|---|
| `add` | `content`, `scope?` | Creates a memory. Scope defaults to `project`. The plugin auto-classifies the content and stores `type`, `confidence`, `sensitivity`, `priority`, and `tags`. Credentials and sensitive content are redacted. |
| `search` | `query?`, `scope?`, `type?`, `confidence?`, `timeRange?` | Keyword search with optional filters: `type` (fact/preference/rule/lesson/system), `confidence` numeric threshold, `timeRange` in milliseconds. Empty query returns the latest scoped memories up to 50. |
| `list` | `limit?`, `scope?` | Newest first. Default limit `50`. |
| `profile` | — | Builds and persists the user profile: totals, scopes, preferences, recent memories, top keywords, knowledge titles. |
| `forget` | `id` | Deletes one memory. Returns `true` or `false`. |
| `export` | `outputPath` | Writes memories as a JSON array to the given path. |
| `import` | `inputPath` | Appends memories from a JSON array file. Returns the new total. |
| `list-shards` | — | Lists distinct scopes (shards). |
| `migrate` | `fromPath` | Imports `{ "memories": [...] }` from a legacy database file. |
| `dream` | — | Runs consolidation if `dreaming.enabled`; otherwise returns `skipped`. |
| `restore-trash` | `id` | Restores a soft-deleted memory from the trash. |

### Knowledge modes

A second store for longer reference material, separate from memories.

| Mode | Arguments | Result |
|---|---|---|
| `knowledge-list` | — | Lists all knowledge entries. |
| `knowledge-show` | `id` | Returns one entry or `null`. |
| `knowledge-save` | `content`, `id?` | Creates or replaces an entry. Generates `kb_*` id when omitted. |
| `knowledge-delete` | `id` | Deletes one entry. Returns `true` or `false`. |

### Examples

```js
// Project facts
memory({ mode: "add", content: "Deploys use Fly.io. Staging app: acme-staging.", scope: "project" });

// User preference
memory({ mode: "add", content: "User prefers Traditional Chinese replies and terse output.", scope: "user" });

// Search with filters
memory({ mode: "search", query: "auth", type: "lesson", confidence: 0.5, timeRange: 86400000 });

// Read back
memory({ mode: "list", limit: 10 });
memory({ mode: "search", scope: "project" });

// Remove
memory({ mode: "forget", id: "mem_1793763404758_bzth932" });

// Backup and restore
memory({ mode: "export", outputPath: "/tmp/memories.json" });
memory({ mode: "import", inputPath: "/tmp/memories.json" });

// Long-form knowledge
memory({ mode: "knowledge-save", content: "Architecture: ...", id: "kb_architecture" });
memory({ mode: "knowledge-list" });
memory({ mode: "knowledge-show", id: "kb_architecture" });
```

### Auto-capture

When a session becomes idle:

1. The plugin reads the session messages and concatenates their text.
2. Credentials and sensitive content are redacted.
3. The text is classified by type and confidence.
4. The text is compared with existing memories using word-set Jaccard similarity.
5. If similar to an existing memory:
   - `updateOnCaptureEnabled: true` → update that memory.
   - `updateOnCaptureEnabled: false` → skip.
6. Otherwise a new `project` memory is added with its classification metadata.
7. An event is logged to `events.log.json`; if more than three events fall within `eventLog.summaryHours`, a summary memory is created.

Limitations:

- The whole session is stored as **one** memory. There is no AI extraction of individual decisions yet.
- Only `session.status.type === "idle"` triggers capture. Child-session filtering is not implemented.
- Auto-capture is disabled when `chatMessage.enabled` is `false`.
- Sensitive memories are excluded from automatic recall to reduce leak risk.

### Dreaming

`dream` consolidates related memories:

| Similarity | Action |
|---|---|
| `>= 0.9` | Merge both contents into one memory. |
| `>= 0.8` | Supersede: keep the newer content, move the older one to trash. |
| `>= relatedThreshold` | Update: append the other content as a note. |

Enable it with:

```jsonc
{ "dreaming": { "enabled": true, "relatedThreshold": 0.75 } }
```

Then call `memory({ mode: "dream" })` or `POST /api/dream`.

Trash entries are written to `trash.db.json` inside the storage directory, so `restore-trash` finds them.

---

## Web API

The server starts automatically on `127.0.0.1:4747` unless `webServerHost` is empty.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/memory` | List memories. |
| `GET` | `/api/memory/:id` | Get one memory. |
| `POST` | `/api/memory` | Add a memory. Body: `{ "content": "...", "scope": "project" }`. |
| `DELETE` | `/api/memory/:id` | Delete a memory. |
| `GET` | `/api/knowledge` | List knowledge entries. |
| `GET` | `/api/stats` | Counts and timestamp. |
| `GET` | `/api/profile` | Builds, persists and returns the user profile. |
| `POST` | `/api/dream` | Runs consolidation and returns the result (or `skipped` when dreaming is disabled). |
| `GET` | `/api/skills` | Returns `501` (not implemented). |

```sh
curl http://127.0.0.1:4747/api/stats
curl http://127.0.0.1:4747/api/memory

curl -X POST http://127.0.0.1:4747/api/memory \
  -H 'Content-Type: application/json' \
  -d '{"content":"Use pnpm for this repo","scope":"project"}'
```

With Basic Auth enabled:

```sh
curl -u user:password http://127.0.0.1:4747/api/memory
```

If the port is already in use, the plugin logs one informational line (`port 4747 already in use; assuming another OpenCode instance serves the memory API`) and keeps working. Within one process, repeated setups share a single server and the port is released after the last cleanup.

---

## Storage

Default location:

```
~/.opencode-memory/
├── memories.db.json
├── knowledge.db.json
├── trash.db.json
└── profile.json
```

Tests and temporary runs can point storage elsewhere with `OPENCODE_MEM_DIR`:

```sh
OPENCODE_MEM_DIR=/tmp/opencode-mem-test node --test
```

Memories file shape:

```json
{
  "memories": [
    {
      "id": "mem_1793763404758_bzth932",
      "content": "Use pnpm for this repo",
      "scope": "project",
      "sessionId": "ses_abc123",
      "createdAt": "2026-11-04T03:36:44.758Z",
      "updatedAt": "2026-11-04T03:36:44.758Z"
    }
  ],
  "knowledge": []
}
```

Auto-capture records include `sessionId` so recall can skip the current session; memories added through the tool do not.

The file is JSON, not a database. Concurrent writers are not locked. Do not edit it while OpenCode is writing.

---

## Security

**Credential redaction** runs before every write (`src/security.js`):

| Pattern | Example |
|---|---|
| GitHub token | `ghp_...`, `gho_...`, `ghu_...`, `ghs_...`, `ghr_...` |
| OpenAI API key | `sk-...` |
| AWS access key | `AKIA...` |
| Slack token | `xox[baprs]-...` |
| GCP API key | `AIza...` |
| PEM private key | `-----BEGIN PRIVATE KEY-----...` |

Redaction is best-effort pattern matching, not a guarantee. Do not rely on it as the only protection for secrets.

**Web server**

- Binds to loopback by default.
- Basic Auth is enforced only when both `webServerAuthUsername` and `webServerAuthPassword` are set.
- If you bind to a non-loopback address, set both credentials.
- Traffic is plain HTTP; use a reverse proxy with TLS for remote access.

**Storage**

- Memories are stored unencrypted JSON on disk.
- Database encryption at rest is not implemented.
- Restrict permissions on `~/.opencode-memory` if the machine is shared.

---

## Troubleshooting

### Plugin does not load

Check the log:

```sh
grep "opencode-mem-decision" ~/.local/share/opencode/log/opencode.log | tail -20
```

If you see:

```
Plugin must export a default definition with an id and an effect or setup function
```

the plugin is using the V1 API. OpenCode 2.x requires:

```js
import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "opencode-mem-decision",
  async setup(ctx) { /* ... */ },
});
```

Also confirm:

- dependency is `@opencode/plugin` (2.x), not `@opencode-ai/plugin`;
- `package.json` has `"type": "module"` and `"main": "index.js"`;
- the loaded directory is the one you edited (global copy vs repository).

### Tool `memory` is missing

1. `opencode service restart`
2. `opencode service status`
3. Check the log for `failed to load plugin`.
4. Confirm the plugin directory contains `node_modules/@opencode/plugin`.

### Changes do not take effect

You edited the repository, but OpenCode loads `~/.config/opencode/plugins/opencode-mem-decision/`. Re-copy the files or use a symlink.

### Web server does not start

- Confirm `webServerHost` is not `""`.
- Check whether another process owns the port:

  ```sh
  lsof -nP -iTCP:4747 -sTCP:LISTEN
  ```

- Change `webServerPort` if needed.

### Search returns nothing

`search` is keyword based: it tokenizes the query with Unicode letters and numbers and keeps memories that contain at least one query token. An empty query returns everything in scope. Semantic (embedding) search is still on the roadmap.

---

## Development

```sh
git clone <repo-url>
cd opencode_mem
npm install
npm test
```

Project layout:

```
.
├── index.js                 # re-exports the plugin definition
├── src/
│   ├── plugin.js            # V2 Plugin.define + tool registration + session.idle
│   ├── config.js            # defaults and deep merge
│   ├── capture.js           # auto-capture, similarity, deduplication
│   ├── inject.js            # recall, injection marker, strip helper
│   ├── profile.js           # user profile build and prompt counting
│   ├── dreaming.js          # consolidation and trash
│   ├── security.js          # credential redaction
│   ├── server.js            # HTTP API
│   ├── storage/local.js     # JSON storage
│   └── tools/memoryTools.js # legacy tool helper
├── tests/                   # node:test unit tests
└── doc/                     # design, handover, lessons learned
```

Run a single test file:

```sh
node --test tests/plugin.test.js
```

After changing the plugin, sync to the global directory and restart:

```sh
rsync -a --delete \
  --exclude node_modules \
  ./index.js ./package.json ./package-lock.json ./src/ \
  ~/.config/opencode/plugins/opencode-mem-decision/

cd ~/.config/opencode/plugins/opencode-mem-decision && npm install
opencode service restart
```

---

## Roadmap

1. Implement semantic search with embeddings (local or OpenAI-compatible).
2. Replace JSON storage with libSQL/Turso and add migrations.
3. AI-based capture: extract discrete decisions instead of whole-session blobs.
4. Markdown Vault and Remote API backends.
5. Web UI for browsing, editing, and restoring memories.
6. Database encryption at rest and file locking.
7. Integration and end-to-end tests.

---

## Documentation

- [`doc/DESIGN.md`](doc/DESIGN.md) — design and module breakdown
- [`doc/handover.md`](doc/handover.md) — implementation status, V2 migration notes, next steps
- [`doc/lesson_learn.md`](doc/lesson_learn.md) — plugin loading failures and fixes
- [OpenCode V2 plugin guide](https://opencode.ai/v2/docs/build/plugins)

---

## License

MIT
