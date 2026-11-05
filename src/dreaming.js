import fs from "fs/promises";
import path from "path";
import { listMemories, updateMemory, softDeleteMemory, addMemory, getStorageDir, cleanupTrash, projectStoragePath } from "./storage/local.js";
import { calculateSimilarity } from "./capture.js";
import { redactCredentials } from "./security.js";
import { loadConfig } from "./config.js";

const TRASH_FILE = "trash.db.json";
const DEFAULT_TRASH_RETENTION_DAYS = 90;

function trashPath() {
  return path.join(getStorageDir(), TRASH_FILE);
}

async function readTrash() {
  try {
    const data = await fs.readFile(trashPath(), "utf-8");
    return JSON.parse(data);
  } catch (e) {
    if (e.code === "ENOENT") return { entries: [] };
    throw e;
  }
}

async function writeTrash(entries) {
  const filePath = trashPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ entries }, null, 2), "utf-8");
}

export async function runDreaming({ memoryConfig, storage, activeProject }) {
  if (!memoryConfig.dreaming?.enabled) return { action: "skipped", reason: "dreaming disabled" };

  const relatedThreshold = memoryConfig.dreaming.relatedThreshold || 0.75;
  const defaultConfig = loadConfig();
  const effectiveScope = activeProject?.projectName ? `project:${activeProject.projectName}` : "default";
  const memories = await listMemories(1000, effectiveScope, defaultConfig);
  const trash = await readTrash();
  let actions = [];

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i];
      const b = memories[j];
      const sim = calculateSimilarity(a.content || "", b.content || "");
      if (sim >= relatedThreshold) {
        const decision = sim >= 0.9 ? "merge" : sim >= 0.8 ? "supersede" : "update";
        const winner = decision === "merge" ? a : b;
        const loser = decision === "merge" ? b : a;

        if (decision === "merge") {
          await storage.updateMemory(winner.id, {
            content: redactCredentials(`${winner.content}\n\n${loser.content}`),
          });
        } else if (decision === "supersede") {
          await storage.updateMemory(winner.id, { content: redactCredentials(loser.content) });
          await moveToTrash(loser.id, loser.content, trash.entries);
        } else {
          await storage.updateMemory(winner.id, {
            content: redactCredentials(`${winner.content}\nNote: ${loser.content}`),
          });
        }

        actions.push({ action: decision, winner: winner.id, loser: loser.id, similarity: sim });
      }
    }
  }

  const retentionDays = memoryConfig.dreaming?.trashRetentionDays || DEFAULT_TRASH_RETENTION_DAYS;
  await cleanupTrash(retentionDays);

  await writeTrash(trash.entries);
  return { action: "dreamed", count: actions.length, actions };
}

async function moveToTrash(id, content, entries) {
  const memory = { id, content: redactCredentials(content) };
  entries.push({ ...memory, addedAt: new Date().toISOString(), deletedAt: new Date().toISOString() });
  await softDeleteMemory(id);
}

export async function restoreTrashEntry(id, activeProject = null) {
  const filePath = trashPath();
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const trash = JSON.parse(data);
    const entry = trash.entries.find((e) => e.id === id);
    if (!entry) return { error: "not found" };
    trash.entries = trash.entries.filter((e) => e.id !== id);
    await fs.writeFile(filePath, JSON.stringify(trash, null, 2), "utf-8");
    const scope = activeProject?.projectName ? `project:${activeProject.projectName}` : "project";
    await addMemory(entry.content, scope);
    return { restored: true };
  } catch (e) {
    return { error: e.message };
  }
}
