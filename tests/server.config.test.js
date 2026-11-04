import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { createWebServer, releaseWebServer } from "../src/server.js";
import { localStorage } from "../src/storage/local.js";

const TEST_DIR = path.join(os.tmpdir(), `opencode-mem-server-config-test-${process.pid}-${Date.now()}`);
const CONFIG_PATH = path.join(TEST_DIR, "config.json");

test.beforeEach(async () => {
  process.env.OPENCODE_MEM_DIR = TEST_DIR;
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.rm(CONFIG_PATH, { force: true });
});

test.afterEach(async () => {
  delete process.env.OPENCODE_MEM_DIR;
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test("server - GET /api/config masks sensitive values", async (t) => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const config = {
    webServerHost: "127.0.0.1",
    webServerPort: port,
    webServerAuthUsername: "u",
    webServerAuthPassword: "secret",
    embeddingApiKey: "emb-key",
    extractionApiKey: "ext-key",
    memory: { encryption: { enabled: true, password: "mypassword" } },
  };
  await fs.writeFile(CONFIG_PATH, JSON.stringify({
    ...config,
    memory: { encryption: { enabled: true, password: "mypassword" } },
  }), "utf-8");
  const server = createWebServer({ memoryConfig: config, storage: localStorage, configPath: CONFIG_PATH });
  try {
    const auth = Buffer.from("u:secret").toString("base64");
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      headers: { Authorization: "Basic " + auth },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.webServerAuthPassword, "***");
    assert.equal(body.embeddingApiKey, "***");
    assert.equal(body.extractionApiKey, "***");
    assert.equal(body.memory.encryption.password, "***");
    assert.equal(body.webServerAuthUsername, "u");
  } finally {
    await releaseWebServer(server);
  }
});

test("server - POST /api/config writes config and masks in response", async (t) => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = createWebServer({ memoryConfig: { webServerHost: "127.0.0.1", webServerPort: port }, storage: localStorage, configPath: CONFIG_PATH });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webServerAuthPassword: "newpass",
        embeddingApiKey: "newemb",
        memory: { encryption: { password: "mypassword" } },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.saved, true);
    assert.equal(body.config.webServerAuthPassword, "***");
    assert.equal(body.config.embeddingApiKey, "***");
    assert.equal(body.config.memory.encryption.password, "***");

    const savedFile = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
    assert.equal(savedFile.webServerAuthPassword, "newpass");
    assert.equal(savedFile.embeddingApiKey, "newemb");
    assert.equal(savedFile.memory.encryption.password, "mypassword");
  } finally {
    await releaseWebServer(server);
  }
});
