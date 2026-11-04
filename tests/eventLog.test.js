import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import { logEvent, summarizeRecentEvents } from "../src/eventLog.js";
import { getStorageDir } from "../src/storage/local.js";

test("eventLog - logEvent writes to events.log.json", async () => {
  const dir = getStorageDir();
  const file = `${dir}/events.log.json`;
  try {
    await fs.rm(file, { force: true });
  } catch {}

  const entry = await logEvent({ sessionID: "ses_123", actor: "system", event_type: "auto-capture", description: "test capture" });
  assert.equal(entry.sessionID, "ses_123");
  const data = JSON.parse(await fs.readFile(file, "utf-8"));
  assert.equal(data.length, 1);
});

test("eventLog - summarizeRecentEvents returns null when few events", async () => {
  const file = `${getStorageDir()}/events.log.json`;
  try {
    await fs.rm(file, { force: true });
  } catch {}
  const summary = await summarizeRecentEvents({ hours: 24 });
  assert.equal(summary, null);
});

test("eventLog - summarizeRecentEvents generates summary when many events", async () => {
  const file = `${getStorageDir()}/events.log.json`;
  try {
    await fs.rm(file, { force: true });
  } catch {}

  const now = new Date().toISOString();
  await logEvent({ sessionID: "ses_1", actor: "user", event_type: "tool_call", description: "deploy", related_memory_ids: ["mem_1"] });
  await logEvent({ sessionID: "ses_1", actor: "agent", event_type: "decision", description: "choose Fastify" });
  await logEvent({ sessionID: "ses_2", actor: "system", event_type: "auto-capture", description: "capture", related_memory_ids: ["mem_1"] });

  const summary = await summarizeRecentEvents({ hours: 24 });
  assert.ok(summary.summary.includes("deploy"));
  assert.equal(summary.related_memory_ids.length, 1);
});
