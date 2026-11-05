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

const TECH_VOCAB = new Set([
  "react", "vue", "svelte", "angular", "node", "express", "fastify",
  "python", "typescript", "javascript", "go", "rust", "java", "csharp",
  "docker", "kubernetes", "aws", "gcp", "azure", "postgresql", "redis",
  "mongodb", "prisma", "tauri", "capacitor", "electron", "nextjs", "nuxt",
  "sveltekit", "astro", "deno", "bun", "supabase", "vercel", "netlify",
  "graphql", "rest", "grpc", "oauth", "jwt", "saml", "sso", "openid",
  "wasm", "neon", "deno", "bun", "turborepo", "monorepo", "microservice",
  "serverless", "lamdba", "cloudflare", "cloudfront", "cloudfunction",
  "terraform", "ansible", "puppet", "chef", "vault", "secretsmanager",
  "prometheus", "grafana", "opentelemetry", "kibana", "logstash", "filebeat",
  "mysql", "sqlite", "mariadb", "influxdb", "cassandra", "elasticsearch",
  "kafka", "rabbitmq", "redis", "memcached", "solr", "mongodb",
]);

function extractTechTerms(text) {
  const terms = new Set();
  const lower = text.toLowerCase();
  const normalized = lower.replace(/[\.\-]/g, "");
  for (const term of TECH_VOCAB) {
    if (normalized.includes(term.replace(/[\.\-]/g, ""))) terms.add(term);
  }
  // camelCase words and acronyms (>=3 chars, at least 2 lowercase letters)
  const wordMatches = text.match(/[a-zA-Z]{3,}/g) || [];
  for (const w of wordMatches) {
    if (/[a-z]{2,}/.test(w) && /[A-Z]/.test(w) && w.length < 30) {
      terms.add(w.toLowerCase().replace(/[\.\-]/g, ""));
    }
  }
  // version-like identifiers
  const versionMatches = text.match(/(?:v|ver)[.\d]+/gi) || [];
  for (const v of versionMatches) terms.add(v.toLowerCase());
  return Array.from(terms).slice(0, 5);
}

function extractErrorKeywords(text) {
  const errs = text.match(/\b(?:ERR_?[A-Z_0-9]+|E\d{4}|4\d{2}|5\d{2}|invalid|unauthorized|forbidden|timeout|failed|error)[^\n]*/gi) || [];
  return Array.from(new Set(errs.map(e => e.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20)))).slice(0, 3);
}

function extractTags(text, type) {
  const tags = [];

  if (type === "lesson") {
    if (/error|bug|fix|fail|debug|root cause/i.test(text)) tags.push("debug");
    if (/mistake|learned|lesson/i.test(text)) tags.push("lesson");
  } else if (type === "task") {
    tags.push("howto");
    if (/workflow|procedure|setup|steps/i.test(text)) tags.push("workflow");
  } else if (type === "preference") {
    if (/language|中文|Traditional Chinese|繁體中文/i.test(text)) tags.push("language");
    if (/prefer|always|never/i.test(text)) tags.push("preference");
  } else if (type === "rule") {
    tags.push("rule");
    if (/must|require|enforce/i.test(text)) tags.push("policy");
  }

  const techTerms = extractTechTerms(text);
  for (const t of techTerms) {
    if (!tags.includes(t)) tags.push(t);
  }

  const errorKeywords = extractErrorKeywords(text);
  for (const e of errorKeywords) {
    if (!tags.includes(e)) tags.push(e);
  }

  return tags.slice(0, 5);
}
