import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import plugin from "../index.js";
import { localStorage } from "../src/storage/local.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-plugin-test-${process.pid}-${Date.now()}`);

const MEMORY_MODES = [
  "add", "search", "list", "profile", "forget", "migrate",
  "export", "import", "list-shards", "dream", "restore-trash",
  "knowledge-list", "knowledge-show", "knowledge-save", "knowledge-delete",
];

function createContext(options = {}) {
  const tools = new Map();
  const hooks = new Map();
  const registrations = [];

  const context = {
    options,
    location: { directory: process.cwd() },
    storage: {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
      scan: async () => ({ entries: [] }),
    },
    tool: {
      transform: async (callback) => {
        const editor = {
          list: () => [...tools.values()],
          get: (id) => tools.get(id),
          namespace: () => {},
          add: (tool) => {
            tools.set(tool.name, tool);
          },
          update: () => {},
          remove: (id) => {
            tools.delete(id);
          },
        };
        callback(editor);
        const registration = { dispose: async () => {} };
        registrations.push(registration);
        return registration;
      },
    },
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {},
      }),
    },
    session: {
      hook: async (name, callback) => {
        hooks.set(name, callback);
        const registration = {
          name,
          dispose: async () => {
            hooks.delete(name);
          },
        };
        registrations.push(registration);
        return registration;
      },
    },
  };

  return { context, tools, hooks, registrations };
}

test.beforeEach(async () => {
  process.env.OPENCODE_MEM_DIR = TEST_DIR;
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(path.join(TEST_DIR, "memories.db.json"), JSON.stringify({ memories: [] }));
  await fs.writeFile(path.join(TEST_DIR, "knowledge.db.json"), JSON.stringify({ knowledge: [] }));
  await fs.rm(path.join(TEST_DIR, "profile.json"), { force: true });
});

test.afterEach(async () => {
  delete process.env.OPENCODE_MEM_DIR;
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test("system - plugin module exports V2 definition", async () => {
  assert.ok(plugin);
  assert.equal(plugin.id, "opencode-mem-decision");
  assert.equal(typeof plugin.setup, "function");
  assert.equal(typeof plugin.server, "undefined");
});

test("system - setup registers memory tool with JSON Schema input", async () => {
  const { context, tools } = createContext({ webServerHost: "" });
  const cleanup = await plugin.setup(context);

  const memoryTool = tools.get("memory");
  assert.ok(memoryTool);
  assert.equal(memoryTool.description, "Manage cross-session memories and knowledge");

  const input = memoryTool.input;
  assert.equal(input.type, "object");
  assert.deepEqual(input.required, ["mode"]);
  assert.equal(input.additionalProperties, false);
  assert.equal(input.properties.mode.type, "string");
  for (const mode of MEMORY_MODES) {
    assert.ok(input.properties.mode.enum.includes(mode), `missing mode ${mode}`);
  }
  assert.equal(typeof memoryTool.execute, "function");

  await cleanup();
});

test("system - setup registers a prompt hook", async () => {
  const { context, hooks } = createContext({ webServerHost: "" });
  const cleanup = await plugin.setup(context);

  assert.equal(typeof hooks.get("prompt"), "function");

  await cleanup();
});

test("system - prompt hook injects memories once when injectOn is first", async () => {
  await localStorage.addMemory("Seeded memory about Fly deploys", "project");

  const { context, hooks } = createContext({
    webServerHost: "",
    chatMessage: { enabled: true, injectOn: "first" },
  });
  const cleanup = await plugin.setup(context);
  const prompt = hooks.get("prompt");

  const first = { sessionID: "ses_prompt_first", messageID: "msg_1", prompt: { text: "hello" }, delivery: {} };
  await prompt(first);
  assert.match(first.prompt.text, /opencode-mem-decision:injected/);
  assert.match(first.prompt.text, /Seeded memory about Fly deploys/);
  assert.ok(first.prompt.text.startsWith("hello"));

  const second = { sessionID: "ses_prompt_first", messageID: "msg_2", prompt: { text: "hello again" }, delivery: {} };
  await prompt(second);
  assert.equal(second.prompt.text, "hello again");

  await cleanup();
});

test("system - prompt hook injects on every prompt when injectOn is always", async () => {
  await localStorage.addMemory("Seeded memory about Fly deploys", "project");

  const { context, hooks } = createContext({
    webServerHost: "",
    chatMessage: { enabled: true, injectOn: "always" },
  });
  const cleanup = await plugin.setup(context);
  const prompt = hooks.get("prompt");

  const first = { sessionID: "ses_prompt_always", messageID: "msg_1", prompt: { text: "one" }, delivery: {} };
  const second = { sessionID: "ses_prompt_always", messageID: "msg_2", prompt: { text: "two" }, delivery: {} };
  await prompt(first);
  await prompt(second);

  assert.match(first.prompt.text, /opencode-mem-decision:injected/);
  assert.match(second.prompt.text, /opencode-mem-decision:injected/);

  await cleanup();
});

test("system - memory tool execute returns structured content", async () => {
  const { context, tools } = createContext({ webServerHost: "" });
  await plugin.setup(context);

  const memoryTool = tools.get("memory");
  const result = await memoryTool.execute({ mode: "profile" }, { sessionID: "ses_test" });

  assert.equal(typeof result.content, "string");
  const parsed = JSON.parse(result.content);
  assert.equal(typeof parsed.totals.memories, "number");
  assert.ok(Array.isArray(parsed.topKeywords));

  await assert.rejects(() => memoryTool.execute({ mode: "nope" }, { sessionID: "ses_test" }));
});

test("system - setup loads with custom options", async () => {
  const { context, tools } = createContext({
    memoryBackend: "database",
    storagePath: "/tmp/opencode-mem-test",
    chatMessage: { enabled: true },
    webServerHost: "",
  });
  const cleanup = await plugin.setup(context);
  assert.ok(tools.get("memory"));
  await cleanup();
});

test("system - setup starts web server when host is configured", async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const { context } = createContext({ webServerHost: "127.0.0.1", webServerPort: port });
  const cleanup = await plugin.setup(context);

  const response = await fetch(`http://127.0.0.1:${port}/api/stats`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.memories, "number");

  await cleanup();
});

test("system - two setups share one server and release the port", async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const options = { webServerHost: "127.0.0.1", webServerPort: port };
  const first = createContext(options);
  const second = createContext(options);

  const cleanupFirst = await plugin.setup(first.context);
  const cleanupSecond = await plugin.setup(second.context);

  const response = await fetch(`http://127.0.0.1:${port}/api/stats`);
  assert.equal(response.status, 200);

  await cleanupFirst();
  await cleanupSecond();

  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/api/stats`));
});
