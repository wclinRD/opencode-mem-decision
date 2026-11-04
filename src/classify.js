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

const TYPE_PATTERNS = [
  { type: "preference", pattern: /(?:prefer|preferable|like|dislike|always|never|usually|tend to|avoid|not want)/i },
  { type: "rule", pattern: /\b(r|require|must|should|cannot|avoid|never|always)\b/i },
  { type: "lesson", pattern: /(?:lesson|learned|mistake|bug|fix|error|root cause|debug)/i },
  { type: "fact", pattern: /(?:uses|uses in|implemented|built on|based on|deployed on|configured|the [a-z]+ is)/i },
  { type: "system", pattern: /system|instruction|prompt|rule of system/i },
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
  for (const { type: t, pattern } of TYPE_PATTERNS) {
    if (pattern.test(text)) {
      type = t;
      confidence += 0.25;
      break;
    }
  }
  return { type, confidence, sensitive };
}
