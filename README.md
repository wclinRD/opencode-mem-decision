# opencode-mem-decision

Cross-session persistent memory for [OpenCode](https://opencode.ai) 2.x agents.

OpenCode sessions forget everything when they end. This plugin gives the agent a durable memory store: decisions, project facts, preferences, and reusable knowledge that survive restarts and can be recalled in later sessions.

> **Status:** version `1.0.0` with advanced integrations enabled. The plugin now supports vector embeddings, deduplication, encryption at rest, schema migrations, Markdown vault, project sharing, and a skills registry. See [Feature status](#feature-status) for details.

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
| Auto-capture on session idle | ✅ Implemented | Captures whole session text as one memory when `session.status.type === "idle"`; logs events and summaries |
| Deduplication | ✅ Implemented | Vector similarity when embedding is available; falls back to word-set Jaccard / substring matching. Configurable via `duplicateDetection` |
| Knowledge base | ✅ Implemented | Separate JSON file |
| Dreaming / consolidation | ✅ Implemented | Works when enabled; trash uses the storage directory |
| Memory injection into prompts | ✅ Implemented | Dynamic injection budget, precedence rules |
| Keyword search with filters | ✅ Implemented | Supports scope, type, confidence, timeRange |
| Semantic search / embeddings | ✅ Implemented | Local stub (768-dim token hash), remote OpenAI-compatible API, HuggingFace Inference. See [Embedding service](#embedding-service) |
| Encryption at rest | ✅ Implemented | AES-256-GCM via `memory.encryption` in config (optional) |
| Schema migrations | ✅ Implemented | JSON schema versioning and lock files |
| Markdown Vault backend | ✅ Implemented | Selectable via `memoryBackend: "markdown"`; stores memories as `.md` with front matter |
| Event logging | ✅ Implemented | Append-only events.log.json with summaries |
| User profile | ✅ Implemented | Built from memories, rebuilt every N prompts |
| Shared project memory | ✅ Implemented | Triggers on `.opencode-mem-project` marker; stored as `shared-project` scope |
| Auto-extraction (AI/text) | ✅ Implemented | Extracts summary, topics, code snippets, decisions from captured sessions (stub or remote) |
| Skills registry | ✅ Implemented | `src/skills.js` and `skill-*` tool modes; REST endpoints `/api/skills` |
| Web UI | ✅ Implemented | Static HTML/JS UI with memory/knowledge/events browsers and a Settings page for config load/save. |

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
     │  detect duplicate using embeddings or word-set similarity
     │  optionally run AI extraction (summary/topics/code/decisions)
     │  check for `.opencode-mem-project` marker and tag shared memories
     │  log event to events.log.json, generate summary when threshold met
     ▼
~/.opencode-memory/memories.db.json
     │
     ├── memory tool (agent) ──► add / list / search / export / forget / profile
     ├── web server ───────────► GET /api/memory, /api/stats, /api/profile, /api/skills, POST /api/dream
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

Copy the **whole repository**, so the `src/` directory keeps its name:

```
~/.config/opencode/plugins/opencode-mem-decision/
├── index.js               # export { default } from "./src/plugin.js";
├── package.json           # "main": "index.js", "type": "module"
├── package-lock.json
├── node_modules/          # npm install
└── src/
    ├── plugin.js          # Plugin.define(...)
    └── storage/ ...
```

> **Do not flatten `src/`.** Copying the contents of `src/` into the plugin root
> (`cp -R /path/to/opencode_mem/src/* ~/.config/opencode/plugins/opencode-mem-decision/`)
> makes `index.js` fail with
> `ERR_MODULE_NOT_FOUND: Cannot find module '.../src/plugin.js'`.
> OpenCode reports the less specific
> `Plugin must export a default definition with an id and an effect or setup function`
> because the failed import leaves `default` undefined.

When the destination already exists, `cp -R` nests the repository inside it. Remove the old copy first (`rm -rf ~/.config/opencode/plugins/opencode-mem-decision`) or use the `rsync` sync commands below.

The directory must contain `package.json` with `"main": "index.js"` and `index.js` must default-export the plugin definition.

Reload and verify:

```sh
opencode service restart
opencode service status

grep "opencode-mem-decision" ~/.local/share/opencode/log/opencode.log | tail
```

A successful load shows `loading plugin` and **no** `failed to load plugin`.

> Changes made in the source repository do not reach OpenCode automatically. Re-copy `index.js`, `package.json`, `package-lock.json`, and the `src/` directory to the global directory, keeping the `src/` layer:
>
> ```sh
> SRC=/path/to/opencode_mem
> DST=~/.config/opencode/plugins/opencode-mem-decision
> rsync -a "$SRC"/index.js "$SRC"/package.json "$SRC"/package-lock.json "$DST"/
> rsync -a "$SRC"/src/ "$DST"/src/
> ```
>
> The trailing slash on `"$SRC"/src/` copies the directory's contents, not the directory itself. Do not add `--delete`: it removes runtime files such as `config.json` that are not in the repository.
>
> Alternatively, use a symlink:
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

### Advanced options

These options enable newer features and must be configured explicitly:

| Option | Default | Effect |
|---|---|---|
| `duplicateDetection` | `{ enabled: true, similarityThreshold: 0.75, updateOnMatch: true }` | When adding or capturing a memory, compare against existing ones. With an embedding service it uses vector cosine similarity; otherwise it falls back to word-set Jaccard / substring matching. If a duplicate is found and `updateOnMatch` is `true`, the existing memory is updated instead of adding a new one; otherwise the capture is skipped. |
| `embeddingModel` | `"Xenova/nomic-embed-text-v1"` | Model used for embeddings. If `embeddingApiUrl` is set, the plugin calls that remote `/v1/embeddings`. If no model starts with `Xenova/`, it falls back to HuggingFace Inference; otherwise it uses a local token-hash stub (768 dims). |
| `embeddingApiUrl` | `""` | Remote OpenAI-compatible embeddings API base URL (no `/v1/embeddings` needed). |
| `embeddingApiKey` | `""` | API key for the remote embeddings API. |
| `extractionProvider` | `"stub"` | Auto-extraction provider: `"stub"`, `"openai-compatible"`, or `"huggingface"`. |
| `extractionApiUrl` | `""` | Remote OpenAI-compatible chat completions API base URL used by extraction (no `/v1/chat/completions` needed). |
| `extractionApiKey` | `""` | API key for the remote extraction API. |
| `extractionModel` | `"gpt-4o-mini"` | Model name for remote extraction when `extractionProvider` is `"openai-compatible"`. |
| `projectShared.enabled` | `true` | Detect `.opencode-mem-project` in the project tree; when present, mark captured memories as `shared-project` scope and tag them with `project:<name>`. |
| `projectShared.markerFileName` | `".opencode-mem-project"` | File name to search upward from the current working directory. |
| `memory.encryption.enabled` | `false` | Encrypt JSON storage files with AES-256-GCM using a password or environment variable. |
| `memory.encryption.password` | `process.env.OPENCODE_MEM_PASSWORD || null` | Password for encryption. If unset, the process generates a session-only key and does not persist across restarts. |
| `memoryBackend` | `"database"` | Storage backend to use: `"database"` (default JSON) or `"markdown"` (Vault). |
| `markdownPath` | `null` | Custom directory for the Markdown vault. Falls back to `~/.opencode-memory/vault`. |

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

### Auto-extraction

When `autoCapture` saves a memory, it also calls the configured extraction provider to extract structured information:

```json
{
  "summary": "String summary of the session.",
  "topics": ["topic1", "topic2"],
  "codeSnippets": ["`...`"],
  "decisions": ["decision1", "decision2"]
}
```

The plugin stores these as supplementary memories with types `summary`, `decision`, or `code`, tagged `auto-extraction`. If a remote OpenAI-compatible or HuggingFace Inference endpoint is configured, it uses that; otherwise the local stub uses text heuristics.

### Shared project memory

Placing a file named `.opencode-mem-project` (default) in a project tree makes the plugin tag captured memories with `shared-project` scope and a `project:<name>` tag. Cross-project agents can then recall shared project memories by filtering on this scope or tag. The plugin searches upward from the current working directory for the marker file.

### Skills registry

The plugin maintains a separate skill library in `<storage>/skills.db.json`. Skills can be managed through the `memory` tool:

```js
memory({ mode: "skill-save", content: "Use pnpm", scope: "project" });
memory({ mode: "skill-list", scope: "project", limit: 10 });
memory({ mode: "skill-show", id: "skill_..." });
memory({ mode: "skill-delete", id: "skill_..." });
```

The Web API offers:

```sh
curl http://127.0.0.1:4747/api/skills?scope=project&limit=20
curl http://127.0.0.1:4747/api/skills/search?query=pnpm&scope=project
curl -X POST http://127.0.0.1:4747/api/skills -H 'Content-Type: application/json' -d '{"content":"Use pnpm","scope":"project"}'
curl -X DELETE http://127.0.0.1:4747/api/skills/...
```

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
| `GET` | `/api/memory/search` | Search memories. Query string: `query`, `scope`, `type`, `confidence`, `timeRange`, `ttlDays`, `includeExpired`. |
| `GET` | `/api/knowledge` | List knowledge entries. |
| `GET` | `/api/stats` | Counts and timestamp. |
| `GET` | `/api/profile` | Builds, persists and returns the user profile. |
| `POST` | `/api/dream` | Runs consolidation and returns the result (or `skipped` when dreaming is disabled). |
| `GET` | `/api/skills` | List or add skills (see [Skills registry](#skills-registry)). |
| `POST` | `/api/skills` | Add a skill. Body: `{ "content": "...", "scope": "global", "metadata": { ... } }`. |
| `DELETE` | `/api/skills` | Delete all skills matching query and scope. |
| `DELETE` | `/api/skills/:id` | Delete a single skill. |
| `GET` | `/api/skills/search` | Search skills by query and scope. |
| `GET` | `/api/events/summary` | Summarize recent events (hours query param). |
| `GET` | `/api/config` | Return current configuration with sensitive values masked (e.g., API keys, passwords). |
| `POST` | `/api/config` | Update and save configuration to the plugin config file. Returns a masked version of the saved config. |

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
├── skills.db.json
├── trash.db.json
├── events.log.json
└── profile.json
```

With `memoryBackend: "markdown"`, memories are stored in:

```
~/.opencode-memory/vault/<id>.md
```

Each vault file uses YAML front matter for metadata and plain text for the body.

Tests and temporary runs can point storage elsewhere with `OPENCODE_MEM_DIR`:

```sh
OPENCODE_MEM_DIR=/tmp/opencode-mem-test node --test
```

Memory encryption (when configured) wraps the JSON files with an encrypted envelope, but the plaintext JSON shape remains compatible:

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

The file is JSON or Markdown, not a database. Concurrent writers are not locked. Do not edit it while OpenCode is writing.

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

- Memories are stored in JSON or Markdown by default. Use `memoryBackend: "markdown"` to switch.
- Database encryption at rest is optional and enabled via `memory.encryption`. It requires a password or `OPENCODE_MEM_PASSWORD`.
- The plugin writes `skills.db.json`, `events.log.json`, and `profile.json`.
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

first check that the entry point resolves. From the plugin directory:

```sh
cd ~/.config/opencode/plugins/opencode-mem-decision
node -e "import('./index.js').then(m => console.log(m.default.id)).catch(e => console.error(e.code, e.message))"
```

`ERR_MODULE_NOT_FOUND ... src/plugin.js` means the install was flattened: create `src/` and copy the repository's `src/` contents into it (see [Install](#install)). Only after that, treat the message as a V1 API problem. OpenCode 2.x requires:

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
- the loaded directory is the one you edited (global copy vs repository);
- the entry point resolves from the plugin directory (where `node_modules` exists): `node -e "import('./index.js')"` shows no `ERR_MODULE_NOT_FOUND`.

### Tool `memory` is missing

1. `opencode service restart`
2. `opencode service status`
3. Check the log for `failed to load plugin`.
4. Confirm the plugin directory contains `node_modules/@opencode/plugin`.
5. Confirm the layout: `index.js` at the root and `src/plugin.js` inside `src/`. A flattened install never loads, even with a correct `node_modules`.

### Changes do not take effect

You edited the repository, but OpenCode loads `~/.config/opencode/plugins/opencode-mem-decision/`. Re-copy the files (keeping `src/`) or use a symlink. After syncing, restart the service: `opencode service restart`.

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
│   ├── plugin.js            # V2 Plugin.define + tool registration + session.idle auto-capture
│   ├── config.js            # defaults and deep merge
│   ├── capture.js           # auto-capture, similarity, extraction, project-shared integration
│   ├── inject.js            # recall, injection marker, strip helper
│   ├── profile.js           # user profile build and prompt counting
│   ├── dreaming.js          # consolidation and trash
│   ├── security.js          # credential redaction
│   ├── server.js            # HTTP API with memory/knowledge/skills routes
│   ├── storage/local.js     # JSON storage core
│   ├── storage/markdown.js  # Markdown vault backend
│   ├── storage/encryption.js# AES-256-GCM encrypted file handling
│   ├── storage/migrations.js# schema versioning and lock files
│   ├── embedding.js         # local and remote embedding service
│   ├── extraction.js        # AI/text extraction service
│   ├── dedup.js             # deduplication by vector or text
│   ├── projectShared.js     # shared-project marker detection
│   ├── skills.js            # skills registry storage
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
SRC=$(pwd)
DST=~/.config/opencode/plugins/opencode-mem-decision
rsync -a "$SRC"/index.js "$SRC"/package.json "$SRC"/package-lock.json "$DST"/
rsync -a "$SRC"/src/ "$DST"/src/
(cd "$DST" && npm install)
opencode service restart
```

Keep the `src/` layer: `index.js` imports `./src/plugin.js`. No `--delete`; it would also remove runtime files in the global directory.

Check the install before restarting:

```sh
diff -rq "$SRC"/src "$DST"/src     # no output = identical
node -e "import('$DST/index.js').then(m => console.log(m.default.id))"
```

---

## Roadmap

1. **Remote embeddings & vector similarity** are implemented as a local stub and remote API fallback; improve vector dimensions and accuracy.
2. Replace JSON storage with libSQL/Turso and add migrations (core migration infrastructure exists).
3. AI-based capture: extract discrete decisions instead of whole-session blobs (stub integration added; actual AI extraction needs provider support).
4. Markdown Vault and Remote API backends are implemented; further optimize vault I/O and remote error handling.
5. Web UI for browsing, editing, and restoring memories/skills.
6. Database encryption at rest and file locking are implemented; verify with long-term use.
7. Integration and end-to-end tests; browser automation and real OpenCode session tests.
8. Shared skills registry improvements: tagging system, versioning, and export/import tools.
9. Project-level shared memory sharing across processes and sessions via marker files.

---

## Documentation

- [`doc/DESIGN.md`](doc/DESIGN.md) — design and module breakdown
- [`doc/handover.md`](doc/handover.md) — implementation status, V2 migration notes, next steps
- [`doc/lesson_learn.md`](doc/lesson_learn.md) — plugin loading failures and fixes
- [OpenCode V2 plugin guide](https://opencode.ai/v2/docs/build/plugins)

---

## License

MIT
