import fs from "fs/promises";
import path from "path";
import { getStorageDir } from "./storage/local.js";

const EVENTS_FILE = "events.log.json";

function eventsPath() {
  return path.join(getStorageDir(), EVENTS_FILE);
}

export async function logEvent({ sessionID, time, actor, event_type, description, related_memory_ids }) {
  const filePath = eventsPath();
  const entry = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    sessionID,
    time: time || new Date().toISOString(),
    actor,
    event_type,
    description,
    related_memory_ids: related_memory_ids || [],
  };
  let events = [];
  try {
    const data = await fs.readFile(filePath, "utf-8");
    events = JSON.parse(data);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  events.push(entry);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(events, null, 2), "utf-8");
  return entry;
}

export async function summarizeRecentEvents({ hours = 24 } = {}) {
  const filePath = eventsPath();
  let events = [];
  try {
    const data = await fs.readFile(filePath, "utf-8");
    events = JSON.parse(data);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return null;
  }

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const recent = events.filter((e) => e.time >= cutoff);
  if (recent.length < 3) return null;

  const summary = recent
    .map((e) => `[${e.event_type}] ${e.description}`)
    .join("\n");

  const related_ids = recent.flatMap((e) => e.related_memory_ids || []);
  return { summary, related_memory_ids: [...new Set(related_ids)] };
}
