import fs from "fs/promises";
import path from "path";
import { getStorageDir } from "./local.js";

const MigrateFile = "migrations.lock.json";
const VERSION_FILE = "storage-version.json";

export const SCHEMA_VERSION = 2;

function lockPath() {
  return path.join(getStorageDir(), MigrateFile);
}

function versionPath() {
  return path.join(getStorageDir(), VERSION_FILE);
}

export async function readVersion() {
  const filePath = versionPath();
  try {
    const data = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(data);
    return Number.isInteger(parsed.version) ? parsed.version : 1;
  } catch (e) {
    if (e.code === "ENOENT") return 1;
    throw e;
  }
}

export async function writeVersion(version) {
  const data = { version, updatedAt: new Date().toISOString() };
  const filePath = versionPath();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function applyMigration(fromVersion, toVersion) {
  const migrations = {
    // v1 -> v2: add embedding field to memory objects
    1: async () => {},
    2: async () => {},
  };
  const migrate = migrations[fromVersion];
  if (!migrate) throw new Error(`No migration available from ${fromVersion}`);
  await migrate();
}

export async function lockMigrations() {
  const lockPathFile = lockPath();
  const lockData = { lockedAt: new Date().toISOString(), by: process.env.USER || "unknown" };
  await fs.writeFile(lockPathFile, JSON.stringify(lockData, null, 2), "utf8");
}

export async function unlockMigrations() {
  try {
    await fs.unlink(lockPath());
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

export async function ensureSchema() {
  const fromVersion = await readVersion();
  if (fromVersion < SCHEMA_VERSION) {
    await lockMigrations();
    try {
      await applyMigration(fromVersion, SCHEMA_VERSION);
      await writeVersion(SCHEMA_VERSION);
      return SCHEMA_VERSION;
    } finally {
      await unlockMigrations();
    }
  } else if (fromVersion > SCHEMA_VERSION) {
    throw new Error(`Storage schema version ${fromVersion} is newer than supported ${SCHEMA_VERSION}`);
  }
  return fromVersion;
}
