const REDACTION_PATTERNS = [
  {
    name: "GitHub Token",
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
  },
  {
    name: "OpenAI API Key",
    pattern: /sk-[a-zA-Z0-9]{32,}/g,
  },
  {
    name: "AWS Access Key",
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: "Slack Token",
    pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[0-9a-zA-Z]{24}/g,
  },
  {
    name: "GCP API Key",
    pattern: /AIza[0-9A-Za-z\-_]{35}/g,
  },
  {
    name: "PEM Private Key",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
];

export function redactCredentials(text) {
  if (typeof text !== "string") return text;

  let redacted = text;
  for (const { name, pattern } of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, `[REDACTED:${name}]`);
  }
  return redacted;
}

export function isRedacted(text) {
  return REDACTION_PATTERNS.some(({ pattern }) => pattern.test(text));
}
