const SENSITIVE_PATTERNS = [
  { name: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,255}/g },
  { name: "OpenAI API Key", pattern: /sk-[a-zA-Z0-9]{32,}/g },
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "Slack Token", pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[0-9a-zA-Z]{24}/g },
  { name: "GCP API Key", pattern: /AIza[0-9A-Za-z\-_]{35}/g },
  { name: "PEM Private Key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: "CC or Personal ID", pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/gi },
  { name: "Email address", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
  { name: "Phone number", pattern: /\b(?:\+?\d{1,3}[-\s]?)?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}\b/g },
];

export const TYPE_PATTERNS = [
  {
    type: "preference",
    pattern: /(?:prefer(?:s|able)?|likes?|dislikes?|always|never|usually|tends? to|avoids?|want(?:s)?|not want)/i,
    weight: 0.3,
  },
  {
    type: "rule",
    pattern: /\b(r|require|requires?|must|should|cannot|avoid|never|always|must not|enforce)\b/i,
    weight: 0.4,
  },
  {
    type: "lesson",
    pattern: /(?:lessons?|learn(?:ed|ing)|mistake|bugs?|fix(?:ed|es)?|errors?|root cause|debug(?:ging|ged))/i,
    weight: 0.3,
  },
  {
    type: "fact",
    pattern: /\b(?:uses|used|implemented|built on|based on|deployed on|configured|the [a-z]+ is|runs on|depends on)\b/i,
    weight: 0.2,
  },
  {
    type: "system",
    pattern: /system|instruction|prompt|rule of system/i,
    weight: 0.2,
  },
  {
    type: "task",
    pattern: /(?:how to|steps to|procedure for|instructions for|workflow for|setup for)/i,
    weight: 0.3,
  },
];

export function looksSensitive(text) {
  if (typeof text !== "string") return false;
  return SENSITIVE_PATTERNS.some(({ pattern }) => pattern.test(text));
}

export function classifyMemory(text) {
  if (typeof text !== "string") return { type: "fact", confidence: 0.5, sensitive: false };
  const sensitive = looksSensitive(text);
  let type = "fact";
  let confidence = 0.5;
  let matchCount = 0;
  for (const { type: t, pattern, weight } of TYPE_PATTERNS) {
    // Keep global flag; we advance lastIndex after each match to avoid zero-length loops.
    const tempPattern = new RegExp(pattern.source, (pattern.flags || "") + "g");
    let match;
    let count = 0;
    while ((match = tempPattern.exec(text)) !== null) {
      count++;
      matchCount++;
      type = t;
      confidence += weight;
      // Stop after first non-fact match; do not check later patterns.
      if (t !== "fact") break;
      // Advance manually to avoid zero-length or boundary loops.
      tempPattern.lastIndex = match.index + (match[0].length || 1);
    }
    if (count > 0 && t !== "fact") break;
  }
  const lengthScore = text.length < 40 ? 0 : text.length >= 150 ? 0.05 : 0;
  confidence = Math.min(1, confidence + lengthScore);
  const priority = confidence >= 0.8 ? 2 : confidence >= 0.65 ? 1 : 0;
  const tags = extractTags(text, type);
  return { type, confidence, sensitive, priority, tags };
}

function extractTags(text, type) {
  const tags = new Set();
  if (type === "fact") {
    const techMatches = text.match(/\b(?:React|Vue|Svelte|Angular|Node|Express|Fastify|Python|TypeScript|JavaScript|Go|Rust|Docker|Kubernetes|AWS|GCP|Azure|PostgreSQL|Redis|MongoDB|Prisma|Tauri|Capacitor|Electron)\b/gi);
    if (techMatches) {
      techMatches.forEach((t) => tags.add(t.toLowerCase()));
    }
  }
  if (type === "lesson" && /error|bug|fix/i.test(text)) tags.add("debug");
  if (type === "preference" && /language|中文|Traditional Chinese/i.test(text)) tags.add("language");
  if (tags.size > 0) return Array.from(tags).slice(0, 3);
  return [];
}
