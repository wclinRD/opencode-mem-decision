import http from "http";
import { localStorage } from "./storage/local.js";

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

export function createWebServer({ memoryConfig, storage }) {
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
      if (path === "/api/memory" && method === "GET") {
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
      } else if (path.match(/^\/api\/memory\/[^/]+$/) && method === "GET") {
        const id = path.split("/").pop();
        sendJson(res, 200, await storage.getMemory(id));
      } else if (path === "/api/memory" && method === "POST") {
        const body = await parseBody(req);
        sendJson(res, 201, await storage.addMemory(body.content, body.scope || "project"));
      } else if (path.match(/^\/api\/memory\/[^/]+$/) && method === "DELETE") {
        const id = path.split("/").pop();
        sendJson(res, 200, { deleted: await storage.deleteMemory(id) });
      } else if (path === "/api/profile" && method === "GET") {
        sendJson(res, 200, { type: "info", message: "User profile not yet implemented" });
      } else if (path === "/api/dream" && method === "POST") {
        sendJson(res, 501, { error: "Dreaming not yet implemented" });
      } else if (path.match(/^\/api\/skills/) && method === "GET") {
        sendJson(res, 501, { error: "Skills registry not yet implemented" });
      } else {
        sendJson(res, 404, { error: "Not found" });
      }
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  });

  const port = memoryConfig.webServerPort || 4747;
  server.listen(port, memoryConfig.webServerHost, () => {
    console.log(`OpenCode Memory web server listening on http://${memoryConfig.webServerHost}:${port}`);
  });

  return server;
}
