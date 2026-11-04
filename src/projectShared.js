import fs from "fs/promises";
import path from "path";
import os from "os";

async function findProjectMarker(startDir, markerFileName) {
  let current = startDir || process.cwd();
  let limit = 10;
  while (limit > 0) {
    const target = path.join(current, markerFileName);
    try {
      const stat = await fs.stat(target);
      if (stat.isFile()) {
        const content = await fs.readFile(target, "utf8").catch(() => "");
        return {
          projectDir: current,
          content: content.trim(),
        };
      }
    } catch (e) {
      if (e.code !== "ENOENT") {
        console.error(`[opencode-mem-decision] error reading project marker: ${e.message}`);
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    limit -= 1;
  }
  return null;
}

export async function resolveProjectShared({ memoryConfig, cwd = process.cwd() }) {
  const config = memoryConfig.projectShared || { enabled: true, markerFileName: ".opencode-mem-project" };
  if (!config.enabled) return null;
  const markerFileName = config.markerFileName || ".opencode-mem-project";
  const marker = await findProjectMarker(cwd, markerFileName);
  if (!marker) return null;

  let projectName = marker.content;
  if (projectName && !projectName.startsWith("project:")) {
    // Simple heuristic: treat as text name
    const cleaned = projectName.trim().replace(/[^a-z0-9\s]/gi, " ").trim().toLowerCase();
    const parts = cleaned.split(/\s+/).filter(Boolean).slice(0, 3);
    if (parts.length > 0) {
      projectName = `project:${parts.join("-")}`;
    }
  }
  return {
    projectDir: marker.projectDir,
    markerFileName,
    projectName: projectName || "shared-project",
  };
}

export async function createProjectMarker(cwd, projectName) {
  const config = { enabled: true, markerFileName: ".opencode-mem-project" };
  const markerFile = path.join(cwd, config.markerFileName);
  const content = projectName || "shared-project";
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(markerFile, `${content}\n`, "utf8");
  return { projectDir: cwd, markerFileName: config.markerFileName, projectName: content };
}
