import { redactCredentials } from "./security.js";
import { searchMemories } from "./storage/local.js";
import { stripInjectedBlock } from "./inject.js";
import { logEvent, summarizeRecentEvents } from "./eventLog.js";
import { classifyMemory as defaultClassifyMemory, looksSensitive } from "./classify.js";
import { loadConfig } from "./config.js";
import { resolveProjectShared } from "./projectShared.js";
import path from "path";

const simHash = (text) => {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const seen = new Set();
  return words.filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  }).sort().join("|");
};

function normalizeText(text) {
  if (typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/["'`.:;!?()[\]{}.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveSessionDirFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const latest = messages[messages.length - 1];
  const files = latest?.files || latest?.parts?.find((p) => p?.type === "text")?.files || [];
  const firstFile = files.find((f) => f?.uri && f.uri.startsWith("file://"));
  if (firstFile) {
    const uri = firstFile.uri;
    const clean = uri.startsWith("file://") ? uri.slice(7) : uri;
    return path.dirname(clean);
  }
  return null;
}

export function calculateSimilarity(a, b) {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  const hashA = simHash(normA);
  const hashB = simHash(normB);
  if (hashA === hashB) return 1.0;
  const setA = new Set(hashA.split("|"));
  const setB = new Set(hashB.split("|"));
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function isShortSubstringMatch(a, b) {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (normA.length < 20 || normB.length < 20) return false;
  const longer = normA.length >= normB.length ? normA : normB;
  const shorter = normA.length >= normB.length ? normB : normA;
  if (shorter.length > 0.3 * longer.length) return false;
  const windows = longer.length - shorter.length + 1;
  for (let i = 0; i < windows; i++) {
    const window = longer.slice(i, i + shorter.length);
    if (window === shorter) return true;
    const windowNorm = normalizeText(window);
    if (windowNorm === shorter) return true;
  }
  return false;
}

export function isDuplicate(newContent, existingMemories, threshold = 0.75) {
  const redacted = redactCredentials(newContent);
  for (const mem of existingMemories) {
    const content = mem.content || "";
    const sim = calculateSimilarity(redacted, content);
    if (sim >= threshold) return { duplicate: true, existingId: mem.id, similarity: sim };
    if (isShortSubstringMatch(redacted, content)) return { duplicate: true, existingId: mem.id, similarity: 0.9 };
  }
  return { duplicate: false };
}

const lowValuePatterns = [
  /{[\s\S]*"type"\s*:\s*"tool_use"\s*,[\s\S]*}/i,
  /{[\s\S]*"type"\s*:\s*"tool_result"\s*,[\s\S]*}/i,
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[Z+-]/g,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
  /(?:0x)?[0-9a-fA-F]{16,}(?:\/[0-9a-fA-F]+)+/g,
  /\b(?:Error|Exception|Stack trace)\b[\s\S]{0,120}(?=\n\n|\n$)/gi,
  /\b(?:at\s+\w+\.)+\w+:[0-9]+:[0-9]+/gm,
  /(?:檢查|建立|查看|繼續|已提交|已修改|準備|完成|查看修改|提交修改|推送)\b/gi,
  /\b(branch|commit|push|git status)\b/gi,
];

const TECHNICAL_KEYWORDS = new Set([
  "typescript", "javascript", "python", "go", "rust", "react", "node", "docker",
  "kubernetes", "aws", "database", "config", "api", "server", "frontend", "backend",
  "authentication", "authorization", "cache", "deployment", "pipeline", "test",
  "unit test", "integration", "debug", "log", "performance", "security", "refactor",
  "architecture", "migration", "schema", "query", "index", "build", "deploy",
]);

function sentenceScore(sentence) {
  const words = sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  let score = words.length / 2; // basic length contribution
  let keywordHits = 0;
  for (const word of words) {
    if (TECHNICAL_KEYWORDS.has(word)) keywordHits++;
  }
  if (keywordHits > 0) score += keywordHits * 3;
  // Position bonus
  score += 1;
  // Code block mentions
  if (/\b(code|export|import|function|class|const|let|var|async|await)\b/i.test(sentence)) score += 1.5;
  return score;
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

export function summarizeLongText(text, maxSentences = 5) {
  const sentences = splitSentences(text);
  if (sentences.length <= maxSentences) return text;
  const scored = sentences.map((s, i) => ({ index: i, text: s, score: sentenceScore(s) }));
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, maxSentences).sort((a, b) => a.index - b.index);
  return selected.map((s) => s.text).join(" ");
}

function shouldExcludeLine(line) {
  const norm = line.trim().toLowerCase();
  if (norm.length < 6) return true;
  if (/^(\[?tool_use\]?|\[?tool_result\]?|\[?json\]?|\[?base64\]?|\[?stack\]?|\[?error\]?|\[?exception\]?|\[?auto-capture\]?)\s*[:=\s]/i.test(norm)) return true;
  if (/^\[auto-capture\]\s/i.test(norm)) return true;
  if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/i.test(line) || /-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/i.test(line)) return true;
  if (lowValuePatterns.some((p) => (p.global ? p.test(line) : p.test(line)))) return true;
  if (/^\s*(```json|```typescript|```javascript|```bash|```python|```zsh|```sh)\s*$/i.test(norm)) return true;
  if (/^\s*(```)[\s\S]{0,30}\n/.test(line)) return true;
  return false;
}

export function filterSessionText(raw) {
  if (typeof raw !== "string") return "";
  const parts = raw
    .split("\n")
    .map((l) => l.replace(/\n/g, ""))
    .filter((l) => l.trim().length > 0 && !shouldExcludeLine(l));
  const joined = parts.join("\n").trim();
  return joined;
}

export function checkSensitive(text) {
  const sensitive = looksSensitive(text);
  if (sensitive) return "sensitive";
  return "normal";
}

const MIN_QUALITY_LENGTH = 60;

export async function autoCapture({ sessionData, memoryConfig, storage, classifyMemory, extractionService }) {
  if (!memoryConfig.chatMessage?.enabled) return;

  const sessionText =
    (sessionData?.messages || [])
      .map((m) => stripInjectedBlock(m?.content || ""))
      .filter(Boolean)
      .join("\n") || "";
  const filtered = filterSessionText(sessionText);
  if (filtered.length < MIN_QUALITY_LENGTH) {
    console.log(`[opencode-mem-decision] auto-capture skipped: filtered text length ${filtered.length} below threshold`);
    return { action: "skip", reason: "below quality threshold" };
  }

  const classified = classifyMemory ? classifyMemory() : defaultClassifyMemory(filtered);
  const sensitivity = checkSensitive(filtered);

  // Summarize before classification if text is long
  const useSummary = filtered.length > 5000;
  const textToClassify = useSummary ? summarizeLongText(filtered) : filtered;
  const classifiedForText = classifyMemory ? classifyMemory(textToClassify) : defaultClassifyMemory(textToClassify);
  const storageText = useSummary ? summarizeLongText(filtered, 8) : filtered;

  await logEvent({
    sessionID: sessionData?.id,
    actor: "system",
    event_type: "auto-capture",
    description: `Filtered session length ${filtered.length}, classified type ${classified.type}, sensitive ${sensitivity}, summary=${useSummary}`,
    related_memory_ids: [],
  });

  const duplicateConfig = memoryConfig.duplicateDetection || { enabled: true, similarityThreshold: 0.75, updateOnMatch: true };
  const sessionDir = deriveSessionDirFromMessages(sessionData?.messages || []);
  const projectShared = await resolveProjectShared({ memoryConfig, cwd: sessionDir || process.cwd() });
  const projectTag = projectShared ? [projectShared.projectName] : [];

  // Skip storing raw sensitive/high-risk content; store summary only if appropriate
  if (sensitivity === "sensitive" && filtered.length > 1500 && useSummary) {
    const summaryText = storageText;
    if (summaryText.length < MIN_QUALITY_LENGTH) {
      await logEvent({
        sessionID: sessionData?.id,
        actor: "system",
        event_type: "auto-capture",
        description: `Sensitive content skipped: summary below quality threshold`,
        related_memory_ids: [],
      });
      return { action: "skip", reason: "sensitive content below threshold" };
    }
    const memory = await storage.addMemory(
      redactCredentials(summaryText),
      projectShared ? "project:" + projectShared.projectName : "project",
      sessionData?.id,
      {
        type: "summary",
        confidence: 0.85,
        sensitive: "sensitive",
        priority: 1,
        tags: ["auto-summary", "sensitive-detected", ...(projectTag || [])],
      },
      duplicateConfig
    );
    if (!memory) {
      return { action: "skip", reason: "summary below similarity threshold" };
    }
    return { action: "add", id: memory.id, summary: true };
  }

  const memory = await storage.addMemory(
    useSummary ? redactCredentials(storageText) : redactCredentials(filtered),
    projectShared ? "project:" + projectShared.projectName : "project",
    sessionData?.id,
    {
      type: classifiedForText.type,
      confidence: classifiedForText.confidence,
      sensitive: sensitivity,
      priority: classifiedForText.priority,
      tags: [...(classifiedForText.tags || []), ...(projectTag || [])],
    },
    duplicateConfig
  );

  const existingMemories = await storage.listMemories(1000, projectShared ? `project:${projectShared.projectName}` : "default", memoryConfig);
  const existingIds = new Set(existingMemories.map((m) => m.id));

  if (!memory) {
    return { action: "skip", reason: "below similarity threshold" };
  }

  const wasUpdate = existingIds.has(memory.id);

  if (extractionService) {
    try {
      const extracted = await extractionService.extract(filtered);
      if (extracted && typeof extracted === "object") {
        const summary = typeof extracted.summary === "string" && extracted.summary.trim().length > 0 ? extracted.summary : null;
        const decisions = Array.isArray(extracted.decisions) ? extracted.decisions.filter(Boolean) : [];
        const topics = Array.isArray(extracted.topics) ? extracted.topics.filter(Boolean) : [];
        const codeSnippets = Array.isArray(extracted.codeSnippets) ? extracted.codeSnippets.filter(Boolean) : [];

        if (summary) {
          const summaryText = `Auto-extracted summary:\n${summary}\nTopics: ${topics.join(", ")}`;
          await storage.addMemory(
            summaryText,
            projectShared ? "project:" + projectShared.projectName : "project",
            sessionData?.id,
            { type: "summary", confidence: 0.85, sensitive: "normal", priority: 1, tags: ["auto-extraction", ...(projectTag || [])] },
            duplicateConfig
          );
        }
        if (decisions.length > 0) {
          await storage.addMemory(
            `Auto-extracted decisions:\n${decisions.map((d, i) => `${i + 1}. ${d}`).join("\n")}`,
            projectShared ? "project:" + projectShared.projectName : "project",
            sessionData?.id,
            { type: "decision", confidence: 0.85, sensitive: "normal", priority: 1, tags: ["auto-extraction", ...(projectTag || [])] },
            duplicateConfig
          );
        }
        if (codeSnippets.length > 0) {
          await storage.addMemory(
            `Auto-extracted code snippets:\n${codeSnippets.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
            projectShared ? "project:" + projectShared.projectName : "project",
            sessionData?.id,
            { type: "code", confidence: 0.85, sensitive: "normal", priority: 1, tags: ["auto-extraction", ...(projectTag || [])] },
            duplicateConfig
          );
        }
      }
    } catch (e) {
      console.error(`[opencode-mem-decision] extraction failed: ${e.message}`);
    }
  }

  const summary = await summarizeRecentEvents({ hours: 24 });
  if (summary && !wasUpdate) {
    await storage.addMemory(
      `Session Summary: ${summary.summary}\nRelated memory IDs: ${summary.related_memory_ids.join(",")}`,
      projectShared ? `project:${projectShared.projectName}` : "project",
      null,
      { type: "summary", confidence: 0.8, sensitivity: "normal", tags: ["auto-summary"] },
      duplicateConfig
    );
  }

  if (wasUpdate) {
    return { action: "update", id: memory.id };
  }
  return { action: "add", id: memory.id };
}
