import http from "http";
import fs from "fs";
import * as fsPromises from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { localStorage, listProjectCounts } from "./storage/local.js";
import { buildProfile } from "./profile.js";
import { runDreaming } from "./dreaming.js";
import { summarizeRecentEvents } from "./eventLog.js";
import { loadConfig } from "./config.js";
import { skillsStorage } from "./skills.js";
import { saveGraph, loadGraph } from "./storage/graph.js";
import { buildHierarchicalGraph } from "./organize.js";
import { simulateDualRouteRetrieve } from "./retrieval.js";

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".config", "opencode", "plugins", "opencode-mem-decision", "config.json");

function readConfigFile(configPath) {
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content);
    return loadConfig(parsed);
  } catch (e) {
    return loadConfig();
  }
}

function maskSensitiveConfig(config) {
  const masked = { ...config };
  if (masked.memory?.encryption?.password) masked.memory.encryption.password = "***";
  if (masked.webServerAuthPassword) masked.webServerAuthPassword = "***";
  if (masked.embeddingApiKey) masked.embeddingApiKey = "***";
  if (masked.extractionApiKey) masked.extractionApiKey = "***";
  return masked;
}

function saveConfigFile(configPath, config) {
  return fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

const UI_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "static", "ui.html");

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(data));
}

function basicAuth(req, username, password) {
  if (!username || !password) return true;
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) return false;
  const [decodedUser, decodedPass] = Buffer.from(auth.slice(6), "base64").toString("utf-8").split(":");
  return decodedUser === username && decodedPass === password;
}

// One HTTP server per process and host/port. Every OpenCode instance loads its
// own copy of the plugin, but a single process may set it up more than once.
let sharedServer = null;

