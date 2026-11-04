import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { localStorage } from "./storage/local.js";
import { buildProfile } from "./profile.js";
import { runDreaming } from "./dreaming.js";

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

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
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

export function createWebServer({ memoryConfig, storage }) {
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
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="OpenCode Memory"' });
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;
    const path = url.pathname;

    try {
      if (path === "/" || path === "/index.html") {
        const html = await fs.readFile(UI_FILE, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else if (path === "/api/memory" && method === "GET") {
        sendJson(res, 200, await storage.listMemories());
      } else if (path === "/api/knowledge" && method === "GET") {
        sendJson(res, 200, await storage.listKnowledge());
      } else if (path === "/api/stats" && method === "GET") {
        const memories = await storage.listMemories(10000);
        sendJson(res, 200, {
          memories: memories.length,
          knowledge: (await storage.listKnowledge()).length,
          timestamp: new Date().toISOString(),
        });
      } else if (path === "/api/memory/search" && method === "GET") {
        const query = url.searchParams.get("query") || "";
        const scope = url.searchParams.get("scope") || "default";
        sendJson(res, 200, await storage.searchMemories(query, scope));
      } else if (path.match(/^\/api\/memory\/[^/]+$/) && method === "GET") {
        const id = path.split("/").pop();
        sendJson(res, 200, await storage.getMemory(id));
      } else if (path === "/api/memory" && method === "DELETE") {
        const scope = url.searchParams.get("scope") || "default";
        const query = url.searchParams.get("query") || "";
        const deletedCount = await storage.deleteMemories(query, scope);
        sendJson(res, 200, { deleted: deletedCount });
      } else if (path === "/api/memory" && method === "POST") {
        const body = await parseBody(req);
        sendJson(res, 201, await storage.addMemory(body.content, body.scope || "project"));
      } else if (path.match(/^\/api\/memory\/[^/]+$/) && method === "DELETE") {
        const id = path.split("/").pop();
        sendJson(res, 200, { deleted: await storage.deleteMemory(id) });
      } else if (path === "/api/profile" && method === "GET") {
        sendJson(res, 200, await buildProfile({ memoryConfig, storage }));
      } else if (path === "/api/dream" && method === "POST") {
        sendJson(res, 200, await runDreaming({ memoryConfig, storage }));
      } else if (path.match(/^\/api\/skills/) && method === "GET") {
        sendJson(res, 501, { error: "Skills registry not yet implemented" });
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
