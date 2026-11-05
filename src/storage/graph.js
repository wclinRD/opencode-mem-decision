import fs from "fs/promises";
import path from "path";
import os from "os";

const HOME_DIR = process.env.HOME || os.homedir() || "~";

function getStorageDir() {
  const override = process.env.OPENCODE_MEM_DIR;
  if (override) return path.resolve(override);
  return path.join(HOME_DIR, ".opencode-memory");
}

export function getGraphStoragePath() {
  return path.join(getStorageDir(), "graph.db.json");
}

export async function saveGraph(graphData) {
  const filePath = getGraphStoragePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(graphData, null, 2), "utf-8");
}

export async function loadGraph() {
  const filePath = getGraphStoragePath();
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