export function createWebServer({ memoryConfig, storage, configPath }) {
  const host = memoryConfig.webServerHost;
  const port = memoryConfig.webServerPort || 4747;
  const key = `${host}:${port}`;

  if (sharedServer && sharedServer.key === key) {
    sharedServer.refs += 1;
    return sharedServer.server;
  }

  const server = http.createServer(async (req, res) => {
    const { webServerAuthUsername, webServerAuthPassword } = memoryConfig;
    if (!basicAuth(req, webServerAuthUsername, webServerAuthPassword)) {
      sendJson(res, 401, { error: "Unauthorized" }, { "WWW-Authenticate": 'Basic realm="OpenCode Memory"' });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;
    const path = url.pathname;

    try {
      if (path === "/" || path === "/index.html") {
        const html = await fsPromises.readFile(UI_FILE, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else if (path === "/api/memory" && method === "GET") {
        const defaultConfig = loadConfig();
        sendJson(res, 200, await storage.listMemories(undefined, "default", defaultConfig));
      } else if (path === "/api/knowledge" && method === "GET") {
        sendJson(res, 200, await storage.listKnowledge());
      } else if (path.match(/^\/api\/knowledge\/[^/]+$/) && method === "DELETE") {
        const id = path.split("/").pop();
        sendJson(res, 200, { deleted: await storage.deleteKnowledge(id) });
      } else if (path === "/api/stats" && method === "GET") {
        const defaultConfig = loadConfig();
        const memories = await storage.listMemories(10000, "default", defaultConfig);
        sendJson(res, 200, {
          memories: memories.length,
          knowledge: (await storage.listKnowledge()).length,
          timestamp: new Date().toISOString(),
        });
      } else if (path === "/api/projects" && method === "GET") {
        const projectCounts = await listProjectCounts();
        sendJson(res, 200, { projects: projectCounts });
      } else if (path === "/api/config" && method === "GET") {
        const fullConfig = readConfigFile(configPath || DEFAULT_CONFIG_PATH);
        sendJson(res, 200, maskSensitiveConfig(fullConfig));
      } else if (path === "/api/config" && method === "POST") {
        const body = await parseBody(req);
        const current = readConfigFile(configPath || DEFAULT_CONFIG_PATH);
        const merged = {
          ...current,
          ...body,
          chatMessage: { ...current.chatMessage, ...(body.chatMessage || {}) },
          dreaming: { ...current.dreaming, ...(body.dreaming || {}) },
          memory: { ...current.memory, ...(body.memory || {}) },
        };
        await saveConfigFile(configPath || DEFAULT_CONFIG_PATH, merged);
        sendJson(res, 200, { saved: true, config: maskSensitiveConfig(merged) });
      } else if (path === "/api/memory/search" && method === "GET") {
        const query = url.searchParams.get("query") || "";
        const scope = url.searchParams.get("scope") || "default";
        const project = url.searchParams.get("project") || null;
        const effectiveScope = project ? `project:${project}` : scope;
        const type = url.searchParams.get("type") || "all";
        const confidence = url.searchParams.get("confidence");
        const timeRange = url.searchParams.get("timeRange");
        const ttlDays = url.searchParams.get("ttlDays");
        const includeExpired = url.searchParams.get("includeExpired") === "true";
        const filters = { scope: effectiveScope };
        if (type !== "all") filters.type = type;
        if (confidence) filters.confidence = Number(confidence);
        if (timeRange) filters.timeRange = Number(timeRange);
        if (ttlDays) filters.ttlDays = Number(ttlDays);
        filters.includeExpired = includeExpired;
        sendJson(res, 200, await storage.searchMemories(query, filters));
      } else if (path === "/api/events/summary" && method === "GET") {
        const hours = url.searchParams.get("hours") || 24;
        sendJson(res, 200, await summarizeRecentEvents({ hours: Number(hours) }));
      } else if (path.match(/^\/api\/memory\/[^/]+$/) && method === "GET") {
        const id = path.split("/").pop();
        sendJson(res, 200, await storage.getMemory(id));
      } else if (path === "/api/memory" && method === "DELETE") {
        const scope = url.searchParams.get("scope") || "default";
        const project = url.searchParams.get("project") || null;
        const effectiveScope = project ? `project:${project}` : scope;
        const query = url.searchParams.get("query") || "";
        const deletedCount = await storage.deleteMemories(query, effectiveScope);
        sendJson(res, 200, { deleted: deletedCount });
      } else if (path === "/api/memory" && method === "POST") {
        const body = await parseBody(req);
        const scope = body.scope || "project";
        const project = body.project;
        const effectiveScope = project ? `project:${project}` : scope;
        sendJson(res, 201, await storage.addMemory(body.content, effectiveScope));
      } else if (path.match(/^\/api\/memory\/[^/]+$/) && method === "DELETE") {
        const id = path.split("/").pop();
        sendJson(res, 200, { deleted: await storage.deleteMemory(id) });
      } else if (path === "/api/memory/optimize" && method === "POST") {
        const body = await parseBody(req);
        const scope = body.scope || "default";
        const result = await storage.optimizeMemories(scope);
        sendJson(res, 200, result);
      } else if (path === "/api/memory/organize" && method === "POST") {
        const body = await parseBody(req);
        const scope = body.scope || "default";
        const memories = await storage.searchMemories("", { scope, includeExpired: true });
        const graphData = buildHierarchicalGraph(memories, body.config || {});
        await saveGraph(graphData);
        sendJson(res, 200, graphData);
      } else if (path === "/api/memory/retrieve" && method === "POST") {
        const body = await parseBody(req);
        const query = body.query || "";
        const scope = body.scope || "default";
        const filters = body.filters || {};
        const memories = await storage.searchMemories("", { scope, includeExpired: true });
        const graphData = await loadGraph();
        const result = simulateDualRouteRetrieve(query, memories, graphData, filters);
        sendJson(res, 200, result);
      } else if (path === "/api/profile" && method === "GET") {
        sendJson(res, 200, await buildProfile({ memoryConfig, storage }));
      } else if (path === "/api/dream" && method === "POST") {
        sendJson(res, 200, await runDreaming({ memoryConfig, storage }));
      } else if (path === "/api/skills" && method === "GET") {
        const scope = url.searchParams.get("scope") || "global";
        const limit = Number(url.searchParams.get("limit") || 100);
        sendJson(res, 200, await skillsStorage.listSkills(scope, limit));
      } else if (path === "/api/skills/search" && method === "GET") {
        const query = url.searchParams.get("query") || "";
        const scope = url.searchParams.get("scope") || "global";
        sendJson(res, 200, await skillsStorage.searchSkills(query, scope));
      } else if (path === "/api/skills" && method === "POST") {
        const body = await parseBody(req);
        sendJson(res, 201, await skillsStorage.addSkill(body.content, body.scope || "global", body.metadata));
      } else if (path === "/api/skills" && method === "DELETE") {
        const scope = url.searchParams.get("scope") || "global";
        const query = url.searchParams.get("query") || "";
        const matched = await skillsStorage.searchSkills(query, scope);
        for (const skill of matched) {
          await skillsStorage.deleteSkill(skill.id);
        }
        sendJson(res, 200, { deleted: matched.length });
      } else if (path.match(/^\/api\/skills\/[^/]+$/) && method === "DELETE") {
        const id = path.split("/").pop();
        sendJson(res, 200, { deleted: await skillsStorage.deleteSkill(id) });
      } else if (path === "/api/skills/search" && method === "DELETE") {
        const scope = url.searchParams.get("scope") || "global";
        const query = url.searchParams.get("query") || "";
        const matched = await skillsStorage.searchSkills(query, scope);
        for (const skill of matched) {
          await skillsStorage.deleteSkill(skill.id);
        }
        sendJson(res, 200, { deleted: matched.length });
      } else if (path.match(/^\/api\/skills\/[^/]+$/) && method === "GET") {
        const id = path.split("/").pop();
        sendJson(res, 200, await skillsStorage.getSkill(id));
      } else {
        sendJson(res, 404, { error: "Not found" });
      }
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  });

  sharedServer = { key, server, refs: 1, closed: false };

  // A busy port must not crash the host process. Another OpenCode instance is
  // already serving the API on this port, so keep going without retrying.
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.log(
        `[opencode-mem-decision] port ${port} already in use; assuming another OpenCode instance serves the memory API`,
      );
      return;
    }
    console.error(`[opencode-mem-decision] web server error: ${error.message}`);
  });

  server.listen(port, host, () => {
    console.log(`[opencode-mem-decision] web server listening on http://${host}:${port}`);
  });

  return server;
}

export async function releaseWebServer(server) {
  const state = sharedServer;
  if (!state || state.server !== server) return;

  state.refs -= 1;
  if (state.refs > 0) return;

  sharedServer = null;
  if (state.closed) return;
  state.closed = true;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      server.close(finish);
      server.closeAllConnections?.();
    } catch {
      finish();
    }
  });
}
