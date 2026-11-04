import { listMemories, updateMemory, deleteMemory, addMemory } from "./storage/local.js";
import { calculateSimilarity } from "./capture.js";
import { redactCredentials } from "./security.js";

const TRASH_FILE = "trash.db.json";

async function readTrash() {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const STORAGE_DIR = "~/.opencode-memory";
    const filePath = path.join(STORAGE_DIR, TRASH_FILE);
    try {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data);
    } catch (e) {
      if (e.code === "ENOENT") return { entries: [] };
      throw e;
    }
  } catch {
    return { entries: [] };
  }
}

async function writeTrash(entries) {
  const fs = await import("fs/promises");
  const path = await import("path");
  const STORAGE_DIR = "~/.opencode-memory";
  const filePath = path.join(STORAGE_DIR, TRASH_FILE);
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ entries }, null, 2), "utf-8");
}

export async function runDreaming({ memoryConfig, storage }) {
  if (!memoryConfig.dreaming?.enabled) return { action: "skipped", reason: "dreaming disabled" };

  const relatedThreshold = memoryConfig.dreaming.relatedThreshold || 0.75;
  const memories = await listMemories(1000, "all-projects");
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

  await writeTrash(trash.entries);
  return { action: "dreamed", count: actions.length, actions };
}

async function moveToTrash(id, content, entries) {
  entries.push({ id, content: redactCredentials(content), addedAt: new Date().toISOString() });
  await deleteMemory(id);
}

export async function restoreTrashEntry(id) {
  const fs = await import("fs/promises");
  const path = await import("path");
  const STORAGE_DIR = "~/.opencode-memory";
  const filePath = path.join(STORAGE_DIR, TRASH_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const trash = JSON.parse(data);
    const entry = trash.entries.find((e) => e.id === id);
    if (!entry) return { error: "not found" };
    trash.entries = trash.entries.filter((e) => e.id !== id);
    await fs.writeFile(filePath, JSON.stringify(trash, null, 2), "utf-8");
    await addMemory(entry.content, "project");
    return { restored: true };
  } catch (e) {
    return { error: e.message };
  }
}
