import fs from "fs/promises";
import path from "path";
import { getStorageDir } from "./storage/local.js";
import { redactCredentials } from "./security.js";

const SKILLS_FILE = "skills.db.json";

function skillsPath() {
  return path.join(getStorageDir(), SKILLS_FILE);
}

async function readSkillsFile() {
  try {
    const data = await fs.readFile(skillsPath(), "utf-8");
    return JSON.parse(data);
  } catch (e) {
    if (e.code === "ENOENT") return { skills: [] };
    throw e;
  }
}

async function writeSkillsFile(data) {
  const filePath = skillsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

export async function addSkill(content, scope = "global", metadata = {}) {
  const skillsFilePath = skillsPath();
  await fs.mkdir(path.dirname(skillsFilePath), { recursive: true });
  const db = await readSkillsFile();

  const skillId = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const skill = {
    id: skillId,
    content: redactCredentials(content),
    scope,
    tags: metadata?.tags || [],
    description: metadata?.description || "",
    author: metadata?.author || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const existing = db.skills.find((s) => s.id === skillId);
  if (existing) {
    Object.assign(existing, skill);
  } else {
    db.skills.push(skill);
  }
  await writeSkillsFile(db);
  return skill;
}

export async function listSkills(scope = "global", limit = 100) {
  const db = await readSkillsFile();
  const scoped = db.skills.filter((s) => scope === "global" || s.scope === scope);
  return scoped
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}

export async function getSkill(id) {
  const db = await readSkillsFile();
  return db.skills.find((s) => s.id === id) || null;
}

export async function updateSkill(id, updates) {
  const db = await readSkillsFile();
  const skill = db.skills.find((s) => s.id === id);
  if (!skill) return null;
  if (updates.content) skill.content = redactCredentials(updates.content);
  if (updates.scope) skill.scope = updates.scope;
  if (updates.tags) skill.tags = updates.tags;
  if (updates.description) skill.description = updates.description;
  if (updates.author) skill.author = updates.author;
  skill.updatedAt = new Date().toISOString();
  await writeSkillsFile(db);
  return skill;
}

export async function deleteSkill(id) {
  const db = await readSkillsFile();
  const index = db.skills.findIndex((s) => s.id === id);
  if (index >= 0) {
    db.skills.splice(index, 1);
    await writeSkillsFile(db);
    return true;
  }
  return false;
}

export async function searchSkills(query, scope = "global") {
  const db = await readSkillsFile();
  const scoped = db.skills.filter((s) => scope === "global" || s.scope === scope);
  const tokens = [...new Set(tokenize(query))];
  return scoped
    .filter((skill) => {
      const memoryTokens = new Set(tokenize(skill.content || ""));
      return tokens.some((token) => memoryTokens.has(token));
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

export const skillsStorage = {
  addSkill,
  listSkills,
  getSkill,
  updateSkill,
  deleteSkill,
  searchSkills,
};
